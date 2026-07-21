import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { db } from '../data/db'
import { useGame } from '../hooks/useGame'
import { legalMoves } from '../engine/legalMoves'
import '../engine/cardDefinitions'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'

/**
 * A real sealed pool contains whatever printings you opened, and ProtectThePod exports them
 * faithfully. Everything the engine keys by card id is written against the Normal number, so a
 * Hyperspace card used to play as a vanilla body with no ability at all (#382-#385).
 *
 * ASH_044 Barriss Offee (Normal) and ASH_308 Barriss Offee (Hyperspace) are the same card.
 */
const BARRISS_NORMAL: SwuCard = {
  Set: 'ASH', Number: '044', Name: 'Barriss Offee', Type: 'Unit', VariantType: 'Normal',
  Arenas: ['Ground'], Cost: '0', Power: '3', HP: '4', Unique: true,
}
const BARRISS_HYPERSPACE: SwuCard = { ...BARRISS_NORMAL, Number: '308', VariantType: 'Hyperspace' }
const LEADER: SwuCard = { Set: 'ASH', Number: '011', Name: 'Cad Bane', Subtitle: 'He Who Gets Paid', Type: 'Leader', VariantType: 'Normal', Cost: '6', Power: '4', HP: '7' }
const BASE: SwuCard = { Set: 'ASH', Number: '020', Name: 'Nevarro City', Type: 'Base', VariantType: 'Normal', HP: '30' }
const CHAFF: SwuCard = { Set: 'ASH', Number: '099', Name: 'Gozanti Assault Carrier', Type: 'Unit', VariantType: 'Normal', Arenas: ['Space'], Cost: '9', Power: '1', HP: '1' }

/** Deck of Hyperspace Barriss: what a real pool looks like. */
const HYPERSPACE_DECK: SavedDeck = {
  id: 'hs', name: 'Hyperspace', leader: 'ASH_011', base: 'ASH_020',
  cards: [{ id: 'ASH_308', count: 4 }, { id: 'ASH_099', count: 26 }], importedAt: 1,
}

const identity = <T,>(a: T[]) => a
const passiveAi = (s: GameState) => { const m = legalMoves(s); return m.length > 0 ? m[m.length - 1] : null }
const OPTS = { shuffle: identity, ai: passiveAi, firstPlayer: 'player' as const }

async function seed(cards: SwuCard[]) {
  for (const c of cards) await db.cards.put({ id: `${c.Set}_${c.Number}`, json: c, fetchedAt: 1 })
}

/** Play through setup so the first action-phase play is a Barriss. */
async function toFirstPlay(deck: SavedDeck) {
  const { result } = renderHook(() => useGame(deck, deck, OPTS))
  await waitFor(() => expect(result.current.status).toBe('playing'))
  act(() => result.current.act({ type: 'keepHand' }))
  act(() => result.current.act({ type: 'setupResource', handIndex: 5 }))
  act(() => result.current.act({ type: 'setupResource', handIndex: 4 }))
  return result
}

describe('printings play as the card, not as a vanilla body', () => {
  beforeEach(async () => {
    await db.cards.clear()
    // The Normal printings are cached, as they would be after a set import — this is the index.
    await seed([BARRISS_NORMAL, LEADER, BASE, CHAFF, BARRISS_HYPERSPACE])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('gives a Hyperspace card the abilities registered against its Normal id', async () => {
    const result = await toFirstPlay(HYPERSPACE_DECK)
    const state = result.current.gameState!
    // The deck was rewritten to the canonical id, so the engine sees the registered card.
    expect(state.players.player.hand.every(id => id !== 'ASH_308')).toBe(true)
    expect(state.players.player.hand).toContain('ASH_044')

    act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
    // Barriss' When Played offers a heal when something is damaged; with nothing damaged she
    // raises nothing. What matters is that she is the registered card at all.
    expect(result.current.gameState!.cards.ASH_044?.name).toBe('Barriss Offee')
    expect(result.current.unresolvedPrintings).toEqual([])
  })

  /**
   * #385: two printings of one unique card are still one card, so the unique rule has to catch
   * them. Keyed by raw id, ASH_044 and ASH_308 looked like different cards and both stayed.
   */
  it('treats two printings of a unique card as duplicates', async () => {
    const mixed: SavedDeck = {
      ...HYPERSPACE_DECK,
      cards: [{ id: 'ASH_308', count: 2 }, { id: 'ASH_044', count: 2 }, { id: 'ASH_099', count: 26 }],
    }
    const result = await toFirstPlay(mixed)
    act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))
    act(() => result.current.act({ type: 'playUnit', handIndex: 0 }))

    const s = result.current.gameState!
    const barriss = s.players.player.units.filter(u => u.cardId === 'ASH_044')
    // Either the second was refused, or the unique rule is asking which to defeat. What must not
    // happen is two copies quietly coexisting.
    const asking = s.pendingChoices?.some(c => c.kind === 'selectUniqueUnitToDefeat')
    expect(barriss.length < 2 || asking).toBe(true)
  })

  /** Offline: the game must still start, with the affected cards named rather than hidden. */
  it('plays on and reports the cards when no printing index is available', async () => {
    await db.cards.clear()
    await seed([BARRISS_HYPERSPACE, LEADER, BASE, CHAFF]) // no Normal Barriss anywhere
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { result } = renderHook(() => useGame(HYPERSPACE_DECK, HYPERSPACE_DECK, OPTS))
    await waitFor(() => expect(result.current.status).toBe('playing'))

    expect(result.current.unresolvedPrintings.map(u => u.name)).toContain('Barriss Offee')
    expect(result.current.gameState!.players.player.hand).toContain('ASH_308') // unchanged, plays vanilla
  })
})
