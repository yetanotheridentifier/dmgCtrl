import { describe, it, expect, beforeEach } from 'vitest'
import { listDecks, saveDeck, removeDeck, STORAGE_KEY } from '../data/deckStore'
import type { ParsedDeck } from '../utils/parseProtectThePod'

const PARSED: ParsedDeck = {
  name: 'Vader Aggro',
  leader: 'SOR_010',
  base: 'SOR_029',
  cards: [
    { id: 'SOR_100', count: 2 },
    { id: 'SOR_101', count: 2 },
  ],
}

describe('deckStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns an empty list when nothing is stored', () => {
    expect(listDecks()).toEqual([])
  })

  it('saves a deck and lists it back', () => {
    const saved = saveDeck(PARSED)
    const decks = listDecks()
    expect(decks).toHaveLength(1)
    expect(decks[0].id).toBe(saved.id)
    expect(decks[0].name).toBe('Vader Aggro')
    expect(decks[0].leader).toBe('SOR_010')
    expect(decks[0].cards).toEqual(PARSED.cards)
    expect(decks[0].importedAt).toBeGreaterThan(0)
  })

  it('persists to localStorage under the sealed decks key', () => {
    saveDeck(PARSED)
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)).toHaveLength(1)
  })

  it('assigns a distinct id per save', () => {
    const a = saveDeck(PARSED)
    const b = saveDeck({ ...PARSED, name: 'Second' })
    expect(a.id).not.toBe(b.id)
    expect(listDecks()).toHaveLength(2)
  })

  it('removes a deck by id', () => {
    const a = saveDeck(PARSED)
    const b = saveDeck({ ...PARSED, name: 'Second' })
    removeDeck(a.id)
    const decks = listDecks()
    expect(decks).toHaveLength(1)
    expect(decks[0].id).toBe(b.id)
  })

  it('survives corrupt storage by returning an empty list', () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    expect(listDecks()).toEqual([])
  })
})
