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
   * A pending on-play trigger (#334): after an Ambush/Support unit enters play, its
   * controller resolves the optional attack before the turn passes. While set, the
   * only legal moves are the trigger's attack(s) or `skipTrigger`.
   */
  pendingTrigger?: { kind: 'ambush' | 'support'; unitId: string }
}

export function opponentOf(player: PlayerId): PlayerId {
  return player === 'player' ? 'opponent' : 'player'
}
