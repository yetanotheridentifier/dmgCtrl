import { COMMIT_ID } from '../buildIdentity'
import { nextSeed } from '../engine/rng'
import { resolveAi } from '../ai/registry'
import { wilsonInterval } from './stats'
import { benchDeckSet, type DeckSource, type DeckMatchup } from './decks'
import { seating } from './seating'
import type { DropReason, GameResult } from './selfPlay'
import type { GameRecorder } from './records'
import { runGames, bySeat, newTally, addToTally, type ScheduledGame } from './gameRun'

/** Seat and first player cycle on independent axes, so four games cover all four combinations once.
 *  Exported so a pre-flight check can warn about a games-per-shard that leaves a partial cycle. */
export const SEATING_CYCLE = 4

export interface BenchConfig {
  games: number
  seed: number
  /** AI name for the player seat (see the registry). */
  aiA: string
  /** AI name for the opponent seat. */
  aiB: string
  stepCeiling?: number
  /**
   * Which deck population to play over. Defaults to `mirror`, the single fixed deck every historical
   * result was measured on. `coverage` is what makes a term measurable when its cards are not among
   * the mirror deck's 30 units. See {@link DeckSource}.
   */
  decks?: DeckSource
  /**
   * Called with the running count after every game, dropped ones included.
   *
   * A shard is otherwise silent until its last game: an overnight `--games 2000` run left twelve
   * 0-byte logs and reported nothing for eight hours before it was lost. What the count becomes is a
   * heartbeat file; this stays a bare callback so the run layer keeps doing no I/O of its own.
   */
  onProgress?: (gamesPlayed: number) => void
  /**
   * Called with each completed game while its moves and starting position are still on it, which is
   * the only moment they are: the run drops them straight after to bound its memory. A dropped game
   * is not passed, since it is kept whole on the report already.
   *
   * What a recorder does with the game is its own business (`records.ts` writes it to a file); like
   * `onProgress`, this stays a bare callback so the run layer does no I/O of its own. Absent, the run
   * does nothing it did not do before.
   */
  onGame?: GameRecorder
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
  /**
   * Games aiA moved first in, and its wins in them. The on-draw half is the remainder of `completed`
   * and the wins behind `winRateA`, so the two sub-rates weight-average back to it by construction.
   *
   * Both sides play the same deck list here, so this measures the harness and the AI rather than a
   * deck: how much of aiA's rate comes from holding the opening.
   */
  gamesOnPlay: number
  winsOnPlay: number
  avgRounds: number
  movesPerSec: number
  failures: Failure[]
  games: GameResult[]
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

/** A matchup's name: one deck when both seats share it, both when they do not. */
const matchupName = (m: DeckMatchup): string =>
  m.player.name === m.opponent.name ? m.player.name : `${m.player.name} vs ${m.opponent.name}`

/**
 * Play N games between two named AIs and aggregate the metrics the tickets ask for. Seat and
 * first-player advantage are cancelled by `seating`. Everything is seeded from one base seed, so a
 * whole run reproduces exactly. Any dropped game makes the run provisional and its seed is recorded so
 * the failure can be reproduced and filed.
 */
export function runBench(config: BenchConfig): BenchReport {
  const source = config.decks ?? 'mirror'
  const { decks, cardDb } = benchDeckSet(source, config.seed)
  const aiA = resolveAi(config.aiA)
  const aiB = resolveAi(config.aiB)

  // Non-negative, and stable for a given seed so a run stays reproducible.
  const deckOffset = ((config.seed % decks.length) + decks.length) % decks.length

  function* schedule(): Generator<ScheduledGame<DeckMatchup>> {
    let seed = config.seed
    for (let i = 0; i < config.games; i++) {
      seed = nextSeed(seed)
      // Seat and first player vary on independent cycles, so neither advantage settles on one side.
      // Before this, `aiA` sat in the `player` seat every game and only the first move alternated,
      // which left a bias big enough to read 49.4% for an AI measured against itself.
      const seats = seating(i)
      // A whole seating cycle per deck. Cycling decks by `i % decks.length` instead would pin each deck
      // to one seat whenever the counts share a factor, and 44 decks against a 4-game cycle does.
      //
      // Offset by the run's seed so shards do not all play the same decks. Without it a sharded screen
      // covers only `games / 4` decks however many shards it runs, because the index depends on the
      // game number alone: ten shards of eight games would play the same two decks ten times over.
      const deck = decks[(deckOffset + Math.floor(i / SEATING_CYCLE)) % decks.length]
      // The source names a list per seat, so each seat keeps its list when the AIs swap.
      yield { seed, seats, ...bySeat(deck, seats), key: deck }
    }
  }

  const games: GameResult[] = []
  const failures: Failure[] = []
  let seatsSwapped = 0
  // Read from aiA's seat, not from the `player` seat: half the games have them swapped.
  const t = newTally()
  runGames(schedule(), { aiA, aiB, cardDb, stepCeiling: config.stepCeiling, onProgress: config.onProgress },
    g => addToTally(t, g),
    g => {
      const { result, seats } = g
      if (seats.swapped) seatsSwapped++
      // The runner releases a completed game's moves once its recorders have run, so this keeps the
      // finished game rather than the whole one. Only dropped games stay whole, as replayable fixtures.
      games.push(result)
      if (result.status === 'dropped') {
        failures.push({ gameIndex: g.index, seed: result.seed, reason: result.dropReason! })
        return
      }
      // A copy, so what the recorder was handed keeps its moves when the runner lets go of its own.
      config.onGame?.({
        index: g.index,
        runSeed: config.seed,
        decks: source,
        deck: g.key,
        ais: { player: seats.swapped ? config.aiB : config.aiA, opponent: seats.swapped ? config.aiA : config.aiB },
        result: { ...result },
      })
    })

  const { completed, wins: winsA, draws } = t
  const ci = wilsonInterval(winsA, completed)
  const done = games.filter(g => g.status === 'completed')

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
    avgMargin: completed === 0 ? 0 : t.marginSum / completed,
    decks: source,
    decksUsed: Math.min(decks.length, Math.max(1, Math.ceil(config.games / SEATING_CYCLE))),
    // Both halves under an asymmetric source, since "which deck did this run open on" is two decks
    // there and naming only one of them would read as a mirror that it is not.
    firstDeck: matchupName(decks[deckOffset % decks.length]),
    seatsSwapped,
    gamesOnPlay: t.gamesOnPlay,
    winsOnPlay: t.winsOnPlay,
    avgRounds: mean(done.map(g => g.rounds)),
    movesPerSec: totalMs === 0 ? 0 : totalMoves / (totalMs / 1000),
    failures,
    games,
  }
}
