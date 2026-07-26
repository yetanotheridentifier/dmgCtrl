import { describe, it, expect } from 'vitest'
import { runAiMatchups } from '../bench/aiMatchups'
import { buildMatchupDecks } from '../bench/matchupDecks'
import { resolveAi } from '../ai/registry'
import '../engine/cardDefinitions'

/**
 * AI versus AI broken down by matchup (#319's acceptance bar, #395's claim).
 *
 * Separate from `runMatchupMatrix` because that one measures DECK strength under a single AI and
 * leans on a symmetry trick ("i vs j also gives j vs i") that is only valid when both seats play
 * identically. With two different AIs every ordered pair is its own experiment.
 */
describe('buildMatchupDecks trimmed to one base per leader', () => {
  const trimmed = buildMatchupDecks(undefined, 1)

  it('gives one deck per leader', () => {
    expect(trimmed).toHaveLength(18)
    expect(new Set(trimmed.map(d => d.leaderName)).size).toBe(18)
  })

  /**
   * The bias this rotation exists to avoid: taking the first base every time handed all 18 decks an
   * Aggression base, and measuring greedy against the frozen baseline on that set read 49.1% where
   * the aspect-spanning set reads 53.9%. A single-aspect sample is not a matchup sample.
   */
  it('spans every base aspect rather than repeating one', () => {
    expect(new Set(trimmed.map(d => d.baseAspect)).size).toBeGreaterThan(1)
  })

  it('leaves the full set unchanged', () => {
    expect(buildMatchupDecks()).toHaveLength(72)
  })
})

describe('runAiMatchups', () => {
  // Two decks, one game a cell: enough to prove the shape without a long run.
  const decks = buildMatchupDecks(undefined, 1).slice(0, 2)
  const report = runAiMatchups(decks, resolveAi('greedy'), resolveAi('random'), 'greedy', 'random', { gamesPerCell: 1, seed: 5 })

  it('plays every ORDERED pair, including each deck against itself', () => {
    expect(report.cells).toHaveLength(4)
    const pairs = report.cells.map(c => `${c.aLabel} | ${c.bLabel}`)
    expect(new Set(pairs).size).toBe(4)
  })

  it('reports an overall rate with a confidence band', () => {
    expect(report.totalGames).toBe(4)
    expect(report.overallWinRateA).toBeGreaterThanOrEqual(0)
    expect(report.overallCi).toBeGreaterThan(0)
  })

  it('sorts worst-first for aiA, so the losing matchups surface', () => {
    const rates = report.cells.map(c => c.winRateA)
    expect(rates).toEqual([...rates].sort((a, b) => a - b))
  })

  it('is deterministic for a given seed', () => {
    const again = runAiMatchups(decks, resolveAi('greedy'), resolveAi('random'), 'greedy', 'random', { gamesPerCell: 1, seed: 5 })
    expect(again).toEqual(report)
  })
}, 60_000)
