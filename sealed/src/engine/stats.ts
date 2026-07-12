import type { GameState, UnitState } from './types'
import { unitHasKeyword, unitKeywordValue } from './keywords'

/**
 * Computed unit stats (#305). All combat and defeat checks go through these
 * helpers so upgrades (#308) and lasting effects (#306) slot into one place.
 * Attached upgrades add their printed power/HP; Power/HP never drop below 0
 * (CR 1.10.4 / 1.11.4).
 */

export interface StatContext {
  /** True while the unit is the attacker in an attack (Raid applies). */
  attacking?: boolean
}

/** Sum a stat across the unit's card and every attached upgrade (#308). */
function withUpgrades(state: GameState, unit: UnitState, stat: 'power' | 'hp'): number {
  let total = state.cards[unit.cardId]?.[stat] ?? 0
  for (const { cardId } of unit.upgrades) total += state.cards[cardId]?.[stat] ?? 0
  return total
}

export function effectivePower(state: GameState, unit: UnitState, ctx: StatContext = {}): number {
  let power = withUpgrades(state, unit, 'power')
  if (ctx.attacking) {
    power += unitKeywordValue(state, unit, 'Raid')
  }
  if (unitHasKeyword(state, unit, 'Grit')) {
    power += unit.damage
  }
  return Math.max(0, power)
}

export function effectiveHp(state: GameState, unit: UnitState): number {
  return Math.max(0, withUpgrades(state, unit, 'hp'))
}
