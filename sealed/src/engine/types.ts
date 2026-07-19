/**
 * Game state schema (T2.1) — pure data, fully JSON-serialisable.
 *
 * The engine is a pure function over this shape: (state, action) => state.
 * `cards` is the static card database for the match; it is shared by reference
 * between successive states and never mutated, so structural cloning of states
 * stays cheap for search (MCTS) later.
 *
 * Ability text is intentionally NOT modelled in the MVP engine — Sealed play
 * with vanilla stats first; abilities layer in post-M1.
 */

import type { AttackTarget } from './actions'

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
  /** Card art URL as served by the data source; render via artUrl() (#311). */
  frontArt?: string
  /** Back-side art (SWUDB BackArt): the unit side of a deployed leader. */
  backArt?: string
  /** Rules/ability text (SWUDB FrontText); shown in the textual card fallback. */
  text?: string
}

export type CardDb = Readonly<Record<string, EngineCard>>

/**
 * An upgrade attached to a unit (#308). `owner` is the player who played it —
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
   * they cease to exist. Rendering them as tokens rather than cards is #336.
   */
  upgrades: UpgradeAttachment[]
  /**
   * Hidden state (#334): the unit can't be attacked (unless it has Sentinel, which
   * overrides Hidden); cleared at the next phase. Set on entry for units with the
   * Hidden keyword, or when an ability grants it (#337).
   */
  hidden?: boolean
  /**
   * Keywords temporarily granted for a single attack (Support, #334). Set only
   * during the resolution of a support attack and cleared immediately after, so a
   * resting state never carries it. `unitHasKeyword`/`unitKeywordValue` include it.
   */
  grantedKeywords?: KeywordInstance[]
  /**
   * Card ids whose full abilities (keywords + triggered) this unit has been granted
   * for a single attack (Improvised Identity, #343). Like `grantedKeywords`, set only
   * during that attack and cleared immediately after. `unitKeywords`/`runUnitTrigger`
   * include them.
   */
  grantedAbilityCardIds?: string[]
  /**
   * Keys of once-per-round action abilities this unit has already used this round
   * (`${cardId}#${index}`); cleared at round start (#343).
   */
  usedAbilities?: string[]
  /**
   * A card name this unit forbids the opponent from playing while it's in play (#355,
   * Ryder Azadi). Set by its When Played "name a card"; the restriction ends naturally
   * when the unit leaves play (the field goes with it).
   */
  namedCard?: string
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
   * Grants waiting for the next unit this player plays this phase (Sabine → Shielded #348; Mouse
   * Droid → −1 cost to the next Imperial #355; Neel → the next ≤1-power unit enters ready #355).
   * Each grant carries an optional filter (`trait` / `maxPower`) and is consumed by the next unit
   * that matches it — `costDelta` folds into `effectiveCost`, `keywords` / `entersReady` apply in
   * `enterUnit`. Cleared at the start of the regroup phase.
   */
  nextUnitGrants?: NextUnitGrant[]
}

/** A pending "your next unit …" grant (#348/#355). All fields are plain data (GameState is JSON). */
export interface NextUnitGrant {
  keywords?: KeywordInstance[]
  costDelta?: number // e.g. −1 to the matching unit's cost
  entersReady?: boolean
  // Filter — the grant only applies to (and is consumed by) a unit matching all set constraints:
  trait?: string // the unit must have this trait
  maxPower?: number // the unit's printed power must be ≤ this
}

/** True if `card` is a unit satisfying a grant's filter (#355). */
export function nextUnitGrantMatches(card: EngineCard | undefined, grant: NextUnitGrant): boolean {
  if (!card || card.type !== 'unit') return false
  if (grant.trait && !card.traits.some(t => t.toLowerCase() === grant.trait!.toLowerCase())) return false
  if (grant.maxPower !== undefined && (card.power ?? 0) > grant.maxPower) return false
  return true
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
  /** Monotonic counter for deterministic unit instance ids. */
  instanceCounter: number
  /** Seed for in-game shuffles (mulligans) — advances on use, replays deterministically. */
  rngSeed: number
  /** Sub-stage of the setup phase: mulligan decisions, then resource picks (CR 5.2.1e–f). */
  setupStage: 'mulligan' | 'resource'
  /** Terminal outcome: a winning player, `'draw'` (both bases fall at once), or null while live. */
  winner: PlayerId | 'draw' | null
  /**
   * Queue of pending mid-resolution choices (#334/#342). While the head is set, the
   * only legal moves are that choice's options (or `skipTrigger` to decline), and
   * `activePlayer` is held at the choice's `controller` so the right side decides.
   * Ambush/Support use it (a single-element queue); optional "may…" abilities and
   * simultaneous `whenReadies` triggers push one entry per decision.
   */
  pendingChoices?: PendingChoice[]
  /**
   * A combat suspended mid-resolution (#342): an "On Defense" ability raised a choice
   * before combat damage. Holds what's needed to resume (`completeAttack`) once the
   * choice(s) drain, plus the attacker's `activePlayer` to restore for the turn pass.
   */
  pendingAttack?: { attackerId: string; target: AttackTarget; activePlayer: PlayerId; stage: 'onDefense' | 'damage' }
  /**
   * A "take the initiative" whose "When you take the initiative" trigger raised a choice (#348):
   * the turn transition (end the phase, or pass to the opponent) is deferred until the choice
   * drains. `true` = taking the initiative also ended the action phase (CR 1.15.5c).
   */
  pendingInitiativeEndsPhase?: boolean
  /**
   * An opponent-interjected choice is pending as part of this player's action (Sabine Wren, #348):
   * `activePlayer` is temporarily the choosing opponent, and this holds the original actor so that
   * once the interjected choice(s) drain, control is restored to them and the turn advances normally.
   * Generic — any effect that makes "an opponent" choose mid-action sets this.
   */
  pendingResumeActive?: PlayerId
  /**
   * Transient "this phase" stat/keyword modifiers (#306/#347), each aimed at a unit.
   * Folded into `effectivePower`/`effectiveHp`/`unitKeywords`; cleared at the start of
   * the regroup phase so a unit defeated during regroup uses its base stats.
   */
  lastingEffects?: LastingEffect[]
  /**
   * Events the engine tracks within a boundary so abilities can query them (#347):
   * which units entered play this phase and which cards were defeated this phase
   * (per controller). Reset whenever the phase changes.
   */
  phaseEvents?: PhaseEvents
}

/**
 * One option of a choose-one/modal ability (#348). A small serialisable effect descriptor,
 * resolved by the engine when the option is picked. New variants extend the `kind` union.
 * `arenaLastingBuff`: grant every unit in `arena` (both players) the given "this phase" buff.
 */
/** Reference to a specific attached upgrade (its host unit + position), for card-select choices (#348). */
export interface UpgradeRef {
  unitId: string
  upgradeIndex: number
  cardId: string
}

/** The current combat's roles, so combat-conditional auras (Grogu, #348) can react to who is
 *  attacking / defending. Threaded through `StatContext` into the aura pass during damage resolution. */
export interface CombatContext {
  attackerInstanceId: string
  defenderInstanceId: string
}

/** A hand card offered for play by an ability — its hand position + card id (#348). */
export interface HandCardRef {
  handIndex: number
  cardId: string
}

/** Parameters for a "play a unit from hand" step (#348): cost delta and whether it enters ready. */
export interface PlayFromHandSpec {
  costDelta: number
  entersReady: boolean
}

/** An upgrade sitting in the resource zone, offered for play (#348) — its position + card id. */
export interface ResourceUpgradeRef {
  resourceIndex: number
  cardId: string
}

/** Parameters for a "play an upgrade from your resources" step (#348). */
export interface PlayResourceUpgradeSpec {
  /** Front pays the upgrade's cost from remaining resources; the deployed back plays it free. */
  payCost: boolean
  /** Eligible target unit instance ids (front: entered this phase; back: any friendly). */
  targetUnits: string[]
}

/** A follow-up "deal N damage to a unit or a base" selection (#348). */
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

/** A "this phase" modifier targeting a single unit (#347). Omitted stats = 0. */
export interface LastingEffect {
  targetInstanceId: string
  power?: number
  hp?: number
  keywords?: KeywordInstance[]
}

/** Per-phase event counters (#347). `enteredPlay` holds instance ids (still-in-play
 *  units), `defeated` holds card ids (so trait conditions like "Imperial" can check). */
export interface PhaseEvents {
  enteredPlay: Record<PlayerId, string[]>
  defeated: Record<PlayerId, string[]>
}

/**
 * A decision the resolver pauses on until its `controller` picks an option or skips.
 * `id` addresses the choice so the controller can resolve several simultaneous ones
 * in an order of their choosing (CR: the active player orders simultaneous triggers).
 * `resumeAtInitiative` marks choices raised at round-start readying (`whenReadies`) —
 * once the queue drains, play resumes with the initiative holder, not `advanceTurn`.
 */
export type PendingChoice =
  | { kind: 'ambush'; id: string; controller: PlayerId; unitId: string }
  | { kind: 'support'; id: string; controller: PlayerId; unitId: string }
  | { kind: 'payOrExhaust'; id: string; controller: PlayerId; unitId: string; cost: number; resumeAtInitiative?: boolean }
  | { kind: 'mayPlayTopFree'; id: string; controller: PlayerId; unitId: string; cardId: string }
  | { kind: 'mayDamageExhaust'; id: string; controller: PlayerId; unitId: string; arena: Arena }
  // Improvised Identity (#343): search the revealed top cards for a ground unit to
  // discard (`revealed` are the top-of-deck ids, pickable by deck index), then a
  // `mayAttack` follows, granting the discarded card's abilities for that attack.
  | { kind: 'search'; id: string; controller: PlayerId; unitId: string; revealed: string[] }
  | { kind: 'mayAttack'; id: string; controller: PlayerId; unitId: string; grantCardId?: string }
  // Optional targeted effects, e.g. from an On Attack ability (#309): `targets` are the
  // eligible unit instance ids; the controller picks one or declines.
  // `rewardIfDefeated`: if the damage defeats the target, give `count` Advantage to `instanceId`
  // (Imposing Scout Walker → its own unit) (#355).
  | { kind: 'mayDamage'; id: string; controller: PlayerId; unitId: string; targets: string[]; amount: number; optional?: boolean; rewardIfDefeated?: { instanceId: string; count: number } }
  // Give `count` of a token to a chosen target (#355). `optional` (default true) offers a decline.
  | { kind: 'mayGiveTokens'; id: string; controller: PlayerId; token: string; count: number; targets: string[]; optional?: boolean }
  | { kind: 'mayAdvantageEach'; id: string; controller: PlayerId; unitId: string; targets: string[] }
  // Vane (#309/#348): defeat a friendly upgrade (chosen from `candidates`, cards or tokens); then the
  // `then` damage-target selection follows. `optional` = the deployed "may" version (a Cancel is
  // offered); the front action is mandatory. Each candidate is the exact upgrade (unit + index).
  | { kind: 'selectUpgradeToDefeat'; id: string; controller: PlayerId; candidates: UpgradeRef[]; optional: boolean; then: DamageTargetSpec }
  // Choose where to deal a fixed amount of damage (#348): a unit (`unitTargets`) or a base
  // (`baseTargets`, by owner). Mandatory. Vane's "deal 2 to a base / the defending unit or a base".
  | { kind: 'selectDamageTarget'; id: string; controller: PlayerId; amount: number; unitTargets: string[]; baseTargets: PlayerId[] }
  // Greef Karga front (#309): on playing a unit, may exhaust the leader to give it an Advantage token.
  // `unitId` is the just-played unit to receive the token.
  | { kind: 'mayExhaustLeaderForAdvantage'; id: string; controller: PlayerId; unitId: string }
  // Optional "this phase" buff (#347), e.g. Baylan's On Attack: pick a unit among `targets`
  // and grant it the given power/HP/keywords for the phase, or decline.
  | { kind: 'mayLastingBuff'; id: string; controller: PlayerId; targets: string[]; power?: number; hp?: number; keywords?: KeywordInstance[] }
  // Ezra front (#347): on a friendly attack ending, may exhaust the leader to give an Advantage
  // token to one of `targets` (a unit other than the attacker), or decline.
  | { kind: 'mayExhaustLeaderGiveAdvantage'; id: string; controller: PlayerId; targets: string[] }
  // Ezra deployed (#347): may give an Advantage token to one of `targets`, or decline (no cost).
  | { kind: 'mayGiveAdvantage'; id: string; controller: PlayerId; targets: string[] }
  // Shin Hati front (#347): on a friendly attack ending, may exhaust the leader to exhaust one of
  // `targets` (a ready unit cheaper than the base damage dealt), or decline.
  | { kind: 'mayExhaustLeaderExhaustUnit'; id: string; controller: PlayerId; targets: string[] }
  // Shin Hati deployed (#347): may exhaust one of `targets`, or decline (no leader-exhaust cost).
  // `markUsed`, when set, marks a once-per-round triggered ability as spent on acceptance.
  | { kind: 'mayExhaustUnit'; id: string; controller: PlayerId; targets: string[]; markUsed?: { instanceId: string; key: string } }
  // Choose-one / modal (#348): pick exactly one of `options` (Sloane). Each option is a small
  // serialisable effect descriptor, resolved by index; mandatory (no decline).
  | { kind: 'chooseOne'; id: string; controller: PlayerId; options: ChooseOption[] }
  // Luke front (#348): may exhaust the (undeployed) leader to heal `amount` from `unitId`, or decline.
  | { kind: 'mayExhaustLeaderHealUnit'; id: string; controller: PlayerId; unitId: string; amount: number }
  // Luke deployed (#348): heal `amount` from a chosen unit (`unitTargets`) or base (`baseTargets`). Mandatory.
  | { kind: 'selectHealTarget'; id: string; controller: PlayerId; amount: number; unitTargets: string[]; baseTargets: PlayerId[]; optional?: boolean }
  // Play a unit from hand as part of an ability (#348): pick one of `candidates` (affordable hand
  // units), paying its cost + `costDelta`, entering ready if `entersReady` (Fennec, Moff Gideon).
  | { kind: 'playUnitFromHand'; id: string; controller: PlayerId; candidates: HandCardRef[]; costDelta: number; entersReady: boolean; optional?: boolean }
  // Additional cost "exhaust a friendly unit" (#348): pick one of `targets` to exhaust, then the
  // `then` play-from-hand step follows (Fennec). Mandatory.
  | { kind: 'selectUnitToExhaust'; id: string; controller: PlayerId; targets: string[]; then: PlayFromHandSpec }
  // The Armorer (#348): look at your resources and pick an upgrade to play (by candidate index); the
  // `then` spec carries how it plays. `optional` = the deployed "may" version (a Cancel is offered).
  | { kind: 'selectResourceUpgrade'; id: string; controller: PlayerId; candidates: ResourceUpgradeRef[]; optional: boolean; then: PlayResourceUpgradeSpec }
  // Follow-up: attach the chosen resource upgrade to one of `targets` (#348). Mandatory.
  | { kind: 'attachResourceUpgrade'; id: string; controller: PlayerId; resourceIndex: number; cardId: string; targets: string[]; payCost: boolean }
  // Optionally pay `cost` to draw `draw` cards (#348, Mandalorian). `cost` 0 = a free "may draw".
  // `thenDiscard` (Mos Espa Watermonger, #355): after drawing, discard that many cards from hand —
  // but only if a card was actually drawn ("you may draw a card. If you do, discard a card").
  | { kind: 'mayPayToDraw'; id: string; controller: PlayerId; cost: number; draw: number; thenDiscard?: number }
  // Discard `count` cards from your own hand, one at a time (#355, Mos Espa Watermonger). Mandatory
  // unless `optional`. Resolved by an `acceptChoice` carrying the hand index to discard. `then`
  // (Ninth Sister) runs after the last discard, using the just-discarded card's cost as damage to
  // distribute among any units for the player in `distributeDamageTo`.
  | { kind: 'selectDiscard'; id: string; controller: PlayerId; count: number; optional?: boolean; then?: { distributeDamageTo: PlayerId } }
  // Deal `total` damage spread among any units (#355, Ninth Sister), one point per pick until
  // `remaining` reaches 0. `targets` are the currently-eligible unit instance ids (both sides,
  // recomputed as units are defeated). Always optional — the controller may stop early (a "may").
  | { kind: 'distributeDamage'; id: string; controller: PlayerId; remaining: number; total: number; targets: string[] }
  // Look at `target`'s hand (#355, Imperial Defector / Remnant Lookouts) — the controller sees it
  // revealed. View-only unless `mayDiscard`, when the controller may discard one of the target's
  // cards (an `acceptChoice` with its hand index); `thenDraw` then has the target draw a card.
  | { kind: 'lookAtHand'; id: string; controller: PlayerId; target: PlayerId; mayDiscard?: boolean; thenDraw?: boolean }
  // Search the revealed top cards (#355, Clan Wren Loyalist): pick one of the `eligibleIndices`
  // (indices into `revealed`) to draw; the rest go to the bottom of the deck. Resolved by an
  // `acceptChoice` carrying the `deckIndex` (0-based within `revealed`). Mandatory when eligible.
  | { kind: 'searchDraw'; id: string; controller: PlayerId; revealed: string[]; eligibleIndices: number[] }
  // The Cyborg Mech (#355): deal `undamagedAmount` to a chosen undamaged target, or `damagedAmount`
  // to a damaged one (the amount is decided by the picked unit's damage). Mandatory board-target.
  | { kind: 'variableStrike'; id: string; controller: PlayerId; targets: string[]; undamagedAmount: number; damagedAmount: number }
  // Barriss Offee (#355): heal up to `maxHeal` from a chosen unit and give it that many Advantage
  // tokens (one per damage healed). Optional board-target — only damaged units are eligible.
  | { kind: 'healForAdvantage'; id: string; controller: PlayerId; targets: string[]; maxHeal: number }
  // Name a card (#355, Ryder Azadi) — resolved by an `acceptChoice` carrying `cardName`; the name is
  // recorded on `unitId` (a `namedCard`), forbidding the opponent from playing cards with that name
  // while it's in play. Mandatory.
  | { kind: 'nameCard'; id: string; controller: PlayerId; unitId: string }
  // "You may defeat this unit. If you do, [search]" (#355, Admiral Ackbar) — a yes/no. Accept defeats
  // `unitId` and starts the search-and-play-free (below); skip leaves the unit in play.
  | { kind: 'mayDefeatSelfSearch'; id: string; controller: PlayerId; unitId: string }
  // Search the revealed cards (held out of the deck) and play space units for free while a combined-cost
  // `budget` lasts (#355, Admiral Ackbar). Pick one `eligibleIndices` (indices into `revealed`) at a time
  // via an `acceptChoice`'s `deckIndex`; skip (Done) stops. Leftover revealed cards return to the bottom.
  | { kind: 'searchPlayFree'; id: string; controller: PlayerId; revealed: string[]; eligibleIndices: number[]; budget: number }
  // Optionally deploy your leader via a triggered epic action (#348, Grogu). A yes/no.
  | { kind: 'mayDeployLeader'; id: string; controller: PlayerId }
  // Unique rule (CR): a player controlling two upgrades with the same title defeats one (their
  // choice). `candidates` are the duplicate instances; picking one defeats it. Mandatory.
  | { kind: 'selectUniqueToDefeat'; id: string; controller: PlayerId; cardId: string; candidates: UpgradeRef[] }
  | { kind: 'selectUniqueUnitToDefeat'; id: string; controller: PlayerId; cardId: string; candidates: string[] }
  // Thrawn front (#348): attack with any ready unit; it gains Restore `restore` for that attack
  // (0 when the condition didn't hold). Mandatory — the attack is made on the board.
  | { kind: 'attackWithRestore'; id: string; controller: PlayerId; restore: number }
  // Thrawn deployed (#348): On Attack, may defeat one of `targets` (a non-leader enemy unit), or decline.
  | { kind: 'mayDefeatEnemyUnit'; id: string; controller: PlayerId; targets: string[] }
  // Sabine front (#348): the opponent (`controller`) must give `count` Advantage tokens to one of
  // their units (`targets`). Mandatory when able — an opponent-interjected choice (pendingResumeActive).
  | { kind: 'opponentGivesAdvantage'; id: string; controller: PlayerId; count: number; targets: string[] }
  // Repeatable board-target pick (#355): click eligible `targets` one at a time (each applies `spec`
  // immediately and re-offers), or Done (skipTrigger). Inspiring Veteran (up to N Advantage) / Pre
  // Vizsla (defeat non-leaders within an HP budget, a token each).
  | {
      kind: 'multiPick'; id: string; controller: PlayerId; targets: string[]
      spec: { mode: 'giveAdvantage'; remaining: number } | { mode: 'defeatForToken'; budget: number; token: string }
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

/** Remove the head choice; the queue becomes `undefined` when it empties. */
export function popChoice(state: GameState): GameState {
  const rest = (state.pendingChoices ?? []).slice(1)
  return { ...state, pendingChoices: rest.length > 0 ? rest : undefined }
}

/** Remove a specific choice by id; the queue becomes `undefined` when it empties. */
export function removeChoice(state: GameState, id: string): GameState {
  const rest = (state.pendingChoices ?? []).filter(c => c.id !== id)
  return { ...state, pendingChoices: rest.length > 0 ? rest : undefined }
}

/** Append a choice to the pending queue (order = trigger order; the controller reorders). */
export function pushChoice(state: GameState, choice: PendingChoice): GameState {
  // Guarantee a unique id among pending choices — different triggers on the same played
  // unit (e.g. Support + Greef Karga) would otherwise collide and mislabel each other.
  const existing = state.pendingChoices ?? []
  let id = choice.id
  let n = 1
  while (existing.some(c => c.id === id)) id = `${choice.id}#${n++}`
  return { ...state, pendingChoices: [...existing, id === choice.id ? choice : { ...choice, id }] }
}

// ---------------------------------------------------------------------------
// Lasting effects + phase-event tracking (#306/#347)
// ---------------------------------------------------------------------------

/** Add a "this phase" modifier aimed at a unit. */
export function addLastingEffect(state: GameState, effect: LastingEffect): GameState {
  return { ...state, lastingEffects: [...(state.lastingEffects ?? []), effect] }
}

/** Drop every lasting effect (called at the start of the regroup phase). */
export function clearLastingEffects(state: GameState): GameState {
  return state.lastingEffects ? { ...state, lastingEffects: undefined } : state
}

/** Clear both players' "next unit you play this phase" grants — a phase-boundary reset (#348). */
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
  return { enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] } }
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

/** Note that a unit with card id `cardId` was defeated under `owner` this phase. */
export function recordUnitDefeated(state: GameState, owner: PlayerId, cardId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return { ...state, phaseEvents: { ...events, defeated: { ...events.defeated, [owner]: [...events.defeated[owner], cardId] } } }
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
 *  Cleared when the unit readies at regroup (shared with activated abilities, #343). */
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
