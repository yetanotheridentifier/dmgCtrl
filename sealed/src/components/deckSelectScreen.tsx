import { useState } from 'react'
import { useDecks } from '../hooks/useDecks'
import type { SavedDeck } from '../data/deckStore'
import { cardRefFromId } from '../utils/parseProtectThePod'
import type { ParseDeckError, ParsedDeck } from '../utils/parseProtectThePod'
import { syncCatalogue } from '../data/catalogueSync'
import type { CardRef } from '../data/catalogueSync'

interface Props {
  onPlay: (deck: SavedDeck, opponentDeck: SavedDeck) => void
}

const ERROR_MESSAGES: Record<ParseDeckError, string> = {
  'invalid-json': "Couldn't read that — check you've pasted the ProtectThePod JSON export.",
  'invalid-format': "That JSON doesn't look like a deck export.",
  'missing-leader': 'Deck must include exactly 1 leader.',
  'missing-base': 'Deck must include exactly 1 base.',
  'too-few-cards': 'Deck must have at least 30 cards.',
}

function deckRefs(deck: ParsedDeck): CardRef[] {
  const ids = [deck.leader, deck.base, ...deck.cards.map(c => c.id)]
  return ids
    .map(cardRefFromId)
    .filter((ref): ref is CardRef => ref !== null)
}

function cardCount(deck: SavedDeck): number {
  return deck.cards.reduce((n, c) => n + c.count, 0)
}

function pickOpponent(decks: SavedDeck[], choice: string, fallback: SavedDeck): SavedDeck {
  if (choice !== 'random') return decks.find(d => d.id === choice) ?? fallback
  return decks[Math.floor(Math.random() * decks.length)]
}

export default function DeckSelectScreen({ onPlay }: Props) {
  const { decks, importDeck, removeDeck } = useDecks()
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<ParseDeckError | null>(null)
  const [opponentChoice, setOpponentChoice] = useState('random')

  function handleImport() {
    const result = importDeck(importText)
    if (result.ok) {
      setImportText('')
      setImportError(null)
      // Fire-and-forget: hydrate the new deck's cards in the background,
      // leader and base first (highest display priority).
      void syncCatalogue(deckRefs(result.deck))
    } else {
      setImportError(result.error)
    }
  }

  function handlePlay(deck: SavedDeck) {
    onPlay(deck, pickOpponent(decks, opponentChoice, deck))
  }

  return (
    <div data-testid="deck-select-screen" className="max-w-2xl">
      <h2 className="text-accent text-sm uppercase tracking-[0.12em] font-light">Deck selection</h2>

      {decks.length === 0 ? (
        <p data-testid="deck-empty-state" className="mt-4 text-ink-faint text-sm">
          No decks yet — paste a ProtectThePod export below to get started.
        </p>
      ) : (
        <ul data-testid="deck-list" className="mt-4 divide-y divide-line/40 border-2 border-line/60 rounded-xl bg-surface">
          {decks.map(deck => (
            <li key={deck.id} className="flex items-center gap-4 px-4 py-3">
              <div className="flex-1 min-w-0">
                <span className="block font-medium truncate">{deck.name}</span>
                <span className="block text-xs text-ink-faint">
                  {cardCount(deck)} cards · leader {deck.leader} · base {deck.base}
                </span>
              </div>
              <button
                onClick={() => handlePlay(deck)}
                className="px-4 py-1.5 text-sm border-2 border-ink text-ink rounded-xl shadow-[0_0_12px_rgba(255,255,255,0.2)] hover:bg-white/10"
              >
                Play
              </button>
              <button
                onClick={() => removeDeck(deck.id)}
                className="px-4 py-1.5 text-sm border-2 border-line/60 text-ink-dim rounded-xl hover:border-red hover:text-red"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {decks.length > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <label htmlFor="opponent-deck-select" className="text-accent text-xs uppercase tracking-[0.12em] font-light">
            Opponent
          </label>
          <select
            id="opponent-deck-select"
            data-testid="opponent-deck-select"
            value={opponentChoice}
            onChange={e => setOpponentChoice(e.target.value)}
            className="bg-transparent border-2 border-accent rounded-xl px-3 py-1.5 text-sm text-ink shadow-[0_0_12px_rgba(79,195,247,0.3)] focus:outline-none"
          >
            <option value="random">Random deck</option>
            {decks.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-8">
        <h3 className="text-accent text-xs uppercase tracking-[0.12em] font-light">Import deck</h3>
        <textarea
          data-testid="deck-import-textarea"
          value={importText}
          onChange={e => {
            setImportText(e.target.value)
            setImportError(null)
          }}
          placeholder="Paste ProtectThePod JSON"
          className="mt-2 w-full h-36 bg-transparent border-2 border-accent rounded-xl p-3 text-sm font-mono text-ink placeholder:text-ink-faint shadow-[0_0_12px_rgba(79,195,247,0.3)] focus:outline-none"
        />
        {importError && (
          <p data-testid="deck-import-error" className="mt-1 text-sm text-red">
            {ERROR_MESSAGES[importError]}
          </p>
        )}
        <button
          data-testid="deck-import-btn"
          onClick={handleImport}
          disabled={importText.trim() === ''}
          className="mt-2 px-5 py-2 text-sm border-2 border-ink text-ink rounded-xl shadow-[0_0_12px_rgba(255,255,255,0.2)] hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Import
        </button>
      </div>
    </div>
  )
}
