import { useState } from 'react'
import { listDecks, saveDeck, removeDeck as removeStoredDeck } from '../data/deckStore'
import type { SavedDeck } from '../data/deckStore'
import { parseProtectThePod } from '../utils/parseProtectThePod'
import type { ParseDeckResult } from '../utils/parseProtectThePod'

export interface DecksValue {
  decks: SavedDeck[]
  importDeck: (text: string) => ParseDeckResult
  removeDeck: (id: string) => void
}

export function useDecks(): DecksValue {
  const [decks, setDecks] = useState<SavedDeck[]>(listDecks)

  function importDeck(text: string): ParseDeckResult {
    const result = parseProtectThePod(text)
    if (result.ok) {
      saveDeck(result.deck)
      setDecks(listDecks())
    }
    return result
  }

  function removeDeck(id: string) {
    removeStoredDeck(id)
    setDecks(listDecks())
  }

  return { decks, importDeck, removeDeck }
}
