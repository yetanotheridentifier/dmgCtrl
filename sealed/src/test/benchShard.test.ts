import { describe, it, expect } from 'vitest'
import { poolShards } from '../bench/shard'

/**
 * Pooling a sharded A/B (#488, #447).
 *
 * The bench is single-threaded, so a long run is N processes over N seeds, pooled. That is exactly
 * what the existing three-seed results already do by hand; this makes it arithmetic rather than
 * arithmetic-by-hand, because the tempting shortcut is wrong.
 *
 * **Averaging the shards' win rates is only correct when every shard completed the same number of
 * games, and shards drop games.** A dropped game is excluded from its shard's denominator, so an
 * unweighted mean quietly over-weights whichever shard lost the most games. Pooling the counts and
 * recomputing is the honest operation, and it is also the one that gives a confidence interval over
 * the whole run rather than a mean of twelve wide ones.
 */
describe('poolShards', () => {
  it('sums the games rather than averaging the rates', () => {
    const pooled = poolShards([
      { winRateA: 0.6, completed: 100 },
      { winRateA: 0.4, completed: 100 },
    ])
    expect(pooled.completed).toBe(200)
    expect(pooled.wins).toBe(100)
    expect(pooled.winRateA).toBeCloseTo(0.5, 10)
  })

  /** The case an unweighted mean gets wrong: the shards disagree AND differ in size. */
  it('weights a shard by the games it actually completed', () => {
    const pooled = poolShards([
      { winRateA: 1, completed: 900 },
      { winRateA: 0, completed: 100 },
    ])
    // The unweighted mean would say 50%.
    expect(pooled.winRateA).toBeCloseTo(0.9, 10)
    expect(pooled.completed).toBe(1000)
  })

  /** The interval is over the pooled run, which is the whole reason for sharding: twelve narrow-ish
   *  shards are one narrow result, not twelve wide ones. */
  it('gives an interval over the pooled total, tighter than any one shard', () => {
    const shards = Array.from({ length: 12 }, () => ({ winRateA: 0.5, completed: 800 }))
    const pooled = poolShards(shards)
    const single = poolShards([shards[0]])
    expect(pooled.completed).toBe(9600)
    expect(pooled.winCi).toBeLessThan(single.winCi)
    expect(pooled.winCi).toBeLessThan(0.011)
  })

  it('survives a shard that completed nothing', () => {
    const pooled = poolShards([{ winRateA: 0.5, completed: 100 }, { winRateA: 0, completed: 0 }])
    expect(pooled.completed).toBe(100)
    expect(pooled.winRateA).toBeCloseTo(0.5, 10)
  })

  it('reports nothing rather than dividing by zero when every shard failed', () => {
    const pooled = poolShards([{ winRateA: 0, completed: 0 }])
    expect(pooled.completed).toBe(0)
    expect(pooled.winRateA).toBe(0)
  })
})
