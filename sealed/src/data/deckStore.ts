import type { ParsedDeck } from '../utils/parseProtectThePod'

export const STORAGE_KEY = 'sealed_decks'

export interface SavedDeck extends ParsedDeck {
  id: string
  importedAt: number
}

function load(): SavedDeck[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SavedDeck[]) : []
  } catch {
    return []
  }
}

function persist(decks: SavedDeck[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks))
}

export function listDecks(): SavedDeck[] {
  return load()
}

export function saveDeck(deck: ParsedDeck): SavedDeck {
  const saved: SavedDeck = {
    ...deck,
    id: crypto.randomUUID(),
    importedAt: Date.now(),
  }
  persist([...load(), saved])
  return saved
}

export function removeDeck(id: string): void {
  persist(load().filter(d => d.id !== id))
}
