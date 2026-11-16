// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { addToStore, loadStore, restoreToStore } from '../bench/collectedStore'
import { archiveGame, archiveStatus, archivedGames, openArchive, writeSnapshot, type ArchivedGame } from '../bench/recordArchive'
import { fakeD1 } from './helpers/fakeD1'
import { stagedGame } from './helpers/stagedGames'

/**
 * The store of collected games: the D1 table the collection Worker writes (`proxy/records.js`),
 * read and written from this machine through wrangler. Here wrangler is stood in for by the same
 * schema in a local SQLite database (the Worker's own migration files, `helpers/fakeD1.ts`), so the
 * SQL this module sends is the SQL that is run.
 */

const GAMES = [7, 11, 23].map(stagedGame)
const DAY = '2026-11-16'

const asArchived = (game: { gameKey: string; text: string }, day = DAY): ArchivedGame => ({ gameKey: game.gameKey, pulledDay: day, payload: game.text })

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
  it('holds every game, so status, snapshots and rows all read it the same way', () => {
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
    const local = openArchive()
    for (const g of GAMES) archiveGame(local, asArchived(g))
    const path = writeSnapshot(local, mkdtempSync(join(tmpdir(), 'store-')), DAY).path
    const d1 = fakeD1()

    const restored = restoreToStore(d1.store, path)

    expect(restored).toEqual({ added: GAMES.length, duplicates: 0, refused: [] })
    expect(d1.store.keys()).toEqual(GAMES.map(g => g.gameKey).sort())
  })
})

describe('the replay check kept beside each game', () => {
  const build = (game: { text: string }) => (JSON.parse(game.text) as { build?: { release: string; commitId: string } }).build

  it('starts unchecked, and lists every game with its build and no payload', () => {
    const d1 = fakeD1()
    d1.store.add(GAMES.map(g => asArchived(g)))

    const games = d1.store.games()
    expect(games.map(g => g.gameKey)).toEqual(GAMES.map(g => g.gameKey).sort())
    for (const game of games) {
      const staged = GAMES.find(g => g.gameKey === game.gameKey)!
      expect(game).toEqual({ gameKey: game.gameKey, release: build(staged)?.release ?? null, commitId: build(staged)?.commitId ?? null, check: null })
    }
  })

  it('records the build each game was checked on and the refusal, or none for a game that replayed', () => {
    const d1 = fakeD1()
    d1.store.add(GAMES.map(g => asArchived(g)))
    const [a, b] = GAMES.map(g => g.gameKey).sort()

    d1.store.recordChecks([
      { gameKey: a, checkedOn: 'abc1234', refusal: null, flagged: false },
      { gameKey: b, checkedOn: 'abc1234', refusal: "the replay threw: it's not legal", flagged: true },
    ])

    const checks = new Map(d1.store.games().map(g => [g.gameKey, g.check]))
    expect(checks.get(a)).toEqual({ checkedOn: 'abc1234', refusal: null, flagged: false })
    expect(checks.get(b)).toEqual({ checkedOn: 'abc1234', refusal: "the replay threw: it's not legal", flagged: true })
    expect([...checks.values()].filter(c => c === null)).toHaveLength(1)
  })

  it('keeps no time with a check, only the build it was made on', () => {
    const d1 = fakeD1()
    const columns = (d1.db.prepare('PRAGMA table_info(collected_games)').all() as { name: string }[]).map(c => c.name)
    expect(columns).toEqual(['game_key', 'received_day', 'release', 'commit_id', 'payload', 'checked_on', 'refusal', 'flagged'])
  })

  it('removes the games named and no others, and never a key it was not given as one', () => {
    const d1 = fakeD1()
    d1.store.add(GAMES.map(g => asArchived(g)))
    const keys = GAMES.map(g => g.gameKey).sort()

    d1.store.remove([keys[0], keys[2]])

    expect(d1.store.keys()).toEqual([keys[1]])
    expect(() => d1.store.remove(["x' OR 1=1 --"])).toThrow('not a game key')
    expect(() => d1.store.recordChecks([{ gameKey: "x' OR 1=1 --", checkedOn: 'abc1234', refusal: null, flagged: false }])).toThrow('not a game key')
    expect(d1.store.keys()).toEqual([keys[1]])
  })
})
