import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import { buildCardDb } from '../engine/cardDb'
import { nextSeed } from '../engine/rng'
import { COMMIT_ID } from '../buildIdentity'
import type { Ai } from '../ai/types'
import { playGame } from './selfPlay'
import { seating, resultForA, movedFirstForA } from './seating'
import { wilsonInterval, firstPlayerSplit, type FirstPlayerSplit } from './stats'
import type { MatchupDeck } from './matchupDecks'

/**
 * AI versus AI, broken down by matchup (#319, #395).
 *
 * #319's acceptance bar is "beats the plain greedy baseline over a benchmark run, **with
 * per-matchup results recorded**, not just the aggregate", and #395's whole claim is that the right
 * line differs by matchup, so a role-aware bot should move some matchups in each direction while
 * improving overall. Neither existing harness could show that:
 *
 * - `generalisation.ts` plays MIRRORS, passing the same deck to both seats, so it can report per
 *   deck but never "pool X against pool Y".
 * - `matrix.ts` plays ONE AI against itself to measure deck strength, and leans on a symmetry trick
 *   (i vs j also gives j vs i) that is only valid when both seats play identically.
 *
 * That trick is exactly why this is a separate function rather than a flag on `runMatchupMatrix`:
 * with two different AIs, `aiA on deck i vs aiB on deck j` is a genuinely different experiment from
 * the reverse, so every ORDERED pair has to be played. Hence the reduced deck set
 * (`buildMatchupDecks(pool, 1)`), which keeps it to N*N over 18 decks rather than 72.
 *
 * Seats are alternated within each cell so first-player advantage cancels.
 */

const POOL = ashSet as unknown as SwuCard[]

export interface AiMatchupCell {
  /** Deck aiA played. */
  aLabel: string
  /** Deck aiB played. */
  bLabel: string
  games: number
  winsA: number
  winRateA: number
  /** The on-play half: games aiA moved first in, and its wins in them. The rest is the on-draw half. */
  gamesOnPlay: number
  winsOnPlay: number
}

/** One of aiA's decks, across every opponent deck it met. */
export interface AiMatchupDeckRow {
  label: string
  games: number
  winRateA: number
  split: FirstPlayerSplit
}

export interface AiMatchupReport {
  commitId: string
  aiA: string
  aiB: string
  deckCount: number
  gamesPerCell: number
  totalGames: number
  dropped: number
  overallWinRateA: number
  overallCi: number
  /** aiA's win rate on the play and on the draw, over every game in the run. */
  split: FirstPlayerSplit
  /** Every ordered pair, worst-first for aiA, so the matchups it loses come up top. */
  cells: AiMatchupCell[]
  /** aiA's decks, most first-player dependent first. At a few games a cell these are wide. */
  byDeck: AiMatchupDeckRow[]
}

export function runAiMatchups(
  decks: MatchupDeck[],
  aiA: Ai,
  aiB: Ai,
  nameA: string,
  nameB: string,
  config: { gamesPerCell: number; seed: number; stepCeiling?: number; timeoutMs?: number },
): AiMatchupReport {
  const cardDb = buildCardDb(POOL)
  const cells: AiMatchupCell[] = []
  let seed = config.seed
  let dropped = 0
  let totalWins = 0
  let totalGames = 0
  let totalOnPlay = 0
  let totalWinsOnPlay = 0

  for (const deckA of decks) {
    for (const deckB of decks) {
      let winsA = 0
      let completed = 0
      let gamesOnPlay = 0
      let winsOnPlay = 0
      for (let g = 0; g < config.gamesPerCell; g++) {
        seed = nextSeed(seed)
        // Each AI keeps its own deck, but they swap SEATS on an independent cycle from who moves
        // first, so neither advantage settles on one side.
        const seats = seating(g)
        const r = playGame({
          deckPlayer: seats.swapped ? deckB.deck : deckA.deck,
          deckOpponent: seats.swapped ? deckA.deck : deckB.deck,
          cardDb,
          aiPlayer: seats.swapped ? aiB : aiA,
          aiOpponent: seats.swapped ? aiA : aiB,
          seed,
          firstPlayer: seats.firstPlayer,
          stepCeiling: config.stepCeiling,
        })
        if (r.status !== 'completed') { dropped++; continue }
        completed++
        const aFirst = movedFirstForA(seats)
        if (aFirst) gamesOnPlay++
        if (resultForA(r, seats).won) { winsA++; if (aFirst) winsOnPlay++ }
      }
      totalWins += winsA
      totalGames += completed
      totalOnPlay += gamesOnPlay
      totalWinsOnPlay += winsOnPlay
      cells.push({
        aLabel: deckA.label,
        bLabel: deckB.label,
        games: completed,
        winsA,
        winRateA: completed === 0 ? 0 : winsA / completed,
        gamesOnPlay,
        winsOnPlay,
      })
    }
  }

  const overall = wilsonInterval(totalWins, totalGames)
  return {
    commitId: COMMIT_ID,
    aiA: nameA,
    aiB: nameB,
    deckCount: decks.length,
    gamesPerCell: config.gamesPerCell,
    totalGames,
    dropped,
    overallWinRateA: overall.rate,
    overallCi: overall.halfWidth,
    split: firstPlayerSplit(totalWinsOnPlay, totalOnPlay, totalWins - totalWinsOnPlay, totalGames - totalOnPlay),
    cells: cells.slice().sort((x, y) => x.winRateA - y.winRateA),
    byDeck: byDeck(cells),
  }
}

/**
 * aiA's decks, each across every opponent it met, ordered by how much it depends on the opening.
 *
 * A deck's row here is `deckCount` cells, so at the default four games a cell it is 72 games and each
 * half is 36: the ordering is a queue of candidates to re-measure, not a measurement. The overall
 * split above is the number with the sample behind it.
 */
function byDeck(cells: AiMatchupCell[]): AiMatchupDeckRow[] {
  const rows = new Map<string, { games: number; wins: number; gamesOnPlay: number; winsOnPlay: number }>()
  for (const c of cells) {
    const acc = rows.get(c.aLabel) ?? { games: 0, wins: 0, gamesOnPlay: 0, winsOnPlay: 0 }
    acc.games += c.games
    acc.wins += c.winsA
    acc.gamesOnPlay += c.gamesOnPlay
    acc.winsOnPlay += c.winsOnPlay
    rows.set(c.aLabel, acc)
  }
  return [...rows.entries()]
    .map(([label, a]) => ({
      label,
      games: a.games,
      winRateA: a.games === 0 ? 0 : a.wins / a.games,
      split: firstPlayerSplit(a.winsOnPlay, a.gamesOnPlay, a.wins - a.winsOnPlay, a.games - a.gamesOnPlay),
    }))
    .sort((x, y) => (y.split.gap ?? 0) - (x.split.gap ?? 0))
}
