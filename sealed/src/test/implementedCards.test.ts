import { describe, it, expect } from 'vitest'
import { registeredCardIds, getCardDefinition } from '../engine/abilities'
import '../engine/cardDefinitions' // side-effect: registers every implemented card
import { IMPLEMENTED_LEADERS, IMPLEMENTED_UPGRADES, IMPLEMENTATION_PROGRESS, TOTAL_PROGRESS, UNIT_GROUPS } from '../data/implementedCards'

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

describe('implementation progress (#306)', () => {
  it('counts the whole set plus the tokens', () => {
    const cat = Object.fromEntries(IMPLEMENTATION_PROGRESS.map(c => [c.label, c]))
    // ASH set totals + the 4 built-in tokens.
    expect(cat.Leaders).toMatchObject({ done: 18, total: 18 })
    expect(cat.Upgrades).toMatchObject({ done: 25, total: 25 })
    expect(cat.Bases).toMatchObject({ done: 8, total: 8 })
    expect(cat.Tokens).toMatchObject({ done: 3, total: 3 }) // Shield/Advantage/Mandalorian — Experience deferred
    expect(cat.Units).toMatchObject({ done: 39, total: 179 }) // Group A done (validated); B–F pending
    expect(cat.Events).toMatchObject({ done: 0, total: 34 })
  })

  it('the total is the sum of the categories', () => {
    expect(TOTAL_PROGRESS.done).toBe(18 + 25 + 8 + 3 + 39 + 0) // 93
    expect(TOTAL_PROGRESS.total).toBe(18 + 25 + 8 + 3 + 179 + 34) // 267
  })

  it('the unit groups list every unit exactly once (179 total)', () => {
    const all = UNIT_GROUPS.flatMap(g => g.units)
    expect(all).toHaveLength(179)
    expect(new Set(all).size).toBe(179) // no duplicates across groups
  })
})
