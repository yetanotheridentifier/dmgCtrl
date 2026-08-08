import { describe, it, expect } from 'vitest'
import { poolShards, shardRunKey, pendingSeeds, mergeShardResults, type ShardResult } from '../bench/shard'

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

/**
 * Resuming a long run.
 *
 * The depth-4 A/B is 65 to 75 wall hours. Today a shard dying at hour 60 loses the whole run, and it
 * does so **quietly**: the failure surfaces as a pooled result short of the games requested, which
 * reads exactly like a completed run unless someone checks the count.
 *
 * So each shard's result is written as it finishes, and re-running the same command picks up what is
 * missing. A completed shard is never replayed; a failed one always is.
 */
describe('resuming a sharded run', () => {
  const config = { shards: 4, games: 700, baseSeed: 4910, aiA: 'reply:pessimistic:4x4:200000', aiB: 'beam-reply' }

  it('keys a run by what makes it that run, and nothing else', () => {
    const key = shardRunKey(config)
    expect(shardRunKey({ ...config })).toBe(key)
    expect(shardRunKey({ ...config, baseSeed: 5000 })).not.toBe(key)
    expect(shardRunKey({ ...config, games: 800 })).not.toBe(key)
    expect(shardRunKey({ ...config, aiB: 'beam' })).not.toBe(key)
    // Shard COUNT must not change the key, or adding shards to an interrupted run orphans its results.
    expect(shardRunKey({ ...config, shards: 8 })).toBe(key)
  })

  it('produces a key safe to use as a directory name', () => {
    // AI specs carry colons, which are legal in a name and a nuisance in a path.
    expect(shardRunKey(config)).not.toMatch(/[^A-Za-z0-9._-]/)
  })

  it('runs every seed when nothing has been done', () => {
    expect(pendingSeeds(config, [])).toEqual([4910, 4911, 4912, 4913])
  })

  it('skips a shard that already completed', () => {
    const done = [{ seed: 4911, winRateA: 0.5, completed: 700, dropped: 0, exitCode: 0 }]
    expect(pendingSeeds(config, done)).toEqual([4910, 4912, 4913])
  })

  /** A failed shard is exactly what resuming exists for, so it must never be treated as done. */
  it('re-runs a shard that failed', () => {
    const done = [{ seed: 4911, winRateA: 0, completed: 0, dropped: 0, exitCode: 137 }]
    expect(pendingSeeds(config, done)).toContain(4911)
  })

  /** An OOM kill can leave a shard that exited cleanly but played almost nothing. Completing zero
   *  games is not completing. */
  it('re-runs a shard that finished with no games', () => {
    const done = [{ seed: 4911, winRateA: 0, completed: 0, dropped: 0, exitCode: 0 }]
    expect(pendingSeeds(config, done)).toContain(4911)
  })

  /** Results from a longer previous run must not silently satisfy a shorter one, or the pooled total
   *  would mix two different experiments. */
  it('ignores a result for a seed outside this run', () => {
    const done = [{ seed: 9999, winRateA: 0.5, completed: 700, dropped: 0, exitCode: 0 }]
    expect(pendingSeeds(config, done)).toEqual([4910, 4911, 4912, 4913])
  })

  it('has nothing left to do when every shard completed', () => {
    const done = [4910, 4911, 4912, 4913].map(seed =>
      ({ seed, winRateA: 0.5, completed: 700, dropped: 0, exitCode: 0 }))
    expect(pendingSeeds(config, done)).toEqual([])
  })

  /**
   * **The resumed run must pool EVERY shard, not just the ones it re-ran.**
   *
   * This is the failure the whole mechanism exists to prevent, turned back on itself: a resumed run
   * that reported only its fresh shards would give a win rate over a fraction of the games, with a
   * plausibly wider interval and no indication anything was missing. Silently wrong beats loudly
   * broken only in the sense that it is worse.
   */
  describe('merging what was resumed with what was already banked', () => {
    const bank = (seed: number): ShardResult =>
      ({ seed, winRateA: 0.5, completed: 700, dropped: 0, exitCode: 0 })

    it('returns every shard of the run, banked and fresh alike', () => {
      const merged = mergeShardResults(config, [bank(4910), bank(4911)], [bank(4912), bank(4913)])
      expect(merged.map(r => r.seed)).toEqual([4910, 4911, 4912, 4913])
    })

    it('prefers the fresh result when a seed was re-run', () => {
      const stale = { ...bank(4912), exitCode: 137, completed: 0 }
      const merged = mergeShardResults(config, [bank(4910), stale], [bank(4912)])
      expect(merged.filter(r => r.seed === 4912)).toHaveLength(1)
      expect(merged.find(r => r.seed === 4912)?.exitCode).toBe(0)
      expect(merged.find(r => r.seed === 4912)?.completed).toBe(700)
    })

    it('drops a banked result for a seed outside this run', () => {
      const merged = mergeShardResults(config, [bank(9999), bank(4910)], [bank(4911)])
      expect(merged.map(r => r.seed)).toEqual([4910, 4911])
    })
  })
})
