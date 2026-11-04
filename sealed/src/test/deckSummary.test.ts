import { describe, it, expect } from 'vitest'
import jtlSet from './fixtures/jtlSet.json'
import type { SwuCard } from '../data/cards'
import { buildCardDb } from '../engine/cardDb'
import { costCurve, deckAspects, deckEntries, deckGroups, deckSet, typeSummary } from '../components/setup/deckSummary'
import type { ParsedDeck } from '../utils/parseProtectThePod'

/**
 * What the setup screen says about a deck: its card list, grouped and ordered the way a decklist is
 * read, and the summary on the deck card (aspects, set, type counts and cost curve).
 */
const JTL = jtlSet as unknown as SwuCard[]
const CARDS = buildCardDb(JTL)
const idOf = (c: SwuCard) => `${c.Set}_${c.Number}`
const ofType = (type: string) => JTL.filter(c => c.Type === type)
const LEADER = ofType('Leader')[0]
const LAKE_COUNTRY = JTL.find(c => c.Name === 'Lake Country')!
const COLOURED_BASE = ofType('Base').find(b => (b.Aspects ?? []).length > 0)!

const units = ofType('Unit')
const events = ofType('Event')
const deck = (cards: SwuCard[], base = COLOURED_BASE): ParsedDeck => ({
  name: 'Test',
  leader: idOf(LEADER),
  base: idOf(base),
  cards: cards.map((c, i) => ({ id: idOf(c), count: i === 0 ? 2 : 1 })),
})

describe('deckEntries and deckGroups', () => {
  it('orders units, then upgrades, then events, each by cost then name', () => {
    const upgrades = ofType('Upgrade')
    // Given out of order on purpose: events first, and units most expensive first.
    const entries = deckEntries(deck([...events.slice(0, 3), ...upgrades.slice(0, 2), ...units.slice(0, 6).reverse()]), CARDS)
    const groups = deckGroups(entries)

    expect(groups.map(g => g.title)).toEqual(['Units', 'Upgrades', 'Events'])
    for (const group of groups) {
      const keys = group.entries.map(e => [e.cost, e.name] as const)
      const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
      expect(keys).toEqual(sorted)
    }
  })

  it('counts copies per group, and gives a type with no cards no group', () => {
    const groups = deckGroups(deckEntries(deck([...units.slice(0, 3), events[0]]), CARDS))

    expect(groups.map(g => [g.title, g.copies])).toEqual([['Units', 4], ['Events', 1]])
    expect(typeSummary(groups)).toBe('4 units, 1 event')
  })

  it('names a card the lookup does not hold by its id, under Other', () => {
    const entries = deckEntries({ ...deck([units[0]]), cards: [{ id: 'XYZ_999', count: 1 }] }, CARDS)

    expect(deckGroups(entries)).toEqual([{ title: 'Other', copies: 1, entries: [expect.objectContaining({ id: 'XYZ_999', name: 'XYZ_999' })] }])
  })
})

describe('costCurve', () => {
  it('buckets copies by cost, with 1 or less in the first and 7 or more in the last', () => {
    const entries = [0, 1, 2, 2, 5, 7, 9].map((cost, i) => ({ id: `c${i}`, count: 1, name: `c${i}`, cost, type: 'unit' as const }))
    expect(costCurve(entries)).toEqual([2, 2, 0, 0, 1, 0, 2])
  })
})

describe('the deck card summary', () => {
  it('reads the set from the leader', () => {
    expect(deckSet(deck([]))).toBe('JTL')
  })

  it('shows the leader\'s aspects then the base\'s', () => {
    expect(deckAspects(deck([]), CARDS)).toEqual([...(LEADER.Aspects ?? []), ...(COLOURED_BASE.Aspects ?? [])])
  })

  /** Lake Country has no aspect, so a deck on it shows the leader's alone. */
  it('shows only the leader\'s aspects for a deck on Lake Country', () => {
    expect(deckAspects(deck([], LAKE_COUNTRY), CARDS)).toEqual(LEADER.Aspects)
  })
})
