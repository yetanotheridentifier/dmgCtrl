/**
 * Game state schema — pure data, fully JSON-serialisable.
 *
 * The engine is a pure function over this shape: (state, action) => state.
 * `cards` is the static card database for the match; it is shared by reference
 * between successive states and never mutated, so structural cloning of states
 * stays cheap for search (MCTS) later.
 *
 * Card ability *text* is never stored here — abilities live in the registry keyed by card id
 * (see abilities.ts), so state stays plain JSON and replays deterministically.
 */

import type { AttackTarget } from './actions'
import type { TriggerPoint } from './abilities'

export type PlayerId = 'player' | 'opponent'
export type Arena = 'ground' | 'space'
export type Phase = 'setup' | 'action' | 'regroup'
export type CardType = 'unit' | 'event' | 'upgrade' | 'leader' | 'base' | 'token'

/** A keyword on a card; `value` carries the numeral for Raid 2, Restore 1, etc. */
export interface KeywordInstance {
  name: string
  value?: number
}

/** Normalised static card data (from SWUDB detail via cardDb.ts). */
export interface EngineCard {
  id: string
  name: string
  subtitle?: string
  type: CardType
  arena?: Arena
  cost: number
  power?: number
  hp?: number
  aspects: string[]
  traits: string[]
  keywords: KeywordInstance[]
  unique: boolean
  /** Card art URL as served by the data source; render via artUrl(). */
  frontArt?: string
  /** Back-side art (SWUDB BackArt): the unit side of a deployed leader. */
  backArt?: string
  /** Rules/ability text (SWUDB FrontText); shown in the textual card fallback. */
  text?: string
  /**
   * Printed rarity (SWUDB Rarity): Common, Uncommon, Rare, Legendary, Special. No rules meaning,
   * but it is the designers' own statement of how strong a card is, which the AI uses to judge a
   * card's worth in hand (#393). Absent for tokens and any source data that omits it.
   */
  rarity?: string
}

export type CardDb = Readonly<Record<string, EngineCard>>

/**
 * An upgrade attached to a unit. `owner` is the player who played it —
 * on defeat the upgrade returns to its owner's discard, which may differ from the
 * unit's controller when an upgrade is attached to an enemy unit.
 */
export interface UpgradeAttachment {
  cardId: string
  owner: PlayerId
}

/** A unit in play. instanceId keeps duplicate copies of a card distinct. */
export interface UnitState {
  instanceId: string
  cardId: string
  arena: Arena
  damage: number
  exhausted: boolean
  isLeader: boolean
  /**
   * Attached upgrades. Card upgrades return to their owner's discard on defeat;
   * token upgrades (cardId in TOKEN_CARDS, type `token`) never go to a discard —
   * they cease to exist. The UI draws them as on-card tokens rather than behind-card upgrades.
   */
  upgrades: UpgradeAttachment[]
  /**
   * Hidden state: the unit can't be attacked (unless it has Sentinel, which
   * overrides Hidden); cleared at the next phase. Set on entry for units with the
   * Hidden keyword, or when an ability grants it.
   */
  hidden?: boolean
  /**
   * Keywords temporarily granted for a single attack (Support). Set only
   * during the resolution of a support attack and cleared immediately after, so a
   * resting state never carries it. `unitHasKeyword`/`unitKeywordValue` include it.
   */
  grantedKeywords?: KeywordInstance[]
  /**
   * Card ids whose full abilities this unit has been granted for a single attack (Support,
   * Improvised Identity). Like `grantedKeywords`, set only during that attack and cleared
   * immediately after. Read them via `abilityCardIds`, which every ability lookup goes through so
   * that EVERY category of ability is lent, not just the ones whose hook happened to remember to
   * check (#417). Abilities only: printed traits do not travel.
   */
  grantedAbilityCardIds?: string[]
  /**
   * Keys of once-per-round action abilities this unit has already used this round
   * (`${cardId}#${index}`); cleared at round start.
   */
  usedAbilities?: string[]
  /**
   * Cards this unit has captured (Bothan-5) — card ids held face-down under it, out of every
   * other zone. Released to their owner's discard when the captor leaves play.
   */
  captured?: string[]
  /**
   * A card name this unit forbids the opponent from playing while it's in play (Ryder
   * Azadi). Set by its When Played "name a card"; the restriction ends naturally
   * when the unit leaves play (the field goes with it).
   */
  namedCard?: string
  /**
   * The player who OWNS this card, when that differs from the player who controls it (Rehabilitation
   * takes control of an enemy unit). Which `players[…].units` array a unit sits in is its
   * *controller*; ownership decides where the card goes when it leaves play — a stolen unit is
   * defeated into its owner's discard, not its controller's. Absent = owner is the controller,
   * which is true of every unit that has never changed hands.
   */
  owner?: PlayerId
}

export interface ResourceState {
  cardId: string
  exhausted: boolean
}

export interface LeaderState {
  cardId: string
  /** false: Leader side in base zone. true: deployed, lives in units[] with isLeader. */
  deployed: boolean
  epicActionUsed: boolean
  exhausted: boolean
}

export interface BaseState {
  cardId: string
  damage: number
}

export interface PlayerState {
  leader: LeaderState
  base: BaseState
  hand: string[]
  /** Draw order: index 0 is the top of the deck. */
  deck: string[]
  discard: string[]
  resources: ResourceState[]
  units: UnitState[]
  /**
   * Grants waiting for the next unit this player plays this phase (Sabine → Shielded; Mouse
   * Droid → −1 cost to the next Imperial; Neel → the next ≤1-power unit enters ready).
   * Each grant carries an optional filter (`trait` / `maxPower`) and is consumed by the next unit
   * that matches it — `costDelta` folds into `effectiveCost`, `keywords` / `entersReady` apply in
   * `enterUnit`. Cleared at the start of the regroup phase.
   */
  nextUnitGrants?: NextUnitGrant[]
}

/**
 * Where an instance of damage came from (Gorian Shard's Corsair). Card-level rather than
 * instance-level so it also describes a leader's or an event's damage, which have no unit in play.
 * `undefined` means "unattributed" — treated as preventable.
 */
export interface DamageSource {
  cardId: string
  controller: PlayerId
}

/** A pending "your next unit …" grant. All fields are plain data (GameState is JSON). */
export interface NextUnitGrant {
  keywords?: KeywordInstance[]
  costDelta?: number // e.g. −1 to the matching unit's cost
  entersReady?: boolean
  // Filter — the grant only applies to (and is consumed by) a unit matching all set constraints:
  trait?: string // the unit must have this trait
  maxPower?: number // the unit's printed power must be ≤ this
}

/** True if `card` is a unit satisfying a grant's filter. */
export function nextUnitGrantMatches(card: EngineCard | undefined, grant: NextUnitGrant): boolean {
  if (!card || card.type !== 'unit') return false
  if (grant.trait && !card.traits.some(t => t.toLowerCase() === grant.trait!.toLowerCase())) return false
  if (grant.maxPower !== undefined && (card.power ?? 0) > grant.maxPower) return false
  return true
}

/**
 * Every card that supplies this unit's abilities: its own card, each attached upgrade, and any card
 * lent to it for a single attack (Support, Improvised Identity).
 *
 * The ONE definition of that set. It used to be spelled out at each lookup site, and the spellings
 * drifted: only some included the lent cards, so an ability whose hook happened to live at a
 * granted-blind site was silently never lent. Scion Shuttle's `aura` and Red Leader's
 * `attacksEitherArena` were both lost that way (#417). Route every ability lookup through here.
 *
 * Duplicates are deliberate and must not be collapsed: two copies of the same upgrade on one host,
 * or a Support source whose card matches the borrower's, each apply their ability again, and
 * keyword numerals stack (CR).
 *
 * Printed TRAITS are deliberately not covered by this: Support lends "this unit's other abilities",
 * and a trait is not an ability. Only a `grantedTraits` hook lends traits.
 */
export function abilityCardIds(unit: UnitState): string[] {
  return [unit.cardId, ...unit.upgrades.map(u => u.cardId), ...(unit.grantedAbilityCardIds ?? [])]
}

export interface GameState {
  cards: CardDb
  players: Record<PlayerId, PlayerState>
  /** Controller of the initiative counter. */
  initiative: PlayerId
  /**
   * Who used Take the Initiative this round (null: available). The taker is
   * hard-passed — they auto-pass every remaining turn this action phase
   * (CR 1.15.5b). A normal pass does NOT lock a player out; only consecutive
   * passes end the phase (CR 1.15.6d).
   */
  initiativeTakenBy: PlayerId | null
  activePlayer: PlayerId
  phase: Phase
  round: number
  /** Action phase ends when both players pass consecutively. */
  consecutivePasses: number
  /** Regroup: whether each player has made their resource-1-card choice yet. */
  regroupResourced: Record<PlayerId, boolean>
  /**
   * This board is a SEARCH SIMULATION, so the regroup it crosses is a model rather than the real one.
   *
   * Never set in real play. An AI stamps it on its own copy before searching, and every board reached
   * from there inherits it, which is what makes the property hold however the boundary is reached: at
   * the root, in a modelled reply, or deep in the frontier.
   *
   * It exists because `enterRegroup` deals both players two cards off a fully-ordered deck held in
   * state. A search that crossed the real regroup would score a hand containing cards nobody has drawn,
   * and would then prefer lines whose value came from knowing them.
   *
   * Exactly three deviations, all in `simulatedRegroupFor` and `enterRegroup`:
   *
   * 1. **The two cards are removed from the deck but not read.** Deck size is public and the deck-out
   *    clock is real, so they are spent rather than left in place, and the empty-deck damage still
   *    lands.
   * 2. **One resource is taken instead of one of them.** The shipped weights put `resource - card` at
   *    +2 and banking is always chosen, so this is a faithful model of this bot rather than a
   *    convenience. The second card is simply not modelled, which understates both hands equally.
   * 3. **The resourcing choice is settled rather than offered.** The opponent's would otherwise be
   *    decided by reading their hand.
   */
  simulatedRegroup?: boolean
  /** Monotonic counter for deterministic unit instance ids. */
  instanceCounter: number
  /** Seed for in-game shuffles (mulligans) — advances on use, replays deterministically. */
  rngSeed: number
  /** Sub-stage of the setup phase: mulligan decisions, then resource picks (CR 5.2.1e–f). */
  setupStage: 'mulligan' | 'resource'
  /** Terminal outcome: a winning player, `'draw'` (both bases fall at once), or null while live. */
  winner: PlayerId | 'draw' | null
  /**
   * Queue of pending mid-resolution choices. While the head is set, the
   * only legal moves are that choice's options (or `skipTrigger` to decline), and
   * `activePlayer` is held at the choice's `controller` so the right side decides.
   * Ambush/Support use it (a single-element queue); optional "may…" abilities and
   * simultaneous `whenReadies` triggers push one entry per decision.
   */
  pendingChoices?: PendingChoice[]
  /**
   * A combat suspended mid-resolution: an "On Defense" ability raised a choice
   * before combat damage. Holds what's needed to resume (`completeAttack`) once the
   * choice(s) drain, plus the attacker's `activePlayer` to restore for the turn pass.
   */
  // `prevented` collects units whose incoming combat damage a prevention effect has cancelled
  // (The Mandalorian) — decided at the `prevent` stage, honoured when damage is dealt.
  pendingAttack?: { attackerId: string; target: AttackTarget; activePlayer: PlayerId; stage: 'onDefense' | 'damage'; viaAmbush?: boolean; preventAsked?: string[]; prevented?: string[] }
  /**
   * A "take the initiative" whose "When you take the initiative" trigger raised a choice:
   * the turn transition (end the phase, or pass to the opponent) is deferred until the choice
   * drains. `true` = taking the initiative also ended the action phase (CR 1.15.5c).
   */
  pendingInitiativeEndsPhase?: boolean
  /**
   * An opponent-interjected choice is pending as part of this player's action (Sabine Wren):
   * `activePlayer` is temporarily the choosing opponent, and this holds the original actor so that
   * once the interjected choice(s) drain, control is restored to them and the turn advances normally.
   * Generic — any effect that makes "an opponent" choose mid-action sets this.
   */
  pendingResumeActive?: PlayerId
  /**
   * Triggered abilities that have fired but not yet resolved, one entry per **ability**.
   *
   * The rules order triggered abilities (CR 7.6.9, 7.6.10), and most abilities resolve without asking
   * the player anything. Ordering therefore cannot be read off `pendingChoices`: a batch where one side
   * draws a card and the other looks at a deck top puts a single entry in that queue, so the engine
   * saw one side owing something and never asked. The abilities have to exist as data before they run.
   *
   * Per ability rather than per unit, because a unit's own ability and one granted by an upgrade on it
   * are two abilities the player orders (the reported case was exactly that).
   */
  pendingTriggers?: PendingTrigger[]
  /**
   * Which side is currently entitled to resolve its triggers, once CR 7.6.10 has been answered.
   *
   * Held separately from `activePlayer` because that moves for other reasons, and a batch may outlive
   * several choices. Scoped to the layer it was answered for, so a nested batch does not silently
   * inherit an answer given about the batch it interrupted. Cleared when the triggers drain.
   */
  triggerTurn?: { side: PlayerId; layer: number }
  /**
   * Transient "this phase" stat/keyword modifiers, each aimed at a unit.
   * Folded into `effectivePower`/`effectiveHp`/`unitKeywords`; cleared at the start of
   * the regroup phase so a unit defeated during regroup uses its base stats.
   */
  lastingEffects?: LastingEffect[]
  /**
   * Events the engine tracks within a boundary so abilities can query them:
   * which units entered play this phase and which cards were defeated this phase
   * (per controller). Reset whenever the phase changes.
   */
  phaseEvents?: PhaseEvents
}

/**
 * One option of a choose-one/modal ability. A small serialisable effect descriptor,
 * resolved by the engine when the option is picked. New variants extend the `kind` union.
 * `arenaLastingBuff`: grant every unit in `arena` (both players) the given "this phase" buff.
 */
/** Reference to a specific attached upgrade (its host unit + position), for card-select choices. */
export interface UpgradeRef {
  unitId: string
  upgradeIndex: number
  cardId: string
}

/** The current combat's roles, so combat-conditional auras (Grogu) can react to who is
 *  attacking / defending. Threaded through `StatContext` into the aura pass during damage resolution. */
export interface CombatContext {
  attackerInstanceId: string
  defenderInstanceId: string
}

/** A hand card offered for play by an ability — its hand position + card id. */
export interface HandCardRef {
  handIndex: number
  cardId: string
}

/** Parameters for a "play a unit from hand" step: cost delta and whether it enters ready. */
export interface PlayFromHandSpec {
  costDelta: number
  entersReady: boolean
}

/** An upgrade sitting in the resource zone, offered for play — its position + card id. */
export interface ResourceUpgradeRef {
  resourceIndex: number
  cardId: string
}

/** Parameters for a "play an upgrade from your resources" step. */
export interface PlayResourceUpgradeSpec {
  /** Front pays the upgrade's cost from remaining resources; the deployed back plays it free. */
  payCost: boolean
  /** Eligible target unit instance ids (front: entered this phase; back: any friendly). */
  targetUnits: string[]
}

/** A follow-up "deal N damage to a unit or a base" selection. */
export interface DamageTargetSpec {
  amount: number
  /** Instance ids of units that may take the damage. */
  unitTargets: string[]
  /** Owners whose base may take the damage. */
  baseTargets: PlayerId[]
}

export interface ChooseOption {
  label: string
  kind: 'arenaLastingBuff'
  arena: Arena
  power?: number
  hp?: number
  keywords?: KeywordInstance[]
}

/** A transient modifier targeting a single unit. Omitted stats = 0. */
export interface LastingEffect {
  targetInstanceId: string
  power?: number
  hp?: number
  keywords?: KeywordInstance[]
  /**
   * Scoped to a single attack rather than the phase (Mando's N-1 Starfighter and Razor Crest both
   * read "this unit gets +2/+0 for this attack"). Cleared by `clearAttackGrants` alongside the other
   * per-attack grants; everything else lives until the regroup phase.
   */
  untilEndOfAttack?: boolean
  /**
   * Card ids whose triggered abilities the unit gains for the duration (Treacherous Minefield hands
   * every unit in an arena an "On Attack" for the phase). Gathered by `runUnitTrigger` exactly like
   * a printed or upgrade-granted ability.
   */
  abilityCardIds?: string[]
}

/** Per-phase event counters. `enteredPlay` holds instance ids (still-in-play
 *  units), `defeated` holds card ids (so trait conditions like "Imperial" can check). */
export interface PhaseEvents {
  enteredPlay: Record<PlayerId, string[]>
  defeated: Record<PlayerId, string[]>
  /** Players whose base was attacked this phase (Greef Karga). */
  basesAttacked: PlayerId[]
  /** Players whose base was DEALT DAMAGE this phase — combat or ability (Baylan Skoll). */
  basesDamaged: PlayerId[]
  /** Players who had an upgrade defeated this phase (Baylan Skoll). */
  upgradesDefeated: PlayerId[]
  /** Instance ids of units dealt damage this phase, whether or not they survived (Galvanized Leap). */
  damagedUnits: string[]
  /** Card ids of units that LEFT PLAY this phase — defeated, bounced, or otherwise (Fateful Goodbye). */
  leftPlay: Record<PlayerId, string[]>
  /** Players whose LEADER unit left play this phase (Fateful Goodbye pays out more). */
  leaderLeftPlay: PlayerId[]
  /** Card ids each player has played this phase, in order — "the first X you play each phase". */
  played: Record<PlayerId, string[]>
}

/**
 * One triggered ability, owed but not yet resolved.
 *
 * Plain data so it survives the `initialState + moves` replay contract: everything the dispatcher
 * needs to run the ability later is either an id or a value already in state. The context fields are
 * the ones the defeat batch supplies; a trigger point that needs more adds its own here rather than
 * smuggling a closure through.
 */
/**
 * What an ability's effect reads about the event that triggered it, beyond who controls it and which
 * card it is on. Carried on a `PendingTrigger` so a collected ability resolves with the context it
 * triggered with, however long it waits to be ordered.
 *
 * One shape rather than a field per trigger point: a new trigger point adds a member here and needs no
 * change to the queue, and `EffectContext` extends it so an effect reads the same names either way.
 * Every member must stay JSON-serialisable, since the queue lives on the game state.
 */
export interface TriggerContext {
  /** `onAttackEnd`: the target of the attack that just ended. */
  attackTarget?: AttackTarget
  /** `onAttackEnd` / `whenEnemyAttacksBase`: the unit that made the attack. */
  attackerInstanceId?: string
  /** `onAttackEnd`: combat damage dealt to the opponent's base this attack (0 if none). */
  combatDamageToBase?: number
  /** `onAttackEnd`: the defending unit was defeated during this attack. */
  defenderDefeated?: boolean
  /** `onAttackEnd`: combat damage the attacker dealt to the defending unit (0 if a base attack). */
  combatDamageToDefender?: number
  /** `whenDefeated`: the unit as it was at the moment of defeat (it has left play). */
  defeatedUnit?: UnitState
  /** `whenDefeated`: the defeat was caused by combat damage. */
  defeatedByCombat?: boolean
  /** A unit the event is *about*: the one just played, readied, or chosen. */
  targetInstanceId?: string
  /** `whenUpgradeAttached`: the upgrade was played from hand rather than created by an ability. */
  upgradePlayed?: boolean
}

export interface PendingTrigger {
  id: string
  /** Whose ability it is, and therefore whose order it is (CR 7.6.9). */
  controller: PlayerId
  point: TriggerPoint
  /**
   * The card the ability belongs to. An upgrade's ability is attributed to the **upgrade**, not to
   * the unit hosting it, which is what lets a prompt tell one owed ability from another.
   */
  cardId: string
  /** Index into that card's registered abilities, since one card may carry two at the same point. */
  abilityIndex: number
  /**
   * Nesting depth (CR 7.6.11). A batch that fires together shares a layer; anything triggered *while*
   * resolving one of them sits one deeper and resolves first.
   *
   * The layer is what makes a nested ability un-orderable against the batch it interrupted: the rules
   * say it "must be resolved next", so only abilities that triggered at the same time are ever offered
   * as a choice. Ordering questions are therefore asked within a layer, never across two.
   */
  layer: number
  /** The in-play instance the ability fires from, when it still exists. */
  sourceInstanceId?: string
  /**
   * The controller has already named this one as the next to resolve (CR 7.6.9), so the dispatcher
   * runs it instead of asking again. Without it, moving the pick to the front is invisible to a
   * dispatcher that only counts how many are owed, and the same question repeats forever.
   */
  picked?: boolean
  /**
   * The ability is on the controller's **undeployed leader** (its front side) rather than on a unit or
   * an upgrade, so it is looked up in `leaderAbilities` rather than in the card's unit abilities.
   */
  fromLeader?: boolean
  /** The event details the ability triggered with, replayed into its effect when it resolves. */
  ctx?: TriggerContext
}

/**
 * Every pending choice also carries `source`: the card that RAISED it, so a prompt can say why the
 * player is being asked (#374). It is stamped automatically by the ability dispatcher rather than
 * passed at each of the ~185 `pushChoice` call sites, and inherited by follow-up choices.
 *
 * A distributive conditional, not a plain intersection: `(A | B) & C` collapses the union, which
 * would break the ~19 `Extract<PendingChoice, { kind: 'x' }>` lookups across the UI and tests.
 * Distributing keeps `PendingChoice` a genuine union of already-stamped variants, so `Extract`,
 * `switch (choice.kind)` narrowing and exhaustiveness all keep working.
 */
export type PendingChoice = WithChoiceSource<ChoiceVariant>
type WithChoiceSource<T> = T extends unknown ? T & { source?: DamageSource } : never

/**
 * A decision the resolver pauses on until its `controller` picks an option or skips.
 * `id` addresses the choice so the controller can resolve several simultaneous ones
 * in an order of their choosing (CR: the active player orders simultaneous triggers).
 * `resumeAtInitiative` marks choices raised at round-start readying (`whenReadies`) —
 * once the queue drains, play resumes with the initiative holder, not `advanceTurn`.
 */
type ChoiceVariant =
  | { kind: 'ambush'; id: string; controller: PlayerId; unitId: string }
  | { kind: 'support'; id: string; controller: PlayerId; unitId: string }
  | { kind: 'payOrExhaust'; id: string; controller: PlayerId; unitId: string; cost: number; resumeAtInitiative?: boolean }
  | { kind: 'mayPlayTopFree'; id: string; controller: PlayerId; unitId: string; cardId: string }
  | { kind: 'mayDamageExhaust'; id: string; controller: PlayerId; unitId: string; arena: Arena }
  // Improvised Identity: search the revealed top cards for a ground unit to
  // discard (`revealed` are the top-of-deck ids, pickable by deck index), then a
  // `mayAttack` follows, granting the discarded card's abilities for that attack.
  | { kind: 'search'; id: string; controller: PlayerId; unitId: string; revealed: string[] }
  | { kind: 'mayAttack'; id: string; controller: PlayerId; unitId: string; grantCardId?: string }
  // Optional targeted effects, e.g. from an On Attack ability: `targets` are the
  // eligible unit instance ids; the controller picks one or declines.
  // `rewardIfDefeated`: if the damage defeats the target, give `count` Advantage to `instanceId`
  // (Imposing Scout Walker → its own unit).
  // `rewardIfDefeated`: if the damage defeats the target, either give `count` Advantage to a fixed
  // `instanceId` (Imposing Scout Walker), or let the controller give `chooseAdvantage` Advantage to a
  // chosen unit (Justifier).
  // `thenSearchDraw` chains "if you do, search the top N for a unit and draw it" (8D8).
  | { kind: 'mayDamage'; id: string; controller: PlayerId; unitId: string; targets: string[]; amount: number; optional?: boolean; rewardIfDefeated?: { instanceId: string; count: number } | { chooseAdvantage: number }; thenSearchDraw?: number; source?: DamageSource }
  // Give `count` of a token to a chosen target. `optional` (default true) offers a decline.
  | { kind: 'mayGiveTokens'; id: string; controller: PlayerId; token: string; count: number; targets: string[]; optional?: boolean }
  | { kind: 'mayAdvantageEach'; id: string; controller: PlayerId; unitId: string; targets: string[] }
  // Vane: defeat a friendly upgrade (chosen from `candidates`, cards or tokens); then the
  // `then` damage-target selection follows. `optional` = the deployed "may" version (a Cancel is
  // offered); the front action is mandatory. Each candidate is the exact upgrade (unit + index).
  // Vane chains 2 damage via `then`; Clan Vizsla Soldier just defeats the upgrade (`then` omitted).
  // `thenReadyUnit` readies that unit instead — "if you do, ready this unit" (Pegasus Tri-Wing).
  // `thenSearchUpgrade` searches the top N for an upgrade that can attach to the unit the defeated
  // one was on, at `discount` off its cost (Reforge).
  | { kind: 'selectUpgradeToDefeat'; id: string; controller: PlayerId; candidates: UpgradeRef[]; optional: boolean; then?: DamageTargetSpec; thenReadyUnit?: string; thenDraw?: number; thenSearchUpgrade?: { depth: number; discount: number } }
  // Reforge: play one of the revealed upgrades onto `unitId`, paying `discount` less than its cost.
  // `revealed` are held out of the deck; the leftovers go to the bottom when this resolves.
  | { kind: 'searchPlayUpgrade'; id: string; controller: PlayerId; unitId: string; revealed: string[]; eligibleIndices: number[]; discount: number }
  // Return a chosen card from your discard to your hand (Moff Gideon). `candidates` are the
  // eligible discard-pile card ids; `acceptChoice`'s `optionIndex` picks one. Optional.
  // `then: 'discardFate'` chains the bottom-and-heal / return-to-hand modal (Trask Walker)
  // instead of the default return-to-hand.
  | { kind: 'selectFromDiscard'; id: string; controller: PlayerId; candidates: string[]; optional: boolean; then?: 'discardFate' }
  // Trask Walker: optionIndex 0 = bottom the card and heal `heal` from your base,
  // 1 = return it to your hand. Mandatory once a card is chosen.
  | { kind: 'chooseDiscardFate'; id: string; controller: PlayerId; cardId: string; heal: number }
  // Chimaera: choose a friendly AND an enemy non-leader unit, then defeat both. Resolved in
  // two accepts — the first records `chosenFriendly` and re-offers with the enemy targets. Optional.
  // Pick one friendly and one enemy unit, then apply `mode` to both. Resolved in two accepts — the
  // first records `chosenFriendly` and re-offers with the enemy targets. Optional.
  // `thenAdvantage` gives that many Advantage tokens to a friendly unit afterwards (Diplomatic Pageantry).
  | { kind: 'selectPair'; id: string; controller: PlayerId; friendlyTargets: string[]; enemyTargets: string[]; chosenFriendly?: string; mode: 'defeat' | 'exhaust'; thenAdvantage?: number }
  // Jabba the Hutt: return one of `candidates` (card upgrades in play) to its owner's hand.
  | { kind: 'selectUpgradeToReturn'; id: string; controller: PlayerId; candidates: UpgradeRef[]; thenShield?: boolean }
  // Jabba the Hutt: having returned `cardId` to your own hand, may attach it free to a unit.
  | { kind: 'mayPlayUpgradeFree'; id: string; controller: PlayerId; cardId: string; targets: string[] }
  // Jod Na Nawood: may pay `cost`, then exhaust every unit in the chosen arena
  // (optionIndex 0 = ground, 1 = space).
  | { kind: 'mayPayExhaustArena'; id: string; controller: PlayerId; cost: number }
  // Queen Soruna: may reveal a unit from hand (`handIndices`); the revealed card's cost
  // then picks out the units that can be damaged.
  | { kind: 'revealUnitFromHand'; id: string; controller: PlayerId; handIndices: number[]; amount: number }
  // Choose where to deal a fixed amount of damage: a unit (`unitTargets`) or a base
  // (`baseTargets`, by owner). Mandatory. Vane's "deal 2 to a base / the defending unit or a base".
  // `thenHealBase` is the tail of a card that damages and then heals (Grassroots Resistance), so
  // the target is picked in the order the card reads rather than after its own second sentence.
  | { kind: 'selectDamageTarget'; id: string; controller: PlayerId; amount: number; unitTargets: string[]; baseTargets: PlayerId[]; optional?: boolean; source?: DamageSource; thenHealBase?: number }
  // Greef Karga front: on playing a unit, may exhaust the leader to give it an Advantage token.
  // `unitId` is the just-played unit to receive the token.
  | { kind: 'mayExhaustLeaderForAdvantage'; id: string; controller: PlayerId; unitId: string }
  // Optional "this phase" buff, e.g. Baylan's On Attack: pick a unit among `targets`
  // and grant it the given power/HP/keywords for the phase, or decline.
  // `thenMayAttack` chains "you may attack with that unit" (T-6 Shuttle 1974).
  | { kind: 'mayLastingBuff'; id: string; controller: PlayerId; targets: string[]; power?: number; hp?: number; keywords?: KeywordInstance[]; thenMayAttack?: boolean
      // The Student Guides the Master: power is +1 per friendly unit weaker than the chosen one,
      // so it can only be worked out once a target is picked.
      powerPerWeakerFriendly?: boolean }
  // Ezra front: on a friendly attack ending, may exhaust the leader to give an Advantage
  // token to one of `targets` (a unit other than the attacker), or decline.
  | { kind: 'mayExhaustLeaderGiveAdvantage'; id: string; controller: PlayerId; targets: string[] }
  // Ezra deployed: may give an Advantage token to one of `targets`, or decline (no cost).
  | { kind: 'mayGiveAdvantage'; id: string; controller: PlayerId; targets: string[] }
  // Shin Hati front: on a friendly attack ending, may exhaust the leader to exhaust one of
  // `targets` (a ready unit cheaper than the base damage dealt), or decline.
  | { kind: 'mayExhaustLeaderExhaustUnit'; id: string; controller: PlayerId; targets: string[] }
  // Shin Hati deployed: may exhaust one of `targets`, or decline (no leader-exhaust cost).
  // `markUsed`, when set, marks a once-per-round triggered ability as spent on acceptance.
  | { kind: 'mayExhaustUnit'; id: string; controller: PlayerId; targets: string[]; markUsed?: { instanceId: string; key: string } }
  // Choose-one / modal: pick exactly one of `options` (Sloane). Each option is a small
  // serialisable effect descriptor, resolved by index; mandatory (no decline).
  | { kind: 'chooseOne'; id: string; controller: PlayerId; options: ChooseOption[] }
  /**
   * CR 7.6.10: with triggers owed on BOTH sides, the **active player** chooses which player resolves
   * theirs first. Option 0 is us, option 1 is them.
   *
   * They choose the player and nothing else. The opponent's internal order stays the opponent's
   * (CR 7.6.9), which is why this carries no target and no list: offering anything finer would be
   * offering a decision that is not theirs to make.
   */
  | { kind: 'chooseTriggerOrder'; id: string; controller: PlayerId }
  /**
   * CR 7.6.9: a player with several of their own abilities owed at once chooses the order.
   *
   * `cardId` rides alongside the trigger id so a prompt can name the card each waiting ability came
   * from. Two abilities off one unit are otherwise indistinguishable, and one of them is routinely an
   * upgrade's rather than the host's.
   *
   * Only raised for two or more: a single owed ability is not a decision.
   */
  // `sourceInstanceId` is what tells two copies of one card apart: the same ability on two units is a
  // real ordering decision, and without the instance the prompt would offer two identical buttons.
  | { kind: 'chooseNextTrigger'; id: string; controller: PlayerId; candidates: { triggerId: string; cardId: string; sourceInstanceId?: string }[] }
  // Luke front: may exhaust the (undeployed) leader to heal `amount` from `unitId`, or decline.
  | { kind: 'mayExhaustLeaderHealUnit'; id: string; controller: PlayerId; unitId: string; amount: number }
  // Luke deployed: heal `amount` from a chosen unit (`unitTargets`) or base (`baseTargets`). Mandatory.
  // `thenShield` gives the healed unit a Shield token as part of the same effect (Perserverance).
  | { kind: 'selectHealTarget'; id: string; controller: PlayerId; amount: number; unitTargets: string[]; baseTargets: PlayerId[]; optional?: boolean; thenShield?: boolean }
  // Play a unit from hand as part of an ability: pick one of `candidates` (affordable hand
  // units), paying its cost + `costDelta`, entering ready if `entersReady` (Fennec, Moff Gideon).
  | { kind: 'playUnitFromHand'; id: string; controller: PlayerId; candidates: HandCardRef[]; costDelta: number; entersReady: boolean; optional?: boolean }
  // Additional cost "exhaust a friendly unit": pick one of `targets` to exhaust, then the
  // `then` play-from-hand step follows (Fennec). Mandatory.
  | { kind: 'selectUnitToExhaust'; id: string; controller: PlayerId; targets: string[]; then: PlayFromHandSpec }
  // The Armorer: look at your resources and pick an upgrade to play (by candidate index); the
  // `then` spec carries how it plays. `optional` = the deployed "may" version (a Cancel is offered).
  | { kind: 'selectResourceUpgrade'; id: string; controller: PlayerId; candidates: ResourceUpgradeRef[]; optional: boolean; then: PlayResourceUpgradeSpec }
  // Follow-up: attach the chosen resource upgrade to one of `targets`. Mandatory.
  | { kind: 'attachResourceUpgrade'; id: string; controller: PlayerId; resourceIndex: number; cardId: string; targets: string[]; payCost: boolean }
  // Optionally pay `cost` to draw `draw` cards (Mandalorian). `cost` 0 = a free "may draw".
  // `thenDiscard` (Mos Espa Watermonger): after drawing, discard that many cards from hand —
  // but only if a card was actually drawn ("you may draw a card. If you do, discard a card").
  | { kind: 'mayPayToDraw'; id: string; controller: PlayerId; cost: number; draw: number; thenDiscard?: number }
  // Discard `count` cards from your own hand, one at a time. Mandatory unless `optional`.
  // Resolved by an `acceptChoice` carrying the hand index. `then` runs after the last discard: Ninth
  // Sister distributes the discarded card's cost as damage (`distributeDamageTo`); Razor Crest gives a
  // unit a "this phase" buff (`buffUnit`).
  | { kind: 'selectDiscard'; id: string; controller: PlayerId; count: number; optional?: boolean; then?: { distributeDamageTo: PlayerId } | { buffUnit: string; power?: number; hp?: number } | { dealDamage: number; costlierThanDiscard?: boolean } | { exhaustUnit: true } }
  // Leia Organa: a yes/no — deal `selfDamage` to `unitId`, then heal `healBase` from your base.
  | { kind: 'maySelfDamageHealBase'; id: string; controller: PlayerId; unitId: string; selfDamage: number; healBase: number }
  // Mando's N-1: a yes/no — exhaust your (ready) leader to give `unitId` a "+power/+hp this phase" buff.
  | { kind: 'mayExhaustLeaderBuffSelf'; id: string; controller: PlayerId; unitId: string; power: number; hp: number }
  // Deal `total` damage spread among any units (Ninth Sister), one point per pick until
  // `remaining` reaches 0. `targets` are the currently-eligible unit instance ids (both sides,
  // recomputed as units are defeated). Always optional — the controller may stop early (a "may").
  | { kind: 'distributeDamage'; id: string; controller: PlayerId; remaining: number; total: number; targets: string[] }
  // Distribute `total` tokens among `targets`, one per pick until `remaining` reaches 0 (Helgait).
  // Unlike `multiPick`'s give-advantage, targets stay eligible so tokens can stack. Always optional.
  // `exclude` keeps a unit out of the target list across re-offers ("other friendly units"), and
  // `then` chains once distribution finishes — by exhausting the pool or stopping (Elzar Mann).
  | { kind: 'distributeTokens'; id: string; controller: PlayerId; token: string; remaining: number; total: number; targets: string[]; exclude?: string; then?: 'opponentSearchEvent' }
  // Enoch: deal up to `max` damage to your own base, one at a time (`dealt` so far); stopping
  // (or reaching `max`) grants "next unit costs 1 less per 2 damage dealt". Each accept deals 1 more.
  | { kind: 'dealOwnBaseForDiscount'; id: string; controller: PlayerId; dealt: number; max: number }
  // Purrgil Ultra: return a chosen friendly non-leader unit (`targets`) to hand, then deal
  // damage equal to its cost to any unit. Optional (skip = don't return).
  // `then` picks the follow-up: 'damageEqualToCost' (Purrgil Ultra) or 'returnEnemyUnit' (Far Far Away).
  | { kind: 'returnFriendlyUnit'; id: string; controller: PlayerId; targets: string[]; then?: 'damageEqualToCost' | 'returnEnemyUnit' }
  // Return one of `targets` to its owner's hand. Distinct from returnFriendlyUnit in that the card
  // supplies the eligible units, which may be the opponent's.
  | { kind: 'selectUnitToReturn'; id: string; controller: PlayerId; targets: string[] }
  // Galvanized Leap: ready one of `targets`.
  | { kind: 'selectUnitToReady'; id: string; controller: PlayerId; targets: string[] }
  // Rehabilitation: take control of one of `targets` until the regroup phase, debuffing it by
  // `power`/`hp` for this phase.
  | { kind: 'selectUnitToSteal'; id: string; controller: PlayerId; targets: string[]; power?: number; hp?: number }
  // Play a unit from your discard for free (One Must Destroy to Create, Dathomiri Magicks).
  // `candidates` are discard-pile card ids; `acceptChoice`'s `optionIndex` picks one. `remaining`
  // counts how many more may be played after this one, so the offer re-raises until the pool runs out.
  | { kind: 'mayPlayUnitFromDiscard'; id: string; controller: PlayerId; candidates: string[]; remaining: number; maxCost?: number; excludeTrait?: string }
  // "Choose one:" — a modal effect. `modes` holds only the options the card allows right now, so a
  // mode whose condition isn't met is never offered.
  | { kind: 'chooseMode'; id: string; controller: PlayerId; modes: string[] }
  // Treacherous Minefield: pick an arena (optionIndex 0 = ground, 1 = space); every unit there
  // gains `grantCardId`'s abilities for the phase.
  | { kind: 'selectArenaToGrant'; id: string; controller: PlayerId; grantCardId: string }
  // Sense Through the Force: name a number from 0 to `max`, then search — the guess is checked
  // against the drawn card's cost.
  | { kind: 'chooseNumber'; id: string; controller: PlayerId; max: number; then: 'senseThroughTheForce' }
  // Hold Them Off: pick the unit that will deal the damage; its power becomes the pool to spread
  // among units in its own arena.
  | { kind: 'selectDistributeSource'; id: string; controller: PlayerId; targets: string[] }
  // Reanimated Night Trooper, stage 1 (#388): choose which deck to look at (`acceptChoice`'s
  // `baseTarget` picks one of `decks`), or decline outright. Choosing a deck reveals its top card
  // rather than discarding it — that decision is the follow-up `mayDiscardTop` choice below.
  | { kind: 'peekTopDiscard'; id: string; controller: PlayerId; decks: PlayerId[] }
  // Reanimated Night Trooper, stage 2: the top card of `deck` (`cardId`) is now revealed. Accept
  // discards it; decline leaves it on top.
  | { kind: 'mayDiscardTop'; id: string; controller: PlayerId; deck: PlayerId; cardId: string }
  // Look at `target`'s hand (Imperial Defector / Remnant Lookouts) — the controller sees it
  // revealed. View-only unless `mayDiscard`, when the controller may discard one of the target's
  // cards (an `acceptChoice` with its hand index); `thenDraw` then has the target draw a card.
  | { kind: 'lookAtHand'; id: string; controller: PlayerId; target: PlayerId; mayDiscard?: boolean; thenDraw?: boolean }
  // Search the revealed top cards (Clan Wren Loyalist): pick one of the `eligibleIndices`
  // (indices into `revealed`) to draw; the rest go to the bottom of the deck. Resolved by an
  // `acceptChoice` carrying the `deckIndex` (0-based within `revealed`). Mandatory when eligible.
  // `guessedCost` carries Sense Through the Force's named number: if the drawn card's cost matches,
  // the follow-up Advantage offer fires.
  | { kind: 'searchDraw'; id: string; controller: PlayerId; revealed: string[]; eligibleIndices: number[]; guessedCost?: number }
  // The Cyborg Mech: deal `undamagedAmount` to a chosen undamaged target, or `damagedAmount`
  // to a damaged one (the amount is decided by the picked unit's damage). Mandatory board-target.
  | { kind: 'variableStrike'; id: string; controller: PlayerId; targets: string[]; undamagedAmount: number; damagedAmount: number }
  // Barriss Offee: heal up to `maxHeal` from a chosen unit and give it that many Advantage
  // tokens (one per damage healed). Optional board-target — only damaged units are eligible.
  | { kind: 'healForAdvantage'; id: string; controller: PlayerId; targets: string[]; maxHeal: number }
  // Moff Jerjerrod: after creating `count` tokens, you may defeat `unitId` to create `count`
  // more (equivalent to "create twice that number instead"). A yes/no.
  | { kind: 'mayDoubleTokens'; id: string; controller: PlayerId; unitId: string; token: string; count: number }
  // Name a card (Ryder Azadi) — resolved by an `acceptChoice` carrying `cardName`; the name is
  // recorded on `unitId` (a `namedCard`), forbidding the opponent from playing cards with that name
  // while it's in play. Mandatory.
  | { kind: 'nameCard'; id: string; controller: PlayerId; unitId: string }
  // "You may defeat this unit. If you do, [search]" (Admiral Ackbar) — a yes/no. Accept defeats
  // `unitId` and starts the search-and-play-free (below); skip leaves the unit in play.
  | { kind: 'mayDefeatSelfSearch'; id: string; controller: PlayerId; unitId: string }
  // Search the revealed cards (held out of the deck) and play space units for free while a combined-cost
  // `budget` lasts (Admiral Ackbar). Pick one `eligibleIndices` (indices into `revealed`) at a time
  // via an `acceptChoice`'s `deckIndex`; skip (Done) stops. Leftover revealed cards return to the bottom.
  // `playOne` stops after a single pick rather than spending the whole budget, and `entersReady`
  // brings it in ready — "play it for free. It enters play ready" (Eye of Sion).
  | { kind: 'searchPlayFree'; id: string; controller: PlayerId; revealed: string[]; eligibleIndices: number[]; budget: number; playOne?: boolean; entersReady?: boolean }
  // Rancor Keeper: "deal 1 damage to any number of bases" — repeatable, each base at most
  // once; `remaining` are the bases not yet picked. Skip finishes.
  | { kind: 'damageAnyBases'; id: string; controller: PlayerId; remaining: PlayerId[]; amount: number; source?: DamageSource }
  /**
   * The Mandalorian: may defeat a Shield on `preventerId` to prevent `amount` damage headed
   * for `targetId`. A yes/no. Raised on two paths:
   *  - combat, at the `prevent` attack stage, before any damage is calculated — accepting records
   *    the target on `pendingAttack.prevented` and the normal damage step skips it;
   *  - ability damage, where `dealDamageToUnit` defers instead of applying, and this choice's
   *    resolution applies it (declined) or drops it (accepted).
   * `followUp` carries the damage-dealing choice whose "if you do …" tail must only run when the
   * damage actually lands.
   */
  | { kind: 'mayPreventDamage'; id: string; controller: PlayerId; preventerId: string; targetId: string; amount: number; source?: DamageSource; combat?: boolean; followUp?: PendingChoice }
  // Bothan-5: may capture `cardId` from your discard under `unitId`. A yes/no;
  // `markUsed` records the once-each-round use when accepted.
  | { kind: 'mayCapture'; id: string; controller: PlayerId; unitId: string; cardId: string; markUsed?: { instanceId: string; key: string } }
  // Cobb Vanth: may deal `amount` to `selfId`; if you do, give a Shield to `targetId`. A yes/no.
  | { kind: 'maySelfDamageShield'; id: string; controller: PlayerId; selfId: string; targetId: string; amount: number }
  // Gar Saxon: may create `count` of a token unit. A yes/no; `markUsed` records the
  // once-each-round use on the source unit when accepted.
  | { kind: 'mayCreateToken'; id: string; controller: PlayerId; token: string; count: number; markUsed?: { instanceId: string; key: string } }
  // Optionally deploy your leader via a triggered epic action (Grogu). A yes/no.
  | { kind: 'mayDeployLeader'; id: string; controller: PlayerId }
  // Unique rule (CR): a player controlling two upgrades with the same title defeats one (their
  // choice). `candidates` are the duplicate instances; picking one defeats it. Mandatory.
  | { kind: 'selectUniqueToDefeat'; id: string; controller: PlayerId; cardId: string; candidates: UpgradeRef[] }
  | { kind: 'selectUniqueUnitToDefeat'; id: string; controller: PlayerId; cardId: string; candidates: string[] }
  // Attack with any ready unit (Thrawn, Grogu); it gains Restore `restore` for that attack, which is
  // 0 when nothing grants it. Resolved by making the attack on the board — skipping declines it.
  // `grantCardId` lends the chosen attacker a carrier card's abilities for that attack — how the
  // attack-granting events (Rash Action, Follow Me, Masterstroke, Wipe Them Out) add their rider.
  | { kind: 'mayAttackAnyUnit'; id: string; controller: PlayerId; restore: number; grantCardId?: string }
  // Defeat one of `targets`, or decline. The card supplies the eligible units, so this covers
  // "a non-leader enemy unit" (Thrawn), "an upgraded non-leader unit" (Get Lost), and so on.
  // `thenResource` chains "if you do, resource the top card of your deck" (Long Live the Empire).
  // `thenReplayFromDiscard` offers the defeated unit straight back from the discard, free
  // (One Must Destroy to Create).
  | { kind: 'selectUnitToDefeat'; id: string; controller: PlayerId; targets: string[]; thenResource?: boolean; thenReplayFromDiscard?: boolean }
  // Sabine front: the opponent (`controller`) must give `count` Advantage tokens to one of
  // their units (`targets`). Mandatory when able — an opponent-interjected choice (pendingResumeActive).
  | { kind: 'opponentGivesAdvantage'; id: string; controller: PlayerId; count: number; targets: string[] }
  // Repeatable board-target pick: click eligible `targets` one at a time (each applies `spec`
  // immediately and re-offers), or Done (skipTrigger). Inspiring Veteran (up to N Advantage) / Pre
  // Vizsla (defeat non-leaders within an HP budget, a token each).
  | {
      kind: 'multiPick'; id: string; controller: PlayerId; targets: string[]
      spec: { mode: 'giveAdvantage'; remaining: number } | { mode: 'defeatForToken'; budget: number; token: string } | { mode: 'dealEach'; amount: number; remaining: number } | { mode: 'exhaust'; remaining: number }
    }

/** The choice currently awaiting a decision (head of the queue), if any. */
export function activeChoice(state: GameState): PendingChoice | undefined {
  return state.pendingChoices?.[0]
}

/** True while any choice is pending (normal moves are suppressed). */
export function hasPendingChoices(state: GameState): boolean {
  return (state.pendingChoices?.length ?? 0) > 0
}

/** Find a pending choice by id. */
export function findChoice(state: GameState, id: string): PendingChoice | undefined {
  return state.pendingChoices?.find(c => c.id === id)
}

/**
 * Remove a specific choice by id; the queue becomes `undefined` when it empties.
 *
 * Always by id. A player may answer any of their outstanding choices, not just the one at the
 * head, so a "remove the head" helper silently consumed the wrong choice (#376 item 5) and is
 * deliberately not offered.
 */
export function removeChoice(state: GameState, id: string): GameState {
  const rest = (state.pendingChoices ?? []).filter(c => c.id !== id)
  return { ...state, pendingChoices: rest.length > 0 ? rest : undefined }
}

/** Append a choice to the pending queue (order = trigger order; the controller reorders). */
export function pushChoice(state: GameState, choice: PendingChoice): GameState {
  // A decided game resolves nothing (CR 6.6.2: once a player's base has 0 remaining HP they "cannot
  // resolve any abilities or effects"). Guarded HERE rather than at each caller because whether a
  // trigger is raised before or after the win check varies by card and by code path: Camtono revealed a
  // card on top of the game-over screen after an attack that won the game, and the player could neither
  // answer it nor dismiss it, since a decided game offers no legal moves.
  if (state.winner !== null) return state
  // Guarantee a unique id among pending choices — different triggers on the same played
  // unit (e.g. Support + Greef Karga) would otherwise collide and mislabel each other.
  const existing = state.pendingChoices ?? []
  let id = choice.id
  let n = 1
  while (existing.some(c => c.id === id)) id = `${choice.id}#${n++}`
  return { ...state, pendingChoices: [...existing, id === choice.id ? choice : { ...choice, id }] }
}

// ---------------------------------------------------------------------------
// Lasting effects + phase-event tracking
// ---------------------------------------------------------------------------

/** Add a transient modifier aimed at a unit — "this phase" unless it says `untilEndOfAttack`. */
export function addLastingEffect(state: GameState, effect: LastingEffect): GameState {
  return { ...state, lastingEffects: [...(state.lastingEffects ?? []), effect] }
}

/** Drop every lasting effect (called at the start of the regroup phase). */
export function clearLastingEffects(state: GameState): GameState {
  return state.lastingEffects ? { ...state, lastingEffects: undefined } : state
}

/** Clear both players' "next unit you play this phase" grants — a phase-boundary reset. */
export function clearNextUnitGrants(state: GameState): GameState {
  return {
    ...state,
    players: {
      player: { ...state.players.player, nextUnitGrants: undefined },
      opponent: { ...state.players.opponent, nextUnitGrants: undefined },
    },
  }
}

function emptyPhaseEvents(): PhaseEvents {
  return { enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [], upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, leaderLeftPlay: [], played: { player: [], opponent: [] } }
}

/** Clear the tracked per-phase events (called whenever the phase changes). */
export function resetPhaseEvents(state: GameState): GameState {
  return state.phaseEvents ? { ...state, phaseEvents: undefined } : state
}

/** Note that `instanceId` entered play under `owner` this phase. */
export function recordUnitEntered(state: GameState, owner: PlayerId, instanceId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return { ...state, phaseEvents: { ...events, enteredPlay: { ...events.enteredPlay, [owner]: [...events.enteredPlay[owner], instanceId] } } }
}

/** Note that `owner` played `cardId` this phase — recorded after its cost is paid. */
export function recordCardPlayed(state: GameState, owner: PlayerId, cardId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return { ...state, phaseEvents: { ...events, played: { ...events.played, [owner]: [...events.played[owner], cardId] } } }
}

/** Card ids `owner` has played this phase, in order ("the first X you play each phase"). */
export function cardsPlayedThisPhase(state: GameState, owner: PlayerId): string[] {
  return state.phaseEvents?.played[owner] ?? []
}

/** Note that a unit with card id `cardId` was defeated under `owner` this phase. */
export function recordUnitDefeated(state: GameState, owner: PlayerId, cardId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return { ...state, phaseEvents: { ...events, defeated: { ...events.defeated, [owner]: [...events.defeated[owner], cardId] } } }
}

/** Note that `owner`'s base was attacked this phase (Greef Karga). */
export function recordBaseAttacked(state: GameState, owner: PlayerId): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return events.basesAttacked.includes(owner) ? state : { ...state, phaseEvents: { ...events, basesAttacked: [...events.basesAttacked, owner] } }
}

/** Record that `owner`'s base took damage this phase. Idempotent. */
export function recordBaseDamaged(state: GameState, owner: PlayerId): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return events.basesDamaged.includes(owner) ? state : { ...state, phaseEvents: { ...events, basesDamaged: [...events.basesDamaged, owner] } }
}

/** Whether `owner`'s base was dealt damage this phase (Baylan Skoll). */
export function baseDamagedThisPhase(state: GameState, owner: PlayerId): boolean {
  return state.phaseEvents?.basesDamaged.includes(owner) ?? false
}

/** Record that `owner` had an upgrade defeated this phase. Idempotent. */
export function recordUpgradeDefeated(state: GameState, owner: PlayerId): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return events.upgradesDefeated.includes(owner) ? state : { ...state, phaseEvents: { ...events, upgradesDefeated: [...events.upgradesDefeated, owner] } }
}

/** Record that `instanceId` was dealt damage this phase. Idempotent. */
export function recordUnitDamaged(state: GameState, instanceId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return events.damagedUnits.includes(instanceId) ? state : { ...state, phaseEvents: { ...events, damagedUnits: [...events.damagedUnits, instanceId] } }
}

/** Instance ids of units dealt damage this phase (Galvanized Leap). */
export function damagedThisPhase(state: GameState): string[] {
  return state.phaseEvents?.damagedUnits ?? []
}

/** Record that a unit left play under `owner` this phase — defeated, bounced, or otherwise. */
export function recordUnitLeftPlay(state: GameState, owner: PlayerId, cardId: string, isLeader: boolean): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return {
    ...state,
    phaseEvents: {
      ...events,
      leftPlay: { ...events.leftPlay, [owner]: [...events.leftPlay[owner], cardId] },
      leaderLeftPlay: isLeader && !events.leaderLeftPlay.includes(owner) ? [...events.leaderLeftPlay, owner] : events.leaderLeftPlay,
    },
  }
}

/** Card ids of `owner`'s units that left play this phase (Fateful Goodbye). */
export function leftPlayThisPhase(state: GameState, owner: PlayerId): string[] {
  return state.phaseEvents?.leftPlay[owner] ?? []
}

/** Whether `owner`'s leader unit left play this phase. */
export function leaderLeftPlayThisPhase(state: GameState, owner: PlayerId): boolean {
  return state.phaseEvents?.leaderLeftPlay.includes(owner) ?? false
}

/** Whether `owner` had an upgrade defeated this phase (Baylan Skoll). */
export function upgradeDefeatedThisPhase(state: GameState, owner: PlayerId): boolean {
  return state.phaseEvents?.upgradesDefeated.includes(owner) ?? false
}

/** Whether `owner`'s base was attacked this phase. */
export function baseAttackedThisPhase(state: GameState, owner: PlayerId): boolean {
  return state.phaseEvents?.basesAttacked.includes(owner) ?? false
}

/** Instance ids of units that entered play under `owner` this phase. */
export function enteredPlayThisPhase(state: GameState, owner: PlayerId): string[] {
  return state.phaseEvents?.enteredPlay[owner] ?? []
}

/** Card ids of units defeated under `owner` this phase. */
export function defeatedThisPhase(state: GameState, owner: PlayerId): string[] {
  return state.phaseEvents?.defeated[owner] ?? []
}

/** Mark a once-per-round ability (`key`) as spent on the unit `instanceId` under `owner`.
 *  Cleared when the unit readies at regroup (shared with activated abilities). */
export function markAbilityUsed(state: GameState, owner: PlayerId, instanceId: string, key: string): GameState {
  return updatePlayer(state, owner, {
    units: state.players[owner].units.map(u =>
      u.instanceId === instanceId && !(u.usedAbilities ?? []).includes(key)
        ? { ...u, usedAbilities: [...(u.usedAbilities ?? []), key] }
        : u,
    ),
  })
}

/** Total power/HP and keywords a unit gains from all lasting effects aimed at it. */
export function lastingEffectTotals(state: GameState, instanceId: string): { power: number; hp: number; keywords: KeywordInstance[] } {
  let power = 0
  let hp = 0
  const keywords: KeywordInstance[] = []
  for (const e of state.lastingEffects ?? []) {
    if (e.targetInstanceId !== instanceId) continue
    power += e.power ?? 0
    hp += e.hp ?? 0
    if (e.keywords) keywords.push(...e.keywords)
  }
  return { power, hp, keywords }
}

export function opponentOf(player: PlayerId): PlayerId {
  return player === 'player' ? 'opponent' : 'player'
}

/** Immutably patch one player's state, returning a new GameState. */
export function updatePlayer(state: GameState, id: PlayerId, patch: Partial<PlayerState>): GameState {
  return {
    ...state,
    players: { ...state.players, [id]: { ...state.players[id], ...patch } },
  }
}
