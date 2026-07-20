import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchRevealOverlay } from '../components/gameScreen'
import { state, player, card, CARDS } from './helpers/engineFixtures'
import type { PendingChoice } from '../engine/types'

/** The multi-card "search" reveal overlay for Improvised Identity. */
describe('SearchRevealOverlay', () => {
  it('offers Discard only for revealed ground units and reports the deck index', () => {
    const s = state({
      cards: {
        ...CARDS,
        GRD: card({ id: 'GRD', name: 'Trooper', type: 'unit', arena: 'ground' }),
        EV: card({ id: 'EV', name: 'Plan', type: 'event' }),
      },
      players: { player: player(), opponent: player() },
    })
    const choice: Extract<PendingChoice, { kind: 'search' }> = { kind: 'search', id: 'x', controller: 'player', unitId: 'u1', revealed: ['EV', 'GRD', 'EV'] }
    const onPick = vi.fn()
    render(<SearchRevealOverlay state={s} choice={choice} onPick={onPick} />)

    expect(screen.getByTestId('search-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('search-pick-0')).toBeNull() // event, not pickable
    expect(screen.queryByTestId('search-pick-2')).toBeNull()
    fireEvent.click(screen.getByTestId('search-pick-1')) // the ground unit
    expect(onPick).toHaveBeenCalledWith(1)
  })
})
