import type { GameState, KeywordInstance, UnitState } from './types'
import { getCardDefinition } from './abilities'

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
/** Conditional keywords a card grants a unit (e.g. Luke's Lightsaber → Sentinel if Luke) (#340). */
function conditionalKeywordsOf(state: GameState, cardId: string, unit: UnitState): KeywordInstance[] {
  return getCardDefinition(cardId)?.conditionalKeywords?.(state, unit) ?? []
}

/**
 * Every keyword a unit currently has, from all sources (#334/#340): its own card,
 * conditional keywords on its card, each attached upgrade (printed + conditional),
 * and any keywords granted for a single attack (Support).
 */
export function unitKeywords(state: GameState, unit: UnitState): KeywordInstance[] {
  const out: KeywordInstance[] = [
    ...(state.cards[unit.cardId]?.keywords ?? []),
    ...conditionalKeywordsOf(state, unit.cardId, unit),
  ]
  for (const { cardId } of unit.upgrades) {
    out.push(...(state.cards[cardId]?.keywords ?? []), ...conditionalKeywordsOf(state, cardId, unit))
  }
  // Cards whose full abilities are granted for one attack (Improvised Identity, #343).
  for (const cardId of unit.grantedAbilityCardIds ?? []) {
    out.push(...(state.cards[cardId]?.keywords ?? []))
  }
  out.push(...(unit.grantedKeywords ?? []))
  return out
}

export function unitHasKeyword(state: GameState, unit: UnitState, name: string): boolean {
  return unitKeywords(state, unit).some(k => k.name === name)
}

/** A unit's total keyword numeral — values stack across every source. */
export function unitKeywordValue(state: GameState, unit: UnitState, name: string): number {
  return unitKeywords(state, unit).reduce((sum, k) => (k.name === name ? sum + (k.value ?? 0) : sum), 0)
}

/** True if this unit (its card or an upgrade) makes an attacker lose Overwhelm while it defends (#342). */
export function unitNegatesOverwhelm(state: GameState, unit: UnitState): boolean {
  return [unit.cardId, ...unit.upgrades.map(u => u.cardId)].some(id => getCardDefinition(id)?.negatesOverwhelm?.(state, unit) ?? false)
}

/** A unit's traits — its card's plus any granted by an upgrade (The Darksaber → Mandalorian, #343). */
export function unitTraits(state: GameState, unit: UnitState): string[] {
  const out = [...(state.cards[unit.cardId]?.traits ?? [])]
  for (const cardId of [unit.cardId, ...unit.upgrades.map(u => u.cardId)]) {
    out.push(...(getCardDefinition(cardId)?.grantedTraits?.(state, unit) ?? []))
  }
  return out
}

/** Case-insensitive trait test that includes granted traits (#343). */
export function unitHasTrait(state: GameState, unit: UnitState, name: string): boolean {
  return unitTraits(state, unit).some(t => t.toLowerCase() === name.toLowerCase())
}

/** True if this unit is a leader unit — natively, or made one by an upgrade (The Darksaber, #343). */
export function isLeaderUnit(state: GameState, unit: UnitState): boolean {
  if (unit.isLeader) return true
  return [unit.cardId, ...unit.upgrades.map(u => u.cardId)].some(id => getCardDefinition(id)?.makesLeaderUnit?.(state, unit) ?? false)
}
