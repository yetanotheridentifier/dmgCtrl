import { describe, it, expect } from 'vitest'
import { parseProtectThePod, cardRefFromId } from '../utils/parseProtectThePod'

function deckEntries(cardCount: number, perCard = 2) {
  const entries = []
  const needed = Math.ceil(cardCount / perCard)
  for (let i = 0; i < needed; i++) {
    const remaining = cardCount - i * perCard
    entries.push({
      id: `SOR_${String(100 + i)}`,
      count: Math.min(perCard, remaining),
    })
  }
  return entries
}

function validDeckJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    metadata: { name: 'Vader Aggro' },
    leader: { id: 'SOR_010', count: 1 },
    base: { id: 'SOR_029', count: 1 },
    deck: deckEntries(30),
    ...overrides,
  })
}

describe('cardRefFromId', () => {
  it('splits SET_NUMBER ids', () => {
    expect(cardRefFromId('SOR_083')).toEqual({ set: 'SOR', number: '083' })
    expect(cardRefFromId('JTL_150')).toEqual({ set: 'JTL', number: '150' })
  })

  it('returns null for malformed ids', () => {
    expect(cardRefFromId('SOR083')).toBeNull()
    expect(cardRefFromId('')).toBeNull()
    expect(cardRefFromId('_010')).toBeNull()
  })
})

describe('parseProtectThePod', () => {
  it('parses a valid deck export', () => {
    const result = parseProtectThePod(validDeckJson())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.deck.name).toBe('Vader Aggro')
    expect(result.deck.leader).toBe('SOR_010')
    expect(result.deck.base).toBe('SOR_029')
    expect(result.deck.cards.reduce((n, c) => n + c.count, 0)).toBe(30)
  })

  it('accepts leader and base given as plain id strings', () => {
    const result = parseProtectThePod(validDeckJson({ leader: 'SOR_010', base: 'SOR_029' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.deck.leader).toBe('SOR_010')
    expect(result.deck.base).toBe('SOR_029')
  })

  it('defaults the name when metadata is absent', () => {
    const result = parseProtectThePod(validDeckJson({ metadata: undefined }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.deck.name).toBe('Imported deck')
  })

  it('rejects unparseable JSON', () => {
    const result = parseProtectThePod('{nope')
    expect(result).toEqual({ ok: false, error: 'invalid-json' })
  })

  it('rejects JSON that is not a deck-shaped object', () => {
    expect(parseProtectThePod('[]')).toEqual({ ok: false, error: 'invalid-format' })
    expect(parseProtectThePod('{"deck": "not-a-list"}')).toEqual({ ok: false, error: 'invalid-format' })
  })

  it('rejects a deck with no leader', () => {
    const result = parseProtectThePod(validDeckJson({ leader: undefined }))
    expect(result).toEqual({ ok: false, error: 'missing-leader' })
  })

  it('rejects a deck with no base', () => {
    const result = parseProtectThePod(validDeckJson({ base: undefined }))
    expect(result).toEqual({ ok: false, error: 'missing-base' })
  })

  it('rejects a deck with fewer than 30 cards', () => {
    const result = parseProtectThePod(validDeckJson({ deck: deckEntries(29) }))
    expect(result).toEqual({ ok: false, error: 'too-few-cards' })
  })

  it('accepts a deck with more than 30 cards (no maximum)', () => {
    const result = parseProtectThePod(validDeckJson({ deck: deckEntries(42) }))
    expect(result.ok).toBe(true)
  })

  it('rejects a deck containing malformed card ids', () => {
    const result = parseProtectThePod(
      validDeckJson({ deck: [...deckEntries(29), { id: 'garbage', count: 1 }] }),
    )
    expect(result).toEqual({ ok: false, error: 'invalid-format' })
  })

  it('treats entries without a count as a single copy', () => {
    const result = parseProtectThePod(validDeckJson({ deck: deckEntries(29).concat([{ id: 'SOR_200' } as never]) }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.deck.cards.find(c => c.id === 'SOR_200')!.count).toBe(1)
  })
})
