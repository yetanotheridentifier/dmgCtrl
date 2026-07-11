import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { DeckPile, ResourceStack, DiscardPile } from '../components/mat'
import { state, player, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

// Reset the shared modifier store between tests (CardFace zoom reads it).
afterEach(() => fireEvent.keyUp(window, { key: 'Shift', shiftKey: false, altKey: false }))

describe('DeckPile (#332)', () => {
  it('shows the number of cards remaining', () => {
    render(<DeckPile count={17} />)
    expect(screen.getByTestId('deck-pile')).toHaveTextContent('17')
  })
})

describe('ResourceStack (#332)', () => {
  it('shows a ready card with the ready count, and no exhausted card when none are used', () => {
    render(<ResourceStack ready={3} exhausted={0} />)
    expect(screen.getByTestId('resources-ready')).toHaveTextContent('3')
    expect(screen.queryByTestId('resources-exhausted')).toBeNull()
  })

  it('adds an exhausted card with the exhausted count as resources are used', () => {
    render(<ResourceStack ready={1} exhausted={2} />)
    expect(screen.getByTestId('resources-ready')).toHaveTextContent('1')
    expect(screen.getByTestId('resources-exhausted')).toHaveTextContent('2')
  })

  it('hides the ready card when there are no ready resources', () => {
    render(<ResourceStack ready={0} exhausted={4} />)
    expect(screen.queryByTestId('resources-ready')).toBeNull()
    expect(screen.getByTestId('resources-exhausted')).toHaveTextContent('4')
  })
})

function discardState(discard: string[]): GameState {
  return state({
    cards: { ...CARDS, D1: card({ id: 'D1', name: 'First' }), D2: card({ id: 'D2', name: 'Second' }) },
    players: { player: player({ discard }), opponent: player() },
  })
}

describe('DiscardPile (#332)', () => {
  it('renders nothing clickable when the discard is empty', () => {
    render(<DiscardPile state={discardState([])} side="player" />)
    expect(screen.queryByTestId('player-discard-pile')).toBeNull()
  })

  it('shows the pile with its count; clicking opens an overlay of every discarded card', () => {
    render(<DiscardPile state={discardState(['D1', 'D2'])} side="player" />)
    const pile = screen.getByTestId('player-discard-pile')
    expect(pile).toHaveTextContent('2') // count
    expect(screen.queryByTestId('discard-overlay')).toBeNull()

    fireEvent.click(pile)
    const overlay = screen.getByTestId('discard-overlay')
    expect(within(overlay).getAllByTestId('card-face')).toHaveLength(2)
  })

  it('dismisses the overlay when clicking outside it', () => {
    render(<DiscardPile state={discardState(['D1'])} side="player" />)
    fireEvent.click(screen.getByTestId('player-discard-pile'))
    const overlay = screen.getByTestId('discard-overlay')
    fireEvent.click(overlay) // the backdrop
    expect(screen.queryByTestId('discard-overlay')).toBeNull()
  })

  it('does not dismiss when clicking inside the overlay content', () => {
    render(<DiscardPile state={discardState(['D1'])} side="player" />)
    fireEvent.click(screen.getByTestId('player-discard-pile'))
    fireEvent.click(screen.getByTestId('discard-overlay-content'))
    expect(screen.getByTestId('discard-overlay')).toBeInTheDocument()
  })

  it('zooms a discarded card on shift + hover in the overlay (#332)', () => {
    render(<DiscardPile state={discardState(['D1', 'D2'])} side="player" />)
    fireEvent.click(screen.getByTestId('player-discard-pile'))
    const overlay = screen.getByTestId('discard-overlay')
    expect(within(overlay).queryByTestId('card-zoom')).toBeNull() // no zoom until Shift+hover
    const cards = within(overlay).getAllByTestId('card-face')
    fireEvent.pointerEnter(cards[0].parentElement!, { pointerType: 'mouse' })
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    expect(within(overlay).getByTestId('card-zoom')).toBeInTheDocument()
  })
})
