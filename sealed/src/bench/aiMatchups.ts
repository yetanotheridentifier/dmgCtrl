import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import { buildCardDb } from '../engine/cardDb'
import { nextSeed } from '../engine/rng'
import { BUILD_TAG } from '../buildTag'
import type { Ai } from '../ai/types'
import { playGame } from './selfPlay'
import { wilsonInterval } from './stats'
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
}

export interface AiMatchupReport {
  buildTag: string
  aiA: string
  aiB: string
  deckCount: number
  gamesPerCell: number
  totalGames: number
  dropped: number
  overallWinRateA: number
  overallCi: number
  /** Every ordered pair, worst-first for aiA, so the matchups it loses come up top. */
  cells: AiMatchupCell[]
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

  for (const deckA of decks) {
    for (const deckB of decks) {
      let winsA = 0
      let completed = 0
      for (let g = 0; g < config.gamesPerCell; g++) {
        seed = nextSeed(seed)
        // aiA always holds the `player` seat and deckA; only who moves first alternates.
        const r = playGame({
          deckPlayer: deckA.deck,
          deckOpponent: deckB.deck,
          cardDb,
          aiPlayer: aiA,
          aiOpponent: aiB,
          seed,
          firstPlayer: g % 2 === 0 ? 'player' : 'opponent',
          stepCeiling: config.stepCeiling,
          timeoutMs: config.timeoutMs,
        })
        if (r.status !== 'completed') { dropped++; continue }
        completed++
        if (r.winner === 'player') winsA++
      }
      totalWins += winsA
      totalGames += completed
      cells.push({
        aLabel: deckA.label,
        bLabel: deckB.label,
        games: completed,
        winsA,
        winRateA: completed === 0 ? 0 : winsA / completed,
      })
    }
  }

  const overall = wilsonInterval(totalWins, totalGames)
  return {
    buildTag: BUILD_TAG,
    aiA: nameA,
    aiB: nameB,
    deckCount: decks.length,
    gamesPerCell: config.gamesPerCell,
    totalGames,
    dropped,
    overallWinRateA: overall.rate,
    overallCi: overall.halfWidth,
    cells: cells.slice().sort((x, y) => x.winRateA - y.winRateA),
  }
}
