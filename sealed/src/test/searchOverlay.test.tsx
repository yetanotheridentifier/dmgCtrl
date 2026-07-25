import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchRevealOverlay, SearchDrawOverlay, SearchPlayUpgradeOverlay } from '../components/gameScreen'
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

  /**
   * #413: a reveal with nothing pickable must still be dismissable, or the overlay traps the
   * player. The Done button appears only in that case, so a mandatory pick stays mandatory.
   */
  it('shows a Done button only when nothing is pickable', () => {
    const s = state({
      cards: { ...CARDS, GRD: card({ id: 'GRD', name: 'Trooper', type: 'unit', arena: 'ground' }), EV: card({ id: 'EV', name: 'Plan', type: 'event' }) },
      players: { player: player(), opponent: player() },
    })
    const base = { kind: 'search', id: 'x', controller: 'player', unitId: 'u1' } as const

    const onDone = vi.fn()
    const { unmount } = render(<SearchRevealOverlay state={s} choice={{ ...base, revealed: ['EV', 'EV'] }} onPick={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getByTestId('search-done'))
    expect(onDone).toHaveBeenCalledOnce()
    unmount() // the overlay portals to document.body, so clear it before rendering the other case

    // With a pickable card the caller passes no onDone, so there is no way to duck the choice.
    render(<SearchRevealOverlay state={s} choice={{ ...base, revealed: ['GRD'] }} onPick={vi.fn()} />)
    expect(screen.queryByTestId('search-done')).toBeNull()
  })
})

describe('SearchDrawOverlay', () => {
  const s = state({
    cards: { ...CARDS, A: card({ id: 'A', name: 'Alpha', type: 'unit' }), B: card({ id: 'B', name: 'Beta', type: 'unit' }) },
    players: { player: player(), opponent: player() },
  })

  it('dismisses a no-match reveal with Done, and says the cards are being bottomed', () => {
    const onDone = vi.fn()
    render(
      <SearchDrawOverlay
        state={s}
        choice={{ kind: 'searchDraw', id: 'x', controller: 'player', revealed: ['A', 'B'], eligibleIndices: [] }}
        onPick={vi.fn()}
        onDone={onDone}
      />,
    )
    expect(screen.getByTestId('search-draw-prompt')).toHaveTextContent(/bottom/i)
    expect(screen.queryByTestId('search-draw-pick-0')).toBeNull() // nothing is drawable
    fireEvent.click(screen.getByTestId('search-draw-done'))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('offers Draw and no Done when there is a match', () => {
    render(
      <SearchDrawOverlay
        state={s}
        choice={{ kind: 'searchDraw', id: 'x', controller: 'player', revealed: ['A', 'B'], eligibleIndices: [1] }}
        onPick={vi.fn()}
      />,
    )
    expect(screen.getByTestId('search-draw-pick-1')).toBeInTheDocument()
    expect(screen.queryByTestId('search-draw-done')).toBeNull()
  })
})

/** Reforge had no overlay at all, so its search fell through to the action menu (#413). */
describe('SearchPlayUpgradeOverlay', () => {
  const s = state({
    cards: { ...CARDS, UP1: card({ id: 'UP1', name: 'Cheap Kit', type: 'upgrade', cost: 1 }), UP2: card({ id: 'UP2', name: 'Costly Kit', type: 'upgrade', cost: 9 }) },
    players: { player: player(), opponent: player() },
  })
  const choice: Extract<PendingChoice, { kind: 'searchPlayUpgrade' }> =
    { kind: 'searchPlayUpgrade', id: 'x', controller: 'player', unitId: 'u1', revealed: ['UP1', 'UP2'], eligibleIndices: [0, 1], discount: 4 }

  it('offers Play only for the cards the engine says are actually playable', () => {
    const onPick = vi.fn()
    // Both are eligible by attach rules, but only index 0 is affordable after the discount, which
    // is why the playable set comes from the legal moves rather than from eligibleIndices.
    render(<SearchPlayUpgradeOverlay state={s} choice={choice} playableIndices={[0]} onPick={onPick} onDone={vi.fn()} />)
    expect(screen.queryByTestId('search-upgrade-pick-1')).toBeNull()
    fireEvent.click(screen.getByTestId('search-upgrade-pick-0'))
    expect(onPick).toHaveBeenCalledWith(0)
  })

  it('always offers Done, since passing is legal', () => {
    const onDone = vi.fn()
    render(<SearchPlayUpgradeOverlay state={s} choice={choice} playableIndices={[]} onPick={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getByTestId('search-upgrade-done'))
    expect(onDone).toHaveBeenCalledOnce()
  })
})
