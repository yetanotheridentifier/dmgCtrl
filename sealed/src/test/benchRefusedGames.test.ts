// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReplayCheck, StoredGame } from '../bench/collectedStore'
import { readSnapshot } from '../bench/recordArchive'
import { deleteRefused, knownRefused, nextChecks, playedOn, refusedReport } from '../bench/refusedGames'
import { fakeD1 } from './helpers/fakeD1'
import { stagedGame } from './helpers/stagedGames'

/**
 * Collected games that no longer replay: the check kept beside each game, which `--rows` reads to
 * leave a known refusal out and writes after each run, and the listing and deletion of the refused.
 * A refused game is deleted for good after a backup that holds it, except one played on the build
 * that checked it or the one before, which is a sign of an engine defect and is kept until someone
 * has looked at it.
 */

const BUILD = 'aaaaaaa'
const BEFORE = 'bbbbbbb'
const OLD = 'ccccccc'
const RECENT = [BUILD, BEFORE]

const game = (n: number, commitId: string | null, check: ReplayCheck | null, release: string | null = String(n)): StoredGame => ({
  gameKey: n.toString(16).padStart(16, '0'),
  release,
  commitId,
  check,
})
const refused = (checkedOn: string, refusal = 'the game replays to player, but the record says opponent', flagged = false): ReplayCheck => ({ checkedOn, refusal, flagged })
const good = (checkedOn: string): ReplayCheck => ({ checkedOn, refusal: null, flagged: false })

describe('which build played a game', () => {
  it('matches a short commit id against a longer one either way, and never an unknown build', () => {
    expect(playedOn('aaaaaaa', ['aaaaaaa1234567890'])).toBe(true)
    expect(playedOn('aaaaaaa1234', ['aaaaaaa'])).toBe(true)
    expect(playedOn('abcdef0', RECENT)).toBe(false)
    expect(playedOn(null, RECENT)).toBe(false)
    expect(playedOn('', RECENT)).toBe(false)
  })
})

describe('leaving known refusals out of --rows', () => {
  it('leaves out only the games refused on this very build', () => {
    const games = [game(1, OLD, refused(BUILD)), game(2, OLD, refused(BEFORE)), game(3, OLD, good(BUILD)), game(4, OLD, null)]
    expect([...knownRefused(games, BUILD)]).toEqual([games[0].gameKey])
  })
})

describe('the checks a --rows run records', () => {
  it('records each game checked, on this build, with its refusal or none', () => {
    const games = [game(1, OLD, null), game(2, OLD, refused(OLD))]
    const checks = nextChecks(games, [
      { gameKey: games[0].gameKey, refusal: 'the replay threw: no' },
      { gameKey: games[1].gameKey, refusal: null },
    ], BUILD, RECENT)
    expect(checks).toEqual([
      { gameKey: games[0].gameKey, checkedOn: BUILD, refusal: 'the replay threw: no', flagged: false },
      { gameKey: games[1].gameKey, checkedOn: BUILD, refusal: null, flagged: false },
    ])
  })

  it('flags a refusal of a game played on this build or the one before: that is an engine defect, not rules drift', () => {
    const games = [game(1, BUILD, null), game(2, BEFORE, null), game(3, OLD, null)]
    const checks = nextChecks(games, games.map(g => ({ gameKey: g.gameKey, refusal: 'the replay threw: no' })), BUILD, RECENT)
    expect(checks.map(c => c.flagged)).toEqual([true, true, false])
  })

  it('keeps a flag once raised until the game replays, however far the builds move on', () => {
    const games = [game(1, OLD, refused(OLD, 'x', true)), game(2, OLD, refused(OLD, 'x', true))]
    const checks = nextChecks(games, [{ gameKey: games[0].gameKey, refusal: 'x' }, { gameKey: games[1].gameKey, refusal: null }], BUILD, RECENT)
    expect(checks.map(c => c.flagged)).toEqual([true, false])
  })
})

describe('listing the refused games', () => {
  const games = [
    game(1, OLD, refused(BUILD, 'the game replays to player, but the record says opponent')),
    game(2, OLD, refused(BUILD, 'the game replays to opponent, but the record says player')),
    game(3, OLD, refused(BUILD, 'the replay threw: move 12 is not legal'), '40'),
    game(4, BUILD, refused(BUILD, 'the replay threw: move 3 is not legal', true), '41'),
    game(5, OLD, refused(OLD, 'the replay threw: move 9 is not legal'), '40'),
    game(6, OLD, good(BUILD)),
    game(7, OLD, null),
  ]

  it('counts them by reason, with the numbers in a reason set aside, and by the build that played them', () => {
    const report = refusedReport(games, BUILD)
    expect(report.refused).toHaveLength(5)
    expect(report.byReason).toEqual([
      { reason: 'the replay threw: move … is not legal', games: 3 },
      { reason: 'the game replays to opponent, but the record says player', games: 1 },
      { reason: 'the game replays to player, but the record says opponent', games: 1 },
    ])
    expect(report.byBuild).toEqual([{ build: `40 (${OLD})`, games: 2 }, { build: `1 (${OLD})`, games: 1 }, { build: `2 (${OLD})`, games: 1 }, { build: `41 (${BUILD})`, games: 1 }])
  })

  it('deletes only what was refused on this build, keeps a flagged game, and leaves a refusal from another build to be checked again', () => {
    const report = refusedReport(games, BUILD)
    expect(report.deletable).toEqual([games[0], games[1], games[2]].map(g => g.gameKey))
    expect(report.flagged.map(g => g.gameKey)).toEqual([games[3].gameKey])
    expect(report.otherBuild.map(g => g.gameKey)).toEqual([games[4].gameKey])
  })

  it('lets a flagged game go once someone has looked at it and named it', () => {
    const report = refusedReport(games, BUILD, new Set([games[3].gameKey]))
    expect(report.deletable).toContain(games[3].gameKey)
    expect(report.flagged).toEqual([])
  })
})

describe('deleting the refused games', () => {
  const GAMES = [7, 11, 23].map(stagedGame)
  const DAY = '2026-11-16'
  const filled = () => {
    const d1 = fakeD1()
    d1.store.add(GAMES.map(g => ({ gameKey: g.gameKey, pulledDay: DAY, payload: g.text })))
    return d1
  }
  const keys = GAMES.map(g => g.gameKey).sort()

  it('backs the whole store up first, checks the backup holds every game about to go, then removes exactly those', () => {
    const d1 = filled()
    const dir = mkdtempSync(join(tmpdir(), 'refused-'))

    const done = deleteRefused(d1.store, [keys[0], keys[2]], dir, DAY)

    expect(readSnapshot(done.snapshot!.path).map(g => g.gameKey)).toEqual(keys)
    expect(done.deleted).toEqual([keys[0], keys[2]])
    expect(d1.store.keys()).toEqual([keys[1]])
  })

  it('removes nothing when the backup does not hold a game about to go', () => {
    const d1 = filled()
    const dir = mkdtempSync(join(tmpdir(), 'refused-'))

    expect(() => deleteRefused(d1.store, [keys[0]], dir, DAY, path => readSnapshot(path).filter(g => g.gameKey !== keys[0]))).toThrow('does not hold 1 of the games to delete')
    expect(d1.store.keys()).toEqual(keys)
  })

  it('writes no backup and removes nothing when there is nothing to delete', () => {
    const d1 = filled()
    const calls = d1.calls.length
    expect(deleteRefused(d1.store, [], mkdtempSync(join(tmpdir(), 'refused-')), DAY)).toEqual({ deleted: [] })
    expect(d1.calls.length).toBe(calls)
  })
})
