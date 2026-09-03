import { describe, it, expect } from 'vitest'
import { runMatchupMatrix, type MatchupCell } from '../bench/matrix'
import { buildMatchupDecks } from '../bench/matchupDecks'
import { runAiMatchups } from '../bench/aiMatchups'
import { runBench } from '../bench/runBench'
import { poolFirstPlayer } from '../bench/shard'
import { openDb, saveMatrix, deckStrength, firstPlayerAdvantage } from '../bench/store'
import { randomAi } from '../ai/randomAi'
import { resolveAi } from '../ai/registry'
import '../engine/cardDefinitions'

/**
 * Splitting a win rate by who moved first (#507).
 *
 * Three harnesses group results, and the same split has to mean the same thing in all three, so they
 * are tested together rather than one assertion each in `benchMatrix`, `benchAiMatchups` and
 * `benchRunSeating`. The split itself plays no games: it regroups results the harnesses already had
 * and threw away.
 *
 * **The dangerous half is the matrix's derived cell.** `runMatchupMatrix` plays the upper triangle
 * only and derives "j vs i" from the same games, so deck j's ON-PLAY games are exactly deck i's
 * ON-DRAW games. Getting that backwards is silent: it produces a plausible gap of the wrong sign.
 */

const decks = buildMatchupDecks().slice(0, 2)
const find = (cells: MatchupCell[], a: string, b: string): MatchupCell => {
  const c = cells.find(x => x.aLabel === a && x.bLabel === b)
  if (c === undefined) throw new Error(`no cell ${a} vs ${b}`)
  return c
}

describe('the matrix splits every cell by who moved first', () => {
  const result = runMatchupMatrix(decks, randomAi, 'random', { gamesPerCell: 4, seed: 5 })

  /**
   * **The two halves must add back to the number already trusted.** They are stored as "the on-play
   * half plus the total", so the on-draw half is the remainder by construction and cannot drift from
   * `winRateA`. This asserts the construction holds rather than re-deriving it.
   */
  it('adds the halves back to the cell total', () => {
    for (const c of result.cells) {
      expect(c.games, `${c.aLabel} vs ${c.bLabel}: no games dropped`).toBe(4)
      expect(c.gamesOnPlay).toBeGreaterThanOrEqual(0)
      expect(c.gamesOnPlay).toBeLessThanOrEqual(c.games)
      expect(c.winsOnPlay).toBeLessThanOrEqual(c.gamesOnPlay)
      expect(c.winsA - c.winsOnPlay, 'the on-draw half is the remainder').toBeLessThanOrEqual(c.games - c.gamesOnPlay)
    }
  })

  /** Seat and first player cycle independently, so four games give each deck the first move twice. */
  it('balances the halves over a whole seating cycle', () => {
    for (const c of result.cells) expect(c.gamesOnPlay).toBe(2)
  })

  /**
   * **Which half is which, pinned so an inversion cannot pass.** Balanced counts prove nothing here:
   * swapping the two halves leaves 2 and 2 unchanged. Three games is deliberately a partial cycle,
   * where `seating` gives the row deck the first move once and its opponent twice, so the forward and
   * derived cells must disagree in a known direction.
   */
  it('assigns the halves the right way round in the derived cell', () => {
    const odd = runMatchupMatrix(decks, randomAi, 'random', { gamesPerCell: 3, seed: 5 })
    const forward = find(odd.cells, decks[0].label, decks[1].label)
    const derived = find(odd.cells, decks[1].label, decks[0].label)
    expect(forward.games).toBe(3)
    expect(forward.gamesOnPlay, 'deck i moves first in one of three games').toBe(1)
    expect(derived.gamesOnPlay, 'so deck j moves first in the other two').toBe(2)
  })

  /**
   * The two cells are the same games read from opposite sides, so one deck's on-play half is the
   * other's on-draw half: the same games, and every one of them won by one side, the other, or
   * neither.
   */
  it('reads the derived cell from the same games as the forward one', () => {
    const forward = find(result.cells, decks[0].label, decks[1].label)
    const derived = find(result.cells, decks[1].label, decks[0].label)
    expect(derived.games - derived.gamesOnPlay, "deck j's on-draw half is deck i's on-play half").toBe(forward.gamesOnPlay)
    const winsInThatHalf = forward.winsOnPlay + (derived.winsA - derived.winsOnPlay)
    expect(winsInThatHalf, 'no game is won by both, draws are won by neither').toBeLessThanOrEqual(forward.gamesOnPlay)
  })
})

describe('a stored matrix answers the turn-order question', () => {
  const result = runMatchupMatrix(decks, randomAi, 'random', { gamesPerCell: 4, seed: 11 })
  const db = openDb(':memory:')
  const runId = saveMatrix(db, result)

  /**
   * The strength columns use the **same aggregation as the overall rate** (a mean over cells), so with
   * whole seating cycles and no drops the two halves average back to it. Reading them off a different
   * aggregation would let the new columns disagree with the number already trusted.
   */
  it('carries the split into deck strength, averaging back to the overall rate', () => {
    for (const s of deckStrength(db, runId)) {
      expect(s.onPlay).not.toBeNull()
      expect(s.onDraw).not.toBeNull()
      expect((s.onPlay! + s.onDraw!) / 2).toBeCloseTo(s.winRate, 10)
      expect(s.gap).toBeCloseTo(s.onPlay! - s.onDraw!, 10)
      expect(s.gapCi!).toBeGreaterThan(0)
    }
  })

  /**
   * **One on-play observation per game, not two.** A game where deck i moved first is on-play in cell
   * (i,j) and on-draw in cell (j,i), so pooling the on-play halves counts each game once. A mirror
   * pair is the exception rather than a bug: both sides are the same deck, only one cell is emitted,
   * and its `games` split half and half, so it contributes half its games to the pool.
   */
  it('pools each game once as a first-mover observation', () => {
    const games = 4
    // Two decks: pairs (0,0), (0,1), (1,1). The mirrors contribute half their games, the cross pair all.
    const expected = games / 2 + games + games / 2
    const pooled = firstPlayerAdvantage(db, runId)
    expect(pooled.games).toBe(expected)
    expect(pooled.wins).toBeLessThanOrEqual(pooled.games)
    expect(pooled.rate).toBeCloseTo(pooled.wins / pooled.games, 10)
    expect(pooled.halfWidth).toBeGreaterThan(0)
  })
})

describe('AI matchups split aiA by who moved first', () => {
  const trimmed = buildMatchupDecks(undefined, 1).slice(0, 2)
  const report = runAiMatchups(trimmed, resolveAi('greedy'), resolveAi('random'), 'greedy', 'random', { gamesPerCell: 4, seed: 5 })

  it('adds the halves back to the overall rate', () => {
    expect(report.split.onPlay.games + report.split.onDraw.games).toBe(report.totalGames)
    expect(report.split.onPlay.wins + report.split.onDraw.wins).toBe(Math.round(report.overallWinRateA * report.totalGames))
  })

  it('reports each deck aiA played, worst gap first', () => {
    expect(report.byDeck).toHaveLength(2)
    for (const d of report.byDeck) {
      expect(d.split.onPlay.games + d.split.onDraw.games).toBe(d.games)
    }
    const gaps = report.byDeck.map(d => d.split.gap ?? 0)
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a))
  })
}, 60_000)

describe('the head-to-head harness splits by who moved first', () => {
  it('gives aiA the first move in half the games, and counts its wins in each half', () => {
    const report = runBench({ games: 8, seed: 4242, aiA: 'random', aiB: 'random' })
    expect(report.completed).toBe(8)
    expect(report.gamesOnPlay, 'half the games with aiA moving first').toBe(4)
    expect(report.winsOnPlay).toBeLessThanOrEqual(report.gamesOnPlay)
    const winsA = Math.round(report.winRateA * report.completed)
    expect(report.winsOnPlay).toBeLessThanOrEqual(winsA)
    expect(winsA - report.winsOnPlay, 'the on-draw half is the remainder').toBeLessThanOrEqual(report.completed - report.gamesOnPlay)
  })
})

/**
 * Pooling the split across shards, which is where the sample size that makes it readable comes from:
 * a sharded head-to-head is the only path that plays tens of thousands of games.
 *
 * Banked shard results predate these fields (`shard.ts` resumes from results on disk), so a pool that
 * silently treated a missing half as zero would report a first-player rate over a fraction of the
 * games and look like a finished one. Missing anywhere means the pool is refused.
 */
describe('poolFirstPlayer', () => {
  const shard = (gamesOnPlay: number, winsOnPlay: number, completed: number, winRateA: number) =>
    ({ gamesOnPlay, winsOnPlay, completed, winRateA })

  it('sums the halves across shards', () => {
    const pooled = poolFirstPlayer([shard(4, 3, 8, 0.5), shard(4, 1, 8, 0.5)])
    expect(pooled).not.toBeNull()
    expect(pooled!.onPlay.games).toBe(8)
    expect(pooled!.onPlay.wins).toBe(4)
    expect(pooled!.onDraw.games).toBe(8)
    expect(pooled!.onDraw.wins).toBe(4)
    expect(pooled!.gap).toBeCloseTo(0, 10)
  })

  it('refuses to pool when any shard predates the split', () => {
    expect(poolFirstPlayer([shard(4, 3, 8, 0.5), { completed: 8, winRateA: 0.5 }])).toBeNull()
  })

  it('has nothing to report for an empty run', () => {
    expect(poolFirstPlayer([])).toBeNull()
  })
})
