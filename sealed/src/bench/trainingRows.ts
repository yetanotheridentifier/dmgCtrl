import { createHash } from 'node:crypto'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { BuildIdentity } from '../data/gameRecords'
import { EXPORT_FORMAT_VERSION, type ExportedRecord, type GameExport } from '../data/recordExport'
import { withoutCards, type StateWithoutCards } from '../data/replayData'
import type { Action } from '../engine/actions'
import { buildCardDb } from '../engine/cardDb'
import { legalMoves } from '../engine/legalMoves'
import { replayStates, withCardDb } from '../engine/replay'
import type { CardDb, GameState, PlayerId } from '../engine/types'
import { poolFor, SET_CODES } from './setPools'

/**
 * Exported games as training rows: one row per recorded move, made by replaying the game.
 *
 * A row is the position a seat faced, the move it made and how the game ended for it, so the same
 * row serves imitation (state and action) and value learning (state and outcome). One shape rather
 * than two because the state is nearly all of a row's bytes and both uses need it: two files would
 * hold it twice to save a reader from ignoring one field.
 *
 * No features are derived here. The state is the engine's own, without the card database, so
 * whatever a model turns out to need can be computed from it later, by joining the card data back
 * on (`trainingCardDb`) the way this module does.
 *
 * **Every row holds the whole game state, both hands and both decks in draw order included.** That
 * is more than the mover could see. Nothing in the engine projects a state down to one seat's view
 * of it, and this module does not invent one: a row names its `mover` and says `information: 'full'`,
 * and hiding what the mover could not see is the job of whoever derives features from it. The bot's
 * own evaluation draws that line in `ai/evaluate.ts` (see "The two halves of `evaluate`" in
 * ai-model.md).
 */

/** Raised when a reader of older rows would misread newer ones. */
export const ROWS_FORMAT_VERSION = 1

export type Outcome = 'win' | 'loss' | 'draw'

export interface TrainingRow {
  formatVersion: number
  /** Groups a game's rows, and is the same for the same game wherever it was exported (`gameKey`). */
  gameKey: string
  /** Which of the game's moves this is, from zero, and how many there were. */
  moveIndex: number
  moveCount: number
  /** The seat that made the move. */
  mover: PlayerId
  /** Who was sitting there: the person, the bot named by `opponentAi`, or not recorded. */
  decidedBy: 'human' | 'ai' | 'unknown'
  /** How the game ended, from the mover's side. */
  outcome: Outcome
  /** `state` is the whole game state, not what the mover could see. The only value there is. */
  information: 'full'
  /** The record's provenance, as exported. Each is absent when the record never had it. */
  build?: BuildIdentity
  opponentAi?: string
  humanSeat?: PlayerId
  undoCount?: number
  /** The move that was made. */
  action: Action
  /** With `legalMoves`: where `action` is in it, or -1 when the engine's list does not hold it. */
  chosenIndex?: number
  /** Every move the engine offered in this position. Only when asked for (`RowOptions`). */
  legalMoves?: Action[]
  /** The position the move was made in, without its card database. */
  state: StateWithoutCards
}

export interface RowOptions {
  /**
   * Carry each position's legal moves on its row. Off by default: `legalMoves(state)` lists them
   * again from the row's own state, so carrying them trades file size for a reader that needs no
   * engine.
   */
  legalMoves?: boolean
}

/**
 * The card database a record is replayed against: every bundled set fixture, which is what the app
 * ships as its bundled sets. A game is played on the Normal ids of its cards (the app collapses
 * every other printing onto them before the engine sees a deck), and those are the ids the
 * fixtures hold.
 */
export function trainingCardDb(): CardDb {
  return buildCardDb(poolFor(SET_CODES))
}

/**
 * A key for the game itself: a hash of its starting position and its moves, which are what make it
 * the game it is. The export carries no record id, and does not need one for this: the same game
 * exported twice, or from two files, gets the same key, and nothing about when it was exported or
 * what its decks were called changes it.
 */
export function gameKey(record: Pick<ExportedRecord, 'initialState' | 'moves'>): string {
  return createHash('sha256').update(JSON.stringify([record.initialState, record.moves])).digest('hex').slice(0, 16)
}

/** The result from one seat's side. */
export function outcomeFor(winner: PlayerId | 'draw', mover: PlayerId): Outcome {
  if (winner === 'draw') return 'draw'
  return winner === mover ? 'win' : 'loss'
}

const sameAction = (a: Action, b: Action): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Replay a record to every position in it, refusing one that does not end where it says it did.
 *
 * The stored winner is the only thing a record says about its own ending, so it is the check that
 * this build still replays the game as it was played. A record that fails it would give every row
 * the wrong result, and the positions after the point of divergence would never have happened.
 */
function replayedStates(record: ExportedRecord, cards: CardDb): GameState[] {
  const start = withCardDb(record, cards, 'It is in none of the bundled set fixtures, so this build cannot replay the game.')
  let states: GameState[]
  try {
    states = replayStates(start, record.moves)
  } catch (err) {
    throw new Error(`the replay threw: ${(err as Error).message}`, { cause: err })
  }
  // The engine refuses a move made after the game is over, so only the last state can hold a winner.
  const winner = states[states.length - 1].winner
  if (winner === null) throw new Error(`the replay has no winner after its ${record.moves.length} moves, but the record says ${record.winner}`)
  if (winner !== record.winner) {
    const replayed = winner === 'draw' ? 'a draw' : `a win for ${winner}`
    throw new Error(`the game replays to ${replayed}, but the record says ${record.winner}`)
  }
  return states
}

/**
 * One record's rows, in move order. Throws, saying why, for a record this build cannot replay to
 * its stored result: a card no bundled set holds, a move the engine throws on, or an ending that
 * is not the recorded one.
 */
export function rowsForRecord(record: ExportedRecord, cards: CardDb, options: RowOptions = {}): TrainingRow[] {
  const states = replayedStates(record, cards)
  const key = gameKey(record)
  const { build, opponentAi, humanSeat, undoCount, winner } = record
  return record.moves.map((move, i): TrainingRow => {
    const state = states[i]
    const legal = options.legalMoves ? legalMoves(state) : undefined
    return {
      formatVersion: ROWS_FORMAT_VERSION,
      gameKey: key,
      moveIndex: i,
      moveCount: record.moves.length,
      mover: move.by,
      decidedBy: humanSeat === undefined ? 'unknown' : move.by === humanSeat ? 'human' : 'ai',
      outcome: outcomeFor(winner, move.by),
      information: 'full',
      ...(build !== undefined && { build }),
      ...(opponentAi !== undefined && { opponentAi }),
      ...(humanSeat !== undefined && { humanSeat }),
      ...(undoCount !== undefined && { undoCount }),
      action: move.action,
      ...(legal && { chosenIndex: legal.findIndex(a => sameAction(a, move.action)), legalMoves: legal }),
      state: withoutCards(state),
    }
  })
}

export interface ExportRows {
  /** The records that replayed, by their place in the file. */
  games: { index: number; rows: TrainingRow[] }[]
  /** The records that did not, with why. They contribute no rows. */
  rejected: { index: number; reason: string }[]
}

/**
 * Every record of one export file (what `__sealedExportGames()` downloads, parsed). A record that
 * cannot be replayed is set aside with its reason and the rest carry on; a file that is not an
 * export, or is in a format this build does not read, throws.
 */
export function rowsForExport(file: unknown, cards: CardDb, options: RowOptions = {}): ExportRows {
  const candidate = file as Partial<GameExport> | null
  if (!candidate || typeof candidate.formatVersion !== 'number' || !Array.isArray(candidate.records)) {
    throw new Error('not a game export: expected { formatVersion, build, records }')
  }
  if (candidate.formatVersion !== EXPORT_FORMAT_VERSION) {
    throw new Error(`export format version ${candidate.formatVersion}, and this build reads ${EXPORT_FORMAT_VERSION}`)
  }
  const result: ExportRows = { games: [], rejected: [] }
  candidate.records.forEach((record, index) => {
    try {
      result.games.push({ index, rows: rowsForRecord(record, cards, options) })
    } catch (err) {
      result.rejected.push({ index, reason: (err as Error).message })
    }
  })
  return result
}
