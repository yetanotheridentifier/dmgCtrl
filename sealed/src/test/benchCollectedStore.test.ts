// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { addToStore, d1Store, loadStore, migrateToStore, restoreToStore, type CollectedStore } from '../bench/collectedStore'
import { archiveGame, archiveStatus, archivedGames, openArchive, writeSnapshot, type ArchivedGame } from '../bench/recordArchive'
import { STAGING_PREFIX } from '../bench/staging'
import { fakeStaging, stagedGame } from './helpers/stagedGames'

/**
 * The store of collected games: the D1 table the collection Worker writes (`proxy/records.js`),
 * read and written from this machine through wrangler. Here wrangler is stood in for by the same
 * schema in a local SQLite database (the Worker's own migration file), so the SQL this module sends
 * is the SQL that is run.
 */

const SCHEMA = readFileSync(resolve(process.cwd(), '../proxy/migrations/0001_collected_games.sql'), 'utf8')
const GAMES = [7, 11, 23].map(stagedGame)
const DAY = '2026-11-16'

const asArchived = (game: { gameKey: string; text: string }, day = DAY): ArchivedGame => ({ gameKey: game.gameKey, pulledDay: day, payload: game.text })

interface FakeD1 {
  db: DatabaseSync
  calls: string[][]
  store: CollectedStore
}

/** wrangler's `d1 execute`, answered from a local database holding the Worker's table. */
function fakeD1(): FakeD1 {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)
  const calls: string[][] = []
  const run = (args: string[]): string => {
    calls.push(args)
    const at = (flag: string): string | undefined => {
      const i = args.indexOf(flag)
      return i === -1 ? undefined : args[i + 1]
    }
    const file = at('--file')
    if (file !== undefined) {
      db.exec(readFileSync(file, 'utf8'))
      return ' ⛅️ wrangler 4.154.0\n🚣 Executed 3 queries\n'
    }
    const results = db.prepare(at('--command')!).all()
    return ` ⛅️ wrangler 4.154.0\n───────────\n${JSON.stringify([{ results, success: true, meta: {} }], null, 2)}\n`
  }
  return { db, calls, store: d1Store(run) }
}

describe('the D1 store, through wrangler', () => {
  it('keeps each game gzipped, with its key, day and build, and gives back the payload as it was sent', () => {
    const d1 = fakeD1()

    d1.store.add(GAMES.map(g => asArchived(g)))

    const raw = d1.db.prepare('SELECT * FROM collected_games ORDER BY game_key').all() as { game_key: string; received_day: string; release: string | null; payload: Uint8Array }[]
    expect(raw.map(r => r.game_key)).toEqual(GAMES.map(g => g.gameKey).sort())
    for (const row of raw) {
      const game = GAMES.find(g => g.gameKey === row.game_key)!
      expect(row.received_day).toBe(DAY)
      expect([row.payload[0], row.payload[1]]).toEqual([0x1f, 0x8b])
      expect(gunzipSync(row.payload).toString('utf8')).toBe(game.text)
      expect(row.release).toBe((JSON.parse(game.text) as { build?: { release: string } }).build?.release ?? null)
    }
    expect(d1.store.rows('', 10)).toEqual(GAMES.map(g => asArchived(g)).sort((a, b) => a.gameKey.localeCompare(b.gameKey)))
  })

  it('reads the table a page at a time, by key', () => {
    const d1 = fakeD1()
    d1.store.add(GAMES.map(g => asArchived(g)))
    const keys = GAMES.map(g => g.gameKey).sort()

    expect(d1.store.rows('', 2).map(g => g.gameKey)).toEqual(keys.slice(0, 2))
    expect(d1.store.rows(keys[1], 2).map(g => g.gameKey)).toEqual(keys.slice(2))
    expect(d1.store.keys()).toEqual(keys)
  })

  it('names the database by its binding in the proxy config, on the account unless told otherwise', () => {
    const d1 = fakeD1()
    d1.store.keys()

    expect(d1.calls[0]).toEqual(expect.arrayContaining(['d1', 'execute', 'GAME_DB', '--remote', '--config', 'proxy/wrangler.toml', '--json']))
  })

  it('never adds a key it was not given as one: a key is 16 hex digits', () => {
    const d1 = fakeD1()

    expect(() => d1.store.rows("' OR 1=1 --", 10)).toThrow('not a game key')
    expect(() => d1.store.add([{ ...asArchived(GAMES[0]), gameKey: "x'); DROP TABLE collected_games; --" }])).toThrow('not a game key')
  })
})

describe('reading the store as an archive', () => {
  it('holds every game, so status, snapshots and rows read it as they read the local file', () => {
    const d1 = fakeD1()
    d1.store.add(GAMES.map(g => asArchived(g)))

    const loaded = loadStore(d1.store, 2)

    expect([...archivedGames(loaded)]).toEqual(d1.store.rows('', 10))
    expect(archiveStatus(loaded).games).toBe(GAMES.length)
    const file = writeSnapshot(loaded, mkdtempSync(join(tmpdir(), 'store-')), DAY)
    expect(file.games).toBe(GAMES.length)
  })
})

describe('adding to the store', () => {
  it('adds the games it does not hold and leaves the rest as first written', () => {
    const d1 = fakeD1()
    d1.store.add([asArchived(GAMES[0], '2026-10-01')])

    const added = addToStore(d1.store, GAMES.map(g => asArchived(g)))

    expect(added).toEqual({ added: 2, duplicates: 1 })
    expect(d1.store.rows('', 10).find(g => g.gameKey === GAMES[0].gameKey)!.pulledDay).toBe('2026-10-01')
  })

  it('restores a snapshot, refusing a line whose payload is not its key', () => {
    const local = openArchive(':memory:')
    for (const g of GAMES) archiveGame(local, asArchived(g))
    const path = writeSnapshot(local, mkdtempSync(join(tmpdir(), 'store-')), DAY).path
    const d1 = fakeD1()

    const restored = restoreToStore(d1.store, path)

    expect(restored).toEqual({ added: GAMES.length, duplicates: 0, refused: [] })
    expect(d1.store.keys()).toEqual(GAMES.map(g => g.gameKey).sort())
  })
})

describe('moving the staged and archived games into the store', () => {
  it('moves every game from both, once, and checks each key is then in the store', () => {
    const local = openArchive(':memory:')
    archiveGame(local, asArchived(GAMES[0], '2026-10-13'))
    archiveGame(local, asArchived(GAMES[1], '2026-10-13'))
    const staging = fakeStaging([GAMES[1], GAMES[2]])
    const d1 = fakeD1()

    const moved = migrateToStore(d1.store, staging, local, DAY)

    expect(moved).toMatchObject({ archived: 2, staged: 2, games: 3, added: 3, duplicates: 0, refused: [], missing: [] })
    const held = d1.store.rows('', 10)
    expect(held.map(g => g.gameKey)).toEqual(GAMES.map(g => g.gameKey).sort())
    // An archived game keeps the day it was pulled; a game only in staging takes the day of the move.
    expect(held.find(g => g.gameKey === GAMES[1].gameKey)!.pulledDay).toBe('2026-10-13')
    expect(held.find(g => g.gameKey === GAMES[2].gameKey)!.pulledDay).toBe(DAY)
  })

  it('deletes nothing from staging or from the archive', () => {
    const local = openArchive(':memory:')
    archiveGame(local, asArchived(GAMES[0]))
    const staging = fakeStaging([GAMES[1]])

    migrateToStore(fakeD1().store, staging, local, DAY)

    expect(staging.calls.filter(c => c.op === 'delete')).toEqual([])
    expect(staging.values.size).toBe(1)
    expect(archiveStatus(local).games).toBe(1)
  })

  it('moves a staged game without replaying it, and refuses one whose value is not the game its key names', () => {
    const payload = JSON.parse(GAMES[0].text) as { winner: string }
    // A real game whose stored winner this build would not reach: the replay check is the row tool's now.
    const divergent = { ...GAMES[0], text: JSON.stringify({ ...payload, winner: payload.winner === 'player' ? 'opponent' : 'player' }) }
    const stray = { key: `${STAGING_PREFIX}0000000000000000`, text: GAMES[1].text }
    const staging = fakeStaging([divergent, stray])
    const d1 = fakeD1()

    const moved = migrateToStore(d1.store, staging, openArchive(':memory:'), DAY)

    expect(moved.refused).toEqual([{ key: stray.key, reason: expect.stringContaining('the key does not match the game') }])
    expect(d1.store.keys()).toEqual([GAMES[0].gameKey])
    expect(d1.store.rows('', 10)[0].payload).toBe(divergent.text)
  })

  it('is safe to run again: the second run adds nothing', () => {
    const local = openArchive(':memory:')
    archiveGame(local, asArchived(GAMES[0]))
    const staging = fakeStaging([GAMES[1]])
    const d1 = fakeD1()
    migrateToStore(d1.store, staging, local, DAY)

    expect(migrateToStore(d1.store, staging, local, DAY)).toMatchObject({ games: 2, added: 0, duplicates: 2, missing: [] })
  })
})
