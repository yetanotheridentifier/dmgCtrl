import { describe, it, expect } from 'vitest'
import { registeredCardIds, getCardDefinition } from '../engine/abilities'
import '../engine/cardDefinitions' // side-effect: registers every implemented card
import { IMPLEMENTED_LEADERS, IMPLEMENTED_UPGRADES, IMPLEMENTED_UNITS, IMPLEMENTED_EVENTS, SET_PROGRESS, sumCounts, TOTAL_PROGRESS, UNIT_GROUPS } from '../data/implementedCards'

/** The setup-screen manifest must mirror what's actually registered, or it lies to the player. */
describe('implemented-cards manifest', () => {
  const manifestIds = [...IMPLEMENTED_LEADERS, ...IMPLEMENTED_UPGRADES, ...IMPLEMENTED_UNITS, ...IMPLEMENTED_EVENTS].map(c => c.id)

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

describe('implementation progress', () => {
  const bySet = Object.fromEntries(SET_PROGRESS.map(s => [s.code, s]))

  it('groups sets by legality — in rotation, out of rotation, out of cycle — newest first', () => {
    const codesIn = (group: string) => SET_PROGRESS.filter(s => s.group === group).map(s => s.code)
    expect(codesIn('rotation')).toEqual(['ASH', 'LAW', 'SEC', 'LOF', 'JTL'])
    expect(codesIn('retired')).toEqual(['TWI', 'SHD', 'SOR'])
    expect(codesIn('out-of-cycle')).toEqual(['TS26', 'IBH'])
    // The blocks are contiguous and in that order, so the panel can render them by filtering.
    expect(SET_PROGRESS.map(s => s.group)).toEqual([...Array(5).fill('rotation'), ...Array(3).fill('retired'), 'out-of-cycle', 'out-of-cycle'])
  })

  it('counts IBH by distinct cards, not collector numbers, and neither extra set prints tokens', () => {
    // IBH fills 104 numbered slots but reprints cards (Blizzard Force AT-ST is #70/#89/#103).
    expect(bySet.IBH.total).toEqual({ leaders: 2, bases: 2, units: 35, upgrades: 0, events: 12, tokens: 0 })
    expect(sumCounts(bySet.IBH.total)).toBe(51)
    expect(bySet.TS26.total).toEqual({ leaders: 8, bases: 4, units: 41, upgrades: 8, events: 23, tokens: 0 })
  })

  it('counts ASH by card type', () => {
    const ash = bySet.ASH
    expect(ash.total).toEqual({ leaders: 18, bases: 8, units: 179, upgrades: 25, events: 34, tokens: 4 })
    expect(ash.done.leaders).toBe(18)
    expect(ash.done.bases).toBe(8) // all vanilla
    expect(ash.done.upgrades).toBe(IMPLEMENTED_UPGRADES.length)
    expect(ash.done.events).toBe(IMPLEMENTED_EVENTS.length)
    // Keyword-only units (39) + every registered unit ability.
    expect(ash.done.units).toBe(39 + IMPLEMENTED_UNITS.length)
    expect(ash.done.tokens).toBe(3) // Shield/Advantage/Mandalorian — Experience is printed but ungranted
  })

  it('shows every unstarted set at zero, with a real printed total', () => {
    for (const set of SET_PROGRESS.filter(s => s.code !== 'ASH')) {
      expect(sumCounts(set.done), set.code).toBe(0)
      expect(sumCounts(set.total), set.code).toBeGreaterThan(0)
    }
  })

  it('the headline total sums every set', () => {
    expect(TOTAL_PROGRESS.done).toBe(SET_PROGRESS.reduce((n, s) => n + sumCounts(s.done), 0))
    expect(TOTAL_PROGRESS.total).toBe(SET_PROGRESS.reduce((n, s) => n + sumCounts(s.total), 0))
    expect(TOTAL_PROGRESS.done).toBe(sumCounts(bySet.ASH.done)) // only ASH is built so far
  })

  it('the unit groups list every unit exactly once (179 total)', () => {
    const all = UNIT_GROUPS.flatMap(g => g.units)
    expect(all).toHaveLength(179)
    expect(new Set(all.map(u => u.id)).size).toBe(179) // keyed by id — 13 unit names collide with leaders
  })

  it('a built unit is listed as built, never still "blocked on" something', () => {
    const built = new Set(IMPLEMENTED_UNITS.map(u => u.id))
    for (const g of UNIT_GROUPS.filter(g => g.id !== 'built' && g.id !== 'keyword')) {
      for (const u of g.units) expect(built.has(u.id), `${u.name} is built but still listed under "${g.id}"`).toBe(false)
    }
    // …and the built group is exactly the manifest.
    expect(UNIT_GROUPS.find(g => g.id === 'built')!.units.map(u => u.id).sort()).toEqual([...built].sort())
  })

  it('every unit listed in a group is a real ASH card id', () => {
    for (const u of UNIT_GROUPS.flatMap(g => g.units)) expect(u.id, u.name).toMatch(/^ASH_\d{3}$/)
  })
})
