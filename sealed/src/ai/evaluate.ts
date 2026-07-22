import type { GameState, PlayerId } from '../engine/types'
import { opponentOf } from '../engine/types'
import { effectivePower, effectiveHp } from '../engine/stats'

/**
 * Board evaluation for the greedy AI (#391): a single number, higher is better for `me`.
 *
 * It is deliberately zero-sum (everything is "my stuff minus their stuff"), so
 * `evaluate(s, player) === -evaluate(s, opponent)`. That is both correct for a two-player game
 * (building your board and dismantling theirs are the same act) and a clean invariant to rely on.
 *
 * Weights are integers so scores compare exactly (no float-epsilon fuzz in the greedy tie-break),
 * and are ordered per the ticket: winning dominates, then enemy base damage (the win condition),
 * then board presence, then card advantage, then tempo. They are starting values, tuned against the
 * benchmark. This function is the seam later tickets grow (#392 trades, #395 role, #396 tokens).
 */

/** A decisive result outweighs any reachable material score. */
const WIN = 1_000_000
// A point of base damage matters, but must not outweigh removing a real threat: a single big unit
// (say 5/6 = 22 board) should be worth more than one point on the base, or the AI races face and
// never trades. So base damage is weighted well below a unit's board presence.
const W_BASE_DAMAGE = 3 // per point of damage on a base (the win condition)
const W_POWER = 2 // per point of a unit's effective power
const W_HP = 2 // per point of a unit's remaining HP
const W_CARD = 2 // per card in hand
// Economy is the TOTAL resource pool, not the ready count: resources exhaust to pay costs and ready
// again next round, so counting ready ones would wrongly read "played a unit" as a loss and deter
// development. Total resources only grow (by resourcing), so this rewards ramping and ignores spend.
const W_RESOURCE = 3 // per resource in the pool
const W_READY_UNIT = 1 // per ready (unexhausted) unit, a light tempo term

/** Summed power + remaining HP of a player's units in play (deployed leaders included, they live here). */
function boardPresence(state: GameState, id: PlayerId): number {
  let total = 0
  for (const unit of state.players[id].units) {
    total += W_POWER * effectivePower(state, unit)
    total += W_HP * Math.max(0, effectiveHp(state, unit) - unit.damage)
  }
  return total
}

function totalResources(state: GameState, id: PlayerId): number {
  return state.players[id].resources.length
}

function readyUnits(state: GameState, id: PlayerId): number {
  return state.players[id].units.filter(u => !u.exhausted).length
}

/** How good `state` is for `me`. */
export function evaluate(state: GameState, me: PlayerId): number {
  if (state.winner === me) return WIN
  if (state.winner === 'draw') return 0
  if (state.winner !== null) return -WIN

  const foe = opponentOf(me)

  // Damage on the enemy base is progress toward winning; damage on ours is progress toward losing.
  const baseTerm = W_BASE_DAMAGE * (state.players[foe].base.damage - state.players[me].base.damage)

  const board = boardPresence(state, me) - boardPresence(state, foe)
  const cards = W_CARD * (state.players[me].hand.length - state.players[foe].hand.length)
  const resources = W_RESOURCE * (totalResources(state, me) - totalResources(state, foe))
  const tempo = W_READY_UNIT * (readyUnits(state, me) - readyUnits(state, foe))

  return baseTerm + board + cards + resources + tempo
}
