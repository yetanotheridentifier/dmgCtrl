// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SetupScreen from '../components/setupScreen'
import { useGame } from '../hooks/useGame'
import { db } from '../data/db'
import { legalMoves } from '../engine/legalMoves'
import type { SavedDeck } from '../data/deckStore'
import type { GameState } from '../engine/types'
import sorSet from './fixtures/sorSet.json'
import type { SwuCard } from '../data/cards'

/**
 * A first visit on a day the card API cannot be reached: nothing cached, and every fetch rejects.
 * The sets the app lists ship with it, so the deck screen still has a pool to build from and the
 * game still hydrates. Nothing here mocks the data layer: the screen, the hook, the cache and the
 * bundled sets are the real ones, and the only thing taken away is the network.
 */

const identity = <T,>(arr: T[]) => arr
const passiveAi = (s: GameState) => {
  const moves = legalMoves(s)
  return moves.length > 0 ? moves[moves.length - 1] : null
}
const OPTS = { shuffle: identity, ai: passiveAi, firstPlayer: 'player' as const }

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  localStorage.clear()
  await db.cards.clear()
  await db.games.clear()
  fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a first visit with the card API unreachable', () => {
  it('builds a generated deck and a generated opponent, and starts the game', async () => {
    const user = userEvent.setup()
    const onPlay = vi.fn()
    render(<SetupScreen onPlay={onPlay} onHelp={vi.fn()} onSettings={vi.fn()} />)

    // The set both generators start on is here without an import, so there is no failed fetch to report.
    await user.click(screen.getByRole('button', { name: 'Generate a deck' }))
    const view = screen.getByRole('dialog', { name: 'Generated deck' })
    await waitFor(() => expect(within(view).getAllByTestId('deck-row').length).toBeGreaterThan(0))
    expect(within(view).getByRole('button', { name: 'Set: HMW' })).toBeInTheDocument()
    await user.click(within(view).getByRole('button', { name: 'Use this deck' }))
    await user.click(screen.getByRole('button', { name: 'Go to game' }))

    await waitFor(() => expect(onPlay).toHaveBeenCalled())
    const [deck, opponent] = onPlay.mock.calls[0] as [SavedDeck, SavedDeck]
    expect(deck.id).toBe('generated')
    expect(opponent.id).toBe('generated')
    expect(deck.cards.length).toBeGreaterThan(0)
    expect(opponent.cards.length).toBeGreaterThan(0)

    const { result } = renderHook(() => useGame(deck, opponent, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    const game = result.current.gameState!
    expect(game.players.player.hand).toHaveLength(6)
    expect(result.current.unresolvedPrintings).toEqual([])
    // The art still streams from the proxy, so every card has to know where its own is.
    expect(game.cards[deck.leader].frontArt).toMatch(/^https:\/\/cdn\.swu-db\.com\/images\/cards\/HMW\//)
    expect(game.cards[deck.leader].backArt).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await db.cards.count()).toBe(0)
  })

  it('starts a game from a deck list of a bundled set', async () => {
    const sor = sorSet as unknown as SwuCard[]
    const playable = sor.filter(c => c.Type !== 'Leader' && c.Type !== 'Base').slice(0, 30)
    const deck: SavedDeck = {
      id: 'imported',
      name: 'Vader',
      leader: 'SOR_010',
      base: `SOR_${sor.find(c => c.Type === 'Base')!.Number}`,
      cards: playable.map(c => ({ id: `SOR_${c.Number}`, count: 1 })),
      importedAt: 1,
    }

    const { result } = renderHook(() => useGame(deck, deck, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    expect(result.current.gameState!.cards.SOR_010.name).toBe('Darth Vader')
    expect(result.current.unresolvedPrintings).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still says which card could not be loaded when the deck names one no bundled set holds', async () => {
    const deck: SavedDeck = { id: 'x', name: 'x', leader: 'SOR_010', base: 'SOR_029', cards: [{ id: 'SOR_280', count: 30 }], importedAt: 1 }
    const { result } = renderHook(() => useGame(deck, deck, OPTS))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.errorDetail).toMatch(/SOR_280/)
  })
})
