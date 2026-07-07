import { describe, it, expect } from 'vitest'
import { normaliseCard } from '../engine/cardDb'
import { hasKeyword, keywordValue } from '../engine/keywords'
import { effectivePower, effectiveHp } from '../engine/stats'
import { card, state, unit } from './helpers/engineFixtures'
import type { SwuCard } from '../data/cards'

const BASE_CARD: SwuCard = {
  Set: 'TST',
  Number: '500',
  Name: 'Keyworded Unit',
  Type: 'Unit',
  Arenas: ['Ground'],
  Cost: '3',
  Power: '2',
  HP: '4',
}

describe('normaliseCard — keyword capture', () => {
  it('captures plain keywords from Keywords[]', () => {
    const c = normaliseCard({ ...BASE_CARD, Keywords: ['Sentinel', 'Overwhelm'] })
    expect(c.keywords).toEqual([{ name: 'Sentinel' }, { name: 'Overwhelm' }])
  })

  it('extracts numeric values from the rules text (Raid 2, Restore 1)', () => {
    const c = normaliseCard({
      ...BASE_CARD,
      Keywords: ['Raid', 'Restore'],
      FrontText: 'Raid 2 (…)\nRestore 1 (…)',
    })
    expect(c.keywords).toEqual([
      { name: 'Raid', value: 2 },
      { name: 'Restore', value: 1 },
    ])
  })

  it('defaults to no keywords', () => {
    expect(normaliseCard(BASE_CARD).keywords).toEqual([])
  })
})

describe('keyword helpers', () => {
  const s = state({
    cards: {
      ...state().cards,
      TST_K: card({ id: 'TST_K', type: 'unit', arena: 'ground', power: 2, hp: 4, keywords: [{ name: 'Raid', value: 2 }, { name: 'Sentinel' }] }),
    },
  })

  it('hasKeyword checks a unit card by id', () => {
    expect(hasKeyword(s, 'TST_K', 'Sentinel')).toBe(true)
    expect(hasKeyword(s, 'TST_K', 'Grit')).toBe(false)
  })

  it('keywordValue returns the numeral or 0', () => {
    expect(keywordValue(s, 'TST_K', 'Raid')).toBe(2)
    expect(keywordValue(s, 'TST_K', 'Restore')).toBe(0)
  })
})

describe('effectivePower / effectiveHp', () => {
  function withCard(extra: Parameters<typeof card>[0]) {
    return state({
      cards: { ...state().cards, [extra.id]: card(extra) },
    })
  }

  it('returns printed stats for vanilla units', () => {
    const s = state()
    const u = unit('u1', 'TST_U1') // 3/4
    expect(effectivePower(s, u)).toBe(3)
    expect(effectiveHp(s, u)).toBe(4)
  })

  it('Raid adds power only while attacking', () => {
    const s = withCard({ id: 'TST_K', type: 'unit', arena: 'ground', power: 2, hp: 4, keywords: [{ name: 'Raid', value: 2 }] })
    const u = { ...unit('u1', 'TST_U1'), cardId: 'TST_K' }
    expect(effectivePower(s, u)).toBe(2)
    expect(effectivePower(s, u, { attacking: true })).toBe(4)
  })

  it('Grit adds power equal to the damage on the unit', () => {
    const s = withCard({ id: 'TST_K', type: 'unit', arena: 'ground', power: 2, hp: 5, keywords: [{ name: 'Grit' }] })
    const u = { ...unit('u1', 'TST_U1', { damage: 3 }), cardId: 'TST_K' }
    expect(effectivePower(s, u)).toBe(5)
  })
})

