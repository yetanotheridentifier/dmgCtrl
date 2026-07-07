import type { GameState, UnitState } from './types'
import { hasKeyword, keywordValue } from './keywords'

/**
 * Computed unit stats (#305). All combat and defeat checks go through these
 * helpers so upgrades (#308) and lasting effects (#306) slot into one place.
 * Power/HP never drop below 0 (CR 1.10.4 / 1.11.4).
 */

export interface StatContext {
  /** True while the unit is the attacker in an attack (Raid applies). */
  attacking?: boolean
}

export function effectivePower(state: GameState, unit: UnitState, ctx: StatContext = {}): number {
  let power = state.cards[unit.cardId]?.power ?? 0
  if (ctx.attacking) {
    power += keywordValue(state, unit.cardId, 'Raid')
  }
  if (hasKeyword(state, unit.cardId, 'Grit')) {
    power += unit.damage
  }
  return Math.max(0, power)
}

export function effectiveHp(state: GameState, unit: UnitState): number {
  return Math.max(0, state.cards[unit.cardId]?.hp ?? 0)
}
