import { DatabaseSync } from 'node:sqlite'
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { CollectedRecord } from '../data/collection'
import { gameKey } from './trainingRows'

/**
 * The archive of collected games: a local SQLite database, via Node's built-in `node:sqlite` as the
 * bench results are (`store.ts`), holding one row for each game pulled out of staging (`pull.ts`).
 *
 * **A row is the game's key, the payload, and the day it was pulled.** The payload is what the
 * player's app sent and the Worker staged, kept whole as JSON, so the archive holds exactly what
 * was collected and anything derived from a game (its training rows) is derived again from here.
 * The build beside it is copied out of the payload so the archive can be counted by build without
 * parsing every game.
 *
 * **The day is all the archive knows about when.** The payload says how long a game took and not
 * when it was played, the Worker records no arrival time, and a pull adds only its own date. The
 * table refuses a `pulled_day` that is anything but a date.
 *
 * It is a file of its own, apart from the bench results, because those can be measured again and
 * this cannot: once staging has been emptied the archive is the only copy. Hence the snapshot
 * (`writeSnapshot`), which is the archive as one compressed file of plain JSON Lines that restores
 * into an empty archive and that the row tool reads as it stands.
 */

export const DEFAULT_ARCHIVE_PATH = 'bench-results/collected-games.db'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS collected_games (
    game_key   TEXT PRIMARY KEY,
    pulled_day TEXT NOT NULL CHECK (pulled_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    release    TEXT,
    commit_id  TEXT,
    payload    TEXT NOT NULL
  );
`

/** As `store.ts`: a write takes milliseconds, so waiting out another writer is always right. */
const BUSY_TIMEOUT_MS = 30_000

/** Open (creating if absent) the archive at `path`. */
export function openArchive(path: string): DatabaseSync {
  const inMemory = path === ':memory:'
  if (!inMemory) mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  if (!inMemory) db.exec('PRAGMA journal_mode = WAL')
  db.exec(SCHEMA)
  return db
}

/** One archived game. `payload` is the staged record as JSON text. */
export interface ArchivedGame {
  gameKey: string
  /** `YYYY-MM-DD`, and never anything finer. */
  pulledDay: string
  payload: string
}

/** The date of a moment, in UTC, with its time of day dropped. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Add one game. `false` when the archive already holds that key, in which case nothing changes:
 * the game keeps the day it was first pulled. Each call is its own committed write, so a game this
 * has returned for is on disk before the caller does anything else with it.
 */
export function archiveGame(db: DatabaseSync, game: ArchivedGame): boolean {
  const build = (JSON.parse(game.payload) as Pick<CollectedRecord, 'build'>).build
  // `ON CONFLICT (game_key)` and not `INSERT OR IGNORE`: the second would also swallow the day check.
  const done = db
    .prepare('INSERT INTO collected_games (game_key, pulled_day, release, commit_id, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT (game_key) DO NOTHING')
    .run(game.gameKey, game.pulledDay, build?.release ?? null, build?.commitId ?? null, game.payload)
  return Number(done.changes) === 1
}

export function hasGame(db: DatabaseSync, key: string): boolean {
  return db.prepare('SELECT 1 FROM collected_games WHERE game_key = ?').get(key) !== undefined
}

/**
 * Every game, in key order, read `page` at a time so the whole archive is never in memory at once.
 * Paged by key rather than by offset, so a page costs the same however far in it is.
 */
export function* archivedGames(db: DatabaseSync, page = 500): Generator<ArchivedGame> {
  const next = db.prepare('SELECT game_key, pulled_day, payload FROM collected_games WHERE game_key > ? ORDER BY game_key LIMIT ?')
  let after = ''
  for (;;) {
    const rows = next.all(after, page) as { game_key: string; pulled_day: string; payload: string }[]
    for (const row of rows) yield { gameKey: row.game_key, pulledDay: row.pulled_day, payload: row.payload }
    if (rows.length < page) return
    after = rows[rows.length - 1].game_key
  }
}

export interface ArchiveStatus {
  games: number
  /** Games by the build that played them, as `release (commit)`, or `unknown` for a payload with no build. */
  byBuild: { build: string; games: number }[]
}

export function archiveStatus(db: DatabaseSync): ArchiveStatus {
  const rows = db
    .prepare('SELECT release, commit_id, COUNT(*) AS games FROM collected_games GROUP BY release, commit_id')
    .all() as { release: string | null; commit_id: string | null; games: number }[]
  const byBuild = rows
    .map(r => ({ build: r.release === null ? 'unknown' : `${r.release} (${r.commit_id})`, games: Number(r.games) }))
    .sort((a, b) => a.build.localeCompare(b.build, 'en', { numeric: true }))
  return { games: byBuild.reduce((n, b) => n + b.games, 0), byBuild }
}

// --- Snapshots ------------------------------------------------------------

/** Raised when a reader of an older snapshot would misread a newer one. */
export const SNAPSHOT_FORMAT_VERSION = 1

const SNAPSHOT_KIND = 'collected-games'

/** The first line of a snapshot: what the file is, and how many games follow. */
interface SnapshotHeader {
  snapshot: typeof SNAPSHOT_KIND
  formatVersion: number
  games: number
}

export interface SnapshotFile {
  path: string
  games: number
  bytes: number
}

/** A snapshot's place in a folder: one file a day, so a later one the same day replaces it. */
export function snapshotPath(dir: string, day: string): string {
  return join(dir, `${SNAPSHOT_KIND}-${day}.jsonl.gz`)
}

/**
 * Write the whole archive to `dir` as one dated file: gzipped JSON Lines, a header and then a game
 * to a line with its payload as plain JSON. Nothing but `gunzip` is needed to read it.
 *
 * The games are read through the database, in one read transaction, and not by copying its file,
 * which could be part way through a write. They are compressed `batch` at a time into one file (a
 * gzip file may be several compressed pieces end to end), so writing holds no more than a batch.
 *
 * As `records.ts` writes its files: the snapshot appears under its name only when it is whole.
 */
export function writeSnapshot(db: DatabaseSync, dir: string, day: string, batch = 500): SnapshotFile {
  const path = snapshotPath(dir, day)
  const partial = `${path}.partial`
  mkdirSync(dir, { recursive: true })
  db.exec('BEGIN')
  try {
    const games = archiveStatus(db).games
    const header: SnapshotHeader = { snapshot: SNAPSHOT_KIND, formatVersion: SNAPSHOT_FORMAT_VERSION, games }
    writeFileSync(partial, gzipSync(`${JSON.stringify(header)}\n`))
    let lines: string[] = []
    const flush = (): void => {
      if (lines.length > 0) appendFileSync(partial, gzipSync(lines.join('')))
      lines = []
    }
    for (const game of archivedGames(db, batch)) {
      // The payload is JSON already, so it goes in as it is and the line stays plain JSON.
      lines.push(`{"gameKey":${JSON.stringify(game.gameKey)},"pulledDay":${JSON.stringify(game.pulledDay)},"payload":${game.payload}}\n`)
      if (lines.length >= batch) flush()
    }
    flush()
    renameSync(partial, path)
    return { path, games, bytes: statSync(path).size }
  } finally {
    db.exec('COMMIT')
  }
}

/**
 * The games in a snapshot file. Throws for a file that is not one, is in a format this build does
 * not read, or does not hold the number of games its first line says it does.
 */
export function readSnapshot(path: string): ArchivedGame[] {
  const notOne = new Error(`${path}: not a snapshot of collected games`)
  let lines: string[]
  try {
    lines = gunzipSync(readFileSync(path)).toString('utf8').split('\n').filter(line => line !== '')
  } catch (err) {
    throw new Error(`${notOne.message} (${(err as Error).message})`, { cause: err })
  }
  let header: Partial<SnapshotHeader> | null
  try {
    header = JSON.parse(lines[0] ?? 'null') as Partial<SnapshotHeader> | null
  } catch {
    throw notOne
  }
  if (!header || header.snapshot !== SNAPSHOT_KIND || typeof header.formatVersion !== 'number') throw notOne
  if (header.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
    throw new Error(`${path}: snapshot format version ${header.formatVersion}, and this build reads ${SNAPSHOT_FORMAT_VERSION}`)
  }
  const games = lines.slice(1).map((line): ArchivedGame => {
    const { gameKey: key, pulledDay, payload } = JSON.parse(line) as { gameKey: string; pulledDay: string; payload: unknown }
    return { gameKey: key, pulledDay, payload: JSON.stringify(payload) }
  })
  if (games.length !== header.games) throw new Error(`${path}: says it holds ${header.games} games and holds ${games.length}`)
  return games
}

export interface RestoreResult {
  added: number
  duplicates: number
  /** Games left out because their key is not the key of their payload: the line was altered or damaged. */
  refused: { gameKey: string; reason: string }[]
}

/**
 * Put a snapshot's games into an archive, in one transaction. Into an empty archive that is a
 * restore; into one that holds games it adds the ones missing. Each game's key is worked out again
 * from its payload first, which is what catches a damaged file.
 */
export function restoreSnapshot(db: DatabaseSync, path: string): RestoreResult {
  const games = readSnapshot(path)
  const result: RestoreResult = { added: 0, duplicates: 0, refused: [] }
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const game of games) {
      const actual = gameKey(JSON.parse(game.payload) as CollectedRecord)
      if (actual !== game.gameKey) result.refused.push({ gameKey: game.gameKey, reason: `its payload is game ${actual}` })
      else if (archiveGame(db, game)) result.added++
      else result.duplicates++
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return result
}
