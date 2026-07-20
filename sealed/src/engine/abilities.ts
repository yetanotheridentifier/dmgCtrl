import type { EngineCard, GameState, KeywordInstance, PlayerId, UnitState, CombatContext } from './types'
import type { AttackTarget } from './actions'

/**
 * Card ability framework (#303 spike → #340). Card-type-agnostic: units, leaders,
 * events and upgrades all register through the same registry, so their mechanics
 * are reused across card types.
 *
 * GameState stays pure JSON (records replay through the resolver), so ability CODE
 * cannot live in state. A module-level registry maps cardId → a definition (its
 * triggered abilities plus static hooks); the engine consults it at fixed points.
 * Cards with no entry play vanilla — existing behaviour is untouched.
 *
 * Effects are pure `(state, ctx) => state` functions composed from the primitives
 * library (`effects.ts`). Replays are deterministic for a given app version.
 */

/** Timing hooks the resolver fires (#340 adds onAttackEnd / whenReadies / whenRegroupStarts). */
export type TriggerPoint =
  | 'whenPlayed'
  | 'onAttack'
  | 'onAttackEnd'
  // "When a friendly unit's attack ends" (#347): fires for every unit the attacker's
  // controller has (and their undeployed leader), not just the attacker — distinct from
  // `onAttackEnd` ("when THIS unit's attack ends", the attacker only).
  | 'whenFriendlyAttackEnds'
  | 'whenReadies'
  | 'whenRegroupStarts'
  // "When you take the initiative" (#348, Mandalorian) — fires for the taker's undeployed leader.
  | 'whenTakeInitiative'
  | 'whenDefeated'
  // "When another friendly unit is defeated" (#357, The Twins): fires on the defeated unit's
  // controller's *surviving* units — distinct from `whenDefeated` (the defeated unit itself).
  | 'whenFriendlyUnitDefeated'
  // "When an enemy unit attacks your base" (#357, Kachirho Militia): fires on the attacked
  // player's units. `ctx.attackerInstanceId` is the attacking unit.
  | 'whenEnemyAttacksBase'
  // "When 1 or more upgrades attach to this unit" (#357, Sabine Wren) — fires on the unit that
  // received the upgrade, including the Shield token from Shielded on entry.
  | 'whenUpgradeAttached'
  | 'onDefense'
  | 'whenPlayOrCreateUnit'

export interface EffectContext {
  /** Controller of the ability's source card. */
  owner: PlayerId
  /** The card whose ability is firing (the unit's card, or an attached upgrade). */
  cardId: string
  /** In-play instance the ability belongs to, when one exists. */
  sourceInstanceId?: string
  /** `onAttackEnd` only: the target of the attack that just ended. */
  attackTarget?: AttackTarget
  /** `onAttackEnd` only: the instance id of the unit that made the attack. */
  attackerInstanceId?: string
  /** `onAttackEnd` only: combat damage dealt to the opponent's base this attack (0 if none). */
  combatDamageToBase?: number
  /** `onAttackEnd` only: the defending unit was defeated during this attack (#356, Thrawn / Halo / Rukh). */
  defenderDefeated?: boolean
  /** `onAttackEnd` only: combat damage the attacker dealt to the defending unit (0 if a base attack) (#356, Great Mothers). */
  combatDamageToDefender?: number
  /** `whenDefeated` only: the unit as captured at the moment of defeat (it has left play). */
  defeatedUnit?: UnitState
  /** `whenDefeated` only: true when the defeat was caused by combat damage (#356, Paz Vizsla / Shin Hati). */
  defeatedByCombat?: boolean
  /** A chosen target unit's instance id, when the ability picks one (#309). */
  targetInstanceId?: string
}

export type EffectFn = (state: GameState, ctx: EffectContext) => GameState

export interface AbilityDef {
  trigger: TriggerPoint
  /** Human-readable rules text — used by the log and future UI. */
  description: string
  effect: EffectFn
}

/**
 * A card's full behaviour: its triggered abilities plus static hooks the engine
 * consults. All optional — a card supplies only what it needs (#340).
 */
export interface CardDefinition {
  abilities?: AbilityDef[]
  /** Upgrades only: may this card attach to `target`? Default (no hook) = any unit. */
  attachRestriction?: (state: GameState, target: UnitState) => boolean
  /** Cost delta when playing this card (upgrades: `target` is the attach target). */
  costModifier?: (state: GameState, playerId: PlayerId, target?: UnitState) => number
  /** Extra keywords this card grants a unit (e.g. an upgrade granting a conditional keyword). */
  conditionalKeywords?: (state: GameState, unit: UnitState) => KeywordInstance[]
  /**
   * Keyword names this card *removes* from its unit while a condition holds (#353) — e.g. Marrok
   * loses Sentinel while upgraded. Applied after all keyword sources are gathered, so a keyword
   * granted here-and-now by another source isn't stripped unless its name is in this list.
   */
  suppressedKeywords?: (state: GameState, unit: UnitState) => string[]
  /**
   * Conditional power/HP delta this card contributes to its unit (the unit's own
   * card, or an upgrade modifying its host). Folded into `effectivePower`/`effectiveHp`;
   * `ctx` carries the combat situation (e.g. attacking a base). Omitted stats = 0.
   */
  statModifier?: (state: GameState, unit: UnitState, ctx: StatModContext) => { power?: number; hp?: number }
  /**
   * A unit *in play* discounting cards its controller plays (#357, Pit Droid Team). Distinct from
   * `costModifier`, which lives on the card being played. Summed across the controller's units and
   * their upgrades in `effectiveCost`; negative = cheaper.
   */
  costDiscount?: (state: GameState, source: UnitState, ctx: CostDiscountContext) => number
  /**
   * A unit *in play* waiving the aspect penalty of a card its controller plays (#357, Peli Motto).
   * Any waiving unit zeroes the whole penalty for that card.
   */
  waivesAspectPenalty?: (state: GameState, source: UnitState, ctx: CostDiscountContext) => boolean
  /**
   * Multiplier applied to each instance of damage this unit takes (the unit's own
   * card, or an upgrade) — e.g. Deadly Vulnerability's ×2. Multipliers from the card
   * and its upgrades compound. Default (no hook) = ×1.
   */
  damageMultiplier?: (state: GameState, unit: UnitState) => number
  /** This unit can't declare an attack against a base (#357, Wicket). */
  cannotAttackBases?: (state: GameState, unit: UnitState) => boolean
  /** This unit can't currently be attacked (#357, Tatooine Repulsor Train). Also keeps it from being a forced Sentinel target. */
  cannotBeAttacked?: (state: GameState, unit: UnitState) => boolean
  /** This unit may attack enemy units in either arena, not just its own (#357, Red Leader). */
  attacksEitherArena?: (state: GameState, unit: UnitState) => boolean
  /** Defender-side: while this unit defends, the attacker loses Overwhelm (#342). */
  negatesOverwhelm?: (state: GameState, unit: UnitState) => boolean
  /** Activated "Action:" abilities usable on the controller's turn (#343). */
  actionAbilities?: ActionAbilityDef[]
  /** Multiplier on how many cards this unit's searches look at — Arcana Star Map ×2 (#343). */
  searchModifier?: (state: GameState, unit: UnitState) => number
  /** Extra traits this card grants a unit — The Darksaber grants Mandalorian (#343). */
  grantedTraits?: (state: GameState, unit: UnitState) => string[]
  /** True if this card makes its unit a leader unit — The Darksaber (#343). */
  makesLeaderUnit?: (state: GameState, unit: UnitState) => boolean
  /** Aspect icons this unit provides while its controller pays costs — The Darksaber (#343). */
  providesAspects?: (state: GameState, unit: UnitState) => string[]
  /**
   * Undeployed-leader (front-side) behaviour (#309), kept separate from the deployed
   * unit-side (`abilities`/`actionAbilities`/keywords): while a leader is undeployed it
   * isn't a unit, so those never fire on it; once deployed it's a unit and these don't.
   */
  leaderAbilities?: LeaderAbilities
  /** Custom epic-action deploy gate (#309); default is `resources ≥ leader.cost`. */
  deployCondition?: (state: GameState, owner: PlayerId) => boolean
  /**
   * Constant/aura ability (#346): while `source` (a unit with this card, or an upgrade)
   * is in play, it contributes power/HP and/or keywords to OTHER units. Called for each
   * in-play `target`; return `undefined` when it doesn't affect that target. `sameController`
   * is true when source and target share a controller (friendly). `combat` carries the current
   * combat's roles when the aura pass runs during damage resolution (Grogu, #348). Must NOT read
   * the target's computed keywords/power (that recurses through the aura pass) — inspect card data.
   */
  aura?: (state: GameState, source: UnitState, target: UnitState, sameController: boolean, combat?: CombatContext) => AuraContribution | undefined
}

/** What an aura contributes to one affected unit (#346). */
export interface AuraContribution {
  power?: number
  hp?: number
  keywords?: KeywordInstance[]
  /** Keyword names this aura *removes* from the target — "enemy/all units lose X" (#354). */
  removeKeywords?: string[]
}

/**
 * Custom epic-action deploy condition (#309), overriding the default "control resources ≥
 * the leader's cost" — e.g. Bo-Katan (resources + friendly Mandalorian units ≥ 10).
 */
// (declared on CardDefinition above via `deployCondition`.)

/** A leader's undeployed-side abilities (#309). */
export interface LeaderAbilities {
  /** Activated "Action: [Exhaust] …" abilities usable while undeployed. */
  actions?: LeaderActionAbilityDef[]
  /** Triggered "When …" abilities that fire while undeployed (wired later). */
  abilities?: AbilityDef[]
}

/**
 * An activated leader-side action (#309). Uses exhaust the leader (and pay any `cost`).
 * `targets` enumerates valid target-unit instance ids when the ability picks one — an
 * empty list means it can't be used right now; `usable` gates target-less abilities.
 */
export interface LeaderActionAbilityDef {
  description: string
  /** Resource cost paid on use (default 0). */
  cost?: number
  /** Valid target-unit instance ids; omit for a target-less ability. */
  targets?: (state: GameState, owner: PlayerId) => string[]
  /** Gate for a target-less ability (defaults usable). */
  usable?: (state: GameState, owner: PlayerId) => boolean
  effect: (state: GameState, ctx: EffectContext) => GameState
}

/** A leader's undeployed action abilities (empty unless registered). */
export function leaderActions(cardId: string): LeaderActionAbilityDef[] {
  return registry.get(cardId)?.leaderAbilities?.actions ?? []
}

/** An activated ability a unit may use as its action (CR 2.4); e.g. Improvised Identity. */
export interface ActionAbilityDef {
  description: string
  /** Resource cost paid on use (default 0) — the ability's "C=N" cost (#348). */
  cost?: number
  /** May be used only once per round by a given unit (tracked on `UnitState.usedAbilities`). */
  oncePerRound?: boolean
  /** Extra gate beyond once-per-round (defaults usable). */
  usable?: (state: GameState, unit: UnitState) => boolean
  effect: (state: GameState, ctx: EffectContext) => GameState
}

/** A unit's action abilities, from its own card and each attached upgrade, with the
 *  source card id and per-card index so callers can address and track each one (#343). */
export function unitActionAbilities(unit: UnitState): { cardId: string; index: number; ability: ActionAbilityDef }[] {
  const out: { cardId: string; index: number; ability: ActionAbilityDef }[] = []
  for (const cardId of [unit.cardId, ...unit.upgrades.map(u => u.cardId)]) {
    const defs = registry.get(cardId)?.actionAbilities ?? []
    defs.forEach((ability, index) => out.push({ cardId, index, ability }))
  }
  return out
}

/** Stable key for once-per-round tracking of a specific action ability instance. */
export function actionAbilityKey(cardId: string, index: number): string {
  return `${cardId}#${index}`
}

/** What a `costDiscount` / `waivesAspectPenalty` hook is being asked about (#357). */
export interface CostDiscountContext {
  /** The player paying — the controller of the discounting unit. */
  owner: PlayerId
  /** The card being played. */
  card: EngineCard
  /** The upgrade's target unit, when an upgrade is being played. */
  target?: UnitState
}

/** Combat context passed to `statModifier` (mirrors `stats.StatContext`). */
export interface StatModContext {
  attacking?: boolean
  attackingBase?: boolean
  /** This unit is the defender in the current combat (#357, Palace Chef Droid). */
  defending?: boolean
  /** For the attacker: the defending unit had damage on it (#357, Marrok's Fiend Fighter). */
  defenderDamaged?: boolean
}

const registry = new Map<string, CardDefinition>()

/** Register (merging) a card's definition — abilities append, static hooks overwrite. */
export function registerCard(cardId: string, def: CardDefinition): void {
  const existing = registry.get(cardId)
  registry.set(cardId, {
    ...existing,
    ...def,
    abilities: [...(existing?.abilities ?? []), ...(def.abilities ?? [])],
  })
}

/** Convenience: register a single triggered ability on a card. */
export function registerAbility(cardId: string, def: AbilityDef): void {
  registerCard(cardId, { abilities: [def] })
}

export function unregisterAbility(cardId: string): void {
  registry.delete(cardId)
}

export function getCardDefinition(cardId: string): CardDefinition | undefined {
  return registry.get(cardId)
}

/** Every card id with a registered definition — the set of cards whose abilities are built. */
export function registeredCardIds(): string[] {
  return [...registry.keys()]
}

export function getAbilities(cardId: string): AbilityDef[] {
  return registry.get(cardId)?.abilities ?? []
}

/**
 * Fire every ability on `ctx.cardId` registered for `point`, in registration order.
 * Returns the input state unchanged (same reference) when nothing fires.
 */
export function runTrigger(state: GameState, point: TriggerPoint, ctx: EffectContext): GameState {
  let next = state
  for (const ability of getAbilities(ctx.cardId)) {
    if (ability.trigger === point) {
      next = ability.effect(next, ctx)
    }
  }
  return next
}

/**
 * Fire an undeployed leader's front-side triggered abilities at `point` (#309). A
 * deployed leader reacts via its unit (through `runUnitTrigger`), so this only fires
 * while the leader is in the base zone.
 */
export function runLeaderTrigger(state: GameState, point: TriggerPoint, owner: PlayerId, extra?: Partial<EffectContext>): GameState {
  const leader = state.players[owner].leader
  if (leader.deployed) return state
  let next = state
  for (const ability of registry.get(leader.cardId)?.leaderAbilities?.abilities ?? []) {
    if (ability.trigger === point) next = ability.effect(next, { owner, cardId: leader.cardId, ...extra })
  }
  return next
}

/**
 * Fire a unit event at `point` (#340): the unit's own card abilities AND each
 * attached upgrade's abilities, so an upgrade's "When Attack Ends: …" fires when
 * the attached unit's attack ends. `owner` controls the unit.
 */
export function runUnitTrigger(
  state: GameState,
  point: TriggerPoint,
  unit: UnitState,
  owner: PlayerId,
  extra?: Partial<EffectContext>,
): GameState {
  let next = state
  // The unit's own card, its upgrades, and any cards whose abilities are granted for
  // this attack (Improvised Identity, #343).
  const cardIds = [unit.cardId, ...unit.upgrades.map(u => u.cardId), ...(unit.grantedAbilityCardIds ?? [])]
  for (const cardId of cardIds) {
    for (const ability of getAbilities(cardId)) {
      if (ability.trigger === point) {
        next = ability.effect(next, { owner, cardId, sourceInstanceId: unit.instanceId, ...extra })
      }
    }
  }
  return next
}
