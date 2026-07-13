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
  pendingAttack?: { attackerId: string; target: AttackTarget; activePlayer: PlayerId }
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
  return { ...state, pendingChoices: [...(state.pendingChoices ?? []), choice] }
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
