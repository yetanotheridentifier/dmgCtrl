import type { Action } from '../engine/actions'
import type { CardDb, GameState, PlayerId } from '../engine/types'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import type { Ai } from '../ai/types'
import { initGame } from '../engine/initGame'
import { resolve } from '../engine/resolve'
import { seededShuffle, nextSeed } from '../engine/rng'
import { setupAi } from '../ai/setupAi'
import { newCoverage, observeAction, observeState } from './playCoverage'

/** Why a game was abandoned instead of counted. Each is a distinct engine-defect signature. */
export type DropReason = 'nonterminating' | 'timeout' | 'stuck' | 'threw'

export interface MoveRecord {
  by: PlayerId
  action: Action
}

export interface GameResult {
  /** The seed this game was played from: with the deck and AIs, a full reproduction recipe. */
  seed: number
  firstPlayer: PlayerId
  status: 'completed' | 'dropped'
  /** Set only when status is 'dropped'. */
  dropReason: DropReason | null
  winner: PlayerId | 'draw' | null
  rounds: number
  moveCount: number
  baseDamage: Record<PlayerId, number>
  /** Base-damage lead from the player seat's view: damage dealt to the opponent minus damage taken. */
  margin: number
  durationMs: number
  /** The moves played, retained so a dropped game can be replayed. */
  moves: MoveRecord[]
  /**
   * Per-card play coverage, empty unless `trackCoverage` was set. Deck-card ids only: leaders are
   * reported in `leadersDeployed`, since they are in play from the first turn.
   */
  cardsPlayed: string[]
  /** Card ids that reached a hand. A card decked but never drawn appears in neither list. */
  cardsDrawn: string[]
  /** Leader ids that deployed, which is the only way a leader's deployed side runs. */
  leadersDeployed: string[]
  /**
   * The starting position, so a dropped game becomes a replayable fixture ({ initialState, moves }).
   * `runBench` clears it for completed games to bound memory over a long run.
   */
  initialState: GameState | null
}

export interface PlayGameOptions {
  deckPlayer: ParsedDeck
  deckOpponent: ParsedDeck
  cardDb: CardDb
  aiPlayer: Ai
  aiOpponent: Ai
  seed: number
  firstPlayer: PlayerId
  /** Abort a game that will not terminate. Real games are a few hundred moves; a cycle blows past. */
  stepCeiling?: number
  /**
   * Accepted and ignored.
   *
   * This used to abort a game whose wall-clock time ran away, which made a RESULT depend on how busy
   * the machine was: two byte-identical sweep configs measured 0.4964 and 0.4965, one game apart in
   * 8400, because a loaded box dropped a game an idle one finished. Determinism is a stated
   * invariant, and `stepCeiling` already bounds the work deterministically.
   *
   * Kept in the signature so existing callers still compile, and so the reason is documented where
   * someone would otherwise reintroduce it.
   *
   * @deprecated wall-clock time no longer affects the outcome; use `stepCeiling`.
   */
  timeoutMs?: number
  /**
   * Track which cards were drawn and played. Off by default: it costs a set-union per step, and the
   * AI benchmark plays hundreds of thousands of games where the answer is never read. The coverage
   * sweep turns it on.
   */
  trackCoverage?: boolean
}

/**
 * A few hundred moves is a real game, so this is generous by two orders of magnitude and only ever
 * catches a genuine cycle. It is the ONLY guard allowed to decide a game's fate, because it is a
 * function of the seed rather than of the machine.
 */
const DEFAULT_STEP_CEILING = 50_000

/**
 * A seeded shuffle that advances its own seed each call, so both decks (and any later shuffle) draw
 * a distinct but reproducible order from the one game seed.
 */
function makeSeededShuffle(seed: number): <T>(arr: T[]) => T[] {
  let s = seed
  return <T>(arr: T[]): T[] => {
    s = nextSeed(s)
    return seededShuffle(arr, s)
  }
}

/**
 * Play one full game headlessly between two AIs, seeded so it is a pure function of its inputs. The
 * setup heuristic drives both seats (random mulligans/resourcing are game-ruining), then each seat's
 * AI takes over for the action phase, exactly as the app does. A game that hangs, gets stuck or
 * throws is DROPPED with a reason rather than corrupting the run.
 */
export function playGame(opts: PlayGameOptions): GameResult {
  const stepCeiling = opts.stepCeiling ?? DEFAULT_STEP_CEILING
  const shuffle = makeSeededShuffle(opts.seed)

  let state = initGame(opts.deckPlayer, opts.deckOpponent, opts.cardDb, {
    firstPlayer: opts.firstPlayer,
    shuffle,
    rngSeed: opts.seed,
  })
  // `resolve` is immutable, so this reference stays the untouched starting position for replay.
  const initialState = state

  const moves: MoveRecord[] = []
  const start = performance.now()
  let status: GameResult['status'] = 'completed'
  let dropReason: DropReason | null = null
  let steps = 0

  const coverage = opts.trackCoverage ? newCoverage() : null

  try {
    while (state.winner === null) {
      if (steps >= stepCeiling) {
        status = 'dropped'
        dropReason = 'nonterminating'
        break
      }
      if (coverage) observeState(coverage, state)
      const active = state.activePlayer
      const ai = active === 'player' ? opts.aiPlayer : opts.aiOpponent
      const action = setupAi(state) ?? ai(state)
      if (!action) {
        status = 'dropped'
        dropReason = 'stuck'
        break
      }
      // Read the action against the state it was chosen in: a hand index means nothing afterwards.
      if (coverage) observeAction(coverage, state, action)
      moves.push({ by: active, action })
      state = resolve(state, action)
      steps++
    }
  } catch {
    status = 'dropped'
    dropReason = 'threw'
  }

  // The loop observes before acting, so the final position has not been seen yet. A unit played by
  // the winning move would otherwise be missed.
  if (coverage) observeState(coverage, state)

  const baseDamage: Record<PlayerId, number> = {
    player: state.players.player.base.damage,
    opponent: state.players.opponent.base.damage,
  }

  return {
    seed: opts.seed,
    firstPlayer: opts.firstPlayer,
    status,
    dropReason,
    winner: state.winner,
    rounds: state.round,
    moveCount: moves.length,
    baseDamage,
    margin: baseDamage.opponent - baseDamage.player,
    durationMs: performance.now() - start,
    moves,
    initialState,
    cardsPlayed: coverage ? [...coverage.played] : [],
    cardsDrawn: coverage ? [...coverage.drawn] : [],
    leadersDeployed: coverage ? [...coverage.leadersDeployed] : [],
  }
}
