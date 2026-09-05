import { describe, it, expect } from 'vitest'
import { loadReport, replaySteps } from './helpers/replayReport'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { unitHasKeyword } from '../engine/keywords'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { makeBeamAi } from '../ai/search'
import { makeEvaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { BEAM_REPLY_LIMITS, BEAM_HORIZON_LIMITS } from '../ai/greedyAi'
import { lockedLanes } from '../ai/race'
import type { BeamLimits } from '../ai/search'
import { OPPONENT_AI } from '../config'
import type { GameState, PlayerId, UnitState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * The shielded-Sentinel lockout, from a filed report rather than a scripted board (#502, #499).
 *
 * A play-tester's game in which the bot declined to strip a Shield off a Sentinel **19 times**, taking
 * it once, while its ground lane stayed shut for around twenty consecutive decisions. Self-play never
 * produces this: the bench measures a shut lane on 2.1% of decisions and never lasting more than a
 * single round, which is exactly the gap between what testers hit and what a bench can see.
 *
 * ## Why the bot passes
 *
 * Not a close call and **not a tie**, which is what the scripted fixture in `aiTieBreak.test.ts`
 * wrongly suggested. Stripping measured a consistent **11 to 12 points worse** than passing all game
 * (5.39 against 16.39, then -30.61 against -18.61, then -72.61 against -60.61). Removing a Shield
 * leaves the same units at the same HP and differs only by a token no term reads, while the attack's
 * cost (exhausting the attacker, exposing it to a counter) is priced in full. All visible cost, no
 * visible benefit.
 *
 * ## What this test pins
 *
 * The defect at shipped weights, and the size of the fix. It is the **benefit** half of the evidence:
 * a win rate cannot show it, because a lane is shut in 1.9% of bench rounds, so the fix is worth a
 * fraction of a point there however well it works here. Cost is measured separately on the full pool.
 */

const report = loadReport('shieldedSentinelLockout')
const states = replaySteps(report)

const isShielded = (u: UnitState): boolean => u.upgrades.some(up => up.cardId === TOKEN_SHIELD)
const shieldsOn = (s: GameState, seat: PlayerId): number =>
  s.players[seat].units.reduce((n, u) => n + u.upgrades.filter(up => up.cardId === TOKEN_SHIELD).length, 0)

/**
 * Is some arena of `seat`'s shut, every ready attacker forced onto shielded targets only?
 *
 * The shipped predicate, not a restatement of it. This file used to carry its own copy, which is how
 * a replay test can quietly stop testing the thing the bench measures.
 */
const laneShut = (s: GameState, seat: PlayerId): boolean => lockedLanes(s, seat).length > 0

/** Bot decisions where its lane was shut by a shielded blocker and a strip was legal. */
const locked = states.filter(s =>
  s.winner === null
  && s.activePlayer === 'opponent'
  && shieldsOn(s, 'player') > 0
  && legalMoves(s).length >= 2
  && laneShut(s, 'opponent')
  && legalMoves(s).some(m => shieldsOn(resolve(s, m), 'player') < shieldsOn(s, 'player')),
)

/**
 * How many of those decisions this weight actually strips on.
 *
 * Memoised: each call is 18 searches by the shipped bot at ~200 ms apiece, and asking twice for the
 * same weight doubled this file's cost for nothing.
 */
const cache = new Map<string, number>()
function stripsAt(blockedReach: number, limits: BeamLimits = BEAM_REPLY_LIMITS): number {
  const key = `${blockedReach}|${limits.maxCrossings ?? 0}x${limits.tailActions ?? 0}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const ai = makeBeamAi(makeEvaluate({ ...DEFAULT_WEIGHTS, blockedReach }), limits)
  const n = locked.filter(s => {
    const held = shieldsOn(s, 'player')
    const move = ai(s)
    return move !== null && shieldsOn(resolve(s, move), 'player') < held
  }).length
  cache.set(key, n)
  return n
}

describe('the filed shielded-Sentinel lockout', () => {
  it('replays to a real, sustained lockout', () => {
    expect(locked.length, 'the reported game must actually contain the defect').toBeGreaterThanOrEqual(15)
    // The reporter's blocker is a Sentinel carrying a Shield, which is the whole shape of the defect.
    const blocker = states[states.length - 1].players.player.units.concat(
      ...states.map(s => s.players.player.units),
    ).find(u => isShielded(u))
    expect(blocker, 'the reporter held a shielded unit').toBeDefined()
    expect(states.some(s => s.players.player.units.some(u => isShielded(u) && unitHasKeyword(s, u, 'Sentinel'))))
      .toBe(true)
  })

  /**
   * **The defect, pinned against the configuration that actually ships.** `blockedReach` defaults to
   * zero, so the term being present in the codebase changes nothing. That is why the reporter still
   * saw this on a build containing it.
   *
   * **The tie-break now ships and does not rescue it either**, which was predicted rather than
   * discovered: a second opinion is consulted only between candidates that already tied for the lead,
   * and here passing wins outright (52 to 43). The tie only exists once `blockedReach` prices it, and
   * that weight measured 25.0% at the value which creates it.
   *
   * So the +2.35 points the tie-break earns are an aggregate effect across ordinary decisions, and
   * this position is evidence that it fixes no specific reported defect. Both facts belong in the same
   * assertion, or the win rate reads as a fix for something it never touches.
   */
  it('barely ever strips at the weights the app ships', () => {
    expect(OPPONENT_AI).toBe('beam-reply')
    expect(DEFAULT_WEIGHTS.blockedReach, 'the term ships off').toBe(0)
    expect(BEAM_REPLY_LIMITS.tieBreak, 'the tie-break ships on').toEqual({ reply: 'null' })
    expect(stripsAt(0), 'and the reported behaviour survives it: still almost never strips').toBeLessThanOrEqual(2)
  }, 120_000)

  /**
   * **The size of the fix, measured on real boards rather than a scripted one.** Weight 3 strips on 10
   * of these 18 decisions against 1 at shipped weights.
   *
   * It is a partial fix and the bound below says so: even weight 12 reaches only 10, so roughly a
   * third of these positions are refused for reasons this term does not touch. Worth knowing before
   * anyone reads a win-rate result as "solved".
   */
  it('strips far more often at an in-scale weight, without fixing every case', () => {
    const fixed = stripsAt(3)
    expect(fixed, 'weight 3 must be a large improvement on shipped').toBeGreaterThanOrEqual(8)
    expect(fixed, 'but it does not rescue every locked position').toBeLessThan(locked.length)
    expect(fixed).toBeGreaterThan(stripsAt(0))
  }, 120_000)

  /**
   * **Crossing the round boundary does not rescue these positions either**, which is the second half
   * of the answer #516 scoped and never ran. The scripted board says the crossing moves the gap by
   * exactly zero; this says the same thing across eighteen real boards from the filed game.
   *
   * Over the 18 locked decisions: **shipped strips 1, the horizon strips 1, an in-scale weight of 3
   * strips 10.** The two candidates are not close, and the horizon is not a partial fix that a
   * heavier configuration might complete. It changes nothing at all.
   *
   * The horizon count is asserted as "no better than shipped" rather than as an exact 1, so an
   * unrelated search change cannot fail this on a number that is not the point. The claim is that
   * crossing the boundary is not the missing piece.
   */
  it('is not rescued by letting a line cross the round boundary', () => {
    expect(stripsAt(0, BEAM_HORIZON_LIMITS)).toBeLessThanOrEqual(stripsAt(0))
    // The comparison that matters: the evaluation term reaches boards the extra depth never does.
    expect(stripsAt(3)).toBeGreaterThan(stripsAt(0, BEAM_HORIZON_LIMITS) * 5)
  }, 120_000)
})
