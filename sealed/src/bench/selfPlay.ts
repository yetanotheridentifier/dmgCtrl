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
export type DropReason = 'nonterminating' | 'stuck' | 'threw'

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
  /**
   * Abort a game that will not terminate. Real games are a few hundred moves; a cycle blows past.
   *
   * **This is the only guard, and a wall-clock one must never be added beside it.** A timeout used to
   * abort a game whose real time ran away, which made a RESULT depend on how busy the machine was:
   * two byte-identical sweep configs measured 0.4964 and 0.4965, one game apart in 8400, because a
   * loaded box dropped a game an idle one finished. Determinism is a stated invariant, and a number
   * that moves with CPU load is not a measurement.
   *
   * A `timeoutMs` option outlived that removal as a deprecated no-op, threaded from the CLI through
   * six modules and read by none of them. It has been deleted: an option that cannot do anything is
   * a question every future reader has to answer again.
   *
   * The cost of clock-independence is that this ceiling is the only bound on a pathological game, so
   * it has to be set low enough to bind in useful time.
   */
  stepCeiling?: number
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
/**
 * How many steps a game may take before it is dropped as non-terminating.
 *
 * **Sized from the evidence store, not guessed.** Across **81,773 completed games** the move count
 * runs median 84, p99 154, p99.99 223, and the longest ever recorded is **259**. So this is roughly
 * four times the longest game the project has ever played, and twelve times a typical one.
 *
 * It was 50,000, which is 193x that longest game. Nothing was ever dropped for hitting it: of 81,780
 * stored games the seven drops are all `threw`. Tightening it therefore changes the outcome of no
 * game anyone has run, while making the guard able to fire in useful time rather than in hours.
 *
 * **This bounds a game's LENGTH, and cannot bound its DURATION.** A single decision that never
 * returns never completes a step, so the counter simply stops and no ceiling can help: measured on
 * one pathological deck, the shipped bot took 29 ordinary steps and then sat inside decision 30
 * indefinitely. Per-decision cost is bounded inside the search (`nodes`, `chainNodes`), not here.
 *
 * The one shared value: the instrumented corpora used to carry their own copy of 4000 apiece.
 */
export const DEFAULT_STEP_CEILING = 1_000

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
