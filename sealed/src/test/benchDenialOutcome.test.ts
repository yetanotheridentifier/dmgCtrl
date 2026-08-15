import { describe, it, expect } from 'vitest'
import {
  runDecisions, openDenialWatch, advanceDenialWatch, closeDenialWatch,
  type DenialOutcomeStat, type DenialWatch,
} from '../bench/decisions'
import '../engine/cardDefinitions'
import { state } from './helpers/engineFixtures'
import type { GameState, PlayerId } from '../engine/types'

/**
 * The denial funnel's arithmetic, pinned before it is allowed to produce a number.
 *
 * This measures something nobody can eyeball: what happened over the several rounds AFTER a decision,
 * in games that take minutes to play. A stage that fires on the wrong event would produce a plausible
 * table that is simply wrong, and there would be no way to tell from the output. The same shape has
 * already cost this project once, when a watch list that leaked between games reported a leader-death
 * rate of 72.3% against a true 17.7%.
 *
 * Driven by hand-built boards rather than by playing games, so each stage is triggered deliberately and
 * in isolation. A test that played real games would exercise the funnel without pinning it.
 */

const empty = (): DenialOutcomeStat => ({
  decided: 0, claimed: 0, declined: 0,
  claimedHopeless: 0, declinedHopeless: 0,
  claimedWithCounterplay: 0, declinedWithCounterplay: 0,
  claimedLostFreeRun: 0, declinedLostFreeRun: 0,
  claimedLostFirstAction: 0, declinedLostFirstAction: 0,
  claimedLostNextRound: 0, declinedLostNextRound: 0,
  claimedSurvived: 0, declinedSurvived: 0,
  claimedWonGame: 0, declinedWonGame: 0,
  claimedRoundsAfter: 0, declinedRoundsAfter: 0,
})

const board = (round: number, winner: GameState['winner'] = null): GameState => state({ round, winner })

/** Play a scripted sequence of resolved decisions past one watch. */
function run(steps: Array<{ after: GameState; by: PlayerId; answer?: boolean }>): DenialWatch {
  const watch = openDenialWatch('player', true, 3)
  for (const step of steps) advanceDenialWatch(watch, step.after, step.by, step.answer === true)
  return watch
}

describe('the denial outcome funnel', () => {
  /** The stage the tail exists to price: claiming hands them the rest of OUR round before the turn
   *  order we bought ever applies. */
  it('charges a loss inside the claim round to the free run', () => {
    const w = run([
      { after: board(3), by: 'opponent' },
      { after: board(3, 'opponent'), by: 'opponent' },
    ])
    expect(w.lostFreeRun).toBe(true)
    expect(w.lostFirstAction).toBe(false)
    expect(w.lostNextRound).toBe(false)
  })

  /** We reached the round we bought, acted first, and they killed us anyway on their first action. */
  it('separates their first action of the next round', () => {
    const w = run([
      { after: board(4), by: 'opponent' },        // the round turns over
      { after: board(4), by: 'player' },          // we act first, which is what claiming bought
      { after: board(4, 'opponent'), by: 'opponent' },
    ])
    expect(w.lostFreeRun).toBe(false)
    expect(w.lostFirstAction).toBe(true)
  })

  /** Their SECOND action is a different finding: we slowed them and it was not enough. */
  it('separates a loss later in the same round', () => {
    const w = run([
      { after: board(4), by: 'opponent' },
      { after: board(4), by: 'player' },
      { after: board(4), by: 'opponent' },        // their first action, survivable
      { after: board(4, 'opponent'), by: 'opponent' },
    ])
    expect(w.lostFirstAction).toBe(false)
    expect(w.lostNextRound).toBe(true)
  })

  /**
   * A pending-choice answer is not an action. Without this the stage fires on a card handing someone a
   * menu mid-resolution, and "they won on their first action" would be counted against a decision the
   * opponent never chose to make.
   */
  it('does not count answering a choice as their first action', () => {
    const w = run([
      { after: board(4), by: 'opponent' },
      { after: board(4), by: 'player' },
      { after: board(4), by: 'opponent', answer: true },
      { after: board(4, 'opponent'), by: 'opponent' },
    ])
    expect(w.lostFirstAction).toBe(true)
    expect(w.lostNextRound).toBe(false)
  })

  /** Stages are exclusive: exactly one loss stage may fire, or the funnel double-counts and the
   *  percentages stop summing to anything meaningful. */
  it('fires at most one loss stage', () => {
    for (const w of [
      run([{ after: board(3, 'opponent'), by: 'opponent' }]),
      run([{ after: board(4), by: 'opponent' }, { after: board(4, 'opponent'), by: 'opponent' }]),
      run([
        { after: board(4), by: 'opponent' }, { after: board(4), by: 'opponent' },
        { after: board(4, 'opponent'), by: 'opponent' },
      ]),
    ]) {
      const fired = [w.lostFreeRun, w.lostFirstAction, w.lostNextRound].filter(Boolean)
      expect(fired.length).toBeLessThanOrEqual(1)
    }
  })

  it('routes claimed and declined to their own columns, and never mixes them', () => {
    const stat = empty()
    const claimedWatch = openDenialWatch('player', true, 3)
    const declinedWatch = openDenialWatch('player', false, 3)
    closeDenialWatch(claimedWatch, board(6, 'player'), stat)
    closeDenialWatch(declinedWatch, board(6, 'opponent'), stat)

    expect(stat.decided).toBe(2)
    expect(stat.claimed).toBe(1)
    expect(stat.declined).toBe(1)
    expect(stat.claimedWonGame).toBe(1)
    expect(stat.declinedWonGame).toBe(0)
    expect(stat.claimedRoundsAfter).toBe(3)
    expect(stat.declinedRoundsAfter).toBe(3)
  })

  /** Survival is "the round we bought ran out with the game still live", not merely "we did not lose
   *  instantly". A loss on their first action of the bought round is not survival. */
  it('counts survival only past the round the claim bought', () => {
    const stat = empty()
    closeDenialWatch(openDenialWatch('player', true, 3), board(4, 'opponent'), stat)
    expect(stat.claimedSurvived, 'lost during the round we bought').toBe(0)

    closeDenialWatch(openDenialWatch('player', true, 3), board(5, 'opponent'), stat)
    expect(stat.claimedSurvived, 'the bought round ended and the game went on').toBe(1)
  })
})

/**
 * And that the funnel is actually WIRED, on real games rather than scripted boards.
 *
 * The unit tests above prove the arithmetic; they would pass just as happily if nothing ever opened a
 * watch. This is the check that the readout is not a table of structural zeroes, which is the failure
 * mode that looks most like a result.
 */
describe('the denial funnel over real games', () => {
  const report = runDecisions({ gamesPerDeck: 1, seed: 4242, aiName: 'beam:4x2', deckLimit: 3 })
  const dn = report.denialOutcome

  it('opens a watch for every denial decision and no others', () => {
    expect(dn.decided).toBe(report.initiativeHorizon.denialLive)
    expect(dn.claimed).toBe(report.initiativeHorizon.denialClaimed)
    expect(dn.claimed + dn.declined).toBe(dn.decided)
  })

  it('sees denial decisions at all', () => {
    expect(dn.decided, 'no denial decisions means this diagnostic reports nothing').toBeGreaterThan(0)
  })

  /**
   * The claim-cost stat spans EVERY claim, so it must see at least as many as the denial funnel, and
   * its outcome split must account for exactly the claims whose free run actually completed.
   */
  it('measures the free run over every claim', () => {
    const cc = report.claimCost
    expect(cc.claims).toBeGreaterThanOrEqual(dn.claimed)
    expect(cc.measured).toBeLessThanOrEqual(cc.claims)
    expect(cc.threatBefore + cc.threatCreated).toBeLessThanOrEqual(cc.measured)
    expect(cc.reachGrowth === 0 ? 0 : cc.reachGrew).toBeGreaterThan(0)
  })

  /** Exclusive stages, at the aggregate level too: a game cannot be lost twice. */
  it('never double-counts a loss', () => {
    for (const [free, first, later, total] of [
      [dn.claimedLostFreeRun, dn.claimedLostFirstAction, dn.claimedLostNextRound, dn.claimed],
      [dn.declinedLostFreeRun, dn.declinedLostFirstAction, dn.declinedLostNextRound, dn.declined],
    ]) {
      expect(free + first + later).toBeLessThanOrEqual(total)
    }
  })
})
