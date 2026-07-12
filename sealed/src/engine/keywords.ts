import type { GameState, UnitState } from './types'

/** Keyword lookups against the static card db (#305). */

export function hasKeyword(state: GameState, cardId: string, name: string): boolean {
  return (state.cards[cardId]?.keywords ?? []).some(k => k.name === name)
}

/** The keyword's numeral (Raid 2 → 2); 0 when absent or unvalued. */
export function keywordValue(state: GameState, cardId: string, name: string): number {
  return (state.cards[cardId]?.keywords ?? []).find(k => k.name === name)?.value ?? 0
}

/**
 * Unit-aware keyword lookups (#308): a unit has a keyword if its own card OR any
 * attached upgrade grants it. Combat and legal-move checks that act on a unit go
 * through these so upgrade-granted keywords (Sentinel from an upgrade, etc.) count.
 */
export function unitHasKeyword(state: GameState, unit: UnitState, name: string): boolean {
  return (
    hasKeyword(state, unit.cardId, name) ||
    unit.upgrades.some(({ cardId }) => hasKeyword(state, cardId, name)) ||
    // Keywords granted for a single attack (Support, #334).
    (unit.grantedKeywords ?? []).some(k => k.name === name)
  )
}

/** A unit's total keyword numeral — values stack across the card, its upgrades, and
 *  any keywords granted for the attack (Support). */
export function unitKeywordValue(state: GameState, unit: UnitState, name: string): number {
  let total = keywordValue(state, unit.cardId, name)
  for (const { cardId } of unit.upgrades) total += keywordValue(state, cardId, name)
  for (const k of unit.grantedKeywords ?? []) if (k.name === name) total += k.value ?? 0
  return total
}
