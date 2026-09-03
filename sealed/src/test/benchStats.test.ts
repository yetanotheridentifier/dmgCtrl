import { describe, it, expect } from 'vitest'
import { wilsonInterval, firstPlayerSplit } from '../bench/stats'

/**
 * A win rate is an estimate, and its noise shrinks as more games are played. The bench reports a
 * confidence interval so "is V2 actually better than V1?" has an honest answer (yes only if the
 * intervals do not overlap), and so a large-N "publish" run is visibly tighter than a quick
 * exploratory one. A Wilson interval behaves near 0 and 1 where the naive one misbehaves.
 */
describe('wilsonInterval', () => {
  it('centres a 50/100 result on 0.5 with a sensible half-width', () => {
    const { rate, halfWidth } = wilsonInterval(50, 100)
    expect(rate).toBeCloseTo(0.5, 5)
    expect(halfWidth).toBeGreaterThan(0.08)
    expect(halfWidth).toBeLessThan(0.11)
  })

  it('tightens as the sample grows', () => {
    const small = wilsonInterval(50, 100)
    const large = wilsonInterval(500, 1000)
    expect(large.halfWidth).toBeLessThan(small.halfWidth)
  })

  it('does not blow up on an empty sample', () => {
    const { rate, halfWidth } = wilsonInterval(0, 0)
    expect(rate).toBe(0)
    expect(halfWidth).toBe(0)
  })

  it('stays within [0,1] at the extremes', () => {
    const perfect = wilsonInterval(20, 20)
    expect(perfect.rate).toBeCloseTo(1, 5)
    expect(perfect.rate - perfect.halfWidth).toBeGreaterThanOrEqual(0)
  })
})

/**
 * A win rate split by who moved first. Each half is half the sample, so both are wider than the
 * overall rate, and the gap between them is wider still: quoting a gap without its band is how a
 * result that shrinks as the sample grows gets believed at the small size.
 */
describe('firstPlayerSplit', () => {
  it('reports each half with its own band', () => {
    const s = firstPlayerSplit(60, 100, 40, 100)
    expect(s.onPlay.rate).toBeCloseTo(0.6, 10)
    expect(s.onDraw.rate).toBeCloseTo(0.4, 10)
    expect(s.gap).toBeCloseTo(0.2, 10)
  })

  /** Half the sample gives a wider band than the whole of it. */
  it('is wider on a half than on the pooled total', () => {
    const s = firstPlayerSplit(60, 100, 40, 100)
    expect(s.onPlay.halfWidth).toBeGreaterThan(wilsonInterval(100, 200).halfWidth)
  })

  /**
   * The gap's band is wider than either half's: it carries both halves' noise. Combining them by
   * square-and-add is Newcombe's hybrid-score method, which is what keeps the band sensible when a
   * half sits near 0 or 1 where a naive one runs outside [0,1].
   */
  it('carries both halves\' noise into the gap', () => {
    const s = firstPlayerSplit(60, 100, 40, 100)
    expect(s.gapCi!).toBeGreaterThan(s.onPlay.halfWidth)
    expect(s.gapCi!).toBeCloseTo(Math.hypot(s.onPlay.halfWidth, s.onDraw.halfWidth), 10)
  })

  it('tightens as the sample grows', () => {
    expect(firstPlayerSplit(600, 1000, 400, 1000).gapCi!).toBeLessThan(firstPlayerSplit(60, 100, 40, 100).gapCi!)
  })

  /**
   * **An empty half has no rate, so it has no gap.** Reporting 0.0% for a half that was never played
   * would read as a measured result rather than as an absent one, and it would drag any average it
   * fed into towards zero.
   */
  it('has no gap when a half was never played', () => {
    const s = firstPlayerSplit(0, 0, 5, 10)
    expect(s.gap).toBeNull()
    expect(s.gapCi).toBeNull()
    expect(s.onDraw.rate).toBeCloseTo(0.5, 10)
  })
})
