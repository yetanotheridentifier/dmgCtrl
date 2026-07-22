import { describe, it, expect } from 'vitest'
import { runSweep } from '../bench/sweep'

/**
 * The coverage sweep (#408) plays across the whole coverage deck set so every card is exercised, and
 * reports any hang/throw as a dropped game. It is a FUZZER: a dropped game is a finding, not a test
 * failure, so this asserts the sweep ran and covered the pool, never that zero games dropped.
 */
describe('runSweep', () => {
  const report = runSweep({ gamesPerDeck: 1, seed: 5 })

  it('plays one game across every coverage deck', () => {
    expect(report.decks).toBeGreaterThanOrEqual(18)
    expect(report.totalGames).toBe(report.decks * report.gamesPerDeck)
    expect(report.completed + report.dropped).toBe(report.totalGames)
  })

  it('exercises essentially the whole card pool', () => {
    // ASH is 264 cards; the coverage set touches every deck-able card plus every leader.
    expect(report.cardsExercised).toBeGreaterThan(250)
  })

  it('records each failure with a reproducible seed and reason', () => {
    expect(report.failures.length).toBe(report.dropped)
    for (const f of report.failures) {
      expect(typeof f.seed).toBe('number')
      expect(f.reason).toBeTruthy()
    }
  })
})
