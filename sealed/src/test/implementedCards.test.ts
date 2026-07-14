import { describe, it, expect } from 'vitest'
import { registeredCardIds, getCardDefinition } from '../engine/abilities'
import '../engine/cardDefinitions' // side-effect: registers every implemented card
import { IMPLEMENTED_LEADERS, IMPLEMENTED_UPGRADES } from '../data/implementedCards'

/** The setup-screen manifest must mirror what's actually registered, or it lies to the player. */
describe('implemented-cards manifest (#347)', () => {
  const manifestIds = [...IMPLEMENTED_LEADERS, ...IMPLEMENTED_UPGRADES].map(c => c.id)

  it('lists exactly the registered ASH cards — no more, no fewer', () => {
    const registered = registeredCardIds().filter(id => id.startsWith('ASH_')).sort()
    expect(manifestIds.slice().sort()).toEqual(registered)
  })

  it('every manifest entry has a real registered definition', () => {
    for (const id of manifestIds) expect(getCardDefinition(id), id).toBeTruthy()
  })

  it('has no duplicate ids', () => {
    expect(new Set(manifestIds).size).toBe(manifestIds.length)
  })
})
