import type { GameState, PlayerId } from '../engine/types'
import { opponentOf } from '../engine/types'
import { effectivePower, effectiveHp } from '../engine/stats'

/**
 * Board evaluation for the greedy AI (#391), unit-count-centred for trades (#392): a single number,
 * higher is better for `me`.
 *
 * Zero-sum ("my stuff minus their stuff"), so `evaluate(s, player) === -evaluate(s, opponent)`. The
 * board term is built around what decides trades: unit COUNT (being up a body is the biggest swing),
 * relative power, and base pressure. Remaining HP counts only lightly, so damage is *progress toward
 * removal* without either overvaluing chip or reading a surviving-but-damaged unit as a big loss;
 * only DEFEATING a unit is the real swing.
 *
 * The weights are parameterised (`makeEvaluate`) so a weight sweep can measure candidates against the
 * frozen baseline (see `bench/tune.ts`). Integers keep scores exact for the seeded tie-break.
 */

/** A decisive result outweighs any reachable material score. */
const WIN = 1_000_000

export interface EvalWeights {
  base: number // per point of damage on a base (the win condition)
  unit: number // per unit in play (the dominant board term)
  power: number // per point of a unit's effective power
  hp: number // per point of a unit's remaining HP (light, so damage is progress not a big loss)
  card: number // per card in hand
  resource: number // per resource in the pool (total, not ready: resources ready again each round)
  readyUnit: number // per ready (unexhausted) unit, a light tempo term
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

/** Build an evaluation function for a given set of weights. */
export function makeEvaluate(w: EvalWeights): (state: GameState, me: PlayerId) => number {
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

/** How good `state` is for `me`, under the default (tuned) weights. */
export const evaluate = makeEvaluate(DEFAULT_WEIGHTS)
