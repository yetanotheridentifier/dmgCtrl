import { describe, it, expect } from 'vitest'
import { runGeneralisation } from '../bench/generalisation'

/**
 * The generalisation diagnostic (#408 follow-up): aiA vs aiB across every coverage deck, per-deck win
 * rates for aiA. Structural test only, the actual win rates are the data we go looking at via the
 * CLI, not a pass/fail gate.
 */
describe('runGeneralisation', () => {
  const report = runGeneralisation({ gamesPerDeck: 2, seed: 5, aiA: 'greedy', aiB: 'random' })

  it('reports one result per coverage deck', () => {
    expect(report.decks).toBeGreaterThanOrEqual(18)
    expect(report.perDeck.length).toBe(report.decks)
    expect(report.totalGames).toBe(report.decks * report.gamesPerDeck)
  })

  it('gives a per-deck win rate in [0,1], sorted weakest-first', () => {
    for (const d of report.perDeck) {
      expect(d.winRateA).toBeGreaterThanOrEqual(0)
      expect(d.winRateA).toBeLessThanOrEqual(1)
    }
    for (let i = 1; i < report.perDeck.length; i++) {
      expect(report.perDeck[i].winRateA).toBeGreaterThanOrEqual(report.perDeck[i - 1].winRateA)
    }
  })

  it('is deterministic', () => {
    const again = runGeneralisation({ gamesPerDeck: 2, seed: 5, aiA: 'greedy', aiB: 'random' })
    expect(again.overallWinRateA).toBe(report.overallWinRateA)
    expect(again.perDeck.map(d => d.winRateA)).toEqual(report.perDeck.map(d => d.winRateA))
  })
})
