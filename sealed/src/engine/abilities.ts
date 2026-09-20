import type { Arena, DelayedEffect, EngineCard, GameState, KeywordInstance, PendingTrigger, PlayerId, UnitState, CombatContext, DamageSource, TriggerContext, UpgradeRef } from './types'
import { abilityCardIds, baseAbilityCardIds } from './types'

/**
 * Card ability framework. Card-type-agnostic: units, leaders, events and upgrades
 * all register through the same registry, so their mechanics are reused across card types.
 *
 * GameState stays pure JSON (records replay through the resolver), so ability CODE
 * cannot live in state. A module-level registry maps cardId → a definition (its
 * triggered abilities plus static hooks); the engine consults it at fixed points.
 * Cards with no entry play vanilla — existing behaviour is untouched.
 *
 * Effects are pure `(state, ctx) => state` functions composed from the primitives
 * library (`effects.ts`). Replays are deterministic for a given app version.
 */

/** Timing hooks the resolver fires (adds onAttackEnd / whenReadies / whenRegroupStarts). */
export type TriggerPoint =
  | 'whenPlayed'
  | 'onAttack'
  | 'onAttackEnd'
  // "When a friendly unit's attack ends": fires for every unit the attacker's
  // controller has (and their undeployed leader), not just the attacker — distinct from
  // `onAttackEnd` ("when THIS unit's attack ends", the attacker only).
  | 'whenFriendlyAttackEnds'
  | 'whenReadies'
  | 'whenRegroupStarts'
  // "When you take the initiative" (Mandalorian) — fires for the taker's undeployed leader.
  | 'whenTakeInitiative'
  | 'whenDefeated'
  // "When another friendly unit is defeated" (The Twins): fires on the defeated unit's
  // controller's *surviving* units — distinct from `whenDefeated` (the defeated unit itself).
  | 'whenFriendlyUnitDefeated'
  // "When an enemy unit is defeated" (Chimaera): the mirror of the above — fires on the
  // OPPOSING player's units when a unit is defeated.
  | 'whenEnemyUnitDefeated'
  // "When an enemy unit attacks your base" (Kachirho Militia): fires on the attacked
  // player's units. `ctx.attackerInstanceId` is the attacking unit.
  | 'whenEnemyAttacksBase'
  // "When 1 or more upgrades attach to this unit" (Sabine Wren) — fires on the unit that
  // received the upgrade, including the Shield token from Shielded on entry.
  | 'whenUpgradeAttached'
  // "When you draw 1 or more cards" (Axe Woves): fires once per draw EVENT (not per card)
  // on the drawing player's units, including the regroup-phase draw.
  | 'whenDrawCards'
  // "When your base is dealt damage" (Blade Three): fires on the damaged base's owner's units.
  // All base damage funnels through `dealDamageToBase`, so combat and ability damage both count.
  | 'whenOwnBaseDamaged'
  // "When a friendly upgrade is defeated" (Zeb Orrelios): fires on the upgrade owner's units.
  // Deliberately narrow: raised by an effect defeating an upgrade, or by its host unit dying — NOT
  // by a Shield/Advantage token being spent as part of combat resolution, which happens inside
  // damage application, where raising a choice would interrupt a half-applied combat.
  | 'whenFriendlyUpgradeDefeated'
  // "When a friendly unit is dealt damage and survives" (Rancor Keeper). `ctx.damagedSurvivors` names them.
  | 'whenFriendlyDamagedSurvives'
  // "When you deal damage to an enemy base" (Cassian Andor): fires on the units of the player whose
  // opponent's base was dealt damage, unless that base's own controller's card dealt it.
  | 'whenEnemyBaseDamaged'
  | 'onDefense'
  // "When you play a unit" (Maz Kanata, Poggle the Lesser): a unit arriving through a play. Fires on the
  // player's undeployed leader and their OTHER units, with `ctx.targetInstanceId` the played unit.
  | 'whenPlayUnit'
  // "When you create a unit": a token unit being created (`createTokenUnit`), fired on the same
  // listeners as `whenPlayUnit`. "Play or create" (Greef Karga) registers both.
  | 'whenCreateUnit'
  // "When a friendly unit enters play" (Outcast): a unit arriving under your control by ANY route, so
  // a play, a token being created, a leader deploying (CR 3: deployed, not played) and a captured card
  // rescued back into play all raise it. Same listeners as `whenPlayUnit`, and the arriving unit is in
  // `ctx.targetInstanceId`. A card that reads "when you play or create" wants those two points instead.
  | 'whenFriendlyEntersPlay'
  // "When Deployed": fires on a leader unit as it deploys, after its entry keywords (Shielded, Hidden).
  | 'whenDeployed'
  // "When you play an upgrade" (The Tarkin Doctrine reads Fortification ones): fires on the player's
  // undeployed leader, units and base, with the upgrade in `ctx.playedCardId`.
  | 'whenPlayUpgrade'
  // "When you play a <kind of> card" (Agent Kallus reads Heroism ones): the same listeners as
  // `whenPlayUpgrade`, but for a card of ANY type, so it fires from all three play doors. The card
  // is in `ctx.playedCardId`, and the condition is the registering card's to apply.
  | 'whenPlayCard'
  // "When a unit enters play", either player's, played or created (Trap Field). Collected from both
  // players' bases only, since no unit or leader reads it; `ctx.targetInstanceId` is the unit.
  | 'whenUnitEntersPlay'
  // "When the action phase starts" (Beast Lair, on a base): fired for every unit and each player's
  // leader and base as the next round's action phase begins, alongside the `actionPhaseStart` delayed
  // effects. The game's FIRST action phase raises nothing, which is right for every card that can
  // read it: each has to be played during an action phase to be in play at all.
  | 'whenActionPhaseStarts'

/**
 * What one ability's effect is handed when it resolves: who owns it and which card it is on, plus the
 * event details in {@link TriggerContext}. The event half is shared with `PendingTrigger.ctx`, so an
 * effect reads the same field names whether it ran eagerly or waited in the ordered queue.
 */
export interface EffectContext extends TriggerContext {
  /** Controller of the ability's source card. */
  owner: PlayerId
  /** The card whose ability is firing (the unit's card, or an attached upgrade). */
  cardId: string
  /** In-play instance the ability belongs to, when one exists. */
  sourceInstanceId?: string
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
 * consults. All optional — a card supplies only what it needs.
 */
/** What an `ifYouDo` hook is told: the ability's context plus what the choice before it settled. */
export interface IfYouDoContext extends EffectContext {
  /** The stage of the ability being resumed, when it has more than one (`IfYouDo.step`). */
  step?: string
  /**
   * The card a discard just put in the discard pile, or a hand card just chosen (then `handIndex` is
   * where it is). The chosen unit is `targetInstanceId`.
   */
  cardChosen?: string
  handIndex?: number
  /** The upgrade chosen by this stage or carried from an earlier one (`IfYouDo.upgrade`). */
  upgradeChosen?: UpgradeRef
  /** The player a `choosePlayerThen` picked. */
  playerChosen?: PlayerId
  /** The option a `selectCardThen` picked (`cardChosen` is its card). */
  optionIndex?: number
  /** The arena a `chooseArenaThen` picked. */
  arenaChosen?: Arena
  /** The unit an earlier stage chose (`IfYouDo.unit`). */
  unitChosen?: string
  /** The card name a `nameCard` with `then` settled. */
  nameChosen?: string
}

export interface CardDefinition {
  abilities?: AbilityDef[]
  /**
   * The rest of an ability after a choice partway through it (`mayPayThen`, `selectUnitThen`, a
   * discard's `ifYouDo`): "you may pay 1. If you do, ...", or several things done to one chosen unit.
   */
  ifYouDo?: (state: GameState, ctx: IfYouDoContext) => GameState
  /**
   * For the `GRANT_*` pseudo cards only: the REAL card this ability carrier belongs to. They are
   * internal ability holders with no entry in the card database, so a choice attributed to one
   * could never be named to the player (#374). Naming the owning card instead is what the player
   * actually needs to understand why they are being asked.
   */
  sourceCardId?: string
  /**
   * Upgrades only: may this card attach to `target` when `player` plays it? Default (no hook) = any
   * unit. `player` is what "attach to a friendly unit" is read against (Darth Maul's Lightsaber).
   */
  attachRestriction?: (state: GameState, target: UnitState, player: PlayerId) => boolean
  /** Cost delta when playing this card (upgrades: `target` is the attach target). */
  costModifier?: (state: GameState, playerId: PlayerId, target?: UnitState) => number
  /**
   * Extra keywords this card grants a unit (e.g. an upgrade granting a conditional keyword). `ctx`
   * carries the combat situation where there is one, so a keyword gained only while attacking a
   * particular defender can read it; it is absent for a resting read.
   */
  conditionalKeywords?: (state: GameState, unit: UnitState, ctx?: StatModContext) => KeywordInstance[]
  /**
   * Keyword names this card *removes* from its unit while a condition holds — e.g. Marrok
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
   * A unit *in play* discounting cards its controller plays (Pit Droid Team). Distinct from
   * `costModifier`, which lives on the card being played. Summed across the controller's units and
   * their upgrades in `effectiveCost`; negative = cheaper.
   */
  costDiscount?: (state: GameState, source: UnitState, ctx: CostDiscountContext) => number
  /**
   * A unit *in play* waiving the aspect penalty of a card its controller plays (Peli Motto).
   * Any waiving unit zeroes the whole penalty for that card.
   */
  waivesAspectPenalty?: (state: GameState, source: UnitState, ctx: CostDiscountContext) => boolean
  /**
   * Aspect icons whose penalty this card ignores while `player` plays it (Rey: "ignore her Heroism
   * aspect penalty if you control Kylo Ren"). Only those icons: any other missing icon still costs.
   */
  ignoresOwnAspectPenalty?: (state: GameState, player: PlayerId) => string[]
  /**
   * Multiplier applied to each instance of damage this unit takes (the unit's own
   * card, or an upgrade) — e.g. Deadly Vulnerability's ×2. Multipliers from the card
   * and its upgrades compound. Default (no hook) = ×1.
   */
  damageMultiplier?: (state: GameState, unit: UnitState) => number
  /**
   * A unit in play reducing damage about to hit *its controller's* base (At Attin Safety Droid
   * caps an instance at 4). Receives the incoming amount, returns what actually lands.
   */
  preventBaseDamage?: (state: GameState, source: UnitState, amount: number) => number
  /**
   * This unit may be defeated to double a batch of token creation (Moff Jerjerrod). Offered by
   * `createTokenUnits` after the batch is made — see the 2N ≡ N-then-N note there.
   */
  doublesTokenCreation?: (state: GameState, source: UnitState) => boolean
  /** Token units its controller creates enter play ready rather than exhausted (Chancellor Palpatine). */
  tokensEnterReady?: (state: GameState, source: UnitState) => boolean
  /**
   * Every unit its controller plays or creates enters play ready (Ritual Dragon). Read by
   * `friendlyUnitsEnterReady`, beside `tokensEnterReady` for a created unit and `entersReady` for a played one.
   */
  unitsEnterReady?: (state: GameState, source: UnitState) => boolean
  /** Its controller's units may attack a base while using Ambush (Fett's Firespray). Read by `ambushAttacksBases`. */
  ambushAttacksBases?: (state: GameState, source: UnitState) => boolean
  /** This unit can't declare an attack against a base (Wicket). */
  cannotAttackBases?: (state: GameState, unit: UnitState) => boolean
  /** This unit can't currently be attacked (Tatooine Repulsor Train). Also keeps it from being a forced Sentinel target. */
  cannotBeAttacked?: (state: GameState, unit: UnitState) => boolean
  /** This unit may attack enemy units in either arena, not just its own (Red Leader). */
  attacksEitherArena?: (state: GameState, unit: UnitState) => boolean
  /** Defender-side: while this unit defends, the attacker loses Overwhelm. */
  negatesOverwhelm?: (state: GameState, unit: UnitState) => boolean
  /** Activated "Action:" abilities usable on the controller's turn. */
  actionAbilities?: ActionAbilityDef[]
  /** Multiplier on how many cards this unit's searches look at — Arcana Star Map ×2. */
  searchModifier?: (state: GameState, unit: UnitState) => number
  /**
   * "While attacking, this unit deals combat damage before the defender" (Carson Teva).
   * A defender defeated by that damage never deals its counter damage. `ctx` carries the unit being
   * attacked, for a card that strikes first only against some defenders (Hound's Tooth).
   */
  dealsDamageFirst?: (state: GameState, unit: UnitState, ctx?: AttackContext) => boolean
  /**
   * "This unit can't attack" (Loth-Wolf). Read by `enemyAttackTargets`, so it removes every target
   * AND the base at once, for each of the five sources of an attack.
   */
  cannotAttack?: (state: GameState, unit: UnitState) => boolean
  /**
   * Damage this card stops on its way to a unit (Cassian Andor, Boba Fett's Armor, Malakili,
   * Umbaran Mobile Cannon). `self` is the unit the card is on — itself, or the host for an upgrade —
   * and `target` the unit about to be damaged. Returns how much of `amount` is prevented; every
   * in-play unit on both sides is asked, and the total is capped at the damage itself.
   *
   * Distinct from `canPreventDamage`, which OFFERS the controller a choice at a cost. This one is
   * the card doing it by itself, with nothing to decide.
   */
  preventUnitDamage?: (state: GameState, self: UnitState, target: UnitState, amount: number, ctx: DamagePreventionContext) => number
  /** "Bases can't be healed" (Confederate Tri-Fighter) — both players' bases, as the card reads. */
  suppressesBaseHealing?: (state: GameState, source: UnitState) => boolean
  /** Whether this unit readies in the regroup phase; absent means it does (Rampart needs 4 power). */
  readiesInRegroup?: (state: GameState, unit: UnitState) => boolean
  /** "This unit isn't defeated by having no remaining HP" while this holds (Chirrut Îmwe, during the action phase). */
  survivesNoHp?: (state: GameState, unit: UnitState) => boolean
  /** "Attached unit can't ready" (Frozen in Carbonite): neither in the regroup phase nor by an ability. */
  cannotReady?: (state: GameState, unit: UnitState) => boolean
  /** Runs an effect this card left for later (`GameState.delayedEffects`), once, when its moment comes. */
  delayed?: (state: GameState, effect: DelayedEffect) => GameState
  /**
   * A card that REPLACES a unit's printed power/HP ("printed power is considered to be 7"): Obi-Wan
   * Kenobi for every friendly unit, Size Matters Not for its own host. Folded in by `withUpgrades`
   * BEFORE upgrades are added, since an upgrade's +X still applies on top of the replacement. Must
   * not read computed stats — it is part of that computation.
   */
  printedStats?: (state: GameState, source: UnitState, target: UnitState, sameController: boolean) => { power?: number; hp?: number } | undefined
  /**
   * A unit in play changing what an OPPONENT pays (Del Meeko's +1 on each event they play). The
   * mirror of `costDiscount`, which only ever reads the paying player's own board.
   */
  enemyCostDelta?: (state: GameState, source: UnitState, ctx: CostDiscountContext) => number
  /** "While paying costs, you pay half as many resources, rounded up" (The Starhawk). Applied last. */
  halvesCosts?: (state: GameState, source: UnitState, owner: PlayerId) => boolean
  /**
   * "You may deal its excess damage to another unit in the same arena" (Wipe Them Out) — Overwhelm
   * aimed at a unit rather than the base. Offered after combat damage, using the same excess figure.
   */
  spillsExcessToUnit?: (state: GameState, unit: UnitState) => boolean
  /**
   * "Advantage tokens on friendly units lose all abilities" (Eviscerator): while this unit is
   * in play, its controller's Advantage tokens give no power and survive combat instead of being spent.
   */
  suppressesFriendlyAdvantage?: (state: GameState, source: UnitState) => boolean
  /**
   * An aura that grants OTHER units a whole card's worth of triggered abilities
   * (Bo-Katan's Gauntlet: "each other friendly non-token unit gains 'When Defeated: …'").
   * Returns the card ids whose abilities `target` gains while `source` is in play. Distinct from
   * `aura`, which only contributes stats/keywords. Consulted by `runUnitTrigger`, so a granted
   * ability fires for the target exactly as if printed on it — including `whenDefeated`, where the
   * target has already left play but the granting source has not.
   */
  grantsAbilities?: (state: GameState, source: UnitState, target: UnitState, sameController: boolean) => string[]
  /**
   * A unit in play making some damage unpreventable (Gorian Shard's Corsair — friendly
   * Underworld cards). Asked about each instance of damage; true means Shields and base-damage
   * prevention are ignored for it.
   */
  makesDamageUnpreventable?: (state: GameState, self: UnitState, source: DamageSource) => boolean
  /**
   * A unit that may prevent damage headed for one of its controller's OTHER units, at a cost it
   * pays itself (The Mandalorian defeats one of its own Shield tokens). Return true when
   * `self` is currently able and eligible to prevent damage to `target`; the engine then offers the
   * choice, and `payPreventionCost` collects the price if it's taken.
   */
  canPreventDamage?: (state: GameState, self: UnitState, target: UnitState) => boolean
  /** Pay the cost of a prevention this card offered — e.g. defeat a Shield on `self`. */
  payPreventionCost?: (state: GameState, self: UnitState) => GameState
  /** Extra traits this card grants a unit — The Darksaber grants Mandalorian. */
  grantedTraits?: (state: GameState, unit: UnitState) => string[]
  /** Traits this card takes away from its unit, printed or granted (Abandoned the Order: loses Jedi). */
  removedTraits?: (state: GameState, unit: UnitState) => string[]
  /** True if this card makes its unit a leader unit — The Darksaber. */
  makesLeaderUnit?: (state: GameState, unit: UnitState) => boolean
  /** Aspect icons this unit provides while its controller pays costs — The Darksaber. */
  providesAspects?: (state: GameState, unit: UnitState) => string[]
  /**
   * Undeployed-leader (front-side) behaviour, kept separate from the deployed
   * unit-side (`abilities`/`actionAbilities`/keywords): while a leader is undeployed it
   * isn't a unit, so those never fire on it; once deployed it's a unit and these don't.
   */
  leaderAbilities?: LeaderAbilities
  /**
   * Base-card behaviour. A base is never played and never leaves play, so nothing about it is a
   * unit: its ability belongs to the player whose base zone it sits in.
   */
  baseAbilities?: BaseAbilities
  /**
   * "This unit enters play ready" while a condition holds (Elzar Mann — a Force leader).
   * Consulted by `playUnitCard`, alongside Ambush and the `nextUnitGrants` enters-ready grant.
   */
  entersReady?: (state: GameState, owner: PlayerId) => boolean
  /** Custom epic-action deploy gate; default is `resources ≥ leader.cost`. */
  deployCondition?: (state: GameState, owner: PlayerId) => boolean
  /**
   * Constant/aura ability: while `source` (a unit with this card, or an upgrade)
   * is in play, it contributes power/HP and/or keywords to OTHER units. Called for each
   * in-play `target`; return `undefined` when it doesn't affect that target. `sameController`
   * is true when source and target share a controller (friendly). `combat` carries the current
   * combat's roles when the aura pass runs during damage resolution (Grogu). Must NOT read
   * the target's computed keywords/power (that recurses through the aura pass) — inspect card data.
   */
  aura?: (state: GameState, source: UnitState, target: UnitState, sameController: boolean, combat?: CombatContext) => AuraContribution | undefined
}

/** What an aura contributes to one affected unit. */
export interface AuraContribution {
  power?: number
  hp?: number
  keywords?: KeywordInstance[]
  /** Keyword names this aura *removes* from the target — "enemy/all units lose X". */
  removeKeywords?: string[]
}

/**
 * Custom epic-action deploy condition, overriding the default "control resources ≥
 * the leader's cost" — e.g. Bo-Katan (resources + friendly Mandalorian units ≥ 10).
 */
// (declared on CardDefinition above via `deployCondition`.)

/** A leader's undeployed-side abilities. */
export interface LeaderAbilities {
  /** Activated "Action: [Exhaust] …" abilities usable while undeployed. */
  actions?: LeaderActionAbilityDef[]
  /** Triggered "When …" abilities that fire while undeployed. */
  abilities?: AbilityDef[]
  /**
   * A constant effect on units while the leader is undeployed (Director Krennic: "each friendly damaged
   * unit gets +1/+0"). Shaped like `CardDefinition.aura`, with the leader's controller in place of a
   * source unit, since an undeployed leader is not a unit. Folded into the same aura pass.
   */
  aura?: (state: GameState, owner: PlayerId, target: UnitState, sameController: boolean, combat?: CombatContext) => AuraContribution | undefined
  /** "Ignore the aspect penalty on <cards> you play" while undeployed (Hera Syndulla). */
  waivesAspectPenalty?: (state: GameState, owner: PlayerId, ctx: CostDiscountContext) => boolean
}

/**
 * An activated leader-side action. Uses exhaust the leader (and pay any `cost`).
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

/**
 * A base card's abilities. The base belongs to a player rather than to a unit, so every hook is
 * asked about its controller: there is no source instance in play to hang them off.
 */
export interface BaseAbilities {
  /** "Epic Action: …" — once each game (CR 2.5), taken as that player's action. */
  epicAction?: BaseActionAbilityDef
  /**
   * A constant effect on units in play (Pau City: "each leader unit you control gets +0/+1").
   * Shaped like `LeaderAbilities.aura`, with the base's controller in place of a source unit, and
   * folded into the same aura pass.
   */
  aura?: (state: GameState, owner: PlayerId, target: UnitState, sameController: boolean, combat?: CombatContext) => AuraContribution | undefined
  /** Cards drawn in the starting hand, relative to the usual six (Colossus: -1). */
  startingHandDelta?: number
  /** Cards the deck must hold, relative to the usual minimum (Data Vault: +10). */
  deckMinimumDelta?: number
  /**
   * "Action:" abilities the base has, from an upgrade attached to it (Heavy Ion Cannon, Bacta Tank).
   * Offered as `useBaseAbility` with the card and index, taken as that player's action for the turn.
   */
  actions?: BaseUpgradeActionDef[]
  /**
   * Damage about to be dealt to this base (Alliance Shield Generator prevents 5 or more). Returns the
   * board with the damage dealt with, prevented and paid for, or `undefined` to leave it alone.
   */
  interceptDamage?: (state: GameState, owner: PlayerId, amount: number) => GameState | undefined
}

/** An "Action:" a base has from one of its upgrades. `cardId` in the effect's context is the upgrade. */
export interface BaseUpgradeActionDef {
  description: string
  /** "[defeat this upgrade]": the cost is the upgrade itself, defeated before the effect. */
  defeatsSelf?: boolean
  /** "Use this ability only once each phase", counted per copy on the base. */
  oncePerPhase?: boolean
  /** Offered only while this holds, so the action is never taken for nothing. */
  usable?: (state: GameState, owner: PlayerId) => boolean
  effect: (state: GameState, ctx: EffectContext) => GameState
}

/** The id a base's ability acts as the source of, so every choice it raises has a stable id (`<cardId>-base`). */
export const baseSourceId = (cardId: string): string => `${cardId}-base`

/** The phase-use key of a base action (`PhaseEvents.baseActionsUsed`). */
export const baseActionKey = (cardId: string, index: number): string => `${cardId}#${index}`

/**
 * The base-upgrade actions `owner` may take now: one per distinct ability, however many copies carry
 * it, since the copies are the same action. A once-each-phase action is spent once every copy has been
 * used this phase.
 */
export function usableBaseActions(state: GameState, owner: PlayerId): { cardId: string; index: number; ability: BaseUpgradeActionDef }[] {
  const base = state.players[owner].base
  const used = state.phaseEvents?.baseActionsUsed?.[owner] ?? []
  const out: { cardId: string; index: number; ability: BaseUpgradeActionDef }[] = []
  for (const cardId of new Set(baseAbilityCardIds(base))) {
    const copies = baseAbilityCardIds(base).filter(id => id === cardId).length
    ;(registry.get(cardId)?.baseAbilities?.actions ?? []).forEach((ability, index) => {
      if (ability.oncePerPhase && used.filter(k => k === baseActionKey(cardId, index)).length >= copies) return
      if (ability.usable && !ability.usable(state, owner)) return
      out.push({ cardId, index, ability })
    })
  }
  return out
}

/**
 * A base's "Epic Action". It has no cost beyond what its own text spells out, and no target: an
 * ability that picks something raises a choice, as a leader's front-side action does.
 */
export interface BaseActionAbilityDef {
  description: string
  /** Offered only while this holds, so the once-a-game action is never spent for nothing. */
  usable?: (state: GameState, owner: PlayerId) => boolean
  effect: (state: GameState, ctx: EffectContext) => GameState
}

/** A base's Epic Action, when its card registers one. */
export function baseEpicAction(cardId: string): BaseActionAbilityDef | undefined {
  return registry.get(cardId)?.baseAbilities?.epicAction
}

/** An activated ability a unit may use as its action (CR 2.4); e.g. Improvised Identity. */
export interface ActionAbilityDef {
  description: string
  /** Resource cost paid on use (default 0) — the ability's "C=N" cost. */
  cost?: number
  /**
   * The ability's "[Exhaust]" cost: the unit must be ready to use it, and using it
   * exhausts the unit — so it can't also attack that round. Distinct from `oncePerRound`,
   * which limits uses without touching the unit's ready state (an ability with no
   * "[Exhaust]" in its cost, e.g. Improvised Identity, which then attacks).
   */
  exhaustCost?: boolean
  /** May be used only once per round by a given unit (tracked on `UnitState.usedAbilities`). */
  oncePerRound?: boolean
  /**
   * "Any player may use this ability" (Mercenary Gunship): offered on the opponent's units too. The
   * player using it pays its cost and is the ability's `owner`, whoever controls the unit.
   */
  anyPlayer?: boolean
  /** Extra gate beyond once-per-round (defaults usable). `state.activePlayer` is the player asking. */
  usable?: (state: GameState, unit: UnitState) => boolean
  effect: (state: GameState, ctx: EffectContext) => GameState
}

/** A unit's action abilities, from its own card and each attached upgrade, with the
 *  source card id and per-card index so callers can address and track each one. */
export function unitActionAbilities(unit: UnitState): { cardId: string; index: number; ability: ActionAbilityDef }[] {
  const out: { cardId: string; index: number; ability: ActionAbilityDef }[] = []
  for (const cardId of abilityCardIds(unit)) {
    const defs = registry.get(cardId)?.actionAbilities ?? []
    defs.forEach((ability, index) => out.push({ cardId, index, ability }))
  }
  return out
}

/** Stable key for once-per-round tracking of a specific action ability instance. */
export function actionAbilityKey(cardId: string, index: number): string {
  return `${cardId}#${index}`
}

/** What a `costDiscount` / `waivesAspectPenalty` hook is being asked about. */
export interface CostDiscountContext {
  /** The player paying — the controller of the discounting unit. */
  owner: PlayerId
  /** The card being played. */
  card: EngineCard
  /** The upgrade's target unit, when an upgrade is being played. */
  target?: UnitState
}

/** What a combat hook that depends on the DEFENDER is asked about (Hound's Tooth). */
export interface AttackContext {
  /** The unit being attacked; absent when the attack is against a base. */
  defender?: UnitState
}

/** What a `preventUnitDamage` hook is told about the damage it may stop. */
export interface DamagePreventionContext {
  /** Where the damage came from, when it is attributed — a card ability names its card. */
  source?: DamageSource
  /** True for combat damage, which is not a card ability (Cassian Andor prevents only abilities). */
  byCombat: boolean
}

/** Combat context passed to `statModifier` (mirrors `stats.StatContext`). */
export interface StatModContext {
  attacking?: boolean
  attackingBase?: boolean
  /** Which arena the defending unit stands in (Retrofitted Airspeeder). */
  defenderArena?: Arena
  /** This unit is the defender in the current combat (Palace Chef Droid). */
  defending?: boolean
  /** For the attacker: the defending unit had damage on it (Marrok's Fiend Fighter). */
  defenderDamaged?: boolean
  /** This attack was made via Ambush, as the unit entered play (Heroic Purrgil). */
  viaAmbush?: boolean
  /** The current combat's roles, where there is one (Corner the Prey reads the defender). */
  combat?: CombatContext
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
 * Stamp every choice raised between `before` and `after` with the card that raised it (#374).
 *
 * Diffs choice IDS rather than array length, because an effect can remove choices as well as add
 * them. A choice that already carries a source keeps it, so the MOST SPECIFIC source wins: a nested
 * effect stamps first, and the outer wrapper then leaves its work alone.
 *
 * Returns `after` by reference when nothing changed, which `runTrigger` documents as its contract.
 */
export function stampChoiceSource(before: GameState, after: GameState, source: DamageSource): GameState {
  const pending = after.pendingChoices
  if (!pending || pending.length === 0) return after
  const existing = new Set((before.pendingChoices ?? []).map(c => c.id))
  let changed = false
  const stamped = pending.map(c => {
    if (c.source || existing.has(c.id)) return c
    changed = true
    return { ...c, source }
  })
  return changed ? { ...after, pendingChoices: stamped } : after
}

/** Run one ability effect, attributing whatever choices it raises to the card it belongs to. */
function runEffect(state: GameState, effect: (s: GameState, ctx: EffectContext) => GameState, ctx: EffectContext): GameState {
  return stampChoiceSource(state, effect(state, ctx), { cardId: ctx.cardId, controller: ctx.owner })
}

/**
 * Card ids whose abilities `unit` (controlled by `owner`) currently gains from a `grantsAbilities`
 * aura in play. Scans both sides' units, since a future aura may target enemies.
 */
function auraGrantedAbilityCards(state: GameState, unit: UnitState, owner: PlayerId): string[] {
  const out: string[] = []
  for (const side of ['player', 'opponent'] as PlayerId[]) {
    for (const source of state.players[side].units) {
      for (const cardId of abilityCardIds(source)) {
        out.push(...(getCardDefinition(cardId)?.grantsAbilities?.(state, source, unit, side === owner) ?? []))
      }
    }
  }
  return out
}

/**
 * The same abilities `runUnitTrigger` would fire, as data instead of as effects.
 *
 * Split out so a batch can be **ordered before it runs** (CR 7.6.9, 7.6.10). The card list is
 * snapshotted here rather than recomputed at resolution time, which is also the more correct reading:
 * whether an aura or a lasting effect granted the ability is settled when the ability triggers, not
 * when the player gets round to resolving it.
 *
 * `abilityIndex` indexes the card's FULL ability list, not the filtered one, so `runPendingTrigger`
 * can address it directly.
 */
export function collectUnitTriggers(
  state: GameState,
  point: TriggerPoint,
  unit: UnitState,
  owner: PlayerId,
  ctx?: TriggerContext,
): PendingTrigger[] {
  const out: PendingTrigger[] = []
  const cardIds = [
    ...abilityCardIds(unit),
    ...auraGrantedAbilityCards(state, unit, owner),
    ...(state.lastingEffects ?? []).flatMap(e => (e.targetInstanceId === unit.instanceId ? e.abilityCardIds ?? [] : [])),
  ]
  for (const cardId of cardIds) {
    getAbilities(cardId).forEach((ability, abilityIndex) => {
      if (ability.trigger !== point) return
      out.push({
        id: `t${out.length}-${unit.instanceId}-${cardId}-${abilityIndex}`,
        controller: owner, point, cardId, abilityIndex,
        // Base layer: the dispatcher deepens anything triggered while resolving another (CR 7.6.11).
        layer: 0,
        sourceInstanceId: unit.instanceId,
        ...(ctx ? { ctx } : {}),
      })
    })
  }
  return out
}

/**
 * The same abilities `collectUnitTriggers` gathers, for a card that is **not a unit in play**: the
 * event or upgrade whose own "When Played" fires as it resolves. It has no instance, so there is no
 * aura or lasting-effect grant to look for, just the card's own abilities.
 */
export function collectCardTriggers(
  point: TriggerPoint,
  cardId: string,
  owner: PlayerId,
  sourceInstanceId?: string,
  ctx?: TriggerContext,
): PendingTrigger[] {
  const out: PendingTrigger[] = []
  getAbilities(cardId).forEach((ability, abilityIndex) => {
    if (ability.trigger !== point) return
    out.push({
      id: `t${out.length}-${sourceInstanceId ?? cardId}-${cardId}-${abilityIndex}`,
      controller: owner, point, cardId, abilityIndex, layer: 0,
      ...(sourceInstanceId ? { sourceInstanceId } : {}),
      ...(ctx ? { ctx } : {}),
    })
  })
  return out
}

/**
 * An **undeployed** leader's front-side triggered abilities at `point`, as data. A deployed leader
 * reacts through its unit, so it is collected by `collectUnitTriggers` like any other unit.
 *
 * Whether the leader was deployed is settled here, when the ability triggers, for the same reason
 * `collectUnitTriggers` snapshots its card list: what triggered is decided by the board at the moment
 * of the event, not by the board whenever the player gets round to resolving it.
 */
export function collectLeaderTriggers(
  state: GameState,
  point: TriggerPoint,
  owner: PlayerId,
  ctx?: TriggerContext,
): PendingTrigger[] {
  const leader = state.players[owner].leader
  if (leader.deployed) return []
  const out: PendingTrigger[] = []
  ;(registry.get(leader.cardId)?.leaderAbilities?.abilities ?? []).forEach((ability, abilityIndex) => {
    if (ability.trigger !== point) return
    out.push({
      id: `t${out.length}-leader-${leader.cardId}-${abilityIndex}`,
      controller: owner, point, cardId: leader.cardId, abilityIndex, layer: 0,
      fromLeader: true,
      ...(ctx ? { ctx } : {}),
    })
  })
  return out
}

/**
 * A player's **base**'s triggered abilities at `point`, as data: the ones its upgrades give it ("Attached
 * base gains: ...") and any printed on an upgrade that lives there (Insurgent Camp). The base is not a
 * unit, so like an undeployed leader it is collected for its controller, with `<cardId>-base` as the
 * source so a choice it raises has a stable id. Never asked about `whenPlayed`: an upgrade's own When
 * Played is collected once, as it is played, by `collectCardTriggers`.
 */
export function collectBaseTriggers(
  state: GameState,
  point: TriggerPoint,
  owner: PlayerId,
  ctx?: TriggerContext,
): PendingTrigger[] {
  const out: PendingTrigger[] = []
  for (const cardId of baseAbilityCardIds(state.players[owner].base)) {
    getAbilities(cardId).forEach((ability, abilityIndex) => {
      if (ability.trigger !== point) return
      out.push({
        id: `t${out.length}-base-${cardId}-${abilityIndex}`,
        controller: owner, point, cardId, abilityIndex, layer: 0,
        sourceInstanceId: baseSourceId(cardId),
        ...(ctx ? { ctx } : {}),
      })
    })
  }
  return out
}

/** A player's undeployed leader and base: the two sources of abilities that are not units in play. */
export function collectPlayerTriggers(
  state: GameState,
  point: TriggerPoint,
  owner: PlayerId,
  ctx?: TriggerContext,
): PendingTrigger[] {
  return [...collectLeaderTriggers(state, point, owner, ctx), ...collectBaseTriggers(state, point, owner, ctx)]
}

/**
 * Everything a unit arriving under `owner`'s control raises: the undeployed leader's front side, the
 * base and every OTHER unit the player controls, each told which unit arrived in `ctx.targetInstanceId`.
 * Both players' bases also see it as `whenUnitEntersPlay` (Trap Field reads any unit entering play).
 *
 * This is the one statement of "a unit entered play", so every route in goes through it. `route` names
 * the way it arrived when a card can read that specifically (`whenPlayUnit` for a play, `whenCreateUnit`
 * for a created token unit), and is omitted for a route no card reads on its own: a leader deploying
 * (CR 3 makes that deployed, NOT played) or a captured card rescued back into play. `whenFriendlyEntersPlay`
 * fires either way, since all four are entering play (CR 7.1).
 */
export function collectArrivalTriggers(
  state: GameState,
  route: 'whenPlayUnit' | 'whenCreateUnit' | undefined,
  owner: PlayerId,
  arrivedId: string,
): PendingTrigger[] {
  const ctx = { targetInstanceId: arrivedId }
  // The arriving unit is excluded from its own arrival: a card that also reads "including this one"
  // (Outcast) covers that half with its own When Played.
  const friendly = (point: TriggerPoint): PendingTrigger[] => [
    ...collectPlayerTriggers(state, point, owner, ctx),
    ...state.players[owner].units.flatMap(u => (u.instanceId === arrivedId ? [] : collectUnitTriggers(state, point, u, owner, ctx))),
  ]
  return [
    ...(route ? friendly(route) : []),
    ...friendly('whenFriendlyEntersPlay'),
    ...(['player', 'opponent'] as PlayerId[]).flatMap(p => collectBaseTriggers(state, 'whenUnitEntersPlay', p, ctx)),
  ]
}

/**
 * The ability a collected trigger stands for. Undeployed-leader abilities live in a different part of
 * the registry from a unit's, so both the resolver and the prompt that names the ability go through
 * here rather than each remembering the distinction.
 */
export function triggerAbility(trigger: PendingTrigger): AbilityDef | undefined {
  const abilities = trigger.fromLeader
    ? registry.get(trigger.cardId)?.leaderAbilities?.abilities ?? []
    : getAbilities(trigger.cardId)
  return abilities[trigger.abilityIndex]
}

/** Resolve exactly one collected trigger. A no-op if its card's abilities are no longer registered. */
export function runPendingTrigger(state: GameState, trigger: PendingTrigger): GameState {
  const ability = triggerAbility(trigger)
  if (!ability || ability.trigger !== trigger.point) return state
  return runEffect(state, ability.effect, {
    owner: trigger.controller,
    cardId: trigger.cardId,
    sourceInstanceId: trigger.sourceInstanceId,
    ...trigger.ctx,
  })
}

