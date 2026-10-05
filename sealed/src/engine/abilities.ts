import type { Arena, CardDb, DelayedEffect, EngineCard, GameState, IfYouDo, KeywordInstance, LastingEffect, PendingTrigger, PlayerId, UnitState, CombatContext, DamageSource, TriggerContext, UpgradeAttachment, UpgradeRef, UsedAbility } from './types'
import { attachmentAbilityId, carriedAbilityCardIds, baseAbilityCardIds, pushChoice } from './types'

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
  // "When a friendly / another friendly / an enemy unit attacks" (Major Partagaz, Barriss Offee): the
  // same event as the attacker's own `onAttack`, in the same batch, heard by BOTH players' undeployed
  // leaders, bases and units, the attacker's own included. `ctx.attackingPlayer` says whose attack it
  // is, and every registration compares it against `ctx.owner`, as at `whenDrawCards`.
  | 'whenUnitAttacks'
  | 'onAttackEnd'
  // "When 1 or more damage is healed from this unit" (Silver Angel): fires on the healed unit from
  // `healUnit`, the one place a unit is healed, with what was removed in `ctx.amountHealed`.
  | 'whenHealed'
  // "When a friendly unit's attack ends": fires for every unit the attacker's
  // controller has (and their undeployed leader), not just the attacker — distinct from
  // `onAttackEnd` ("when THIS unit's attack ends", the attacker only).
  | 'whenFriendlyAttackEnds'
  | 'whenReadies'
  // "When you ready cards during the regroup phase" (Millennium Falcon): the player's ready step, on
  // every unit they control whether or not it was exhausted, in the same batch as `whenReadies`.
  | 'whenReadyStep'
  // "When an enemy unit readies during the action phase" (Rex's DC-17s): fires on the OTHER player's
  // units, raised by `readyUnit` (the single-unit primitive) itself rather than a resolver call site,
  // so it hears every route a unit readies through, not just the ones this file dispatches. Action-
  // phase-only and only for a unit that was actually exhausted: the regroup phase's mass ready (CR
  // 1.12.4) sets `exhausted` directly and never calls `readyUnit`, so it never raises this point.
  // `ctx.targetInstanceId` is the unit that readied.
  | 'whenEnemyUnitReadies'
  // "When you draw this card" (Rey): a card in hand, raised by `drawCards` for each card it drew, as
  // that card's own ability. `ctx.drawingPlayer` is who drew.
  | 'whenDrawn'
  // "When an enemy unit leaves play" (Boba Fett): defeated or returned to hand, the two ways a unit
  // leaves play that the phase record (`leftPlay`) also counts. Heard by both players' undeployed
  // leaders, bases and units, with the unit and its controller in `ctx.unitLeftPlay`.
  | 'whenUnitLeavesPlay'
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
  // "When you discard a card from your deck" (Sebulba's Podracer), "when a player discards a card from
  // their hand" (Migs Mayfeld): one discard event, raised by `discardCards` and heard by BOTH players'
  // undeployed leaders, bases and units. `ctx.discard` says whose cards, from where, and which.
  | 'whenDiscard'
  // "When this card is discarded from your hand or deck" (That's a Rock): each discarded card's own
  // ability, from the pile it has just reached, as `whenDrawn` is from the hand. Same `ctx.discard`.
  | 'whenDiscarded'
  // Damage dealt, to units or a base, by combat or an ability (Rancor Keeper, Blade Three, Cassian
  // Andor, Darth Sidious). One event per application of damage, heard by BOTH players' undeployed
  // leaders, bases and units, the damaged side first. `ctx.damageDealt` names every unit dealt damage
  // (the ones it defeated too), the base, and who dealt it; each registration states the side it reads.
  | 'whenDamageDealt'
  // "When a friendly upgrade is defeated" (Zeb Orrelios): fires on the upgrade owner's units.
  // Deliberately narrow: raised by an effect defeating an upgrade, or by its host unit dying — NOT
  // by a Shield/Advantage token being spent as part of combat resolution, which happens inside
  // damage application, where raising a choice would interrupt a half-applied combat.
  | 'whenFriendlyUpgradeDefeated'
  | 'onDefense'
  // "When you use a <point> ability" (Grand Admiral Thrawn, Enfys Nest): raised by the trigger queue
  // once a collected ability has resolved, including any "Then, ..." it owed, and heard by its
  // controller's leader and units. `ctx.usedAbility` is the ability's handle, which
  // `runAbilitiesAgain` runs a second time. Reading which point it was is the hearing card's job.
  | 'whenAbilityUsed'
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
  // Bounty (CR 13): "Bounty - <reward>. (When this unit is defeated or captured, your opponent
  // collects its bounty.)" Collected at BOTH points a Bounty unit can leave play that way — combat's
  // `finishDefeats` and capture's `attemptCapture` — with `owner` passed as the unit's own OPPONENT,
  // not its controller: CR 13 treats Bounty as controlled by the collector, the reverse of every other
  // trigger point above. `ctx.bountyUnit` carries the unit's snapshot. Never run directly: every
  // Bounty ability is optional regardless of its printed wording, so `runPendingTrigger` raises a
  // `mayCollectBounty` choice instead of the effect, and `runBountyCollection` below answers it.
  | 'bounty'

/**
 * What an enemy card ability may be prevented from doing to a unit or an attached upgrade, per the
 * printed phrasing "can't be \<capture/damage/defeat/exhaust/return to hand/take control of\> by
 * enemy card abilities" (Lurking TIE Phantom, Shadowed Intentions, Rey, Willrow Hood, Mythosaur,
 * Cassian Andor). One vocabulary for every site that phrase can name, read by
 * `protectedFromEnemyAbility` in `effects.ts` — see `CardDefinition.cannotBeTargetedByEnemyAbility`.
 */
export type ProtectedAction = 'capture' | 'damage' | 'defeat' | 'exhaust' | 'return' | 'takeControl'

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
  /**
   * The trigger condition, where it is a property of the event rather than of the board: whether this
   * event triggers the ability at all ("when a FRIENDLY unit is dealt NON-COMBAT damage"). Settled
   * when the event happens, as the rules settle it, so an ability the event does not concern is never
   * collected. That matters at a point heard on both sides: a collected ability that then does nothing
   * still puts its side in the batch, and a batch with both sides in it asks who goes first.
   */
  hears?: (state: GameState, ctx: EffectContext) => boolean
}

/** Whether `ability` is triggered by an event at its point, as collected for `owner`. */
function hearsEvent(state: GameState, ability: AbilityDef, owner: PlayerId, cardId: string, sourceInstanceId: string | undefined, ctx?: TriggerContext): boolean {
  return !ability.hears || ability.hears(state, { owner, cardId, sourceInstanceId, ...ctx })
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
  /** Abilities this stage uses again (`IfYouDo.again`). */
  again?: UsedAbility[]
  /** Units an earlier stage has already taken (`IfYouDo.taken`). */
  taken?: string[]
  /** The card name a `nameCard` with `then` settled. */
  nameChosen?: string
  /** The card ids a finished `disclose` (#603) revealed. */
  disclosed?: string[]
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
  /** "You may play or deploy 1 additional Pilot on this unit": Pilots this unit takes beyond the one (`canTakePilot`). */
  extraPilots?: number
  /** A Pilot's upgrade side only: it may be played on a Vehicle that already has its Pilots (R2-D2). */
  ignoresPilotLimit?: boolean
  /**
   * An upgrade side only: "If this upgrade would be defeated, you may instead move him to the ground
   * arena as a unit and exhaust him" (Luke Skywalker). Read by `sendAttachmentFromPlay`; the engine
   * always takes the "may", since the unit is strictly more than the card in a discard pile.
   */
  defeatedMovesToGround?: boolean
  /**
   * "If this unit would be defeated, you may instead attach her as an upgrade to ..." (L3-37): the
   * units she may attach to instead, read on the board without the units being defeated. Non-empty,
   * `finishDefeats` takes her off the board undefeated and asks her controller which, through a
   * `selectUnitThen` whose answer reaches this card's `ifYouDo` at step `insteadOfDefeat`.
   */
  insteadOfDefeat?: (state: GameState, unit: UnitState, controller: PlayerId) => string[]
  /**
   * "This card can't be played from your hand" (SEC_053 One in a Million): the Play a Card action's
   * hand scan skips it, so its only route into play is an alternate one (Plot, Smuggle, a discard
   * grant, …), which do not go through the hand at all.
   */
  cannotPlayFromHand?: boolean
  /**
   * "Action: If <condition>, play this card from your discard pile (paying its cost)" (Kylo's TIE
   * Silencer, Salvaged Blaster, Brutal Traditions): the one kind of ability that works from a discard
   * pile. Offered to the pile's owner as `useDiscardAction` while `usable` holds and the card could be
   * played, and taken as their action for the turn. Declared on the card, rather than read off its
   * `actionAbilities`, so a unit's ordinary "Action:" never becomes usable from the pile.
   */
  discardAction?: { description: string; usable: (state: GameState, owner: PlayerId) => boolean }
  /** Cost delta when playing this card (upgrades: `target` is the attach target). */
  costModifier?: (state: GameState, playerId: PlayerId, target?: UnitState) => number
  /**
   * "While playing this unit, you may choose any number of friendly units. Deal 1 damage to each of
   * them. For each unit chosen this way, this unit costs 1 less" (The Marauder): Exploit's step with
   * its own terms. `damage` is dealt to each chosen unit and each saves `discount`; the number is
   * any. Exploit itself needs no hook, it is read off the keyword (`exploitTerms`).
   *
   * With `resources` the picks are ready resources the player controls, each defeated and each
   * saving `discount` (Greater Sarlacc: "defeat any number of ready resources you control. For each
   * resource defeated this way, this unit costs 3 less").
   *
   * With `fromDiscard` they are unit cards in the player's discard pile costing at most `maxCost`, up
   * to `limit` of them, each put on the bottom of the deck (Vernestra Rwoh). That is an ADDITIONAL
   * COST rather than a discount, so it saves nothing and may be finished with nothing picked; the
   * cards chosen lend the played unit their "When Played" abilities.
   */
  whilePlaying?: { damage: number; discount: number } | { resources: true; discount: number } | { fromDiscard: { limit: number; maxCost: number } }
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
   * Pairs of keyword names this card trades for one another on its unit — Asajj Ventress replaces
   * "any Raid it has or gains with Restore, or vice versa" for one attack. Each pair swaps in BOTH
   * directions, and the swap is a **rename of the unit's finished keyword list**, applied after every
   * grant and removal: each instance keeps its numeral and answers to the other name, whichever
   * source it came from. Distinct from `suppressedKeywords` plus `conditionalKeywords`, which would
   * have to read the old value before hiding it and then dodge its own removal.
   */
  swappedKeywords?: (state: GameState, unit: UnitState) => [from: string, to: string][]
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
   * `target` is the unit an upgrade is being played on (The Darksaber, on a Mandalorian unit).
   */
  ignoresOwnAspectPenalty?: (state: GameState, player: PlayerId, target?: UnitState) => string[]
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
   * "Enemy Credit tokens lose all abilities" (Conveyex Security Captain): while this unit is in play,
   * the other player's Credit tokens can't be defeated to pay. The Eviscerator shape, aimed at the enemy.
   */
  suppressesEnemyCredits?: (state: GameState, source: UnitState) => boolean
  /**
   * An upgrade that makes its host lose all abilities (CR 8.14.2) while it returns a blank: Imprisoned
   * always, Condemn only while the host attacks. `keep` names the cards whose abilities survive it
   * (Condemn's own granted On Attack, Exiled from the Force's Grit). Read by `abilityBlank`.
   */
  blanksHost?: (state: GameState, host: UnitState) => AbilityBlank | undefined
  /**
   * A unit's constant ability that makes a CARD lose all abilities, wherever the card is: a unit in
   * play, an upgrade, an event being played, an undeployed leader (Brain Invaders: each leader; Galen
   * Erso: the named card an opponent owns). `cardOwner` is the player who owns the card being asked about.
   */
  blanksCard?: (state: GameState, source: UnitState, sourceController: PlayerId, cardId: string, cardOwner: PlayerId) => boolean
  /**
   * An event `player` has just played loses all abilities (Relentless: the first each opponent plays
   * each round). Asked once, as the event resolves, after it has been recorded as played.
   */
  blanksPlayedEvent?: (state: GameState, source: UnitState, sourceController: PlayerId, player: PlayerId) => boolean
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
   * "This unit can't be captured/damaged/defeated/exhausted/returned to hand/taken control of by
   * enemy card abilities" (Lurking TIE Phantom, Rey, Cassian Andor; Shadowed Intentions grants it to
   * its host). Generalises the single-purpose `cannotBeCaptured` built for #466 (capture only) across
   * every prohibition this printed phrasing names, since the shape — "read the target's own card,
   * only against the OTHER side" — is identical for each. Read from the target's own ability card ids
   * (`abilityCardIds`) by `protectedFromEnemyAbility` (`effects.ts`), the one function every
   * defeat/damage/exhaust/return/take-control/capture site asks; never consulted for a unit's own side.
   */
  cannotBeTargetedByEnemyAbility?: (state: GameState, self: UnitState, action: ProtectedAction) => boolean
  /**
   * The aura form of the same protection: another card in play grants it to a unit that is not itself
   * (Mythosaur: "friendly upgraded units can't be exhausted or returned to hand by enemy card
   * abilities"). Asked of every unit in play the way `aura` is, with `sameController` telling a source
   * whether `target` is its own side's.
   */
  grantsEnemyAbilityProtection?: (state: GameState, source: UnitState, target: UnitState, sameController: boolean, action: ProtectedAction) => boolean
  /**
   * "While this unit has exactly 1 friendly upgrade on it, that upgrade can't be defeated or returned
   * to hand by enemy card abilities" (Willrow Hood): the one printed case of this protection landing
   * on an ATTACHED UPGRADE rather than on a unit. Asked of the host's own card only, at the
   * position-addressed defeat/return sites (`defeatUpgradeAt`, `returnUpgradeToHand`) where an
   * ability naming a chosen upgrade reaches it.
   */
  protectsAttachedUpgrade?: (state: GameState, host: UnitState, upgrade: UpgradeAttachment, action: 'defeat' | 'return') => boolean
  /**
   * A unit captured resolves as something else instead (IG-11: "If this unit would be captured,
   * defeat him and deal 3 damage to each enemy ground unit instead"). Unlike `cannotBeTargetedByEnemyAbility`
   * this is asked regardless of which side is capturing. Returning a state means the replacement ran and
   * the capture itself does not happen; returning nothing lets the capture proceed as normal.
   */
  captureReplacement?: (state: GameState, self: UnitState) => GameState | undefined
  /**
   * A unit that may prevent damage headed for one of its controller's OTHER units, at a cost it
   * pays itself (The Mandalorian defeats one of its own Shield tokens). Return true when
   * `self` is currently able and eligible to prevent damage to `target`; the engine then offers the
   * choice, and `payPreventionCost` collects the price if it's taken.
   */
  canPreventDamage?: (state: GameState, self: UnitState, target: UnitState) => boolean
  /**
   * Pay the cost of a prevention this card offered — e.g. defeat a Shield on `self`. `chosen` is the
   * unit picked from `preventionCostTargets`, for a price the player chooses.
   */
  payPreventionCost?: (state: GameState, self: UnitState, chosen?: string) => GameState
  /**
   * The units a prevention's price is picked from (Queen Amidala: another friendly unit sharing a trait
   * with her). The offer is one accept per unit; absent, the price needs no pick.
   */
  preventionCostTargets?: (state: GameState, self: UnitState, target: UnitState) => string[]
  /** The price, as the prevention prompt names it ("defeat a Shield" when absent). */
  preventionCostText?: string
  /**
   * "If a friendly ability would deal damage, you may have that ability deal that much damage plus 1
   * instead" (Ty Yorrick): what this unit adds to one instance of ability damage. `owner` controls
   * `self`, `source` is the dealing ability and `targetController` controls what it damages. Combat
   * damage never asks.
   */
  abilityDamageBonus?: (state: GameState, self: UnitState, owner: PlayerId, source: DamageSource, targetController: PlayerId) => number
  /**
   * "Indirect damage you deal to opponents is increased by 1" (Hunting Aggressor): what `self`'s
   * controller's indirect damage gains before the receiving player assigns it. Asked only of units the
   * DEALER controls, never the target's side — unlike `abilityDamageBonus`, this is specific to
   * indirect damage and never fires for an ordinary ability ping.
   */
  indirectDamageBonus?: (state: GameState, self: UnitState, source: DamageSource, targetController: PlayerId) => number
  /**
   * "You assign all indirect damage you deal to opponents" (Devastator): true flips the assignment
   * from the receiving player to `self`'s controller for indirect damage that controller deals to an
   * opponent. Asked only of units the DEALER controls.
   */
  assignsIndirectDamage?: (state: GameState, self: UnitState, source: DamageSource, targetController: PlayerId) => boolean
  /**
   * "If an upgrade on your base would be defeated, you may defeat this unit instead" (Vice Admiral
   * Rampart). True while `self` can stand in for an upgrade on its controller's base.
   */
  defeatsInsteadOfBaseUpgrade?: (state: GameState, self: UnitState) => boolean
  /**
   * "For this attack, it deals damage equal to its remaining HP instead of its power" (Babu Frik): the
   * attacker's combat damage is read from its remaining HP. Power itself is unchanged for every other reader.
   */
  dealsCombatDamageByHp?: (state: GameState, unit: UnitState) => boolean
  /** Extra traits this card grants a unit — The Darksaber grants Mandalorian. */
  grantedTraits?: (state: GameState, unit: UnitState) => string[]
  /**
   * Extra traits this card has **wherever it is**, in play or not (Zam Wesell copies her controller's
   * leader's Traits "even while she's not in play"). Read by `cardTraits`, so a card in hand, deck or
   * discard carries them too; `grantedTraits` is the in-play-only form, asked about a unit.
   *
   * `owner` is the player whose copy of the card is being read, since a card in an opponent's deck
   * reads their side of the board, not yours.
   */
  cardTraits?: (state: GameState, owner: PlayerId) => string[]
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
  /**
   * The ability's "use the Force" cost (#462): only usable while the controller holds their Force
   * token, which is defeated on use alongside any other cost. Distinct from a card's own optional
   * "may use the Force. If you do" (`mayPayThen.useForce`): this is a mandatory part of paying for
   * the action, the same way `exhaustCost` is for a leader's front side (always paid, since taking
   * the action already requires the leader to be ready).
   */
  useForceCost?: boolean
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
  /** The ability's "use the Force" cost (#462): see `LeaderActionAbilityDef.useForceCost`. */
  useForceCost?: boolean
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

/**
 * A unit's action abilities: from its own card, each attached upgrade, and any card whose abilities it
 * gains from an aura or for the phase (Satine Kryze hands every unit an "Action [exhaust]"), with the
 * source card id and per-card index so callers can address and track each one.
 */
export function unitActionAbilities(state: GameState, unit: UnitState): { cardId: string; index: number; ability: ActionAbilityDef }[] {
  const out: { cardId: string; index: number; ability: ActionAbilityDef }[] = []
  const owner = unitController(state, unit)
  for (const cardId of [...abilityCardIds(state, unit, owner), ...grantedAbilityCards(state, unit, owner)]) {
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
/**
 * Card ids with a `blanksHost` or a `blanksCard` hook. Kept so the gate every ability lookup goes
 * through can answer "nothing on this board takes abilities away" with set lookups alone, which is
 * nearly every board an AI search visits.
 */
const hostBlankers = new Set<string>()
const cardBlankers = new Set<string>()
/** Bumped whenever either set grows, so the gate's memos notice a card registered after they were made. */
const blankerRegistry = { version: 0 }
/**
 * Card ids with a `whenAbilityUsed` ability. Every resolved ability is announced, so this is what
 * keeps the announcement to a set lookup on the many boards where nobody is listening.
 */
const useHearers = new Set<string>()

/** Register (merging) a card's definition — abilities append, static hooks overwrite. */
export function registerCard(cardId: string, def: CardDefinition): void {
  if (def.blanksHost) { hostBlankers.add(cardId); blankerRegistry.version++ }
  if (def.blanksCard) { cardBlankers.add(cardId); blankerRegistry.version++ }
  if ([...(def.abilities ?? []), ...(def.leaderAbilities?.abilities ?? [])].some(a => a.trigger === 'whenAbilityUsed')) useHearers.add(cardId)
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

/**
 * Run an effect as `source`'s: the choices it raises are stamped with it, and damage it deals without
 * naming a source is attributed to it for the damage event (`GameState.resolvingSource`).
 *
 * The marker is on the board only for the call. An effect that changed nothing returns the board it
 * was given, and so does this, which `inertNow` relies on: it asks whether an ability would do
 * anything by comparing references.
 */
export function runAttributed(state: GameState, source: DamageSource, run: (s: GameState) => GameState): GameState {
  return stampChoiceSource(state, whileResolving(state, source, run), source)
}

/**
 * The damage-event half of `runAttributed`: `GameState.resolvingSource` for the duration of `run`.
 * Answering a choice runs under it too, as the card that raised the choice, so damage dealt by the
 * answer is that card's ("that ability deals that much damage plus 1", Ty Yorrick).
 */
export function whileResolving(state: GameState, source: DamageSource, run: (s: GameState) => GameState): GameState {
  const outer = state.resolvingSource
  const marked: GameState = { ...state, resolvingSource: source }
  const after = run(marked)
  if (after === marked) return state
  const rest = { ...after }
  delete rest.resolvingSource
  return outer ? { ...rest, resolvingSource: outer } : rest
}

/**
 * Run a card's `ifYouDo` hook at `then`, attributed to that card like the ability it continues.
 * `settled` is what the answered choice decided, when a choice is what resumed it.
 */
export function resumeAbility(state: GameState, then: IfYouDo, settled: Partial<IfYouDoContext> = {}): GameState {
  const hook = registry.get(then.cardId)?.ifYouDo
  if (!hook) return state
  const source: DamageSource = { cardId: then.cardId, controller: then.owner, ...(then.sourceInstanceId ? { instanceId: then.sourceInstanceId } : {}) }
  return runAttributed(state, source, s => hook(s, { owner: then.owner, cardId: then.cardId, sourceInstanceId: then.sourceInstanceId, step: then.step, upgradeChosen: then.upgrade, unitChosen: then.unit, again: then.again, taken: then.taken, ...settled }))
}

/** Run one ability effect, attributing whatever choices it raises (and damage it deals) to its card. */
function runEffect(state: GameState, effect: (s: GameState, ctx: EffectContext) => GameState, ctx: EffectContext): GameState {
  const source: DamageSource = { cardId: ctx.cardId, controller: ctx.owner, ...(ctx.sourceInstanceId ? { instanceId: ctx.sourceInstanceId } : {}) }
  return runAttributed(state, source, s => effect(s, ctx))
}

// ── Losing all abilities (CR 8.14.2) ──────────────────────────────────────────────────────────────
// "If an ability causes a card to 'lose all abilities', the card ceases to have any abilities,
// including abilities given to it by other cards, for the duration of the 'lose' effect. The card
// cannot gain abilities for the duration of the effect." Keywords are abilities (CR 7.1.2), so they
// go too. Power, HP and modifiers are not abilities and stay. Nor does the loss reach an upgrade's own
// ability that affects its host without the word "gains" (CR 3.6.10: Entrenched still applies to a
// unit Force Lightning has blanked), which is why an upgrade is kept or dropped by what it says.
//
// Everything here is read live off the board, so a loss ends the moment its source does, and an
// ability that has already triggered resolves regardless (CR 8.14.3 for one already resolving; a
// trigger already collected is treated the same way, as `collectUnitTriggers` snapshots its cards).

const SIDES: readonly PlayerId[] = ['player', 'opponent']

/** What a unit keeps while it has lost all its abilities: the cards named here, and nothing else it carries. */
export interface AbilityBlank {
  keep?: string[]
}

const givesAbilitiesCache = new WeakMap<EngineCard, boolean>()
/**
 * True for an upgrade whose text GIVES its host abilities ("attached unit gains ...", CR 7.1.1, 3.6.8).
 * Those are the host's abilities, so a host that loses all abilities loses them and cannot gain them.
 * An upgrade that only affects its host ("attached unit can't attack bases") keeps working (CR 3.6.10).
 *
 * Read off the printed text because that is where the rules draw the line. An upgrade printing both
 * kinds (Death Star Plans) is treated as a giver as a whole: the registry keys abilities by card, not by
 * sentence, and a blanked host carrying one of those is rare enough not to split them for.
 */
function upgradeGivesAbilities(card: EngineCard | undefined): boolean {
  if (!card?.text) return false
  let gives = givesAbilitiesCache.get(card)
  if (gives === undefined) {
    gives = /\bgains\b/i.test(card.text.replace(/\([^)]*\)/g, '')) // reminder text is not the ability
    givesAbilitiesCache.set(card, gives)
  }
  return gives
}

/**
 * The loss that comes from the unit's own situation: a lasting effect aimed at it, or an upgrade on it.
 * Never reads another unit, which is what lets a card-level source ask it about itself without the
 * two recursing. Where several apply, only what every one of them keeps survives.
 */
function directBlank(state: GameState, unit: UnitState): AbilityBlank | undefined {
  let keep: string[] | undefined
  if (lastingBlankTargets(state)?.has(unit.instanceId)) keep = []
  if (hostBlankers.size === 0) return keep === undefined ? undefined : { keep }
  for (const up of unit.upgrades) {
    if (!hostBlankers.has(up.cardId)) continue
    const blank = registry.get(up.cardId)?.blanksHost?.(state, unit)
    if (!blank) continue
    const kept = blank.keep ?? []
    keep = keep === undefined ? kept : keep.filter(id => kept.includes(id))
  }
  return keep === undefined ? undefined : { keep }
}

// The gate is read on every ability lookup, which an AI search makes millions of times, and nearly
// every board it sees has nothing to find. Both scans are therefore cached on the arrays they read.
// The engine replaces a units or lasting-effects array rather than editing it, so an array's identity
// stands for its contents, and a cached answer can never go stale.

const lastingBlankCache = new WeakMap<readonly LastingEffect[], ReadonlySet<string> | undefined>()
/** Instance ids a lasting effect has blanked, or undefined when none has. */
function lastingBlankTargets(state: GameState): ReadonlySet<string> | undefined {
  const effects = state.lastingEffects
  if (!effects) return undefined
  if (lastingBlankCache.has(effects)) return lastingBlankCache.get(effects)
  const ids = effects.filter(e => e.losesAllAbilities).map(e => e.targetInstanceId)
  const out = ids.length > 0 ? new Set(ids) : undefined
  lastingBlankCache.set(effects, out)
  return out
}

type Blanker = { source: UnitState; side: PlayerId }
const NO_BLANKERS: readonly Blanker[] = []
const blankerCache = new WeakMap<readonly UnitState[], { registered: number; found: readonly Blanker[] }>()
function blankersAmong(units: readonly UnitState[], side: PlayerId): readonly Blanker[] {
  const cached = blankerCache.get(units)
  // Keyed on the registry's size as well, so a card registered after the scan (a test's) is seen.
  if (cached && cached.registered === cardBlankers.size) return cached.found
  const hits = units.filter(u => cardBlankers.has(u.cardId))
  const found = hits.length > 0 ? hits.map(source => ({ source, side })) : NO_BLANKERS
  blankerCache.set(units, { registered: cardBlankers.size, found })
  return found
}

/** The units in play whose own card takes abilities away from cards (Brain Invaders, Galen Erso), with their controllers. */
function cardBlankersInPlay(state: GameState): readonly Blanker[] {
  if (cardBlankers.size === 0) return NO_BLANKERS
  const mine = blankersAmong(state.players.player.units, 'player')
  const theirs = blankersAmong(state.players.opponent.units, 'opponent')
  return mine.length === 0 ? theirs : theirs.length === 0 ? mine : [...mine, ...theirs]
}

// `boardVerdict` is the gate's whole cost on nearly every board, and it is asked tens of millions of
// times a game, so every read in it is paid for. Each memo below remembers ONE value, compared by
// identity: the lookups come in long runs against one board, so a single entry answers nearly all of
// them. Measured on a bench run, each of these cost about 5% on its own: a WeakMap keyed by board, and
// reading fields of a state whose shape varies from call to call. The common case does neither.

/** `boardVerdict`: nothing can blank anything here. */
const QUIET = 0
/** `boardVerdict`: the board is quiet, but a unit may carry a host-blanking upgrade, so ask the unit. */
const ASK_UNIT = 1
/** `boardVerdict`: something on the board takes abilities away; work it out. */
const LOUD = 2

/**
 * The gate's memos, one remembered value each, compared by identity. Fields of one object rather than
 * module `let`s, which measured slower on a path taken this often.
 */
const memo = {
  state: undefined as GameState | undefined,
  stateVersion: -1,
  verdict: LOUD as number,
  effects: null as GameState['lastingEffects'] | null,
  effectsClean: true,
  cards: undefined as CardDb | undefined,
  cardsVersion: -1,
  poolCanBlank: true,
  players: undefined as GameState['players'] | undefined,
  playersVersion: -1,
  playersClean: true,
}

/**
 * Whether this game's card pool holds a card with a blanking hook (`blanksHost`, `blanksCard`). Worked
 * out once per pool, which lasts the whole game and every board a search imagines from it, so a game
 * without one never looks at its board for them.
 */
function poolHasBlankers(cards: CardDb): boolean {
  if (cards !== memo.cards || blankerRegistry.version !== memo.cardsVersion) {
    memo.poolCanBlank = Object.values(cards).some(c => hostBlankers.has(c.id) || cardBlankers.has(c.id))
    memo.cards = cards
    memo.cardsVersion = blankerRegistry.version
  }
  return memo.poolCanBlank
}

/**
 * Whether anything on this board takes abilities away: `QUIET`, `ASK_UNIT` or `LOUD`. The gate's whole
 * cost on nearly every board, so the same board object as last time costs one comparison and no read.
 */
function boardVerdict(state: GameState): number {
  if (state !== memo.state || blankerRegistry.version !== memo.stateVersion) {
    memo.verdict = readVerdict(state)
    memo.state = state
    memo.stateVersion = blankerRegistry.version
  }
  return memo.verdict
}
function readVerdict(state: GameState): number {
  const effects = state.lastingEffects
  if (effects !== memo.effects) {
    memo.effectsClean = lastingBlankTargets(state) === undefined
    memo.effects = effects
  }
  if (!memo.effectsClean) return LOUD
  if (!poolHasBlankers(state.cards)) return QUIET
  if (state.players !== memo.players || blankerRegistry.version !== memo.playersVersion) {
    memo.playersClean = cardBlankersInPlay(state).length === 0
    memo.players = state.players
    memo.playersVersion = blankerRegistry.version
  }
  return memo.playersClean ? ASK_UNIT : LOUD
}

/** True when `unit` has certainly lost nothing: the fast path of every gate read. */
function surelyUnblanked(state: GameState, unit: UnitState): boolean {
  const verdict = boardVerdict(state)
  return verdict === QUIET || (verdict === ASK_UNIT && !carriesHostBlanker(unit))
}
/** Read off the unit itself, not the board, so it holds for a unit that has just left play too. */
function carriesHostBlanker(unit: UnitState): boolean {
  const upgrades = unit.upgrades
  for (let i = 0; i < upgrades.length; i++) if (hostBlankers.has(upgrades[i].cardId)) return true
  return false
}

function blankedBy(state: GameState, blankers: readonly Blanker[], cardId: string, owner: PlayerId): boolean {
  // A source that has itself lost its abilities projects nothing. Only its direct loss is read, so two
  // card-level sources never ask each other (two Galen Ersos naming each other both keep working).
  return blankers.some(({ source, side }) =>
    !directBlank(state, source) && (registry.get(source.cardId)?.blanksCard?.(state, source, side, cardId, owner) ?? false))
}

/**
 * Whether a CARD `owner` owns has lost all abilities wherever it is: in play, attached, being played as
 * an event, or an undeployed leader (Brain Invaders, Galen Erso).
 */
export function cardAbilitiesBlanked(state: GameState, cardId: string, owner: PlayerId): boolean {
  if (boardVerdict(state) !== LOUD) return false
  const blankers = cardBlankersInPlay(state)
  return blankers.length > 0 && blankedBy(state, blankers, cardId, owner)
}

/** Whether `owner`'s undeployed leader has lost its front-side abilities. Its epic action is not asked about here. */
export function leaderAbilitiesBlanked(state: GameState, owner: PlayerId): boolean {
  // The verdict first: it is read inside the aura pass, where even finding the leader costs.
  return boardVerdict(state) === LOUD && cardAbilitiesBlanked(state, state.players[owner].leader.cardId, owner)
}

/** Which side `unit` is in play on, or undefined when it has left play. */
function sideOf(state: GameState, unit: UnitState): PlayerId | undefined {
  return SIDES.find(p => state.players[p].units.some(u => u.instanceId === unit.instanceId))
}

/**
 * Whether `unit` has lost all abilities right now, and what it keeps if so. `controller` is needed only
 * for a unit that has already left play (a When Defeated being collected), where the board can't say.
 */
export function abilityBlank(state: GameState, unit: UnitState, controller?: PlayerId): AbilityBlank | undefined {
  if (surelyUnblanked(state, unit)) return undefined
  return blankWith(state, unit, controller, cardBlankersInPlay(state))
}

function blankWith(state: GameState, unit: UnitState, controller: PlayerId | undefined, blankers: readonly Blanker[]): AbilityBlank | undefined {
  const direct = directBlank(state, unit)
  if (blankers.length === 0 || (direct && direct.keep!.length === 0)) return direct
  const owner = unit.owner ?? controller ?? sideOf(state, unit)
  return owner !== undefined && blankedBy(state, blankers, unit.cardId, owner) ? { keep: [] } : direct
}

/**
 * **The one read of which cards supply a unit's abilities right now**: what it carries
 * (`carriedAbilityCardIds`: its card, its upgrades, a card lent for this attack), less whatever a "loses
 * all abilities" effect has taken away. Route every ability lookup through here.
 *
 * A unit that has lost its abilities keeps only the upgrades that don't give it abilities, and anything
 * the loss itself keeps. An upgrade that has lost its OWN abilities (a named card under Galen Erso, a
 * leader piloting under Brain Invaders) supplies nothing to anyone.
 */
export function abilityCardIds(state: GameState, unit: UnitState, controller?: PlayerId): string[] {
  // Kept this small on purpose, with the rest in its own function, so the engine can inline the path
  // nearly every call takes. Measured: the combined function cost a bench run 5% on its own.
  if (surelyUnblanked(state, unit)) return carriedAbilityCardIds(unit)
  return remainingAbilityCardIds(state, unit, controller)
}

function remainingAbilityCardIds(state: GameState, unit: UnitState, controller: PlayerId | undefined): string[] {
  const blankers = cardBlankersInPlay(state)
  const blank = blankWith(state, unit, controller, blankers)
  if (!blank && blankers.length === 0) return carriedAbilityCardIds(unit)
  const keepUpgrade = (up: UpgradeAttachment): boolean =>
    !(blankers.length > 0 && blankedBy(state, blankers, up.cardId, up.owner))
    && (!blank || blank.keep!.includes(up.cardId) || !upgradeGivesAbilities(state.cards[up.cardId]))
  return [
    ...(blank ? [] : [unit.cardId]),
    ...unit.upgrades.filter(keepUpgrade).map(attachmentAbilityId),
    ...(blank ? [] : unit.grantedAbilityCardIds ?? []),
  ]
}

/**
 * Whether the event `player` is playing (owned by `owner`) has lost all abilities as it resolves: a
 * card-level loss (Galen Erso), or one aimed at events as they are played (Relentless).
 */
export function playedEventBlanked(state: GameState, player: PlayerId, owner: PlayerId, cardId: string): boolean {
  if (cardAbilitiesBlanked(state, cardId, owner)) return true
  return SIDES.some(side => state.players[side].units.some(u =>
    abilityCardIds(state, u, side).some(id => registry.get(id)?.blanksPlayedEvent?.(state, u, side, player) ?? false)))
}

/**
 * Card ids whose abilities `unit` (controlled by `owner`) currently gains from a `grantsAbilities`
 * aura in play. Scans both sides' units, since a future aura may target enemies.
 */
function auraGrantedAbilityCards(state: GameState, unit: UnitState, owner: PlayerId): string[] {
  const out: string[] = []
  for (const side of ['player', 'opponent'] as PlayerId[]) {
    for (const source of state.players[side].units) {
      for (const cardId of abilityCardIds(state, source, side)) {
        out.push(...(getCardDefinition(cardId)?.grantsAbilities?.(state, source, unit, side === owner) ?? []))
      }
    }
  }
  return out
}

/**
 * The cards whose abilities `unit` gains from the board rather than carries: a `grantsAbilities` aura
 * in play, and a lasting effect's `abilityCardIds` ("for this phase, each friendly unit gains: ...").
 * `abilityCardIds` covers what the unit carries (its card, its upgrades, a lent card); this is the rest,
 * and needs the state to find. Read for triggered abilities and for "Action:" abilities alike.
 */
function grantedAbilityCards(state: GameState, unit: UnitState, owner: PlayerId): string[] {
  if (abilityBlank(state, unit, owner)) return [] // it can't gain abilities (CR 8.14.2)
  return [
    ...auraGrantedAbilityCards(state, unit, owner),
    ...(state.lastingEffects ?? []).flatMap(e => (e.targetInstanceId === unit.instanceId ? e.abilityCardIds ?? [] : [])),
  ]
}

/** Who controls `unit`, which is in play. */
function unitController(state: GameState, unit: UnitState): PlayerId {
  return state.players.opponent.units.some(u => u.instanceId === unit.instanceId) ? 'opponent' : 'player'
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
  const cardIds = [...abilityCardIds(state, unit, owner), ...grantedAbilityCards(state, unit, owner)]
  for (const cardId of cardIds) {
    getAbilities(cardId).forEach((ability, abilityIndex) => {
      if (ability.trigger !== point || !hearsEvent(state, ability, owner, cardId, unit.instanceId, ctx)) return
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
  if (leader.deployed || leaderAbilitiesBlanked(state, owner)) return []
  const out: PendingTrigger[] = []
  ;(registry.get(leader.cardId)?.leaderAbilities?.abilities ?? []).forEach((ability, abilityIndex) => {
    if (ability.trigger !== point || !hearsEvent(state, ability, owner, leader.cardId, undefined, ctx)) return
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
      if (ability.trigger !== point || !hearsEvent(state, ability, owner, cardId, baseSourceId(cardId), ctx)) return
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
    // "When a unit enters play", from either side: both bases (Trap Field) and every unit but the one
    // arriving (Phee Genoa hears an enemy leader deploy).
    ...(['player', 'opponent'] as PlayerId[]).flatMap(p => [
      ...collectBaseTriggers(state, 'whenUnitEntersPlay', p, ctx),
      ...state.players[p].units.flatMap(u => (u.instanceId === arrivedId ? [] : collectUnitTriggers(state, 'whenUnitEntersPlay', u, p, ctx))),
    ]),
  ]
}

/**
 * The handle a resolved trigger leaves behind for `whenAbilityUsed`, or undefined when resolving it was
 * not a use: a "Then, ..." entry (the rest of an ability already announced), a Bounty (collecting it
 * is the `mayCollectBounty` choice, not this), or an ability that changed nothing.
 */
export function usedAbilityOf(trigger: PendingTrigger, changed: boolean): UsedAbility | undefined {
  if (trigger.resume || !changed || trigger.point === 'bounty') return undefined
  const { controller, point, cardId, abilityIndex, sourceInstanceId, fromLeader, ctx } = trigger
  return {
    controller, point, cardId, abilityIndex,
    ...(sourceInstanceId ? { sourceInstanceId } : {}),
    ...(fromLeader ? { fromLeader } : {}),
    ...(ctx ? { ctx } : {}),
  }
}

/**
 * "When you use an ability": everything its controller has listening, told which ability in
 * `ctx.usedAbility`. Only the controller hears it, since every card that reads it says "you". Besides
 * the leader and units, a player hears the cards in `abilityUseHearers` for the phase.
 */
export function collectAbilityUsed(state: GameState, used: UsedAbility): PendingTrigger[] {
  const owner = used.controller
  const p = state.players[owner]
  const borrowed = (state.abilityUseHearers ?? []).filter(h => h.owner === owner)
  if (borrowed.length === 0 && !useHearers.has(p.leader.cardId) && !p.units.some(u => useHearers.has(u.cardId))) return []
  const ctx: TriggerContext = { usedAbility: used }
  return [
    ...collectPlayerTriggers(state, 'whenAbilityUsed', owner, ctx),
    ...p.units.flatMap(u => collectUnitTriggers(state, 'whenAbilityUsed', u, owner, ctx)),
    ...[...new Set(borrowed.map(h => h.cardId))]
      .flatMap(cardId => collectCardTriggers('whenAbilityUsed', cardId, owner, undefined, ctx))
      .filter(t => hearsEvent(state, triggerAbility(t)!, owner, t.cardId, undefined, ctx)),
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
  if (trigger.resume) return resumeAbility(state, trigger.resume)
  const ability = triggerAbility(trigger)
  if (!ability || ability.trigger !== trigger.point) return state
  // Bounty (CR 13) is always optional, whatever its printed text says, so collecting it is a choice
  // rather than an immediate effect — see `runBountyCollection`, which answers it.
  if (trigger.point === 'bounty') {
    return pushChoice(state, {
      kind: 'mayCollectBounty', id: trigger.id, controller: trigger.controller,
      cardId: trigger.cardId, abilityIndex: trigger.abilityIndex,
      ...(trigger.sourceInstanceId ? { sourceInstanceId: trigger.sourceInstanceId } : {}),
      ...(trigger.ctx ? { ctx: trigger.ctx } : {}),
    })
  }
  return runEffect(state, ability.effect, {
    owner: trigger.controller,
    cardId: trigger.cardId,
    sourceInstanceId: trigger.sourceInstanceId,
    ...trigger.ctx,
  })
}

/**
 * Run one Bounty ability's effect once its `mayCollectBounty` choice is accepted. Kept apart from
 * `runPendingTrigger`'s normal path (which uses the trigger's own `abilityIndex`/`cardId` the same
 * way) so resolve.ts's `acceptChoice` can call it directly without reaching into the registry itself.
 */
export function runBountyCollection(
  state: GameState, cardId: string, abilityIndex: number, owner: PlayerId,
  sourceInstanceId: string | undefined, ctx: TriggerContext | undefined,
): GameState {
  const ability = getAbilities(cardId)[abilityIndex]
  if (!ability) return state
  return runEffect(state, ability.effect, { owner, cardId, sourceInstanceId, ...ctx })
}

