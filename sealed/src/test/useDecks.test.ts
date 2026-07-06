import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDecks } from '../hooks/useDecks'
import { saveDeck } from '../data/deckStore'

function validDeckJson(name = 'Vader Aggro') {
  return JSON.stringify({
    metadata: { name },
    leader: { id: 'SOR_010', count: 1 },
    base: { id: 'SOR_029', count: 1 },
    deck: Array.from({ length: 30 }, (_, i) => ({ id: `SOR_${100 + i}`, count: 1 })),
  })
}

describe('useDecks', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('exposes stored decks on mount', () => {
    saveDeck({ name: 'Existing', leader: 'SOR_010', base: 'SOR_029', cards: [] })
    const { result } = renderHook(() => useDecks())
    expect(result.current.decks).toHaveLength(1)
    expect(result.current.decks[0].name).toBe('Existing')
  })

  it('importDeck adds a valid deck and reports ok', () => {
    const { result } = renderHook(() => useDecks())
    let outcome: ReturnType<typeof result.current.importDeck> | undefined
    act(() => {
      outcome = result.current.importDeck(validDeckJson())
    })
    expect(outcome!.ok).toBe(true)
    expect(result.current.decks).toHaveLength(1)
    expect(result.current.decks[0].name).toBe('Vader Aggro')
  })

  it('importDeck rejects invalid JSON without adding a deck', () => {
    const { result } = renderHook(() => useDecks())
    let outcome: ReturnType<typeof result.current.importDeck> | undefined
    act(() => {
      outcome = result.current.importDeck('{nope')
    })
    expect(outcome).toEqual({ ok: false, error: 'invalid-json' })
    expect(result.current.decks).toHaveLength(0)
  })

  it('removeDeck removes by id', () => {
    const { result } = renderHook(() => useDecks())
    act(() => {
      result.current.importDeck(validDeckJson('One'))
      result.current.importDeck(validDeckJson('Two'))
    })
    const idToRemove = result.current.decks[0].id
    act(() => {
      result.current.removeDeck(idToRemove)
    })
    expect(result.current.decks).toHaveLength(1)
    expect(result.current.decks[0].name).toBe('Two')
  })
})
