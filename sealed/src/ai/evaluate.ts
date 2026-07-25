import type { GameState, PlayerId } from '../engine/types'
import { opponentOf } from '../engine/types'
import { effectivePower, effectiveHp } from '../engine/stats'
import { handValue, DEFAULT_HAND_WEIGHTS, type HandWeights } from './handValue'

/**
 * Board evaluation for the greedy AI (#391), unit-count-centred for trades (#392): a single number,
 * higher is better for `me`.
 *
 * The board term is built around what decides trades: unit COUNT (being up a body is the biggest
 * swing), relative power, and base pressure. Remaining HP counts only lightly, so damage is
 * *progress toward removal* without either overvaluing chip or reading a surviving-but-damaged unit
 * as a big loss; only DEFEATING a unit is the real swing.
 *
 * ## Public and private halves (#393)
 *
 * `publicScore` is zero-sum ("my stuff minus their stuff"), so
 * `publicScore(s, player) === -publicScore(s, opponent)`. It reads only what both players can see,
 * including hand SIZE.
 *
 * `evaluate` adds a private half on top: what `me`'s hand is actually worth, which needs the card
 * identities. Those are hidden information, so the term is applied to the scored seat ONLY:
 * subtracting the opponent's would mean peeking at their hand. `evaluate` is therefore subjective
 * rather than zero-sum, which costs nothing at one ply, since greedy only ever scores from the
 * acting seat. Anything that scores a position from BOTH seats (#400's pessimistic minimax) must
 * call `evaluate(s, foe)` rather than negating `evaluate(s, me)`.
 *
 * The weights are parameterised (`makeEvaluate`) so a weight sweep can measure candidates against the
 * frozen baseline (see `bench/tune.ts`).
 */

/** A decisive result outweighs any reachable material score. */
const WIN = 1_000_000

export interface EvalWeights {
  base: number // per point of damage on a base (the win condition)
  unit: number // per unit in play (the dominant board term)
  power: number // per point of a unit's effective power
  hp: number // per point of a unit's remaining HP (light, so damage is progress not a big loss)
  card: number // per card in hand (public: hand SIZE is visible to both players)
  resource: number // per resource in the pool (total, not ready: resources ready again each round)
  readyUnit: number // per ready (unexhausted) unit, a light tempo term
  /** Private half: what the scored seat's own hand is worth (#393). See `handValue`. */
  hand: HandWeights
}

// Tuned by a weight sweep against the frozen baseline across the 42 coverage decks (#392): a unit
// weight of 6 over-valued raw bodies (4 beat 6 beat 8); power 2 / HP 1 are right (raising either hurt);
// base 4 edged 3 and 5. See bench/tune.ts to re-sweep.
export const DEFAULT_WEIGHTS: EvalWeights = {
  base: 4,
  unit: 4,
  power: 2,
  hp: 1,
  card: 2,
  resource: 3,
  readyUnit: 1,
  hand: DEFAULT_HAND_WEIGHTS,
}

/**
 * Board value of a player's units: a fixed bonus per body (unit count), plus power, plus a light
 * remaining-HP term. Deployed leaders live in `units`, so they count too. Defeating a unit removes
 * its whole contribution (the real trade swing); chipping only shaves the small HP part.
 */
function boardPresence(state: GameState, id: PlayerId, w: EvalWeights): number {
  let total = 0
  for (const unit of state.players[id].units) {
    total += w.unit
    total += w.power * effectivePower(state, unit)
    total += w.hp * Math.max(0, effectiveHp(state, unit) - unit.damage)
  }
  return total
}

function readyUnits(state: GameState, id: PlayerId): number {
  return state.players[id].units.filter(u => !u.exhausted).length
}

/**
 * The zero-sum half: everything both players can see, including hand SIZE but never hand contents.
 * Split out so the invariant `publicScore(s, me) === -publicScore(s, foe)` stays testable now that
 * `evaluate` carries a private term on top.
 */
export function makePublicScore(w: EvalWeights): (state: GameState, me: PlayerId) => number {
  return (state, me) => {
    if (state.winner === me) return WIN
    if (state.winner === 'draw') return 0
    if (state.winner !== null) return -WIN

    const foe = opponentOf(me)
    const baseTerm = w.base * (state.players[foe].base.damage - state.players[me].base.damage)
    const board = boardPresence(state, me, w) - boardPresence(state, foe, w)
    const cards = w.card * (state.players[me].hand.length - state.players[foe].hand.length)
    const resources = w.resource * (state.players[me].resources.length - state.players[foe].resources.length)
    const tempo = w.readyUnit * (readyUnits(state, me) - readyUnits(state, foe))

    return baseTerm + board + cards + resources + tempo
  }
}

/**
 * Squash an unbounded hand value into `[0, 1)`, strictly monotonically.
 *
 * `K` sets where the curve discriminates best; typical hands score 4 to 12 raw, so 10 keeps them in
 * the responsive middle rather than saturated near 1. Its exact value only stretches the ordering,
 * never reverses it.
 */
const HAND_SQUASH = 10
const squash = (x: number): number => x / (x + HAND_SQUASH)

/**
 * Build an evaluation function for a given set of weights.
 *
 * The private hand term is admitted **as a tie-break only**, and that is a guarantee rather than a
 * tuning choice. Every public weight and every quantity it multiplies is an integer, so
 * `publicScore` is integer-valued; squashing hand value into `[0, 1)` therefore makes it strictly
 * incapable of overriding a public preference. It can only order moves the public half rates
 * equally, which is exactly the blind spot: 100% of regroup resource picks were public ties decided
 * by a coin flip.
 *
 * This was measured, not assumed. Letting the term compete on equal footing with the board score
 * cost win rate in proportion to its weight (a 1720-game sweep: 50% at hand weights near zero,
 * 39.8% at moderate, 26.0% at large), because it applies to EVERY decision while only fixing one.
 * Bounding it below the resolution of the public score keeps the fix and removes the distortion.
 */
export function makeEvaluate(w: EvalWeights): (state: GameState, me: PlayerId) => number {
  const publicHalf = makePublicScore(w)
  return (state, me) => {
    // A decided game has no hand worth valuing, and the private term must not blur the WIN cliff.
    if (state.winner !== null) return publicHalf(state, me)
    return publicHalf(state, me) + squash(handValue(state, me, w.hand))
  }
}

/** The public, zero-sum half of the default evaluation. */
export const publicScore = makePublicScore(DEFAULT_WEIGHTS)

/** How good `state` is for `me`, under the default (tuned) weights. */
export const evaluate = makeEvaluate(DEFAULT_WEIGHTS)
