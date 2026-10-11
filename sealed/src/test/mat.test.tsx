// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { DeckPile, ResourceStack, DiscardPile } from '../components/mat'
import { state, player, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

// Reset the shared modifier store between tests (CardFace zoom reads it).
afterEach(() => fireEvent.keyUp(window, { key: 'Shift', shiftKey: false, altKey: false }))

function deckState(deck: string[]): GameState {
  return state({
    cards: { ...CARDS, T1: card({ id: 'T1', name: 'Top Card' }), T2: card({ id: 'T2', name: 'Second Card' }) },
    players: { player: player({ deck }), opponent: player({ deck }) },
  })
}

describe('DeckPile', () => {
  it('shows the number of cards remaining', () => {
    render(<DeckPile state={deckState(Array.from({ length: 17 }, () => 'T2'))} side="player" />)
    expect(screen.getByTestId('deck-pile')).toHaveTextContent('17')
  })

  it('is face down and not a click target: a deck is hidden from both players', () => {
    render(<DeckPile state={deckState(['T1', 'T2'])} side="player" />)
    expect(screen.queryByTestId('player-deck-look')).toBeNull()
    expect(within(screen.getByTestId('deck-pile')).queryByTestId('card-face')).toBeNull()
    expect(screen.getByTestId('deck-pile')).not.toHaveTextContent('Top Card')
  })

  describe('when its player may look at the top card', () => {
    it('highlights as something to click, still face down, with its count', () => {
      render(<DeckPile state={deckState(['T1', 'T2'])} side="player" canLook />)
      const look = screen.getByTestId('player-deck-look')
      expect(look).toHaveAttribute('data-highlight', 'accent-dim')
      expect(look).toHaveAccessibleName('Look at the top card of your deck')
      expect(screen.getByTestId('deck-pile')).toHaveTextContent('2')
      expect(within(look).queryByTestId('card-face')).toBeNull()
      expect(screen.queryByTestId('deck-top-overlay')).toBeNull()
    })

    it('shows the top card, and only the top card, when clicked', () => {
      render(<DeckPile state={deckState(['T1', 'T2'])} side="player" canLook />)
      fireEvent.click(screen.getByTestId('player-deck-look'))
      const overlay = screen.getByTestId('deck-top-overlay')
      expect(within(overlay).getAllByTestId('card-face')).toHaveLength(1)
      expect(overlay).toHaveTextContent('Top Card')
      expect(overlay).not.toHaveTextContent('Second Card')
      expect(screen.getByTestId('deck-top-prompt')).toHaveTextContent('The top card of your deck')
    })

    it('puts it away when clicking outside it, and not when clicking the card', () => {
      render(<DeckPile state={deckState(['T1', 'T2'])} side="player" canLook />)
      fireEvent.click(screen.getByTestId('player-deck-look'))
      fireEvent.click(screen.getByTestId('deck-top-overlay-content'))
      expect(screen.getByTestId('deck-top-overlay')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('deck-top-overlay')) // the backdrop
      expect(screen.queryByTestId('deck-top-overlay')).toBeNull()
    })

    it('follows the deck: the card showing is whichever is on top now', () => {
      const { rerender } = render(<DeckPile state={deckState(['T1', 'T2'])} side="player" canLook />)
      fireEvent.click(screen.getByTestId('player-deck-look'))
      rerender(<DeckPile state={deckState(['T2'])} side="player" canLook />)
      expect(screen.getByTestId('deck-top-overlay')).toHaveTextContent('Second Card')
    })

    it('stops showing it the moment the permission goes', () => {
      const { rerender } = render(<DeckPile state={deckState(['T1', 'T2'])} side="player" canLook />)
      fireEvent.click(screen.getByTestId('player-deck-look'))
      rerender(<DeckPile state={deckState(['T1', 'T2'])} side="player" />)
      expect(screen.queryByTestId('deck-top-overlay')).toBeNull()
      expect(screen.queryByTestId('player-deck-look')).toBeNull()
    })

    it('has nothing to click with no cards left', () => {
      render(<DeckPile state={deckState([])} side="player" canLook />)
      expect(screen.queryByTestId('player-deck-look')).toBeNull()
      expect(screen.getByTestId('deck-pile')).toHaveTextContent('0')
    })
  })
})

describe('ResourceStack', () => {
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

  it('shows no player token unless one is held', () => {
    render(<ResourceStack ready={3} exhausted={0} />)
    expect(screen.queryByTestId('credit-tokens')).toBeNull()
    expect(screen.queryByTestId('force-token')).toBeNull()
  })

  it('shows the Credit tokens held as a pill with the count, and the Force token as a pill of its own', () => {
    render(<ResourceStack ready={3} exhausted={0} credits={4} force owner="player" />)
    expect(screen.getByTestId('credit-tokens')).toHaveTextContent('Cred. 4')
    expect(screen.getByTestId('credit-tokens')).toHaveAccessibleName('4 Credit tokens')
    expect(screen.getByTestId('force-token')).toHaveTextContent('Force')
  })

  it('shows them with no resources at all, since neither depends on a resource', () => {
    render(<ResourceStack ready={0} exhausted={0} credits={1} />)
    expect(screen.getByTestId('credit-tokens')).toHaveTextContent('Cred. 1')
    expect(screen.queryByTestId('force-token')).toBeNull()
  })
})

function discardState(discard: string[]): GameState {
  return state({
    cards: { ...CARDS, D1: card({ id: 'D1', name: 'First' }), D2: card({ id: 'D2', name: 'Second' }) },
    players: { player: player({ discard }), opponent: player() },
  })
}

describe('DiscardPile', () => {
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

  it('zooms a discarded card on shift + hover in the overlay', () => {
    render(<DiscardPile state={discardState(['D1', 'D2'])} side="player" />)
    fireEvent.click(screen.getByTestId('player-discard-pile'))
    const overlay = screen.getByTestId('discard-overlay')
    expect(within(overlay).queryByTestId('card-zoom')).toBeNull() // no zoom until Shift+hover
    const cards = within(overlay).getAllByTestId('card-face')
    fireEvent.pointerEnter(cards[0].parentElement!, { pointerType: 'mouse' })
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    // The zoom portals to document.body (so it escapes the overlay's scroll clip),
    // so it lives outside the overlay subtree now — assert against the whole screen.
    expect(screen.getByTestId('card-zoom')).toBeInTheDocument()
  })

  it('zooms the pile itself on shift + hover — visible, not just mounted', () => {
    render(<DiscardPile state={discardState(['D1'])} side="player" />)
    const pile = screen.getByTestId('player-discard-pile')
    fireEvent.pointerEnter(pile, { pointerType: 'mouse' })
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    // Present but hidden is the failure this guards: an unmeasured popover stays
    // `visibility: hidden` forever, so presence alone proves nothing.
    expect(screen.getByTestId('card-zoom').style.visibility).not.toBe('hidden')
  })
})
