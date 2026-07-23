import type { GameState, PlayerId } from '../engine/types'
import { opponentOf } from '../engine/types'
import { effectivePower, effectiveHp } from '../engine/stats'

/**
 * FROZEN evaluation: the #391 board eval exactly as it stood before the #392 trade refinement. Kept
 * only so `greedy-baseline` can be measured against the new `greedy` in the generalisation
 * diagnostic (a moving comparison needs a fixed reference). Do not "improve" this file, its whole
 * value is that it never changes. The live evaluation is `evaluate.ts`.
 */

const WIN = 1_000_000
const W_BASE_DAMAGE = 3
const W_POWER = 2
const W_HP = 2
const W_CARD = 2
const W_RESOURCE = 3
const W_READY_UNIT = 1

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

export function evaluateBaseline(state: GameState, me: PlayerId): number {
  if (state.winner === me) return WIN
  if (state.winner === 'draw') return 0
  if (state.winner !== null) return -WIN

  const foe = opponentOf(me)
  const baseTerm = W_BASE_DAMAGE * (state.players[foe].base.damage - state.players[me].base.damage)
  const board = boardPresence(state, me) - boardPresence(state, foe)
  const cards = W_CARD * (state.players[me].hand.length - state.players[foe].hand.length)
  const resources = W_RESOURCE * (totalResources(state, me) - totalResources(state, foe))
  const tempo = W_READY_UNIT * (readyUnits(state, me) - readyUnits(state, foe))

  return baseTerm + board + cards + resources + tempo
}
