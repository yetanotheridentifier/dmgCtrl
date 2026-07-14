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
  | { kind: 'mayDamage'; id: string; controller: PlayerId; unitId: string; targets: string[]; amount: number }
  | { kind: 'mayAdvantageEach'; id: string; controller: PlayerId; unitId: string; targets: string[] }
  // Vane (#309): optionally defeat a friendly upgrade (on the chosen unit) to deal 2 to the enemy base.
  | { kind: 'mayDefeatUpgradeForBase'; id: string; controller: PlayerId; unitId: string; targets: string[] }
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
