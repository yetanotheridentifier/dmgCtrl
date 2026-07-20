import { describe, it, expect } from 'vitest'
import { tokenLayout } from '../components/tokens'

describe('tokenLayout — physical-token placement on unit cards', () => {
  it('places a single token over the middle of the art when ready (portrait)', () => {
    const pos = tokenLayout(1, 'portrait')
    expect(pos).toHaveLength(1)
    expect(pos[0].left).toBe(50) // horizontally centred
    expect(pos[0].top).toBeGreaterThan(25) // below the top iconography
    expect(pos[0].top).toBeLessThan(60) // above the bottom-third ability text
  })

  it('builds up 1 → row-of-2 → 2-over-1 → 2×2 when ready (portrait)', () => {
    // row of 2: same row, two columns
    const two = tokenLayout(2, 'portrait')
    expect(two[0].top).toEqual(two[1].top)
    expect(two[0].left).not.toEqual(two[1].left)

    // 2 over 1: two on the top row, one lower and centred
    const three = tokenLayout(3, 'portrait')
    expect(three[0].top).toEqual(three[1].top)
    expect(three[2].top).toBeGreaterThan(three[0].top)
    expect(three[2].left).toBe(50)

    // 2×2: two distinct columns, two distinct rows
    const four = tokenLayout(4, 'portrait')
    expect(new Set(four.map(p => p.left)).size).toBe(2)
    expect(new Set(four.map(p => p.top)).size).toBe(2)
  })

  it('lays tokens in a single centred row when exhausted (landscape)', () => {
    const four = tokenLayout(4, 'landscape')
    expect(four).toHaveLength(4)
    expect(new Set(four.map(p => p.top)).size).toBe(1) // one row
    expect(new Set(four.map(p => p.left)).size).toBe(4) // four distinct columns
    // Symmetric about the centre; left→right order.
    expect(four[0].left).toBeLessThan(four[3].left)
    expect((four[0].left + four[3].left) / 2).toBeCloseTo(50)
    // A single token sits over the middle of the art.
    expect(tokenLayout(1, 'landscape')[0].left).toBe(50)
  })

  it('never returns more than four tokens', () => {
    expect(tokenLayout(7, 'portrait')).toHaveLength(4)
    expect(tokenLayout(7, 'landscape')).toHaveLength(4)
  })
})
