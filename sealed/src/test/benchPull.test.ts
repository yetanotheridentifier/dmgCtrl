// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archivedGames, openArchive, readSnapshot, snapshotPath } from '../bench/recordArchive'
import { pullStaged, verifyStaged } from '../bench/pull'
import { STAGING_PREFIX } from '../bench/staging'
import { trainingCardDb } from '../bench/trainingRows'
import { fakeStaging, stagedGame, type StagedGame } from './helpers/stagedGames'

/**
 * Pulling staged games into the archive. A game is archived only once it is known to be the game
 * its key says it is and to replay to the winner it names; anything else is reported and left
 * where it was. Removing games from staging is a separate, explicit step that only ever names
 * games the archive already holds, and only after a snapshot of them exists.
 */

const CARDS = trainingCardDb()
const GAMES = [7, 11, 23, 31, 42].map(stagedGame)
const DAY = '2026-10-13'

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'pull-'))
const keysOf = (games: StagedGame[]): string[] => games.map(g => g.key).sort()
const archivedKeys = (db: ReturnType<typeof openArchive>): string[] => [...archivedGames(db)].map(g => STAGING_PREFIX + g.gameKey).sort()

/** The same game with one field of its payload changed. */
const altered = (game: StagedGame, change: (payload: Record<string, unknown>) => void): { key: string; text: string } => {
  const payload = JSON.parse(game.text) as Record<string, unknown>
  change(payload)
  return { key: game.key, text: JSON.stringify(payload) }
}

describe('a pull', () => {
  it('archives every staged game under its key, with the day and the payload as staged', () => {
    const staging = fakeStaging(GAMES)
    const db = openArchive(':memory:')

    const result = pullStaged(staging, db, CARDS, { day: DAY })

    expect(result.listed).toBe(5)
    expect(result.pulled).toBe(5)
    expect(result.duplicates).toBe(0)
    expect(result.refused).toEqual([])
    const sorted = [...GAMES].sort((a, b) => a.gameKey.localeCompare(b.gameKey))
    expect([...archivedGames(db)]).toEqual(sorted.map(g => ({ gameKey: g.gameKey, pulledDay: DAY, payload: g.text })))
  })

  it('adds nothing the second time, and fetches nothing it already holds', () => {
    const staging = fakeStaging(GAMES)
    const db = openArchive(':memory:')
    pullStaged(staging, db, CARDS, { day: DAY })
    staging.calls.length = 0

    const again = pullStaged(staging, db, CARDS, { day: '2026-10-20' })

    expect(again).toMatchObject({ listed: 5, pulled: 0, duplicates: 5, refused: [] })
    expect(staging.calls.filter(c => c.op === 'get')).toEqual([])
    expect([...archivedGames(db)].map(g => g.pulledDay)).toEqual(Array(5).fill(DAY))
  })

  it('follows the listing across pages', () => {
    const staging = fakeStaging(GAMES, 2)
    const db = openArchive(':memory:')

    const result = pullStaged(staging, db, CARDS, { day: DAY })

    expect(staging.calls.filter(c => c.op === 'list').map(c => c.keys.length)).toEqual([2, 2, 1])
    expect(result.listed).toBe(5)
    expect(archivedKeys(db)).toEqual(keysOf(GAMES))
  })

  it('fetches in batches no larger than it is told, archiving each before the next', () => {
    const staging = fakeStaging(GAMES)
    const db = openArchive(':memory:')
    const heldAtEachGet: number[] = []
    const get = staging.get.bind(staging)
    staging.get = keys => {
      heldAtEachGet.push([...archivedGames(db)].length)
      return get(keys)
    }

    pullStaged(staging, db, CARDS, { day: DAY, batch: 2 })

    expect(staging.calls.filter(c => c.op === 'get').map(c => c.keys.length)).toEqual([2, 2, 1])
    expect(heldAtEachGet).toEqual([0, 2, 4])
  })

  it('takes only the new games when some are already archived', () => {
    const db = openArchive(':memory:')
    pullStaged(fakeStaging(GAMES.slice(0, 2)), db, CARDS, { day: DAY })

    const staging = fakeStaging(GAMES)
    const result = pullStaged(staging, db, CARDS, { day: '2026-10-14' })

    expect(result).toMatchObject({ listed: 5, pulled: 3, duplicates: 2 })
    expect(staging.calls.filter(c => c.op === 'get').flatMap(c => c.keys).sort()).toEqual(keysOf(GAMES.slice(2)))
  })

  it('is read-only: it never deletes unless asked', () => {
    const staging = fakeStaging(GAMES)
    const result = pullStaged(staging, openArchive(':memory:'), CARDS, { day: DAY, backupDir: tempDir() })

    expect(staging.calls.filter(c => c.op === 'delete')).toEqual([])
    expect(staging.values.size).toBe(5)
    expect(result.deleted).toEqual([])
    // What a delete would take is still named, so it can be read before it is asked for.
    expect(result.removable).toEqual(keysOf(GAMES))
  })

  it('reports an empty staging store as nothing to do', () => {
    const result = pullStaged(fakeStaging([]), openArchive(':memory:'), CARDS, { day: DAY })
    expect(result).toMatchObject({ listed: 0, pulled: 0, duplicates: 0, refused: [], removable: [], deleted: [] })
  })
})

describe('a staged game that does not check out', () => {
  const [good, bad] = GAMES
  const cases: [string, { key: string; text: string }, string][] = [
    ['is not JSON', { key: bad.key, text: bad.text.slice(0, 400) }, 'not JSON'],
    ['is not a game record', { key: bad.key, text: '{"winner":"player"}' }, 'not a game record'],
    ['has had a move removed', altered(bad, p => { (p.moves as unknown[]).pop() }), 'the key does not match the game'],
    ['has had its starting position changed', altered(bad, p => { (p.initialState as Record<string, unknown>).extra = 1 }), 'the key does not match the game'],
    ['names the wrong winner', altered(bad, p => { p.winner = p.winner === 'player' ? 'opponent' : 'player' }), 'the record says'],
    ['is staged under a name that is not a game key', { key: `${STAGING_PREFIX}not-a-key`, text: bad.text }, 'not a game key'],
    ['is staged under another game’s key', { key: GAMES[2].key, text: bad.text }, 'the key does not match the game'],
  ]

  it.each(cases)('is refused when it %s: reported, not archived, not deleted', (_name, entry, reason) => {
    const staging = fakeStaging([good, entry])
    const db = openArchive(':memory:')

    const result = pullStaged(staging, db, CARDS, { day: DAY, delete: true, backupDir: tempDir() })

    expect(result.pulled).toBe(1)
    expect(result.refused).toEqual([{ key: entry.key, reason: expect.stringContaining(reason) as string }])
    expect(archivedKeys(db)).toEqual([good.key])
    // The good game went; the refused one is still staged, exactly as it was.
    expect(result.deleted).toEqual([good.key])
    expect([...staging.values]).toEqual([[entry.key, entry.text]])
  })

  it('is refused again on the next pull, having been left in staging', () => {
    const entry = cases[4][1]
    const staging = fakeStaging([entry])
    const db = openArchive(':memory:')
    pullStaged(staging, db, CARDS, { day: DAY })
    expect(pullStaged(staging, db, CARDS, { day: DAY }).refused).toHaveLength(1)
  })

  it('is reported when it is listed and then gone', () => {
    const staging = fakeStaging([good])
    staging.get = () => new Map()
    const result = pullStaged(staging, openArchive(':memory:'), CARDS, { day: DAY })
    expect(result.refused).toEqual([{ key: good.key, reason: expect.stringContaining('no value') as string }])
  })

  it('passes verification as the game its key names when nothing is wrong with it', () => {
    expect(verifyStaged(good.key, good.text, CARDS)).toEqual({ gameKey: good.gameKey, payload: good.text })
  })
})

describe('--delete', () => {
  it('removes exactly the staged games the archive holds, after a snapshot that holds them', () => {
    const refusedEntry = altered(GAMES[4], p => { p.winner = p.winner === 'player' ? 'opponent' : 'player' })
    const staging = fakeStaging([...GAMES.slice(0, 4), refusedEntry])
    const db = openArchive(':memory:')
    const backupDir = tempDir()
    let snapshotAtDelete: string[] = []
    staging.onDelete = () => {
      snapshotAtDelete = readSnapshot(snapshotPath(backupDir, DAY)).map(g => STAGING_PREFIX + g.gameKey).sort()
    }

    const result = pullStaged(staging, db, CARDS, { day: DAY, delete: true, backupDir })

    const verified = keysOf(GAMES.slice(0, 4))
    expect(staging.calls.filter(c => c.op === 'delete')).toEqual([{ op: 'delete', keys: verified }])
    expect(result.deleted).toEqual(verified)
    expect(snapshotAtDelete).toEqual(verified)
    expect([...staging.values.keys()]).toEqual([refusedEntry.key])
    expect(result.snapshot?.games).toBe(4)
  })

  it('also removes a game archived by an earlier, read-only pull', () => {
    const staging = fakeStaging(GAMES)
    const db = openArchive(':memory:')
    pullStaged(staging, db, CARDS, { day: DAY })

    const result = pullStaged(staging, db, CARDS, { day: DAY, delete: true, backupDir: tempDir() })

    expect(result).toMatchObject({ pulled: 0, duplicates: 5 })
    expect(result.deleted).toEqual(keysOf(GAMES))
    expect(staging.values.size).toBe(0)
  })

  it('never names a game that is archived but was not listed', () => {
    const db = openArchive(':memory:')
    pullStaged(fakeStaging(GAMES), db, CARDS, { day: DAY })

    const staging = fakeStaging(GAMES.slice(0, 2))
    const result = pullStaged(staging, db, CARDS, { day: DAY, delete: true, backupDir: tempDir() })

    expect(result.deleted).toEqual(keysOf(GAMES.slice(0, 2)))
  })

  it('is refused without a folder to snapshot to, before anything is listed', () => {
    const staging = fakeStaging(GAMES)
    const db = openArchive(':memory:')
    expect(() => pullStaged(staging, db, CARDS, { day: DAY, delete: true })).toThrow('--delete needs --backup')
    expect(staging.calls).toEqual([])
    expect([...archivedGames(db)]).toEqual([])
  })

  it('issues no delete at all when there is nothing to remove', () => {
    const staging = fakeStaging([])
    const result = pullStaged(staging, openArchive(':memory:'), CARDS, { day: DAY, delete: true, backupDir: tempDir() })
    expect(staging.calls.filter(c => c.op === 'delete')).toEqual([])
    expect(result.deleted).toEqual([])
  })

  it('with a dry run names what it would remove and removes nothing, needing no snapshot folder', () => {
    const staging = fakeStaging(GAMES)
    const result = pullStaged(staging, openArchive(':memory:'), CARDS, { day: DAY, delete: true, dryRun: true })

    expect(result.removable).toEqual(keysOf(GAMES))
    expect(result.deleted).toEqual([])
    expect(result.snapshot).toBeUndefined()
    expect(staging.calls.filter(c => c.op === 'delete')).toEqual([])
    expect(staging.values.size).toBe(5)
  })

  it('with a dry run still writes the snapshot it was given a folder for', () => {
    const staging = fakeStaging(GAMES)
    const backupDir = tempDir()
    const result = pullStaged(staging, openArchive(':memory:'), CARDS, { day: DAY, delete: true, dryRun: true, backupDir })

    expect(readdirSync(backupDir)).toEqual(['collected-games-2026-10-13.jsonl.gz'])
    expect(result.deleted).toEqual([])
    expect(staging.values.size).toBe(5)
  })
})

describe('a pull that is cut off between archiving and deleting', () => {
  it('loses nothing: the archive holds every game, staging still does, and the next pull finishes the job', () => {
    const staging = fakeStaging(GAMES)
    const dir = tempDir()
    const path = join(dir, 'collected-games.db')
    staging.failDelete = new Error('the connection dropped')

    const first = pullStaged(staging, openArchive(path), CARDS, { day: DAY, delete: true, backupDir: dir })

    expect(first.deleteFailed).toContain('the connection dropped')
    expect(first.deleted).toEqual([])
    expect(staging.values.size).toBe(5)
    expect(existsSync(snapshotPath(dir, DAY))).toBe(true)
    // A fresh connection, as the next run would open: everything was committed before the delete.
    expect(archivedKeys(openArchive(path))).toEqual(keysOf(GAMES))

    staging.failDelete = undefined
    const second = pullStaged(staging, openArchive(path), CARDS, { day: '2026-10-14', delete: true, backupDir: dir })

    expect(second).toMatchObject({ pulled: 0, duplicates: 5 })
    expect(second.deleted).toEqual(keysOf(GAMES))
    expect(staging.values.size).toBe(0)
    expect(archivedKeys(openArchive(path))).toEqual(keysOf(GAMES))
  })

  it('does not delete when the snapshot does not hold every game it is about to remove', () => {
    const staging = fakeStaging(GAMES)
    const dir = tempDir()
    const result = pullStaged(staging, openArchive(':memory:'), CARDS, {
      day: DAY, delete: true, backupDir: dir,
      // A snapshot that came back short, as a full disk or a failed sync would leave it.
      readBack: () => [],
    })

    expect(result.deleteFailed).toContain('snapshot')
    expect(staging.calls.filter(c => c.op === 'delete')).toEqual([])
    expect(staging.values.size).toBe(5)
  })
})
