import { describe, it, expect } from 'vitest'
import { wilsonInterval } from '../bench/stats'

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
