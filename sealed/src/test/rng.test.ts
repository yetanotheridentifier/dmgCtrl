import { describe, it, expect } from 'vitest'
import { seededShuffle, nextSeed } from '../engine/rng'

describe('seededShuffle', () => {
  const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

  it('is deterministic for a given seed', () => {
    expect(seededShuffle(input, 42)).toEqual(seededShuffle(input, 42))
  })

  it('produces different orders for different seeds', () => {
    const a = seededShuffle(input, 1)
    const b = seededShuffle(input, 2)
    expect(a).not.toEqual(b)
  })

  it('returns a permutation (same multiset, input untouched)', () => {
    const before = [...input]
    const out = seededShuffle(input, 7)
    expect([...out].sort()).toEqual([...input].sort())
    expect(input).toEqual(before)
  })
})

describe('nextSeed', () => {
  it('advances deterministically and changes the value', () => {
    expect(nextSeed(42)).toBe(nextSeed(42))
    expect(nextSeed(42)).not.toBe(42)
  })
})
