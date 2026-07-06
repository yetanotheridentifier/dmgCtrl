import { describe, it, expect } from 'vitest'
import { readyResourceCount, canAfford, payCost, addResourceFromHand, readyAllResources } from '../engine/resources'
import type { PlayerState } from '../engine/types'

function playerWith(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    leader: { cardId: 'TST_001', deployed: false, epicActionUsed: false, exhausted: false },
    base: { cardId: 'TST_002', damage: 0 },
    hand: ['TST_100', 'TST_101', 'TST_102'],
    deck: [],
    discard: [],
    resources: [
      { cardId: 'TST_200', exhausted: false },
      { cardId: 'TST_201', exhausted: false },
      { cardId: 'TST_202', exhausted: true },
    ],
    units: [],
    ...overrides,
  }
}

describe('readyResourceCount / canAfford', () => {
  it('counts only ready resources', () => {
    expect(readyResourceCount(playerWith())).toBe(2)
  })

  it('canAfford compares cost against ready resources only', () => {
    const p = playerWith()
    expect(canAfford(p, 0)).toBe(true)
    expect(canAfford(p, 2)).toBe(true)
    expect(canAfford(p, 3)).toBe(false)
  })
})

describe('payCost', () => {
  it('exhausts exactly the number of ready resources needed', () => {
    const p = playerWith()
    const paid = payCost(p, 2)
    expect(paid.resources.filter(r => r.exhausted)).toHaveLength(3)
    expect(readyResourceCount(paid)).toBe(0)
  })

  it('leaves other ready resources untouched when cost is partial', () => {
    const p = playerWith()
    const paid = payCost(p, 1)
    expect(readyResourceCount(paid)).toBe(1)
  })

  it('is a no-op for cost 0', () => {
    const p = playerWith()
    expect(payCost(p, 0)).toEqual(p)
  })

  it('throws when the player cannot afford the cost', () => {
    expect(() => payCost(playerWith(), 3)).toThrow(/afford/i)
  })

  it('does not mutate the input state', () => {
    const p = playerWith()
    payCost(p, 2)
    expect(readyResourceCount(p)).toBe(2)
  })
})

describe('addResourceFromHand', () => {
  it('moves the chosen card from hand to resources, entering exhausted', () => {
    const p = playerWith()
    const next = addResourceFromHand(p, 1)
    expect(next.hand).toEqual(['TST_100', 'TST_102'])
    expect(next.resources).toHaveLength(4)
    const added = next.resources[next.resources.length - 1]
    expect(added).toEqual({ cardId: 'TST_101', exhausted: true })
  })

  it('throws for an out-of-range hand index', () => {
    expect(() => addResourceFromHand(playerWith(), 9)).toThrow(/hand index/i)
    expect(() => addResourceFromHand(playerWith(), -1)).toThrow(/hand index/i)
  })

  it('does not mutate the input state', () => {
    const p = playerWith()
    addResourceFromHand(p, 0)
    expect(p.hand).toHaveLength(3)
    expect(p.resources).toHaveLength(3)
  })
})

describe('readyAllResources', () => {
  it('readies every exhausted resource', () => {
    const next = readyAllResources(playerWith())
    expect(next.resources.every(r => !r.exhausted)).toBe(true)
  })

  it('does not mutate the input state', () => {
    const p = playerWith()
    readyAllResources(p)
    expect(p.resources[2].exhausted).toBe(true)
  })
})
