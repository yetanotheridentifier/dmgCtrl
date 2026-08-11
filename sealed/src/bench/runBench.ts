import { COMMIT_ID } from '../buildIdentity'
import { nextSeed } from '../engine/rng'
import { resolveAi } from '../ai/registry'
import { wilsonInterval } from './stats'
import { benchDeckSet, type DeckSource } from './decks'
import { seating, resultForA } from './seating'

/** Games per full seat / first-player cycle. See `seating`. */
const SEATING_CYCLE = 4
import { playGame } from './selfPlay'
import type { DropReason, GameResult } from './selfPlay'

export interface BenchConfig {
  games: number
  seed: number
  /** AI name for the player seat (see the registry). */
  aiA: string
  /** AI name for the opponent seat. */
  aiB: string
  stepCeiling?: number
  timeoutMs?: number
  /**
   * Which deck population to play over. Defaults to `mirror`, the single fixed deck every historical
   * result was measured on. `coverage` is what makes a term measurable when its cards are not among
   * the mirror deck's 30 units. See {@link DeckSource}.
   */
  decks?: DeckSource
}

export interface Failure {
  gameIndex: number
  seed: number
  reason: DropReason
}

export interface BenchReport {
  /** Engine build the run was measured under: every number is only meaningful against this. */
  commitId: string
  aiA: string
  aiB: string
  seed: number
  gamesRequested: number
  completed: number
  dropped: number
  /** True if any game dropped: the aggregate is then provisional, not a clean result. */
  provisional: boolean
  /** Win rate of aiA, over completed games only, read from whichever seat it occupied. */
  winRateA: number
  drawRate: number
  /** Half-width of the 95% confidence band on winRateA: the +/- you can quote. */
  winCi: number
  /** Mean base-damage margin from aiA's view, over completed games. */
  avgMargin: number
  /** Which deck population was played. Results from different sources are not comparable. */
  decks: DeckSource
  /** How many distinct decks the run actually reached. */
  decksUsed: number
  /** The deck this run opened on. Seed-offset, so sharded runs cover different decks rather than all
   *  replaying the same few; also the quickest way to tell two runs apart in a log. */
  firstDeck: string
  /** Games with aiA in the opponent seat. Half the total, and the check that the seat advantage is
   *  actually being cancelled rather than merely intended to be. */
  seatsSwapped: number
  avgRounds: number
  movesPerSec: number
  failures: Failure[]
  games: GameResult[]
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

/**
 * Play N games between two named AIs and aggregate the metrics the tickets ask for. First-player
 * advantage is cancelled by alternating who holds the initiative each game. Everything is seeded
 * from one base seed, so a whole run reproduces exactly. Any dropped game makes the run provisional
 * and its seed is recorded so the failure can be reproduced and filed.
 */
export function runBench(config: BenchConfig): BenchReport {
  const source = config.decks ?? 'mirror'
  const { decks, cardDb } = benchDeckSet(source, config.seed)
  const aiA = resolveAi(config.aiA)
  const aiB = resolveAi(config.aiB)

  const games: GameResult[] = []
  const failures: Failure[] = []
  const wonByA: boolean[] = []
  const marginsForA: number[] = []
  let seed = config.seed
  let seatsSwapped = 0
  // Non-negative, and stable for a given seed so a run stays reproducible.
  const deckOffset = ((config.seed % decks.length) + decks.length) % decks.length

  for (let i = 0; i < config.games; i++) {
    seed = nextSeed(seed)
    // Seat and first player vary on independent cycles, so neither advantage settles on one side.
    // Before this, `aiA` sat in the `player` seat every game and only the first move alternated,
    // which left a bias big enough to read 49.4% for an AI measured against itself.
    const seats = seating(i)
    if (seats.swapped) seatsSwapped++
    // A whole seating cycle per deck. Cycling decks by `i % decks.length` instead would pin each deck
    // to one seat whenever the counts share a factor, and 44 decks against a 4-game cycle does.
    //
    // Offset by the run's seed so shards do not all play the same decks. Without it a sharded screen
    // covers only `games / 4` decks however many shards it runs, because the index depends on the
    // game number alone: ten shards of eight games would play the same two decks ten times over.
    const deck = decks[(deckOffset + Math.floor(i / SEATING_CYCLE)) % decks.length]
    const result = playGame({
      deckPlayer: deck,
      deckOpponent: deck,
      cardDb,
      aiPlayer: seats.swapped ? aiB : aiA,
      aiOpponent: seats.swapped ? aiA : aiB,
      seed,
      firstPlayer: seats.firstPlayer,
      stepCeiling: config.stepCeiling,
      timeoutMs: config.timeoutMs,
    })
    if (result.status === 'completed') {
      const forA = resultForA(result, seats)
      wonByA.push(forA.won)
      marginsForA.push(forA.margin)
    }

    if (result.status === 'dropped') {
      failures.push({ gameIndex: i, seed: result.seed, reason: result.dropReason! })
    } else {
      // Bound memory over a long run: a completed game's moves and starting position are not needed
      // once counted. Only dropped games are kept whole, to be written out as replayable fixtures.
      result.moves = []
      result.initialState = null
    }
    games.push(result)
  }

  const done = games.filter(g => g.status === 'completed')
  const completed = done.length
  // Read from aiA's seat, not from the `player` seat: half the games have them swapped.
  const winsA = wonByA.filter(Boolean).length
  const draws = done.filter(g => g.winner === 'draw').length
  const ci = wilsonInterval(winsA, completed)

  const totalMoves = games.reduce((n, g) => n + g.moveCount, 0)
  const totalMs = games.reduce((ms, g) => ms + g.durationMs, 0)

  return {
    commitId: COMMIT_ID,
    aiA: config.aiA,
    aiB: config.aiB,
    seed: config.seed,
    gamesRequested: config.games,
    completed,
    dropped: games.length - completed,
    provisional: failures.length > 0,
    winRateA: completed === 0 ? 0 : winsA / completed,
    drawRate: completed === 0 ? 0 : draws / completed,
    winCi: ci.halfWidth,
    avgMargin: mean(marginsForA),
    decks: source,
    decksUsed: Math.min(decks.length, Math.max(1, Math.ceil(config.games / SEATING_CYCLE))),
    firstDeck: decks[deckOffset % decks.length].name,
    seatsSwapped,
    avgRounds: mean(done.map(g => g.rounds)),
    movesPerSec: totalMs === 0 ? 0 : totalMoves / (totalMs / 1000),
    failures,
    games,
  }
}
