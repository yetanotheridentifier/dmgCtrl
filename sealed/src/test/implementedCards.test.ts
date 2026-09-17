import { describe, it, expect } from 'vitest'
import { registeredCardIds, getCardDefinition } from '../engine/abilities'
import '../engine/cardDefinitions' // side-effect: registers every implemented card
import {
  IMPLEMENTED, IMPLEMENTED_LEADERS, IMPLEMENTED_BASES, IMPLEMENTED_UPGRADES, IMPLEMENTED_UNITS, IMPLEMENTED_EVENTS, PLAYABLE_AS_PRINTED,
  SET_PROGRESS, sumCounts, TOTAL_PROGRESS, UNIT_GROUPS, CARD_TYPES, implementedCounts, setOf,
} from '../data/implementedCards'
import type { CardTypeKey, Manifest, TypeCounts } from '../data/implementedCards'
import { REPRINTS } from '../data/reprints'
import { poolFor } from '../bench/setPools'
import { triage } from '../bench/triage'

/** The setup-screen manifest must mirror what's actually registered, or it lies to the player. */
describe('implemented-cards manifest', () => {
  const manifestIds = [...IMPLEMENTED_LEADERS, ...IMPLEMENTED_BASES, ...IMPLEMENTED_UPGRADES, ...IMPLEMENTED_UNITS, ...IMPLEMENTED_EVENTS].map(c => c.id)
  // The registry also holds pseudo cards: abilities one card grants to others, and keywords that need
  // a definition (see docs/abilities.md). They are not cards, so the panel does not count them.
  const isCardId = (id: string) => /^[A-Z0-9]+_\d+$/.test(id)
  const registeredCards = registeredCardIds().filter(isCardId)

  it('lists exactly the registered cards, whatever set they are in', () => {
    expect(manifestIds.slice().sort()).toEqual(registeredCards.sort())
  })

  it('registers nothing else but pseudo cards, so a mistyped card id cannot escape the check above', () => {
    for (const id of registeredCardIds().filter(id => !isCardId(id))) expect(id).toMatch(/^(GRANT|KEYWORD)_[A-Z_]+$/)
  })

  it('every registered card belongs to a set the panel lists', () => {
    const codes = SET_PROGRESS.map(s => s.code)
    for (const id of registeredCards) expect(codes, id).toContain(setOf(id))
  })

  it('every manifest entry has a real registered definition', () => {
    for (const id of manifestIds) expect(getCardDefinition(id), id).toBeTruthy()
  })

  it('has no duplicate ids', () => {
    expect(new Set(manifestIds).size).toBe(manifestIds.length)
  })
})

describe('setOf', () => {
  it('reads the set code off a card id, including a code with a digit in it', () => {
    expect(setOf('ASH_097')).toBe('ASH')
    expect(setOf('TS26_012')).toBe('TS26')
  })
})

describe('implementedCounts', () => {
  const EMPTY: Manifest = { leaders: [], bases: [], units: [], upgrades: [], events: [] }
  const withPlayable = (code: string, over: Partial<TypeCounts>): TypeCounts => ({
    leaders: 0, bases: 0, units: 0, upgrades: 0, events: 0, tokens: 0, ...PLAYABLE_AS_PRINTED[code], ...over,
  })

  it('credits a registered card to the set its id names, and to no other', () => {
    const manifest: Manifest = { ...EMPTY, units: [{ id: 'LAW_100', name: 'A LAW unit' }], events: [{ id: 'SEC_050', name: 'A SEC event' }] }
    expect(implementedCounts('LAW', manifest).units).toBe((PLAYABLE_AS_PRINTED.LAW.units ?? 0) + 1)
    expect(implementedCounts('LAW', manifest).events).toBe(0)
    expect(implementedCounts('SEC', manifest)).toEqual(withPlayable('SEC', { events: 1 }))
    expect(implementedCounts('ASH', manifest)).toEqual(implementedCounts('ASH', EMPTY))
  })

  it('credits a leader only once both of its sides are built', () => {
    const manifest: Manifest = {
      ...EMPTY,
      leaders: [
        { id: 'LAW_001', name: 'Both sides', front: true, back: true },
        { id: 'LAW_002', name: 'Front only', front: true, back: false },
      ],
    }
    expect(implementedCounts('LAW', manifest)).toEqual(withPlayable('LAW', { leaders: 1 }))
  })

  it('credits each set that prints a reprint of a built card, for its own id', () => {
    // Grassroots Resistance is built as ASH_258 and reprinted as SEC_258: one implementation, two ids.
    const reprint = REPRINTS.find(r => r.canonical === 'ASH_258')!
    expect(reprint.printings).toEqual(['SEC_258'])
    const manifest: Manifest = { ...EMPTY, events: [{ id: 'ASH_258', name: 'Grassroots Resistance' }] }
    expect(implementedCounts('ASH', manifest).events).toBe(1)
    expect(implementedCounts('SEC', manifest)).toEqual(withPlayable('SEC', { events: 1 }))
  })

  it('does not credit a reprint whose original is not built', () => {
    expect(implementedCounts('SEC', EMPTY)).toEqual(withPlayable('SEC', {}))
  })
})

/** The ids a set plays as printed, and their counts by type, as the triage tool classifies the set's fixture. */
function playsAsPrinted(code: string): { ids: Set<string>; counts: Partial<TypeCounts> } {
  const TYPE_KEY: Record<string, CardTypeKey> = { Leader: 'leaders', Base: 'bases', Unit: 'units', Upgrade: 'upgrades', Event: 'events' }
  const pool = poolFor([code])
  const blocked = new Set(triage(pool).triaged.map(c => c.id))
  const ids = new Set<string>()
  const counts: Partial<TypeCounts> = {}
  for (const card of pool) {
    const id = `${card.Set}_${card.Number}`
    if (blocked.has(id)) continue
    ids.add(id)
    const key = TYPE_KEY[card.Type]
    counts[key] = (counts[key] ?? 0) + 1
  }
  return { ids, counts }
}

describe('play-as-printed counts', () => {
  const codes = SET_PROGRESS.map(s => s.code)

  it('has an entry for every set and none for a set the panel does not list', () => {
    expect(Object.keys(PLAYABLE_AS_PRINTED).sort()).toEqual(codes.slice().sort())
  })

  // The panel's numbers are recorded, not computed at runtime (that would ship every set's fixture in
  // the app bundle), so this is what stops them drifting from the triage rule.
  it.each(codes)('%s matches the triage of its fixture', code => {
    expect(PLAYABLE_AS_PRINTED[code]).toEqual(playsAsPrinted(code).counts)
  })

  it.each(codes)('%s never counts a built card twice, as built and as playing as printed', code => {
    const { ids } = playsAsPrinted(code)
    const built = [...IMPLEMENTED.leaders, ...IMPLEMENTED.bases, ...IMPLEMENTED.units, ...IMPLEMENTED.upgrades, ...IMPLEMENTED.events].map(c => c.id)
    const credited = [...built, ...REPRINTS.filter(r => built.includes(r.canonical)).flatMap(r => r.printings)]
    for (const id of credited.filter(id => setOf(id) === code)) expect(ids.has(id), id).toBe(false)
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

  it('shows every set the counts of its own registered cards', () => {
    for (const set of SET_PROGRESS) expect(set.done, set.code).toEqual(implementedCounts(set.code, IMPLEMENTED))
  })

  it('counts ASH by card type', () => {
    const ash = bySet.ASH
    expect(ash.total).toEqual({ leaders: 18, bases: 8, units: 179, upgrades: 25, events: 34, tokens: 4 })
    expect(ash.done.leaders).toBe(18)
    expect(ash.done.bases).toBe(8) // all vanilla
    // The manifests hold every set's built cards, so only the ASH ids count here.
    const inAsh = (cards: { id: string }[]) => cards.filter(c => setOf(c.id) === 'ASH').length
    expect(ash.done.upgrades).toBe(inAsh(IMPLEMENTED_UPGRADES))
    expect(ash.done.events).toBe(inAsh(IMPLEMENTED_EVENTS))
    // Keyword-only units + every registered unit ability.
    expect(ash.done.units).toBe(UNIT_GROUPS.find(g => g.id === 'keyword')!.units.length + inAsh(IMPLEMENTED_UNITS))
    expect(ash.done.tokens).toBe(3) // Shield/Advantage/Mandalorian — Experience is printed but ungranted
  })

  it('credits every set with the cards that play as printed, and never more than it prints', () => {
    for (const set of SET_PROGRESS) {
      expect(sumCounts(set.done), set.code).toBeGreaterThan(0) // every set has some vanilla cards
      for (const type of CARD_TYPES) {
        expect(set.done[type], `${set.code} ${type}`).toBeLessThanOrEqual(set.total[type])
      }
    }
  })

  it('the headline total sums every set', () => {
    expect(TOTAL_PROGRESS.done).toBe(SET_PROGRESS.reduce((n, s) => n + sumCounts(s.done), 0))
    expect(TOTAL_PROGRESS.total).toBe(SET_PROGRESS.reduce((n, s) => n + sumCounts(s.total), 0))
    expect(TOTAL_PROGRESS.done).toBeGreaterThan(sumCounts(bySet.ASH.done))
  })

  it('the unit groups list every unit exactly once (179 total)', () => {
    const all = UNIT_GROUPS.flatMap(g => g.units)
    expect(all).toHaveLength(179)
    expect(new Set(all.map(u => u.id)).size).toBe(179) // keyed by id — 13 unit names collide with leaders
  })

  it('a built unit is listed as built, never still "blocked on" something', () => {
    const built = new Set(IMPLEMENTED_UNITS.filter(u => setOf(u.id) === 'ASH').map(u => u.id))
    for (const g of UNIT_GROUPS.filter(g => g.id !== 'built' && g.id !== 'keyword')) {
      for (const u of g.units) expect(built.has(u.id), `${u.name} is built but still listed under "${g.id}"`).toBe(false)
    }
    // …and the built group is exactly the ASH units in the manifest.
    expect(UNIT_GROUPS.find(g => g.id === 'built')!.units.map(u => u.id).sort()).toEqual([...built].sort())
  })

  it('every unit listed in a group is a real ASH card id', () => {
    for (const u of UNIT_GROUPS.flatMap(g => g.units)) expect(u.id, u.name).toMatch(/^ASH_\d{3}$/)
  })
})
