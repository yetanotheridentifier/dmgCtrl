import { describe, it, expect } from 'vitest'
import { orderUnits } from '../components/boardLayout'
import type { EngineCard, GameState, UnitState } from '../engine/types'

function card(id: string, keywords: EngineCard['keywords']): EngineCard {
  return { id, name: id, type: 'unit', cost: 2, power: 2, hp: 2, aspects: [], traits: [], keywords, unique: false }
}

const state = {
  cards: {
    SENT: card('SENT', [{ name: 'Sentinel' }]),
    PLAIN: card('PLAIN', []),
  },
} as unknown as GameState

const unit = (instanceId: string, cardId: string): UnitState =>
  ({ instanceId, cardId, arena: 'ground', damage: 0, exhausted: false, isLeader: false, upgrades: [] })

const sentinel = unit('s', 'SENT')
const plain = unit('p', 'PLAIN')

describe('orderUnits — Sentinels sit closest to the battlefront', () => {
  it('puts Sentinels first in a top-anchored (player) lane, so they render at the front', () => {
    expect(orderUnits(state, [plain, sentinel], 'top').map(u => u.instanceId)).toEqual(['s', 'p'])
  })

  it('puts Sentinels last in a bottom-anchored (opponent) lane, which renders them at the front', () => {
    expect(orderUnits(state, [sentinel, plain], 'bottom').map(u => u.instanceId)).toEqual(['p', 's'])
  })

  it('preserves relative order among non-Sentinels', () => {
    const a = unit('a', 'PLAIN')
    const b = unit('b', 'PLAIN')
    expect(orderUnits(state, [a, sentinel, b], 'top').map(u => u.instanceId)).toEqual(['s', 'a', 'b'])
  })
})
