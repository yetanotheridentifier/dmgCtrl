// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { DatabaseSync } from 'node:sqlite'
import {
  archiveGame, archiveStatus, archivedGames, hasGame, openArchive, readSnapshot, restoreSnapshot, snapshotPath,
  today, writeSnapshot, SNAPSHOT_FORMAT_VERSION,
} from '../bench/recordArchive'
import { stagedGame } from './helpers/stagedGames'

/**
 * Collected games are kept in a local SQLite archive, one row a game under the game's own key. After
 * staging is emptied the archive is the only copy, so it can be written out as a dated snapshot and
 * read back into an empty archive, and what comes back is what went in.
 *
 * The archive says which day a game was pulled and nothing finer: no time of day exists for a
 * collected game anywhere upstream, and the archive does not add one.
 */

const GAMES = [7, 11, 23].map(stagedGame)
const DAY = '2026-10-13'

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'collected-'))
const filled = (path = ':memory:'): DatabaseSync => {
  const db = openArchive(path)
  for (const game of GAMES) archiveGame(db, { gameKey: game.gameKey, pulledDay: DAY, payload: game.text })
  return db
}
const everyRow = (db: DatabaseSync): unknown[] => db.prepare('SELECT * FROM collected_games ORDER BY game_key').all()

describe('the archive of collected games', () => {
  it('holds each game once, under its key, with the payload as it was staged', () => {
    const db = openArchive(':memory:')
    const [game] = GAMES

    expect(archiveGame(db, { gameKey: game.gameKey, pulledDay: DAY, payload: game.text })).toBe(true)
    expect(archiveGame(db, { gameKey: game.gameKey, pulledDay: '2026-10-14', payload: game.text })).toBe(false)

    expect(hasGame(db, game.gameKey)).toBe(true)
    expect(hasGame(db, GAMES[1].gameKey)).toBe(false)
    expect([...archivedGames(db)]).toEqual([{ gameKey: game.gameKey, pulledDay: DAY, payload: game.text }])
  })

  it('hands its games back in key order, however many there are', () => {
    const db = filled()
    expect([...archivedGames(db, 2)].map(g => g.gameKey)).toEqual(GAMES.map(g => g.gameKey).sort())
  })

  it('counts its games, and how many each build played', () => {
    const db = filled()
    const other = JSON.parse(GAMES[0].text) as Record<string, unknown>
    archiveGame(db, { gameKey: 'aaaaaaaaaaaaaaaa', pulledDay: DAY, payload: JSON.stringify({ ...other, build: { release: '413', commitId: 'def5678' } }) })
    const { build: _build, ...unbuilt } = other
    void _build
    archiveGame(db, { gameKey: 'bbbbbbbbbbbbbbbb', pulledDay: DAY, payload: JSON.stringify(unbuilt) })

    expect(archiveStatus(db)).toEqual({
      games: 5,
      byBuild: [
        { build: '412 (abc1234)', games: 3 },
        { build: '413 (def5678)', games: 1 },
        { build: 'unknown', games: 1 },
      ],
    })
  })

  it('is a file that survives being closed and opened again', () => {
    const path = join(tempDir(), 'nested', 'collected-games.db')
    filled(path).close()
    expect([...archivedGames(openArchive(path))]).toHaveLength(3)
  })
})

describe('what the archive records about when', () => {
  it('has a column for the day a game was pulled, and none for anything finer or anything else', () => {
    const db = openArchive(':memory:')
    const columns = (db.prepare('PRAGMA table_info(collected_games)').all() as { name: string }[]).map(c => c.name)
    expect(columns).toEqual(['game_key', 'pulled_day', 'release', 'commit_id', 'payload'])
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(t => t.name)
    expect(tables).toEqual(['collected_games'])
  })

  it('names the day from a moment, dropping the time of day', () => {
    expect(today(new Date('2026-10-13T23:59:59.999Z'))).toBe('2026-10-13')
    expect(today(new Date('2026-10-14T00:00:00.000Z'))).toBe('2026-10-14')
  })

  it('refuses a pulled day that carries a time', () => {
    const db = openArchive(':memory:')
    const [game] = GAMES
    for (const pulledDay of ['2026-10-13T16:22:24+01:00', '2026-10-13 16:22', '1760368944000', '']) {
      expect(() => archiveGame(db, { gameKey: game.gameKey, pulledDay, payload: game.text }), pulledDay).toThrow()
    }
    expect([...archivedGames(db)]).toEqual([])
  })

  it('stores nothing outside the payload that reads as a time of day', () => {
    const db = filled()
    for (const row of everyRow(db) as Record<string, unknown>[]) {
      const { payload, ...beside } = row
      void payload
      expect(beside.pulled_day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // A clock time, an ISO moment or an epoch count would all show here.
      expect(JSON.stringify(Object.values(beside))).not.toMatch(/\d{2}:\d{2}|T\d{2}|\d{10,}/)
    }
  })
})

describe('a snapshot of the archive', () => {
  it('is one dated, compressed file in the folder it is given', () => {
    const dir = tempDir()
    const file = writeSnapshot(filled(), dir, DAY)

    expect(file.path).toBe(snapshotPath(dir, DAY))
    expect(file.path).toBe(join(dir, 'collected-games-2026-10-13.jsonl.gz'))
    expect(file.games).toBe(3)
    expect(readdirSync(dir)).toEqual(['collected-games-2026-10-13.jsonl.gz'])
    expect(file.bytes).toBe(readFileSync(file.path).length)
    expect(file.bytes).toBeLessThan(GAMES.reduce((n, g) => n + g.text.length, 0))
  })

  it('is plain JSON Lines once unpacked: a header, then a game to a line with its payload whole', () => {
    const file = writeSnapshot(filled(), tempDir(), DAY)
    const lines = gunzipSync(readFileSync(file.path)).toString('utf8').trimEnd().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)

    expect(lines[0]).toEqual({ snapshot: 'collected-games', formatVersion: SNAPSHOT_FORMAT_VERSION, games: 3 })
    const sorted = [...GAMES].sort((a, b) => a.gameKey.localeCompare(b.gameKey))
    expect(lines.slice(1)).toEqual(sorted.map(g => ({ gameKey: g.gameKey, pulledDay: DAY, payload: JSON.parse(g.text) as unknown })))
  })

  it('reads back as the games that were archived', () => {
    const db = filled()
    const file = writeSnapshot(db, tempDir(), DAY)
    expect(readSnapshot(file.path)).toEqual([...archivedGames(db)])
  })

  it('holds every game of an archive larger than one write', () => {
    const db = filled()
    const file = writeSnapshot(db, tempDir(), DAY, 2)
    expect(readSnapshot(file.path)).toEqual([...archivedGames(db)])
  })

  it('restores into an empty archive as identical contents', () => {
    const dir = tempDir()
    const original = filled(join(dir, 'a.db'))
    const file = writeSnapshot(original, dir, '2026-11-01')

    const fresh = openArchive(join(dir, 'b.db'))
    expect(restoreSnapshot(fresh, file.path)).toEqual({ added: 3, duplicates: 0, refused: [] })

    expect(everyRow(fresh)).toEqual(everyRow(original))
    expect(archiveStatus(fresh)).toEqual(archiveStatus(original))
    // And a snapshot of the restored archive is the same file, byte for byte.
    const again = writeSnapshot(fresh, join(dir, 'again'), '2026-11-01')
    expect(readFileSync(again.path).equals(readFileSync(file.path))).toBe(true)
  })

  it('adds only what an archive does not already hold', () => {
    const dir = tempDir()
    const file = writeSnapshot(filled(), dir, DAY)
    const partial = openArchive(':memory:')
    archiveGame(partial, { gameKey: GAMES[0].gameKey, pulledDay: '2026-09-01', payload: GAMES[0].text })

    expect(restoreSnapshot(partial, file.path)).toEqual({ added: 2, duplicates: 1, refused: [] })
    // The game it already had keeps the day it was first pulled.
    expect([...archivedGames(partial)].find(g => g.gameKey === GAMES[0].gameKey)!.pulledDay).toBe('2026-09-01')
  })

  it('refuses a game whose key is not the key of its payload, and restores the rest', () => {
    const dir = tempDir()
    const [first, ...rest] = readSnapshot(writeSnapshot(filled(), dir, DAY).path)
    const lines = [
      { snapshot: 'collected-games', formatVersion: SNAPSHOT_FORMAT_VERSION, games: 3 },
      { gameKey: 'ffffffffffffffff', pulledDay: first.pulledDay, payload: JSON.parse(first.payload) as unknown },
      ...rest.map(g => ({ gameKey: g.gameKey, pulledDay: g.pulledDay, payload: JSON.parse(g.payload) as unknown })),
    ]
    const tampered = join(dir, 'tampered.jsonl.gz')
    writeFileSync(tampered, gzipSync(lines.map(l => `${JSON.stringify(l)}\n`).join('')))

    const db = openArchive(':memory:')
    const result = restoreSnapshot(db, tampered)

    expect(result.added).toBe(2)
    expect(result.refused).toEqual([{ gameKey: 'ffffffffffffffff', reason: expect.stringContaining(first.gameKey) as string }])
    expect(hasGame(db, 'ffffffffffffffff')).toBe(false)
  })

  it('refuses a file that is not a snapshot, or is one this build does not read', () => {
    const dir = tempDir()
    const notOne = join(dir, 'not.jsonl.gz')
    writeFileSync(notOne, gzipSync('{"formatVersion":1,"records":[]}\n'))
    expect(() => readSnapshot(notOne)).toThrow('not a snapshot of collected games')

    const newer = join(dir, 'newer.jsonl.gz')
    writeFileSync(newer, gzipSync('{"snapshot":"collected-games","formatVersion":99,"games":0}\n'))
    expect(() => readSnapshot(newer)).toThrow('snapshot format version 99')

    const short = join(dir, 'short.jsonl.gz')
    writeFileSync(short, gzipSync('{"snapshot":"collected-games","formatVersion":1,"games":2}\n'))
    expect(() => readSnapshot(short)).toThrow('says it holds 2 games and holds 0')
  })

  it('leaves no half-written file under the snapshot’s name', () => {
    const dir = tempDir()
    writeSnapshot(filled(), dir, DAY)
    expect(readdirSync(dir).filter(f => f.endsWith('.partial'))).toEqual([])
  })
})
