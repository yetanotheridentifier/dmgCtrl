import { describe, it, expect } from 'vitest'
import { pairedDifference, tCritical95 } from '../bench/paired'
import type { ShardResult } from '../bench/shard'

/**
 * The paired arm-versus-control comparison (#492, phase 1).
 *
 * **This is the unit of evidence in this project, and it had no code.** A win rate on its own inverted
 * a real result: the search tie-break read 51.1% over 2,040 games, which against a theoretical 50% is
 * +1.1 and not significant, and it was abandoned on that reading. Against its own control on the same
 * seeds it is **+2.35 at p < 0.001**, and it shipped.
 *
 * Pairing by seed is what makes it sharp. A shard's seed fixes its decks and shuffles, and deck
 * variance dominates on the coverage pool: the raw per-shard win rates spanned 44.7% to 54.7% while
 * the paired differences had a standard deviation of 1.65 points.
 */

const shard = (seed: number, winRateA: number, over: Partial<ShardResult> = {}): ShardResult =>
  ({ seed, winRateA, completed: 170, dropped: 0, exitCode: 0, commitId: 'abc', ...over })

describe('pairedDifference', () => {
  it('pairs by seed and differences arm minus control', () => {
    const p = pairedDifference([shard(1, 0.6), shard(2, 0.5)], [shard(1, 0.5), shard(2, 0.5)])
    expect(p.n).toBe(2)
    expect(p.perSeed.map(r => r.seed)).toEqual([1, 2])
    // Rates are floats, so 0.6 - 0.5 is 0.09999999999999998: compare within tolerance, never exactly.
    expect(p.perSeed[0].diff).toBeCloseTo(0.1, 10)
    expect(p.perSeed[1].diff).toBeCloseTo(0, 10)
    expect(p.mean).toBeCloseTo(0.05, 10)
  })

  /** A seed present on only one side is not a pair, and silently treating it as one would compare a
   *  shard against nothing. */
  it('ignores a seed missing from either side', () => {
    const p = pairedDifference([shard(1, 0.6), shard(9, 0.9)], [shard(1, 0.5), shard(2, 0.5)])
    expect(p.n).toBe(1)
    expect(p.perSeed[0].seed).toBe(1)
  })

  /** A failed or empty shard contributed no games, so its rate is meaningless and its pair is dropped
   *  rather than counted as a zero. */
  it('drops a pair whose shard failed or played nothing', () => {
    const arm = [shard(1, 0.6), shard(2, 0, { exitCode: 137, completed: 0 }), shard(3, 0.6)]
    const control = [shard(1, 0.5), shard(2, 0.5), shard(3, 0, { completed: 0 })]
    expect(pairedDifference(arm, control).n).toBe(1)
  })

  /**
   * **The published tie-break result, pinned.** Twelve seeds, the arm and control rates exactly as
   * measured, asserting the mean and `t` this project has quoted on #396, #398 and in `ai-model.md`.
   * If the arithmetic ever drifts, the number in the docs becomes wrong and this says so.
   */
  it('reproduces the shipped tie-break comparison', () => {
    const armRates = [0.476, 0.512, 0.524, 0.500, 0.506, 0.494, 0.535, 0.547, 0.541, 0.518, 0.447, 0.529]
    const ctlRates = [0.453, 0.494, 0.471, 0.465, 0.494, 0.482, 0.518, 0.535, 0.518, 0.476, 0.453, 0.488]
    const p = pairedDifference(
      armRates.map((r, i) => shard(9001 + i, r)),
      ctlRates.map((r, i) => shard(9001 + i, r)),
    )
    expect(p.n).toBe(12)
    expect(p.df).toBe(11)
    expect(p.mean * 100).toBeCloseTo(2.35, 1)
    expect(p.sd * 100).toBeCloseTo(1.65, 1)
    expect(p.t).toBeCloseTo(4.94, 1)
    expect(p.significant, 't = 4.94 against a 2.201 critical value').toBe(true)
    // Eleven of twelve shards positive, which is the sign pattern quoted alongside the t.
    expect(p.perSeed.filter(r => r.diff > 0)).toHaveLength(11)
  })

  /**
   * And the counterpart that makes the point: the same arm read against a fixed 50% baseline. The
   * control's own mean is 48.7%, so dropping it costs 1.3 points and the verdict with it.
   */
  it('shows why a fixed 50% baseline loses the result', () => {
    const armRates = [0.476, 0.512, 0.524, 0.500, 0.506, 0.494, 0.535, 0.547, 0.541, 0.518, 0.447, 0.529]
    const p = pairedDifference(
      armRates.map((r, i) => shard(9001 + i, r)),
      armRates.map((_, i) => shard(9001 + i, 0.5)),
    )
    expect(p.mean * 100, 'about +1.1, not +2.35').toBeCloseTo(1.08, 1)
    expect(p.significant, 'and it would have been abandoned').toBe(false)
  })

  /** No variance at all: every shard moved by the same amount. Real, and the `t` is unbounded rather
   *  than a division by zero producing NaN, which would read as "no result". */
  it('handles a difference with no spread', () => {
    const p = pairedDifference([shard(1, 0.6), shard(2, 0.6)], [shard(1, 0.5), shard(2, 0.5)])
    expect(p.sd).toBe(0)
    expect(p.t).toBe(Infinity)
    expect(p.significant).toBe(true)
  })

  it('calls an identical pair a dead heat rather than significant', () => {
    const p = pairedDifference([shard(1, 0.5), shard(2, 0.5)], [shard(1, 0.5), shard(2, 0.5)])
    expect(p.mean).toBe(0)
    expect(p.t).toBe(0)
    expect(p.significant).toBe(false)
  })

  /** Fewer than two pairs has no spread to estimate, so there is no test to run and saying so beats
   *  inventing a `t`. */
  it('refuses to test a single pair', () => {
    const p = pairedDifference([shard(1, 0.6)], [shard(1, 0.5)])
    expect(p.n).toBe(1)
    expect(p.t).toBeNull()
    expect(p.significant).toBe(false)
  })
})

/**
 * Two-sided 5% critical values, from a table rather than an incomplete beta function.
 *
 * A table is exact at the values that matter and cannot be subtly wrong the way a hand-rolled
 * approximation can. Shard counts here are small (10 and 12 are typical), which is precisely where the
 * t distribution differs most from the normal and where an approximation would flatter a result.
 */
describe('tCritical95', () => {
  it('matches the standard table at the shard counts actually used', () => {
    expect(tCritical95(9)).toBeCloseTo(2.262, 3)   // ten shards
    expect(tCritical95(11)).toBeCloseTo(2.201, 3)  // twelve shards
    expect(tCritical95(1)).toBeCloseTo(12.706, 3)
  })

  /** Small samples must be penalised, never flattered: the value falls monotonically toward 1.96. */
  it('falls monotonically toward the normal value', () => {
    for (let df = 1; df < 40; df++) expect(tCritical95(df)).toBeGreaterThanOrEqual(tCritical95(df + 1))
    expect(tCritical95(200)).toBeCloseTo(1.96, 2)
    expect(tCritical95(1000)).toBeGreaterThanOrEqual(1.96)
  })
})
