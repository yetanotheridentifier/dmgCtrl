import type { GameState, KeywordInstance, PlayerId, UnitState, CombatContext } from './types'
import { lastingEffectTotals, abilityCardIds, baseAbilityCardIds, traitsRemovedFrom } from './types'
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
  if (computingKeywords.has(unit.instanceId)) return withKeywordSwaps(state, unit, printedKeywordList(state, unit))
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
    return withKeywordSwaps(state, unit, suppressed.size > 0 ? out.filter(k => !suppressed.has(k.name)) : out)
  } finally {
    computingKeywords.delete(unit.instanceId)
  }
}

/**
 * Keyword names a card currently exchanges on its unit, as a lookup from each name to the one it is
 * read as (Asajj Ventress trades Raid for Restore and Restore for Raid, for one attack). Each pair
 * registers in both directions, which is what "or vice versa" asks for.
 */
function keywordSwapsOf(state: GameState, unit: UnitState): Map<string, string> {
  const swaps = new Map<string, string>()
  for (const cardId of abilityCardIds(unit)) {
    for (const [from, to] of getCardDefinition(cardId)?.swappedKeywords?.(state, unit) ?? []) {
      swaps.set(from, to)
      swaps.set(to, from)
    }
  }
  return swaps
}

/**
 * The swap, applied as a **rename over a finished keyword list**: every instance keeps its numeral
 * and answers to the other name. Running last is what makes "replace any Raid it **has or gains**"
 * true of a keyword from any source, printed, conditional, granted or aura, and it needs neither a
 * read of the old value before hiding it nor a suppression that the grant would then have to dodge.
 */
function withKeywordSwaps(state: GameState, unit: UnitState, keywords: KeywordInstance[]): KeywordInstance[] {
  const swaps = keywordSwapsOf(state, unit)
  if (swaps.size === 0) return keywords
  return keywords.map(k => (swaps.has(k.name) ? { ...k, name: swaps.get(k.name)! } : k))
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
 * A unit's keyword instances from NON-aura sources, after its own conditional removals and swaps.
 * This is what an aura reads when it needs a unit's keywords from inside the keyword pass: about its
 * target, to count or scale them (Gallius Rax, Marchion Ro), or about its own source, to lend them
 * on (The Ghost). `unitKeywords` there would recurse back through the aura pass, and a scaling aura
 * would go on to double its own contribution.
 */
export function nonAuraKeywords(state: GameState, unit: UnitState): KeywordInstance[] {
  const suppressed = suppressedKeywordsOf(state, unit)
  const base = baseKeywordList(state, unit)
  return withKeywordSwaps(state, unit, suppressed.size > 0 ? base.filter(k => !suppressed.has(k.name)) : base)
}

/** Distinct keyword names a unit has from non-aura sources. See {@link nonAuraKeywords}. */
export function nonAuraKeywordNames(state: GameState, unit: UnitState): Set<string> {
  return new Set(nonAuraKeywords(state, unit).map(k => k.name))
}

/** A unit's keyword NUMERAL from non-aura sources. See {@link nonAuraKeywords}. */
export function nonAuraKeywordValue(state: GameState, unit: UnitState, name: string): number {
  return nonAuraKeywords(state, unit).reduce((sum, k) => (k.name === name ? sum + (k.value ?? 0) : sum), 0)
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

/** True if the unit's combat damage is its remaining HP rather than its power, for this attack (Babu Frik). */
export function unitDealsCombatDamageByHp(state: GameState, unit: UnitState): boolean {
  return abilityCardIds(unit).some(id => getCardDefinition(id)?.dealsCombatDamageByHp?.(state, unit) ?? false)
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

/**
 * **The one read of a card's traits**, for a card anywhere: in play, in hand, in a deck, in a discard
 * pile. Printed traits, plus any the card gives itself wherever it is (Zam Wesell copies her leader's),
 * minus any an effect has taken off that player's cards for the phase (The First Legion names one).
 *
 * `owner` is the player whose copy is being read, and both halves need it: the grant reads that
 * player's board, and the removal is aimed at one player's cards. Omit it only where there is
 * genuinely no owner to name, and the printed traits are then all that can be said.
 *
 * `unitTraits` is this plus the traits a unit picks up from what is attached to it.
 */
export function cardTraits(state: GameState, cardId: string, owner?: PlayerId): string[] {
  const printed = state.cards[cardId]?.traits ?? []
  const granted = owner ? getCardDefinition(cardId)?.cardTraits?.(state, owner) ?? [] : []
  const out = granted.length > 0 ? [...printed, ...granted] : printed
  const lost = owner ? traitsRemovedFrom(state, owner) : undefined
  return lost && lost.size > 0 ? out.filter(t => !lost.has(t.toLowerCase())) : out
}

/** Case-insensitive trait test for a card anywhere. See {@link cardTraits}. */
export function cardHasTrait(state: GameState, cardId: string, name: string, owner?: PlayerId): boolean {
  return cardTraits(state, cardId, owner).some(t => t.toLowerCase() === name.toLowerCase())
}

/**
 * A unit's traits — its card's (through {@link cardTraits}) plus any granted by an upgrade
 * (The Darksaber → Mandalorian).
 *
 * The controller is looked up only when something on the board could make a difference: a card-level
 * grant registered for this card, or a trait removal in force. Every other call, which is nearly all
 * of them in an AI search, does the same work it always did.
 */
export function unitTraits(state: GameState, unit: UnitState): string[] {
  const cardLevel = state.traitsRemoved !== undefined || getCardDefinition(unit.cardId)?.cardTraits !== undefined
  const out = cardLevel
    ? [...cardTraits(state, unit.cardId, controllerOf(state, unit))]
    : [...(state.cards[unit.cardId]?.traits ?? [])]
  const removed = new Set<string>()
  for (const cardId of abilityCardIds(unit)) {
    const def = getCardDefinition(cardId)
    out.push(...(def?.grantedTraits?.(state, unit) ?? []))
    for (const t of def?.removedTraits?.(state, unit) ?? []) removed.add(t.toLowerCase())
  }
  return removed.size > 0 ? out.filter(t => !removed.has(t.toLowerCase())) : out
}

/** Which player has this unit in their units array. Only asked where a card-level trait rule is live. */
function controllerOf(state: GameState, unit: UnitState): PlayerId | undefined {
  return state.players.player.units.some(u => u.instanceId === unit.instanceId) ? 'player'
    : state.players.opponent.units.some(u => u.instanceId === unit.instanceId) ? 'opponent'
      : undefined
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
    for (const cardId of baseAbilityCardIds(state.players[owner].base)) {
      add(getCardDefinition(cardId)?.baseAbilities?.aura?.(state, owner, target, sameController, combat))
    }
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
