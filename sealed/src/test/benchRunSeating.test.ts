import { describe, it, expect } from 'vitest'
import { runBench } from '../bench/runBench'
import { benchDeckSet } from '../bench/decks'
import '../engine/cardDefinitions'

/**
 * The A/B harness must cancel the seat advantage, and must be able to choose its deck population.
 *
 * Two defects found together, both of which made A/B results say less than they appeared to.
 *
 * **Seat advantage.** `runBench` pinned `aiA` to the `player` seat in every game and alternated only
 * who moved first. `seating.ts` was written to fix exactly this ("an AI measured against itself read
 * 49.4% to 50.0% across six seeds rather than 50%") and three other harnesses adopted it; the A/B one
 * never did. Measured here: identical bots read 50.0%, 48.8% and 46.3% across three seed sets,
 * pooling to 48.3% where an unbiased harness gives 50%.
 *
 * **Deck population.** The A/B played one fixed 30-unit mirror deck. Whether a term can be measured
 * at all depends on whether its cards are among those 30, and a term that is absent reports neutral
 * rather than failing. Advantage appears on **0.0%** of decisions there against 20.7% on the coverage
 * decks, and a shielded Sentinel on **0.0%** against ~2%: two terms swept for hours against a
 * population that could not express them.
 */

describe('the A/B harness', () => {
  /**
   * **Identical bots must not favour a seat.** The strongest available check short of a long run:
   * over a few games, `aiA` must occupy each seat equally often, which is what cancels the advantage.
   */
  it('gives each AI each seat equally often', () => {
    const report = runBench({ games: 8, seed: 4242, aiA: 'random', aiB: 'random' })
    expect(report.completed).toBeGreaterThan(0)
    expect(report.seatsSwapped, 'half the games with aiA in the opponent seat').toBe(4)
  })

  /** And it must still read the winner from aiA's point of view once seats swap, or every result
   *  inverts on half the games. */
  it('reads the result from aiA regardless of seat', () => {
    // `greedy` beats `random` decisively, so a harness that lost track of the seat would show a rate
    // near 50% instead of near 100%.
    const report = runBench({ games: 8, seed: 99, aiA: 'greedy', aiB: 'random' })
    expect(report.winRateA).toBeGreaterThan(0.7)
  })

  /** The mirror deck stays the default, so every historical result keeps its meaning. */
  it('defaults to the single mirror deck', () => {
    const mirror = benchDeckSet('mirror', 1)
    expect(mirror.decks).toHaveLength(1)
    expect(mirror.decks[0].cards).toHaveLength(30)
  })

  /**
   * Coverage decks are what make a term measurable when its cards are not among the mirror's 30.
   * Both sides always play the SAME list, so the comparison stays a mirror match.
   */
  it('can play the coverage decks instead', () => {
    const coverage = benchDeckSet('coverage', 1)
    expect(coverage.decks.length).toBeGreaterThan(10)
    const report = runBench({ games: 8, seed: 7, aiA: 'random', aiB: 'random', decks: 'coverage' })
    expect(report.completed).toBeGreaterThan(0)
    expect(report.decks).toBe('coverage')
  })

  /**
   * **Deck and seat must not correlate.** Both cycle, so a naive `i % decks.length` would pin each
   * deck to one seating combination whenever the counts share a factor: 44 decks against a 4-game
   * seating cycle would give every deck the same seat every time. Each deck is played for a whole
   * seating cycle instead.
   */
  it('plays each deck through a whole seating cycle', () => {
    const report = runBench({ games: 8, seed: 11, aiA: 'random', aiB: 'random', decks: 'coverage' })
    expect(report.seatsSwapped, 'still balanced across the deck change').toBe(4)
    expect(report.decksUsed, 'two decks over eight games, four games each').toBe(2)
  })
})
