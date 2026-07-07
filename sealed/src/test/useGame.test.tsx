import { StrictMode } from 'react'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { db } from '../data/db'
import { useGame } from '../hooks/useGame'
import { listGameRecords } from '../data/gameRecords'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'

// Seeded SWUDB-shaped cards. TST_900 is a 0-cost 30-power unit so a game can
// be won in two rounds, keeping tests fast and deterministic.
const SWU_CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '900', Name: 'Big Test Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '30', HP: '30' },
]

const DECK: SavedDeck = {
  id: 'deck-1',
  name: 'Big Deck',
  leader: 'TST_001',
  base: 'TST_002',
  cards: [{ id: 'TST_900', count: 30 }],
  importedAt: 1,
}

const identity = <T,>(arr: T[]) => arr
// legalMoves puts pass/skipResource last, so an rng near 1 makes the AI always pass.
const passiveRng = () => 0.999999

const OPTS = { shuffle: identity, rng: passiveRng, firstPlayer: 'player' as const }

async function seedCards() {
  for (const card of SWU_CARDS) {
    await db.cards.put({ id: `TST_${card.Number}`, json: card, fetchedAt: 1 })
  }
}

describe('useGame', () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    await seedCards()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hydrates cards and opens in the setup phase (mulligan decision)', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    const game = result.current.gameState!
    expect(game.phase).toBe('setup')
    expect(game.players.player.hand).toHaveLength(6)
    expect(game.players.player.resources).toHaveLength(0)
    expect(game.activePlayer).toBe('player')
    expect(result.current.legal.map(a => a.type)).toEqual(['mulligan', 'keepHand'])
  })

  it('keeping the hand moves to the resource choice; picking a pair starts round 1', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))

    // The AI (heuristic) made its mulligan call; the human now picks resources.
    let game = result.current.gameState!
    expect(game.phase).toBe('setup')
    expect(game.setupStage).toBe('resource')
    expect(result.current.legal.every(a => a.type === 'setupResource')).toBe(true)

    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))

    game = result.current.gameState!
    expect(game.phase).toBe('action')
    expect(game.players.player.hand).toHaveLength(4)
    expect(game.players.player.resources).toHaveLength(2)
    expect(game.activePlayer).toBe('player')
  })

  it('does not duplicate log entries under StrictMode (updater must be pure)', async () => {
    // The app renders inside <StrictMode>, which double-invokes state updaters
    // in dev to surface impurity. Any side effect inside a setState updater
    // (logging, driving the AI) then runs twice → doubled log entries.
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS), { wrapper: StrictMode })
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))

    const keepEntries = result.current.log.filter(e => e.by === 'player' && /keep hand/i.test(e.text))
    expect(keepEntries).toHaveLength(1)

    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'playCard', handIndex: 0 }))

    // Exactly one log entry per human action taken (keepHand, resource ×2, play).
    expect(result.current.log.filter(e => e.by === 'player')).toHaveLength(4)
    expect(result.current.log.filter(e => e.by === 'player' && /play/i.test(e.text))).toHaveLength(1)
  })

  it('reports an error with diagnostic detail when a deck card cannot be hydrated', async () => {
    // TST_404 is not seeded, so hydration goes to the network — which fails.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({}) }))
    const badDeck = { ...DECK, cards: [{ id: 'TST_404', count: 30 }] }
    const { result } = renderHook(() => useGame(badDeck, badDeck, OPTS))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.errorDetail).toMatch(/TST_404/)
  })

  it('acting as the human triggers the AI to take its turn', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'playCard', handIndex: 0 }))

    const game = result.current.gameState!
    expect(game.players.player.units).toHaveLength(1)
    // AI (passive rng) passed and the turn came back to the human
    expect(game.activePlayer).toBe('player')
    expect(result.current.log.some(e => e.by === 'opponent' && /pass/i.test(e.text))).toBe(true)
  })

  it('drives the AI through the regroup choice too', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'playCard', handIndex: 0 }))
    act(() => result.current.act({ type: 'pass' })) // AI passes → regroup begins
    // human regroup choice
    act(() => result.current.act({ type: 'skipResource' }))

    const game = result.current.gameState!
    // AI auto-resolved its regroup choice; round 2 action phase, human first
    expect(game.phase).toBe('action')
    expect(game.round).toBe(2)
    expect(game.activePlayer).toBe('player')
  })

  it('plays to a win and saves the game record', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'playCard', handIndex: 0 }))
    act(() => result.current.act({ type: 'pass' }))
    act(() => result.current.act({ type: 'skipResource' }))

    const unitId = result.current.gameState!.players.player.units[0].instanceId
    act(() => result.current.act({ type: 'attack', attackerId: unitId, target: { kind: 'base' } }))

    expect(result.current.gameState!.winner).toBe('player')

    await waitFor(async () => {
      const records = await listGameRecords()
      expect(records).toHaveLength(1)
      expect(records[0].winner).toBe('player')
      expect(records[0].playerDeckName).toBe('Big Deck')
      expect(records[0].moves.length).toBeGreaterThan(0)
      expect(records[0].finalState.winner).toBe('player')
    })
  })

  it('rematch resets to a fresh game', async () => {
    const { result } = renderHook(() => useGame(DECK, DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    act(() => result.current.act({ type: 'keepHand' }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'setupResource', handIndex: 0 }))
    act(() => result.current.act({ type: 'playCard', handIndex: 0 }))
    act(() => result.current.rematch())

    await waitFor(() => {
      expect(result.current.gameState!.players.player.units).toHaveLength(0)
      expect(result.current.gameState!.round).toBe(1)
      expect(result.current.log).toEqual([])
    })
  })
})
