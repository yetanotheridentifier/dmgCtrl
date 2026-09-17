import type { GameState, KeywordInstance, UnitState, CombatContext } from './types'
import { lastingEffectTotals, abilityCardIds } from './types'
import { getCardDefinition } from './abilities'
import type { AttackContext, AuraContribution, StatModContext } from './abilities'

/** Keyword lookups against the static card db. */

export function hasKeyword(state: GameState, cardId: string, name: string): boolean {
  return (state.cards[cardId]?.keywords ?? []).some(k => k.name === name)
}

/** The keyword's numeral (Raid 2 → 2); 0 when absent or unvalued. */
export function keywordValue(state: GameState, cardId: string, name: string): number {
  return (state.cards[cardId]?.keywords ?? []).find(k => k.name === name)?.value ?? 0
}

/**
 * Unit-aware keyword lookups: a unit has a keyword if its own card OR any
 * attached upgrade grants it. Combat and legal-move checks that act on a unit go
 * through these so upgrade-granted keywords (Sentinel from an upgrade, etc.) count.
 */
/**
 * Conditional keywords a card grants a unit (e.g. Luke's Lightsaber → Sentinel if Luke).
 *
 * `ctx` carries the combat situation when there is one, so a keyword gained only in combat
 * ("while attacking a damaged unit, this unit gains Overwhelm") can read it. It is absent for a
 * resting read, which is the answer to "does this unit have the keyword right now", and a
 * combat-conditional grant correctly says no.
 */
function conditionalKeywordsOf(state: GameState, cardId: string, unit: UnitState, ctx?: StatModContext): KeywordInstance[] {
  return getCardDefinition(cardId)?.conditionalKeywords?.(state, unit, ctx) ?? []
}

/**
 * Instance ids whose keyword list is currently being computed. A conditional keyword that reads
 * effective POWER (Vonreg's TIE Interceptor gains Overwhelm at 4 power) comes back through this
 * pass, because power reads Raid, which is a keyword. While an id is in flight a nested request for
 * the same unit answers from its PRINTED sources alone, which breaks the cycle and cannot change a
 * non-cyclic computation, since that never re-enters the same id.
 */
const computingKeywords = new Set<string>()

/**
 * Every keyword a unit currently has, from all sources: its own card,
 * conditional keywords on its card, each attached upgrade (printed + conditional),
 * and any keywords granted for a single attack (Support).
 */
export function unitKeywords(state: GameState, unit: UnitState, ctx?: StatModContext): KeywordInstance[] {
  if (computingKeywords.has(unit.instanceId)) return printedKeywordList(state, unit)
  computingKeywords.add(unit.instanceId)
  try {
    const out = baseKeywordList(state, unit, ctx)
    // Keywords granted by other units' auras (Sloane → Overwhelm/Sentinel).
    // With the combat, so an aura can grant a keyword for one attack (Miraj Scintel's Overwhelm).
    const aura = auraContributions(state, unit, ctx?.combat)
    out.push(...aura.keywords)
    // Removals: the unit's own card/upgrades (Marrok loses Sentinel while upgraded) plus auras
    // ("enemy/all units lose X"). Applied after all grants — a keyword survives unless removed by name.
    const suppressed = suppressedKeywordsOf(state, unit)
    for (const name of aura.removeKeywords) suppressed.add(name)
    return suppressed.size > 0 ? out.filter(k => !suppressed.has(k.name)) : out
  } finally {
    computingKeywords.delete(unit.instanceId)
  }
}

/**
 * A unit's keywords from its PRINTED sources only: its cards' own `Keywords`, single-attack grants
 * and "this phase" lasting effects. No hook is consulted, so this cannot re-enter the keyword pass
 * and is what a cycle falls back to.
 */
function printedKeywordList(state: GameState, unit: UnitState): KeywordInstance[] {
  const out: KeywordInstance[] = []
  for (const cardId of abilityCardIds(unit)) out.push(...(state.cards[cardId]?.keywords ?? []))
  out.push(...(unit.grantedKeywords ?? []))
  out.push(...lastingEffectTotals(state, unit.instanceId).keywords)
  return out
}

/**
 * A unit's keywords from every NON-aura source: its card + conditional keywords, each upgrade
 * (printed + conditional), Support-granted abilities, single-attack grants, and "this phase" lasting
 * effects. No aura contributions and no removals — the recursion-safe base an aura can inspect.
 */
function baseKeywordList(state: GameState, unit: UnitState, ctx?: StatModContext): KeywordInstance[] {
  const out = printedKeywordList(state, unit)
  // Own card, each upgrade, and any card lent for this attack, each contributing its conditional
  // keywords too. A lent card used to contribute printed keywords only, so a conditional keyword on
  // a borrowed card was silently dropped (#417).
  for (const cardId of abilityCardIds(unit)) {
    out.push(...conditionalKeywordsOf(state, cardId, unit, ctx))
  }
  return out
}

/**
 * Distinct keyword names a unit has from non-aura sources, after its own conditional removals — used
 * by auras that *count* a target's keywords (Gallius Rax) without recursing back through auras.
 */
export function nonAuraKeywordNames(state: GameState, unit: UnitState): Set<string> {
  const names = new Set(baseKeywordList(state, unit).map(k => k.name))
  for (const name of suppressedKeywordsOf(state, unit)) names.delete(name)
  return names
}

/**
 * A unit's keyword NUMERAL from non-aura sources — what an aura that scales a keyword it can see on
 * its target reads (Marchion Ro doubles each friendly unit's Raid). Asking `unitKeywordValue` there
 * would recurse through the aura pass, and the doubling would double its own contribution.
 */
export function nonAuraKeywordValue(state: GameState, unit: UnitState, name: string): number {
  if (suppressedKeywordsOf(state, unit).has(name)) return 0
  return baseKeywordList(state, unit).reduce((sum, k) => (k.name === name ? sum + (k.value ?? 0) : sum), 0)
}

/** Keyword names conditionally removed from a unit by its own card or an upgrade. */
function suppressedKeywordsOf(state: GameState, unit: UnitState): Set<string> {
  const names = new Set<string>()
  for (const cardId of abilityCardIds(unit)) {
    for (const name of getCardDefinition(cardId)?.suppressedKeywords?.(state, unit) ?? []) names.add(name)
  }
  // "Loses X for this phase" (SpecForce Soldier).
  for (const e of state.lastingEffects ?? []) {
    if (e.targetInstanceId === unit.instanceId) for (const name of e.removeKeywords ?? []) names.add(name)
  }
  return names
}

export function unitHasKeyword(state: GameState, unit: UnitState, name: string, ctx?: StatModContext): boolean {
  return unitKeywords(state, unit, ctx).some(k => k.name === name)
}

/** A unit's total keyword numeral — values stack across every source. */
export function unitKeywordValue(state: GameState, unit: UnitState, name: string, ctx?: StatModContext): number {
  return unitKeywords(state, unit, ctx).reduce((sum, k) => (k.name === name ? sum + (k.value ?? 0) : sum), 0)
}

/** True if this unit (its card or an upgrade) makes an attacker lose Overwhelm while it defends. */
export function unitNegatesOverwhelm(state: GameState, unit: UnitState): boolean {
  return abilityCardIds(unit).some(id => getCardDefinition(id)?.negatesOverwhelm?.(state, unit) ?? false)
}

/**
 * True if the unit deals its combat damage before the defender (Carson Teva). Includes
 * abilities lent for this attack (`grantedAbilityCardIds`), so a unit attacking via Carson's
 * Support gains his first strike too.
 */
export function unitDealsDamageFirst(state: GameState, unit: UnitState, ctx?: AttackContext): boolean {
  return abilityCardIds(unit)
    .some(id => getCardDefinition(id)?.dealsDamageFirst?.(state, unit, ctx) ?? false)
}

/** True if this unit's excess combat damage spills onto another unit rather than the base (Wipe Them Out). */
export function unitSpillsExcessToUnit(state: GameState, unit: UnitState): boolean {
  return abilityCardIds(unit)
    .some(id => getCardDefinition(id)?.spillsExcessToUnit?.(state, unit) ?? false)
}

/** True if the unit deals no combat damage for now (Betrayed Trust). */
export function unitDealsNoCombatDamage(state: GameState, unit: UnitState): boolean {
  return (state.lastingEffects ?? []).some(e => e.noCombatDamage && e.targetInstanceId === unit.instanceId)
}

/** True if any of the unit's cards forbids it attacking bases (Wicket). */
export function unitCannotAttackBases(state: GameState, unit: UnitState): boolean {
  if ((state.lastingEffects ?? []).some(e => e.cannotAttackBases && e.targetInstanceId === unit.instanceId)) return true
  return abilityCardIds(unit).some(id => getCardDefinition(id)?.cannotAttackBases?.(state, unit) ?? false)
}

/**
 * True if the unit can't declare an attack at all (Loth-Wolf). Read by `enemyAttackTargets`, which
 * is the one answer behind all five sources of an attack, so the restriction binds each of them.
 */
export function unitCannotAttack(state: GameState, unit: UnitState): boolean {
  // A lasting prohibition aimed at this unit (Chaotic Diversion) binds exactly like a printed one.
  if ((state.lastingEffects ?? []).some(e => e.cannotAttack && e.targetInstanceId === unit.instanceId)) return true
  return abilityCardIds(unit).some(id => getCardDefinition(id)?.cannotAttack?.(state, unit) ?? false)
}

/** True if the unit currently can't be attacked (Tatooine Repulsor Train). */
export function unitCannotBeAttacked(state: GameState, unit: UnitState): boolean {
  // A lasting protection aimed at this unit (Dooku; On Top of Things only while it lacks Sentinel).
  const lasting = (state.lastingEffects ?? []).filter(e => e.cannotBeAttacked && e.targetInstanceId === unit.instanceId)
  if (lasting.some(e => !e.unlessSentinel) || (lasting.length > 0 && !unitHasKeyword(state, unit, 'Sentinel'))) return true
  return abilityCardIds(unit).some(id => getCardDefinition(id)?.cannotBeAttacked?.(state, unit) ?? false)
}

/** True if the unit may attack enemy units in either arena (Red Leader). */
export function unitAttacksEitherArena(state: GameState, unit: UnitState): boolean {
  return abilityCardIds(unit).some(id => getCardDefinition(id)?.attacksEitherArena?.(state, unit) ?? false)
}

/** A unit's traits — its card's plus any granted by an upgrade (The Darksaber → Mandalorian). */
export function unitTraits(state: GameState, unit: UnitState): string[] {
  const out = [...(state.cards[unit.cardId]?.traits ?? [])]
  const removed = new Set<string>()
  for (const cardId of abilityCardIds(unit)) {
    const def = getCardDefinition(cardId)
    out.push(...(def?.grantedTraits?.(state, unit) ?? []))
    for (const t of def?.removedTraits?.(state, unit) ?? []) removed.add(t.toLowerCase())
  }
  return removed.size > 0 ? out.filter(t => !removed.has(t.toLowerCase())) : out
}

/** Case-insensitive trait test that includes granted traits. */
export function unitHasTrait(state: GameState, unit: UnitState, name: string): boolean {
  return unitTraits(state, unit).some(t => t.toLowerCase() === name.toLowerCase())
}

/**
 * Aura contributions to `target` from every in-play unit's constant abilities.
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
  const add = (contrib: AuraContribution | undefined): void => {
    if (!contrib) return
    power += contrib.power ?? 0
    hp += contrib.hp ?? 0
    if (contrib.keywords) keywords.push(...contrib.keywords)
    if (contrib.removeKeywords) removeKeywords.push(...contrib.removeKeywords)
  }
  for (const owner of ['player', 'opponent'] as const) {
    const sameController = owner === targetOwner
    const leader = state.players[owner].leader
    // An undeployed leader and the base are not units, so each contributes for its controller.
    if (!leader.deployed) add(getCardDefinition(leader.cardId)?.leaderAbilities?.aura?.(state, owner, target, sameController, combat))
    add(getCardDefinition(state.players[owner].base.cardId)?.baseAbilities?.aura?.(state, owner, target, sameController, combat))
    for (const source of state.players[owner].units) {
      for (const cardId of abilityCardIds(source)) {
        add(getCardDefinition(cardId)?.aura?.(state, source, target, sameController, combat))
      }
    }
  }
  return { power, hp, keywords, removeKeywords }
}

/** True if this unit is a leader unit — natively, or made one by an upgrade (The Darksaber). */
export function isLeaderUnit(state: GameState, unit: UnitState): boolean {
  if (unit.isLeader) return true
  return abilityCardIds(unit).some(id => getCardDefinition(id)?.makesLeaderUnit?.(state, unit) ?? false)
}
