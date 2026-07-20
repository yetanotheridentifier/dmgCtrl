import type { GameState, KeywordInstance, UnitState, CombatContext } from './types'
import { lastingEffectTotals } from './types'
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
  const out = baseKeywordList(state, unit)
  // Keywords granted by other units' auras (Sloane → Overwhelm/Sentinel, #346).
  const aura = auraContributions(state, unit)
  out.push(...aura.keywords)
  // Removals: the unit's own card/upgrades (Marrok loses Sentinel while upgraded, #353) plus auras
  // ("enemy/all units lose X", #354). Applied after all grants — a keyword survives unless removed by name.
  const suppressed = suppressedKeywordsOf(state, unit)
  for (const name of aura.removeKeywords) suppressed.add(name)
  return suppressed.size > 0 ? out.filter(k => !suppressed.has(k.name)) : out
}

/**
 * A unit's keywords from every NON-aura source: its card + conditional keywords, each upgrade
 * (printed + conditional), Support-granted abilities, single-attack grants, and "this phase" lasting
 * effects. No aura contributions and no removals — the recursion-safe base an aura can inspect (#354).
 */
function baseKeywordList(state: GameState, unit: UnitState): KeywordInstance[] {
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
  out.push(...lastingEffectTotals(state, unit.instanceId).keywords)
  return out
}

/**
 * Distinct keyword names a unit has from non-aura sources, after its own conditional removals — used
 * by auras that *count* a target's keywords (Gallius Rax) without recursing back through auras (#354).
 */
export function nonAuraKeywordNames(state: GameState, unit: UnitState): Set<string> {
  const names = new Set(baseKeywordList(state, unit).map(k => k.name))
  for (const name of suppressedKeywordsOf(state, unit)) names.delete(name)
  return names
}

/** Keyword names conditionally removed from a unit by its own card or an upgrade (#353). */
function suppressedKeywordsOf(state: GameState, unit: UnitState): Set<string> {
  const names = new Set<string>()
  for (const cardId of [unit.cardId, ...unit.upgrades.map(u => u.cardId)]) {
    for (const name of getCardDefinition(cardId)?.suppressedKeywords?.(state, unit) ?? []) names.add(name)
  }
  return names
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

/**
 * True if the unit deals its combat damage before the defender (#357, Carson Teva). Includes
 * abilities lent for this attack (`grantedAbilityCardIds`), so a unit attacking via Carson's
 * Support gains his first strike too.
 */
export function unitDealsDamageFirst(state: GameState, unit: UnitState): boolean {
  return [unit.cardId, ...unit.upgrades.map(u => u.cardId), ...(unit.grantedAbilityCardIds ?? [])]
    .some(id => getCardDefinition(id)?.dealsDamageFirst?.(state, unit) ?? false)
}

/** True if any of the unit's cards forbids it attacking bases (#357, Wicket). */
export function unitCannotAttackBases(state: GameState, unit: UnitState): boolean {
  return [unit.cardId, ...unit.upgrades.map(u => u.cardId)].some(id => getCardDefinition(id)?.cannotAttackBases?.(state, unit) ?? false)
}

/** True if the unit currently can't be attacked (#357, Tatooine Repulsor Train). */
export function unitCannotBeAttacked(state: GameState, unit: UnitState): boolean {
  return [unit.cardId, ...unit.upgrades.map(u => u.cardId)].some(id => getCardDefinition(id)?.cannotBeAttacked?.(state, unit) ?? false)
}

/** True if the unit may attack enemy units in either arena (#357, Red Leader). */
export function unitAttacksEitherArena(state: GameState, unit: UnitState): boolean {
  return [unit.cardId, ...unit.upgrades.map(u => u.cardId)].some(id => getCardDefinition(id)?.attacksEitherArena?.(state, unit) ?? false)
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

/**
 * Aura contributions to `target` from every in-play unit's constant abilities (#346).
 * Sums power/HP and collects granted keywords. A source affects a target via its card's
 * (or an upgrade's) `aura` hook; `sameController` = source and target share a controller.
 */
export function auraContributions(state: GameState, target: UnitState, combat?: CombatContext): { power: number; hp: number; keywords: KeywordInstance[]; removeKeywords: string[] } {
  const targetOwner = (['player', 'opponent'] as const).find(o => state.players[o].units.some(u => u.instanceId === target.instanceId))
  if (!targetOwner) return { power: 0, hp: 0, keywords: [], removeKeywords: [] }
  let power = 0
  let hp = 0
  const keywords: KeywordInstance[] = []
  const removeKeywords: string[] = []
  for (const owner of ['player', 'opponent'] as const) {
    const sameController = owner === targetOwner
    for (const source of state.players[owner].units) {
      for (const cardId of [source.cardId, ...source.upgrades.map(u => u.cardId)]) {
        const contrib = getCardDefinition(cardId)?.aura?.(state, source, target, sameController, combat)
        if (contrib) {
          power += contrib.power ?? 0
          hp += contrib.hp ?? 0
          if (contrib.keywords) keywords.push(...contrib.keywords)
          if (contrib.removeKeywords) removeKeywords.push(...contrib.removeKeywords)
        }
      }
    }
  }
  return { power, hp, keywords, removeKeywords }
}

/** True if this unit is a leader unit — natively, or made one by an upgrade (The Darksaber, #343). */
export function isLeaderUnit(state: GameState, unit: UnitState): boolean {
  if (unit.isLeader) return true
  return [unit.cardId, ...unit.upgrades.map(u => u.cardId)].some(id => getCardDefinition(id)?.makesLeaderUnit?.(state, unit) ?? false)
}
