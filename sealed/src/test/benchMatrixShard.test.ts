import { describe, it, expect } from 'vitest'
import {
  dealPairs, pairSeed, runMatchupMatrix,
  matrixShardIds, matrixPayloadUsable, pendingMatrixShards, mergeMatrixParts, matrixResumeRefusal,
  type MatrixResult, type MatchupCell,
} from '../bench/matrix'
import { buildMatchupDecks } from '../bench/matchupDecks'
import { greedyAi } from '../ai/greedyAi'
import { COMMIT_ID } from '../buildIdentity'
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

/**
 * Banking and resuming a sharded matrix (#562).
 *
 * The head-to-head has banked each shard as it lands since #492; the matrix passed no banking callback
 * at all, so a 23-hour run that died at hour 20 cost all 23 and printed "Nothing saved. Re-run the
 * identical command to retry", which replayed every shard from zero. The children's payloads were on
 * disk the whole time and nothing read them back.
 *
 * **The matrix cannot resume the way the head-to-head does.** A head-to-head shard is a seed, so
 * re-running at a larger `--shard` extends the run, and the shard count is deliberately excluded from
 * its run key for exactly that reason. A matrix child instead deals itself every Nth pair from
 * `--shard-count N`, so changing the count changes which pairs each child plays: `matrix-0.out` from a
 * ten-shard run holds a different set of pairs than shard 0 of an eight-shard run, and merging the two
 * would give a matrix with duplicated cells and silent gaps. The count is a resume condition here
 * rather than a free parameter.
 *
 * **And a partial matrix still never reaches the database.** Banking a shard's payload and saving a
 * merged matrix stay separate decisions.
 */

const cell = (a: string, b: string): MatchupCell => ({
  aLabel: a, bLabel: b, leaderA: a, baseA: 'vigilance', leaderB: b, baseB: 'command',
  games: 10, winsA: 5, winRateA: 0.5, avgMargin: 0, gamesOnPlay: 5, winsOnPlay: 3,
})

const part = (cells: MatchupCell[], over: Partial<MatrixResult> = {}): MatrixResult => ({
  commitId: COMMIT_ID, model: 'beam-reply', deckCount: 2, gamesPerCell: 10, seed: 42, dropped: 0,
  cells, ...over,
})

/** What the run's own parameters say a banked payload must match to be reusable. */
const wanted = { commitId: COMMIT_ID, model: 'beam-reply', gamesPerCell: 10, seed: 42, deckCount: 2 }

describe('matrixShardIds', () => {
  /** The id names the log, the payload and the banked result, exactly as `seed-N` does for the
   *  head-to-head, so one progress mechanism serves both modes. */
  it('names one shard per child, indexed as the children are', () => {
    expect(matrixShardIds(3)).toEqual(['matrix-0', 'matrix-1', 'matrix-2'])
  })
})

describe('matrixPayloadUsable', () => {
  it('accepts a payload from this run and this build', () => {
    expect(matrixPayloadUsable(part([cell('a', 'b')]), wanted)).toBe(true)
  })

  /**
   * The same lesson as `pendingSeeds`. Nothing in the run directory's name changes when the code does,
   * so without this a re-run after an evaluation change would find every shard complete, replay the old
   * cells in 0.0s and present them as the new measurement.
   */
  it('rejects a payload produced by different code', () => {
    expect(matrixPayloadUsable(part([cell('a', 'b')], { commitId: 'deadbee' }), wanted)).toBe(false)
  })

  /** Each of these changes what the games were, so a payload carrying a different one is a different
   *  experiment however similar it looks. */
  it('rejects a payload measuring something else', () => {
    expect(matrixPayloadUsable(part([cell('a', 'b')], { gamesPerCell: 4 }), wanted)).toBe(false)
    expect(matrixPayloadUsable(part([cell('a', 'b')], { seed: 43 }), wanted)).toBe(false)
    expect(matrixPayloadUsable(part([cell('a', 'b')], { deckCount: 72 }), wanted)).toBe(false)
    expect(matrixPayloadUsable(part([cell('a', 'b')], { model: 'greedy' }), wanted)).toBe(false)
  })

  /**
   * A child killed mid-write leaves a truncated file, and one killed before its first pair leaves a
   * payload with no cells. Neither is a result, and re-running the shard is the right response to both:
   * treating them as done would shrink the matrix without saying so.
   */
  it('rejects what is not a payload at all', () => {
    expect(matrixPayloadUsable(null, wanted)).toBe(false)
    expect(matrixPayloadUsable('half a json file', wanted)).toBe(false)
    expect(matrixPayloadUsable({ commitId: COMMIT_ID }, wanted)).toBe(false)
    expect(matrixPayloadUsable(part([]), wanted), 'a shard that played nothing has done nothing')
      .toBe(false)
  })
})

describe('pendingMatrixShards', () => {
  it('runs every shard when nothing is on disk', () => {
    expect(pendingMatrixShards(3, new Map())).toEqual(['matrix-0', 'matrix-1', 'matrix-2'])
  })

  /** The acceptance criterion: re-running the identical command replays only what is missing. */
  it('skips the shards already banked', () => {
    expect(pendingMatrixShards(3, new Map([['matrix-1', part([cell('a', 'b')])]])))
      .toEqual(['matrix-0', 'matrix-2'])
  })

  it('has nothing to do when every shard is banked', () => {
    const banked = new Map([0, 1, 2].map(k => [`matrix-${k}`, part([cell('a', 'b')])] as const))
    expect(pendingMatrixShards(3, banked)).toEqual([])
  })
})

describe('mergeMatrixParts', () => {
  const whole = [
    part([cell('a', 'a'), cell('a', 'b'), cell('b', 'a')], { dropped: 1 }),
    part([cell('b', 'b')], { dropped: 2 }),
  ]

  it('merges every part\'s cells and sums what they dropped', () => {
    const merged = mergeMatrixParts(whole, 4)
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.merged.cells).toHaveLength(4)
    expect(merged.merged.dropped).toBe(3)
  })

  /**
   * **This is the check the parent never made.** It merged whatever it was handed and trusted that N
   * shards' cells add up to the whole matrix. That held while every part came from one live spawn; once
   * parts can come from disk it is exactly the assumption a wrong resume breaks.
   */
  it('refuses a merge that is short of the matrix it claims to be', () => {
    const merged = mergeMatrixParts([whole[0]], 4)
    expect(merged.ok).toBe(false)
    if (merged.ok) return
    expect(merged.reason).toMatch(/cells/i)
  })

  /** What resuming at the wrong shard count produces: two children that both played the same pair. */
  it('refuses a merge with a cell in it twice', () => {
    const merged = mergeMatrixParts([whole[0], part([cell('a', 'b'), cell('b', 'b')])], 4)
    expect(merged.ok).toBe(false)
    if (merged.ok) return
    expect(merged.reason).toMatch(/duplicate/i)
  })

  it('refuses to merge nothing at all', () => {
    expect(mergeMatrixParts([], 4).ok).toBe(false)
  })
})

describe('matrixResumeRefusal', () => {
  it('allows a run into a directory nothing has used', () => {
    expect(matrixResumeRefusal(null, 10)).toBeNull()
  })

  it('allows a resume at the shard count the run was started with', () => {
    expect(matrixResumeRefusal({ shards: 10 }, 10)).toBeNull()
  })

  /**
   * Refused rather than silently started fresh. The pairs a child plays are a function of the shard
   * count, so resuming at a different one is not a smaller version of the same run: it is a different
   * partition over the same directory, and the payloads already there belong to neither.
   */
  it('refuses a resume at a different shard count, naming both', () => {
    const refusal = matrixResumeRefusal({ shards: 10 }, 8)
    expect(refusal).not.toBeNull()
    expect(refusal).toContain('10')
    expect(refusal).toContain('8')
  })
})

/**
 * A matrix child reports progress while it runs (#562).
 *
 * Without this its log stays 0 bytes for the whole 23 hours, and `--status` can only say `0 of N`. The
 * count is what the heartbeat turns into a rate and a projection.
 */
describe('runMatchupMatrix progress', () => {
  it('reports games played as it plays them', () => {
    const seen: number[] = []
    const decks = buildMatchupDecks().slice(0, 2)
    const result = runMatchupMatrix(decks, greedyAi, 'greedy', {
      gamesPerCell: 1, seed: 7, stepCeiling: 400, onProgress: n => seen.push(n),
    })
    // Three pairs at one game each: (0,0), (0,1), (1,1).
    expect(seen).toEqual([1, 2, 3])
    expect(result.cells.length).toBeGreaterThan(0)
  }, 120_000)
})
