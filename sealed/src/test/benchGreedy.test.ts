import { describe, it, expect } from 'vitest'
import { runBench } from '../bench/runBench'

/**
 * The point of the greedy AI (#391): it must beat `random` decisively. This is a small, seeded
 * regression guard, the decisive numbers come from a large CLI run (`npm run bench`). The threshold
 * is deliberately loose (observed is ~100%); it exists to catch an evaluation change that quietly
 * tanks greedy, not to pin an exact rate.
 */
describe('greedy vs random benchmark', () => {
  it('beats random by a wide margin over a seeded run', () => {
    const report = runBench({ games: 40, seed: 7, aiA: 'greedy', aiB: 'random' })
    expect(report.dropped).toBe(0)
    expect(report.winRateA).toBeGreaterThan(0.75)
  })
})
