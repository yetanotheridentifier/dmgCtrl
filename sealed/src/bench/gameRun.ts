import type { Ai } from '../ai/types'
import type { CardDb } from '../engine/types'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { nextSeed } from '../engine/rng'
import { playGame, type GameResult, type GameWatch } from './selfPlay'
import { resultForA, movedFirstForA, firstPlayerFor, type OutcomeForA, type Seating } from './seating'
import type { DeckMatchup } from './decks'

/**
 * The one game runner: what a run plays, kept apart from what it records.
 *
 * Every game run has the same shape. Two sides, A and B, play a schedule of seeded games, seated by
 * `seating.ts`, and every result is read from side A. The head-to-head, the matchups, the
 * generalisation diagnostic, the matrix and the sweep differ in **which games they schedule** and
 * **what they keep from each one**, never in how a game is played. So the schedule is the run's, the
 * recorders are the run's, and the loop between them is this one.
 *
 * A side is usually an AI. Under the matrix one AI plays both seats and the sides are its two decks,
 * which is why a side carries its own deck rather than taking one from the seat: "A's deck goes where A
 * sits" is the rule that keeps a deck and the AI playing it together when the seats swap.
 *
 * **Which games is the schedule's business.** The head-to-head chains one seed through the run and plays
 * each deck for a whole seating cycle; the matrix derives each pair's seed from the pair and plays only
 * the upper triangle, because one AI on both seats makes "i against j" the same games as "j against i".
 * Those are configurations of a schedule, not separate harnesses, and moving one between modes is a
 * change to a generator, not to a loop.
 *
 * **What to keep is the recorders' business.** The cheap ones (`tallyBy`, below) cost nothing over
 * games already played, so a run can group the same games by deck, leader, cell or turn order without
 * re-running. The expensive instruments are opt-in, and read a game from inside rather than from its
 * result: the decision corpus opens a watch per game (`GameRunOptions.watch`), and the term and lethal
 * corpora are an AI that measures each decision before it makes it. All three play the corpus
 * schedule (`corpusSchedule`) through this loop, without conceding.
 */

/** One game as a run's schedule deals it. */
export interface ScheduledGame<K> {
  seed: number
  seats: Seating
  /** The deck side A plays, whichever seat A takes. */
  deckA: ParsedDeck
  deckB: ParsedDeck
  /** What the run files this game under: a deck, a cell, a pair. The runner never reads it. */
  key: K
}

/** A game the runner has played, as every recorder is handed it. */
export interface FinishedGame<K> extends ScheduledGame<K> {
  /** Position in the schedule, from zero. Dropped games keep their place. */
  index: number
  /**
   * The game, seated as played. A completed game's moves and starting position are on it only while
   * the recorders run: the runner releases them straight after, to bound a long run's memory. A dropped
   * game keeps them, since it is written out as a replayable fixture.
   */
  result: GameResult
  /** The outcome from side A, or null when the game dropped. */
  forA: OutcomeForA | null
}

export type GameRunRecorder<K> = (game: FinishedGame<K>) => void

export interface GameRunOptions {
  aiA: Ai
  aiB: Ai
  cardDb: CardDb
  stepCeiling?: number
  /** See `PlayGameOptions`. The sweep tracks coverage and plays a lethal out. */
  trackCoverage?: boolean
  concede?: boolean
  /** Opens a watch for each game, which sees every step and the final position (`GameWatch`). */
  watch?: () => GameWatch
  /** Called with the running count after every game, dropped ones included, after the recorders. */
  onProgress?: (gamesPlayed: number) => void
}

/**
 * The instrumented corpora's schedule: every deck in turn, `gamesPerDeck` games each.
 *
 * One AI drives both seats and every decision is recorded whoever takes it, so the seats never swap
 * and the first player is the only thing to balance. It is indexed across the whole corpus
 * (`firstPlayerFor`): within a deck, one game per deck would open the same way every time. Each game's
 * seed derives from the run seed and its place, so a deck's games do not depend on the decks before it.
 * The key is the deck's index.
 */
export function* corpusSchedule(decks: DeckMatchup[], gamesPerDeck: number, seed: number): Generator<ScheduledGame<number>> {
  for (let d = 0; d < decks.length; d++) {
    for (let g = 0; g < gamesPerDeck; g++) {
      yield {
        seed: nextSeed(seed + d * 37 + g),
        seats: { swapped: false, firstPlayer: firstPlayerFor(d * gamesPerDeck + g) },
        deckA: decks[d].player,
        deckB: decks[d].opponent,
        key: d,
      }
    }
  }
}

/**
 * A seat-keyed matchup, as the two sides' decks for one game.
 *
 * The head-to-head's deck sources name a list per SEAT (`DeckMatchup`), and under `lockout` the wall
 * stays on the opponent seat whichever AI sits there. This turns that into the per-side decks the runner
 * takes, so the seat keeps its list when the AIs swap.
 */
export function bySeat(m: DeckMatchup, seats: Seating): { deckA: ParsedDeck; deckB: ParsedDeck } {
  return seats.swapped ? { deckA: m.opponent, deckB: m.player } : { deckA: m.player, deckB: m.opponent }
}

/** What every instrumented corpus reports about the games it was read from. */
export interface CorpusGames {
  games: number
  /** Games opened by the `player` seat: half of `games`, and the check that the corpus samples both
   *  openings rather than merely intending to. See `firstPlayerFor`. */
  gamesPlayerFirst: number
  /** Games the engine abandoned (`DropReason`). Their decisions up to the drop are still counted. */
  dropped: number
}

/**
 * An instrumented corpus run: `ai` drives both seats over the corpus schedule, and `watch`, when
 * given, sees each game from inside. No concession, so every game is played out, as the corpora
 * always have been.
 */
export function runCorpus(
  decks: DeckMatchup[],
  config: { gamesPerDeck: number; seed: number; stepCeiling?: number },
  ai: Ai,
  cardDb: CardDb,
  watch?: () => GameWatch,
): CorpusGames {
  const out: CorpusGames = { games: 0, gamesPlayerFirst: 0, dropped: 0 }
  runGames(corpusSchedule(decks, config.gamesPerDeck, config.seed),
    { aiA: ai, aiB: ai, cardDb, stepCeiling: config.stepCeiling, concede: false, watch },
    g => {
      out.games++
      if (g.seats.firstPlayer === 'player') out.gamesPlayerFirst++
      if (g.forA === null) out.dropped++
    })
  return out
}

/** Play every scheduled game, seated, and hand each to every recorder in turn. */
export function runGames<K>(
  schedule: Iterable<ScheduledGame<K>>,
  opts: GameRunOptions,
  ...recorders: Array<GameRunRecorder<K>>
): void {
  let index = 0
  for (const game of schedule) {
    const { seats } = game
    const result = playGame({
      deckPlayer: seats.swapped ? game.deckB : game.deckA,
      deckOpponent: seats.swapped ? game.deckA : game.deckB,
      cardDb: opts.cardDb,
      aiPlayer: seats.swapped ? opts.aiB : opts.aiA,
      aiOpponent: seats.swapped ? opts.aiA : opts.aiB,
      seed: game.seed,
      firstPlayer: seats.firstPlayer,
      stepCeiling: opts.stepCeiling,
      trackCoverage: opts.trackCoverage,
      concede: opts.concede,
      watch: opts.watch?.(),
    })
    const finished: FinishedGame<K> = {
      ...game,
      index,
      result,
      forA: result.status === 'completed' ? resultForA(result, seats) : null,
    }
    for (const record of recorders) record(finished)
    if (result.status === 'completed') {
      result.moves = []
      result.initialState = null
    }
    index++
    opts.onProgress?.(index)
  }
}

/**
 * Side A's tally over some games: the outcome recorder every game run keeps.
 *
 * The first-player halves are always counted, because they cannot be recovered afterwards and cost
 * nothing to keep. Only the on-play half is stored: the on-draw half is the remainder, so the two
 * sub-rates weight-average back to the overall rate by construction.
 */
export interface Tally {
  /** Every game filed here, dropped ones included. */
  games: number
  completed: number
  dropped: number
  wins: number
  draws: number
  /** Side A's base-damage margin, summed over completed games. */
  marginSum: number
  /** Completed games side A moved first in, and its wins and draws in them. */
  gamesOnPlay: number
  winsOnPlay: number
  drawsOnPlay: number
}

export const newTally = (): Tally => ({
  games: 0, completed: 0, dropped: 0, wins: 0, draws: 0, marginSum: 0, gamesOnPlay: 0, winsOnPlay: 0, drawsOnPlay: 0,
})

export function addToTally<K>(t: Tally, g: FinishedGame<K>): void {
  t.games++
  if (g.forA === null) { t.dropped++; return }
  t.completed++
  t.marginSum += g.forA.margin
  const aFirst = movedFirstForA(g.seats)
  if (aFirst) t.gamesOnPlay++
  if (g.forA.won) { t.wins++; if (aFirst) t.winsOnPlay++ }
  if (g.forA.draw) { t.draws++; if (aFirst) t.drawsOnPlay++ }
}

/** Several tallies as one, summed in the order given. */
export function mergeTallies(tallies: Iterable<Tally>): Tally {
  const out = newTally()
  for (const t of tallies) {
    for (const k of Object.keys(out) as Array<keyof Tally>) out[k] += t[k]
  }
  return out
}

/**
 * The same games read from side B.
 *
 * What makes the matrix's triangle sound: with one AI on both seats, deck j against deck i is the games
 * already played as i against j. B wins what A neither won nor drew, and B's on-play half is A's
 * on-draw half.
 */
export function reverseTally(t: Tally): Tally {
  const gamesOnPlay = t.completed - t.gamesOnPlay
  const drawsOnPlay = t.draws - t.drawsOnPlay
  return {
    games: t.games,
    completed: t.completed,
    dropped: t.dropped,
    wins: t.completed - t.wins - t.draws,
    draws: t.draws,
    marginSum: -t.marginSum,
    gamesOnPlay,
    winsOnPlay: gamesOnPlay - (t.wins - t.winsOnPlay) - drawsOnPlay,
    drawsOnPlay,
  }
}

/**
 * A recorder that tallies games by a key of the run's choosing, in the order keys first appear.
 * Grouping by deck, cell or pair is one of these; grouping by leader or base merges the per-deck ones.
 */
export function tallyBy<K>(keyOf: (g: FinishedGame<K>) => string): { record: GameRunRecorder<K>; groups: Map<string, Tally> } {
  const groups = new Map<string, Tally>()
  return {
    groups,
    record: g => {
      const key = keyOf(g)
      let t = groups.get(key)
      if (!t) { t = newTally(); groups.set(key, t) }
      addToTally(t, g)
    },
  }
}
