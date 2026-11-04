import { useState } from 'react'
import { listDecks, saveDeck, removeDeck as removeStoredDeck } from '../data/deckStore'
import type { SavedDeck } from '../data/deckStore'
import { parseProtectThePod } from '../utils/parseProtectThePod'
import type { ParseDeckError } from '../utils/parseProtectThePod'

/** An import's outcome: the deck as saved, id and all, or why the text was not a deck. */
export type ImportResult = { ok: true; deck: SavedDeck } | { ok: false; error: ParseDeckError }

export interface DecksValue {
  decks: SavedDeck[]
  importDeck: (text: string) => ImportResult
  removeDeck: (id: string) => void
}

export function useDecks(): DecksValue {
  const [decks, setDecks] = useState<SavedDeck[]>(listDecks)

  function importDeck(text: string): ImportResult {
    const result = parseProtectThePod(text)
    if (!result.ok) return result
    const deck = saveDeck(result.deck)
    setDecks(listDecks())
    return { ok: true, deck }
  }

  function removeDeck(id: string) {
    removeStoredDeck(id)
    setDecks(listDecks())
  }

  return { decks, importDeck, removeDeck }
}
