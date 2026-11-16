import type { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { CollectedRecord } from '../data/collection'
import { checkStaged } from './pull'
import { archiveGame, archivedGames, checkedSnapshot, openArchive, type ArchivedGame, type RestoreResult } from './recordArchive'
import type { StagingStore } from './staging'
import { PROXY_CONFIG, printedJson, runWrangler, type WranglerRun } from './wrangler'

/**
 * The store of collected games: the D1 table `collected_games` that the collection Worker writes
 * as each game arrives (`proxy/records.js`, schema in `proxy/migrations/`). One row a game: its key,
 * the UTC day it arrived and nothing finer, the build copied out of the payload, and the payload
 * gzipped.
 *
 * **Read from this machine by loading it** (`loadStore`) into an archive in memory, the same table
 * `recordArchive.ts` keeps in a local file, so the status, the snapshot and the rows read either
 * one the same way. An `ArchivedGame`'s `pulledDay` is the day the game reached its store.
 *
 * `CollectedStore` is all the commands know of D1: a page of rows, every key, and adding games. The
 * one implementation runs `wrangler d1 execute` (`wrangler.ts`). A payload comes back as hex (the
 * JSON answer has no bytes) and goes in as a hex literal from a file of statements.
 */

export interface CollectedStore {
  /** Up to `page` games with a key after `after` (`''` for the first page), in key order. */
  rows(after: string, page: number): ArchivedGame[]
  /** Every key held, in order. */
  keys(): string[]
  /** Add these games. A game already held keeps its row as first written. */
  add(games: ArchivedGame[]): void
}

const BINDING = 'GAME_DB'
const GAME_KEY = /^[0-9a-f]{16}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** How many games one statement file carries, so a large move is several modest uploads. */
const ADD_BATCH = 200

/** A key, checked before it is put into SQL text. */
function key(value: string): string {
  if (!GAME_KEY.test(value)) throw new Error(`not a game key: ${JSON.stringify(value).slice(0, 40)}`)
  return value
}

const text = (value: string | null | undefined): string => (value === null || value === undefined ? 'NULL' : `'${value.replaceAll("'", "''")}'`)

/** The rows a `d1 execute --json` printed. */
function results(stdout: string): Record<string, unknown>[] {
  const answer = printedJson(stdout)
  const first = Array.isArray(answer) ? (answer[0] as { results?: unknown } | undefined) : undefined
  if (!first || !Array.isArray(first.results)) throw new Error('wrangler d1 execute: not a set of results')
  return first.results as Record<string, unknown>[]
}

/**
 * The D1 store, through wrangler. `where` says which database: the account's by default, or
 * wrangler's local one (`['--local', '--persist-to', DIR]`), which is how the commands are tried
 * without touching the account.
 */
export function d1Store(run: WranglerRun = runWrangler, where: string[] = ['--remote']): CollectedStore {
  const database = ['wrangler', 'd1', 'execute', BINDING, ...where, '--config', PROXY_CONFIG]
  const query = (sql: string): Record<string, unknown>[] => results(run([...database, '--json', '--command', sql]))
  return {
    rows(after, page) {
      const from = after === '' ? '' : key(after)
      return query(`SELECT game_key, received_day, hex(payload) AS payload FROM collected_games WHERE game_key > '${from}' ORDER BY game_key LIMIT ${Math.floor(page)}`).map(row => ({
        gameKey: String(row.game_key),
        pulledDay: String(row.received_day),
        payload: gunzipSync(Buffer.from(String(row.payload), 'hex')).toString('utf8'),
      }))
    },
    keys() {
      return query('SELECT game_key FROM collected_games ORDER BY game_key').map(row => String(row.game_key))
    },
    add(games) {
      const statements = games.map(game => {
        if (!DAY.test(game.pulledDay)) throw new Error(`not a day: ${JSON.stringify(game.pulledDay).slice(0, 40)}`)
        const build = (JSON.parse(game.payload) as Pick<CollectedRecord, 'build'>).build
        const payload = gzipSync(game.payload).toString('hex')
        return `INSERT INTO collected_games (game_key, received_day, release, commit_id, payload) VALUES ('${key(game.gameKey)}', '${game.pulledDay}', ${text(build?.release)}, ${text(build?.commitId)}, X'${payload}') ON CONFLICT (game_key) DO NOTHING;\n`
      })
      for (let from = 0; from < statements.length; from += ADD_BATCH) {
        const dir = mkdtempSync(join(tmpdir(), 'collected-'))
        const file = join(dir, 'add.sql')
        try {
          writeFileSync(file, statements.slice(from, from + ADD_BATCH).join(''))
          // `--yes`: nothing is there to answer wrangler's prompt before a file is run on the account.
          run([...database, '--file', file, '--yes'])
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      }
    },
  }
}

/** Every game in the store, as an archive in memory, read `page` at a time by key. */
export function loadStore(store: CollectedStore, page = 500): DatabaseSync {
  const db = openArchive(':memory:')
  let after = ''
  for (;;) {
    const games = store.rows(after, page)
    for (const game of games) archiveGame(db, game)
    if (games.length < page) return db
    after = games[games.length - 1].gameKey
  }
}

/**
 * Add the games the store does not hold, then read its keys again: a game that is still not there
 * throws, so a count that comes back is a count of games that are in the store.
 */
export function addToStore(store: CollectedStore, games: ArchivedGame[]): { added: number; duplicates: number } {
  const before = new Set(store.keys())
  const unique = new Map(games.map(game => [game.gameKey, game]))
  const missing = [...unique.values()].filter(game => !before.has(game.gameKey))
  store.add(missing)
  const after = new Set(store.keys())
  const absent = missing.filter(game => !after.has(game.gameKey))
  if (absent.length > 0) throw new Error(`the store does not hold ${absent.length} of the games just added, first ${absent[0].gameKey}`)
  return { added: missing.length, duplicates: unique.size - missing.length }
}

/** A snapshot into the store: the games whose key is their payload's, added; the rest refused and named. */
export function restoreToStore(store: CollectedStore, path: string): RestoreResult {
  const { games, refused } = checkedSnapshot(path)
  return { ...addToStore(store, games), refused }
}

export interface MigrateResult {
  /** Games in the local archive. */
  archived: number
  /** Keys in KV staging. */
  staged: number
  /** Staged values left out because they are not the game their key names. Still staged. */
  refused: { key: string; reason: string }[]
  /** Distinct games moved or already in the store. */
  games: number
  added: number
  duplicates: number
  /** Keys of games from either source that the store does not hold once the move is done. Empty when it worked. */
  missing: string[]
}

/**
 * The one-off move into the store: every game in the local archive and every game in KV staging,
 * then every key of both read back from the store. **Nothing is deleted from either source**: that
 * is a separate step, by hand, once the move has been checked.
 *
 * An archived game keeps the day it was pulled. A staged game is checked to be the game its key
 * names (`checkStaged`) and is not replayed, since the store holds games whether or not this build
 * can replay them; it takes `day`. A game in both is moved once, with its archived day.
 */
export function migrateToStore(store: CollectedStore, staging: StagingStore, archive: DatabaseSync, day: string): MigrateResult {
  const fromArchive = [...archivedGames(archive)]
  const games = new Map(fromArchive.map(game => [game.gameKey, game]))

  const listed: string[] = []
  let cursor: string | undefined
  do {
    const page = staging.list(cursor)
    listed.push(...page.keys)
    cursor = page.cursor
  } while (cursor !== undefined)

  const refused: MigrateResult['refused'] = []
  const values = staging.get(listed)
  for (const name of listed) {
    try {
      const value = values.get(name)
      if (value === undefined) throw new Error('listed, but no value came back for it')
      const game = checkStaged(name, value)
      if (!games.has(game.gameKey)) games.set(game.gameKey, { gameKey: game.gameKey, pulledDay: day, payload: game.payload })
    } catch (err) {
      refused.push({ key: name, reason: (err as Error).message })
    }
  }

  const added = addToStore(store, [...games.values()])
  const held = new Set(store.keys())
  return {
    archived: fromArchive.length,
    staged: listed.length,
    refused,
    games: games.size,
    ...added,
    missing: [...games.keys()].filter(k => !held.has(k)).sort(),
  }
}
