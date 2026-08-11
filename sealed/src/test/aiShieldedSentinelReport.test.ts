import { describe, it, expect } from 'vitest'
import { loadReport, replaySteps } from './helpers/replayReport'
import { legalMoves, enemyAttackTargets } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { unitHasKeyword } from '../engine/keywords'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { makeBeamAi } from '../ai/search'
import { makeEvaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { BEAM_REPLY_LIMITS } from '../ai/greedyAi'
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

/** Is some arena of `seat`'s shut, every ready attacker forced onto shielded targets only? */
function laneShut(s: GameState, seat: PlayerId): boolean {
  return (['ground', 'space'] as const).some(arena => {
    const ready = s.players[seat].units.filter(u => !u.exhausted && u.arena === arena)
    if (ready.length === 0) return false
    return ready.every(u => {
      const { targets, sentinelLocked } = enemyAttackTargets(s, u, seat)
      return sentinelLocked && targets.length > 0 && targets.every(isShielded)
    })
  })
}

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
const cache = new Map<number, number>()
function stripsAt(blockedReach: number): number {
  const hit = cache.get(blockedReach)
  if (hit !== undefined) return hit
  const ai = makeBeamAi(makeEvaluate({ ...DEFAULT_WEIGHTS, blockedReach }), BEAM_REPLY_LIMITS)
  const n = locked.filter(s => {
    const held = shieldsOn(s, 'player')
    const move = ai(s)
    return move !== null && shieldsOn(resolve(s, move), 'player') < held
  }).length
  cache.set(blockedReach, n)
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
   * zero and `beam-reply` carries no tie-break, so the fix being present in the codebase changes
   * nothing until it is switched on. That is why the reporter still saw this on a build containing it.
   */
  it('barely ever strips at the weights the app ships', () => {
    expect(OPPONENT_AI).toBe('beam-reply')
    expect(DEFAULT_WEIGHTS.blockedReach, 'the term ships off').toBe(0)
    expect((BEAM_REPLY_LIMITS as { tieBreak?: unknown }).tieBreak, 'and so does the tie-break').toBeUndefined()
    expect(stripsAt(0), 'the reported behaviour: it almost never strips').toBeLessThanOrEqual(2)
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
})
