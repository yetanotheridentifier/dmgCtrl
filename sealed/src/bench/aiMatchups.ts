import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import { buildCardDb } from '../engine/cardDb'
import { nextSeed } from '../engine/rng'
import { COMMIT_ID } from '../buildIdentity'
import type { Ai } from '../ai/types'
import { seating } from './seating'
import { wilsonInterval, firstPlayerSplit, type FirstPlayerSplit } from './stats'
import { runGames, newTally, addToTally, mergeTallies, type ScheduledGame, type Tally } from './gameRun'
import type { MatchupDeck } from './matchupDecks'
import { recordGames, type GameRecorder } from './records'

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
 * All three play through the one game runner (`gameRun.ts`); what differs is the schedule. With two
 * different AIs, `aiA on deck i vs aiB on deck j` is a genuinely different experiment from the
 * reverse, so this schedules every ORDERED pair where the matrix schedules a triangle. Hence the
 * reduced deck set (`buildMatchupDecks(pool, 1)`), which keeps it to N*N over 18 decks rather than 72.
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
  config: {
    gamesPerCell: number
    seed: number
    stepCeiling?: number
    /** Handed each completed game, as `runBench`'s is (`records.ts`). The decks are the `matchup` population. */
    onGame?: GameRecorder
  },
): AiMatchupReport {
  type Cell = [MatchupDeck, MatchupDeck]
  const pairs: Cell[] = decks.flatMap(a => decks.map((b): Cell => [a, b]))

  function* schedule(): Generator<ScheduledGame<Cell>> {
    let seed = config.seed
    for (const pair of pairs) {
      for (let g = 0; g < config.gamesPerCell; g++) {
        seed = nextSeed(seed)
        // Each AI keeps its own deck, but they swap SEATS on an independent cycle from who moves
        // first, so neither advantage settles on one side.
        yield { seed, seats: seating(g), deckA: pair[0].deck, deckB: pair[1].deck, key: pair }
      }
    }
  }

  const byCell = new Map<Cell, Tally>(pairs.map(p => [p, newTally()]))
  runGames(schedule(), { aiA, aiB, cardDb: buildCardDb(POOL), stepCeiling: config.stepCeiling },
    g => addToTally(byCell.get(g.key)!, g),
    ...(config.onGame ? [recordGames<Cell>({ runSeed: config.seed, decks: 'matchup', aiA: nameA, aiB: nameB }, config.onGame)] : []))

  const cells: AiMatchupCell[] = pairs.map(pair => {
    const [deckA, deckB] = pair
    const t = byCell.get(pair)!
    return {
      aLabel: deckA.label,
      bLabel: deckB.label,
      games: t.completed,
      winsA: t.wins,
      winRateA: t.completed === 0 ? 0 : t.wins / t.completed,
      gamesOnPlay: t.gamesOnPlay,
      winsOnPlay: t.winsOnPlay,
    }
  })
  const all = mergeTallies(byCell.values())

  const overall = wilsonInterval(all.wins, all.completed)
  return {
    commitId: COMMIT_ID,
    aiA: nameA,
    aiB: nameB,
    deckCount: decks.length,
    gamesPerCell: config.gamesPerCell,
    totalGames: all.completed,
    dropped: all.dropped,
    overallWinRateA: overall.rate,
    overallCi: overall.halfWidth,
    split: firstPlayerSplit(all.winsOnPlay, all.gamesOnPlay, all.wins - all.winsOnPlay, all.completed - all.gamesOnPlay),
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
