import { describe, it, expect } from 'vitest'
import { dealPairs, pairSeed, runMatchupMatrix } from '../bench/matrix'
import { buildMatchupDecks } from '../bench/matchupDecks'
import { greedyAi } from '../ai/greedyAi'
import '../engine/cardDefinitions'

/**
 * Sharding the matchup matrix (#492, phase 4).
 *
 * The matrix is this ticket's justification: 72 decks, 2,628 pairs, and against the deployed model
 * roughly **169 hours serial against about 23 sharded**. It has never been run.
 *
 * **The parent cannot hand a child its pair list**: 2,628 pairs do not fit on a command line. Each
 * child is told only `--shard-index K --shard-count N` and deals itself every Nth pair, which also
 * keeps it independently re-runnable, the property resumption depends on.
 */

describe('dealPairs', () => {
  /**
   * **The partition property.** Every pair exactly once across the shards, no gaps and no duplicates.
   * A gap silently shrinks the matrix; a duplicate double-counts a cell. Both look like a finished run.
   */
  it('partitions the pair set exactly, at every shard count', () => {
    const n = 12
    const serial = dealPairs(n).map(([i, j]) => `${i}:${j}`)
    expect(new Set(serial).size, 'the serial enumeration itself has no duplicates').toBe(serial.length)
    // Counts that divide the deck count, share a factor with it, and are coprime to it: a contiguous
    // split by `i` fails on all three, and a round-robin must not.
    for (const shards of [1, 2, 3, 5, 7, 8, 12, 13, 100]) {
      const dealt = Array.from({ length: shards }, (_, k) => dealPairs(n, k, shards)).flat()
      const keys = dealt.map(([i, j]) => `${i}:${j}`)
      expect(new Set(keys).size, `shards=${shards}: no duplicates`).toBe(keys.length)
      expect(keys.sort()).toEqual([...serial].sort())
    }
  })

  /**
   * **Round-robin, not a contiguous slice.** The loop is `for i, for j >= i`, so splitting by `i`
   * gives shard 0 the 72 pairs of row 0 and the last shard a single pair: one shard would run far
   * longer than the rest and set the wall clock on its own.
   */
  it('balances the shards to within one pair', () => {
    const sizes = Array.from({ length: 7 }, (_, k) => dealPairs(12, k, 7).length)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
  })

  it('gives one shard everything, and asking for more shards than pairs is not an error', () => {
    expect(dealPairs(4, 0, 1)).toEqual(dealPairs(4))
    expect(dealPairs(2, 5, 100)).toEqual([])
  })

  /** Unordered pairs only: the reverse matchup is derived from the same games, never replayed. */
  it('enumerates each unordered pair once, including the mirror', () => {
    expect(dealPairs(3)).toEqual([[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]])
  })
})

/**
 * A pair's games must be reproducible **wherever that pair runs**.
 *
 * The serial loop advanced one shared seed as it went, so a pair's games depended on how many pairs
 * had been played before it. Under sharding that is fatal to comparability: a child running every Nth
 * pair would play different games from the serial run, and no sharded result could ever be checked
 * against a serial one. Deriving the seed from the pair removes the ordering dependency entirely.
 */
describe('pairSeed', () => {
  it('depends on the pair and the base seed, not on iteration order', () => {
    expect(pairSeed(42, 3, 7)).toBe(pairSeed(42, 3, 7))
    expect(pairSeed(42, 3, 7)).not.toBe(pairSeed(42, 7, 3))
    expect(pairSeed(42, 3, 7)).not.toBe(pairSeed(43, 3, 7))
    expect(pairSeed(42, 3, 7)).not.toBe(pairSeed(42, 3, 8))
  })

  it('never returns a degenerate seed', () => {
    for (let i = 0; i < 20; i++) for (let j = i; j < 20; j++) expect(pairSeed(0, i, j)).toBeGreaterThan(0)
  })
})

/**
 * **The golden property, which the pair-seeded derivation is what makes possible.**
 *
 * Concatenating the shards must reproduce the serial matrix cell for cell. Without per-pair seeds
 * there would be nothing to compare against short of running the real matrix for a week, and the
 * fallback would have been asserting the partition alone, which cannot see a seeding bug at all.
 */
describe('a sharded matrix equals a serial one', () => {
  // Deliberately tiny. The property holds at any size, and this file runs inside a parallel suite
  // where an expensive case pushes unrelated marginal tests over their timeouts: at four decks and two
  // games it cost 9.6s and timed out `benchSweep`. Three decks is six pairs, and the shard counts
  // below cover one that divides them and one that does not.
  const decks = buildMatchupDecks().slice(0, 3)
  const config = { gamesPerCell: 1, seed: 99, stepCeiling: 400 }
  const key = (c: { aLabel: string; bLabel: string }): string => `${c.aLabel}|${c.bLabel}`

  it('produces the same cells however the pairs are dealt', () => {
    const serial = runMatchupMatrix(decks, greedyAi, 'greedy', config)
    for (const shards of [2, 4]) {
      const dealt = Array.from({ length: shards }, (_, k) =>
        runMatchupMatrix(decks, greedyAi, 'greedy', { ...config, shardIndex: k, shardCount: shards }))
      const merged = dealt.flatMap(r => r.cells)
      expect(merged, `shards=${shards}: every cell present exactly once`).toHaveLength(serial.cells.length)

      const bySerial = new Map(serial.cells.map(c => [key(c), c]))
      for (const c of merged) {
        expect(bySerial.get(key(c)), `shards=${shards}: ${key(c)} exists in the serial run`).toEqual(c)
      }
      expect(dealt.reduce((n, r) => n + r.dropped, 0)).toBe(serial.dropped)
    }
  }, 120_000)
})
