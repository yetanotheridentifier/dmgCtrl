import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GameScreen from '../components/gameScreen'
import { db } from '../data/db'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import type { UseGameOptions } from '../hooks/useGame'

const SWU_CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '900', Name: 'Big Test Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '30', HP: '30' },
  { Set: 'TST', Number: '901', Name: 'Pricey Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
]

// Deal order (identity shuffle): 901, 901, 901, 900, 900, 900.
// Default setup chooser resources the last two → hand: 901 ×3 + 900 ×1.
const DECK: SavedDeck = {
  id: 'deck-1',
  name: 'Big Deck',
  leader: 'TST_001',
  base: 'TST_002',
  cards: [
    { id: 'TST_901', count: 3 },
    { id: 'TST_900', count: 27 },
  ],
  importedAt: 1,
}

const identity = <T,>(arr: T[]) => arr
const OPTS: UseGameOptions = { shuffle: identity, rng: () => 0.999999, firstPlayer: 'player' }

async function seedCards() {
  for (const card of SWU_CARDS) {
    await db.cards.put({ id: `TST_${card.Number}`, json: card, fetchedAt: 1 })
  }
}

async function renderBoard(onExit = vi.fn()) {
  render(<GameScreen deck={DECK} opponentDeck={DECK} onExit={onExit} gameOptions={OPTS} />)
  await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  return onExit
}

describe('GameScreen', () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    await seedCards()
  })

  it('shows a loading state then the board', async () => {
    render(<GameScreen deck={DECK} opponentDeck={DECK} onExit={vi.fn()} gameOptions={OPTS} />)
    expect(screen.getByTestId('game-loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  })

  it('displays base HP for both sides', async () => {
    await renderBoard()
    expect(screen.getByTestId('player-base-hp')).toHaveTextContent('30/30')
    expect(screen.getByTestId('opponent-base-hp')).toHaveTextContent('30/30')
  })

  it('displays resources and the opponent hand as a count', async () => {
    await renderBoard()
    expect(screen.getByTestId('player-resources')).toHaveTextContent('2/2')
    expect(screen.getByTestId('opponent-hand-count')).toHaveTextContent('4')
  })

  it('lists the hand with unplayable cards marked', async () => {
    await renderBoard()
    const hand = screen.getByTestId('player-hand')
    const cards = within(hand).getAllByTestId(/hand-card-/)
    expect(cards).toHaveLength(4)
    expect(cards[0]).toHaveTextContent('Pricey Unit')
    expect(cards[0]).toHaveAttribute('data-playable', 'false')
    expect(cards[3]).toHaveTextContent('Big Test Unit')
    expect(cards[3]).toHaveAttribute('data-playable', 'true')
  })

  it('offers the legal moves as buttons and resolves a click', async () => {
    const user = userEvent.setup()
    await renderBoard()

    await user.click(screen.getByRole('button', { name: /play big test unit/i }))

    // Unit hits the board; passive AI passed; turn is back with the human.
    expect(within(screen.getByTestId('player-ground-units')).getByText(/big test unit/i)).toBeInTheDocument()
    expect(within(screen.getByTestId('game-log')).getAllByText(/pass/i).length).toBeGreaterThan(0)
  })

  it('plays through to a win, shows the banner, and can rematch', async () => {
    const user = userEvent.setup()
    await renderBoard()

    await user.click(screen.getByRole('button', { name: /play big test unit/i }))
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    await user.click(screen.getByRole('button', { name: /skip resourcing/i }))
    await user.click(screen.getByRole('button', { name: /attack base with big test unit/i }))

    const banner = screen.getByTestId('game-over-banner')
    expect(banner).toHaveTextContent(/you won/i)

    await user.click(screen.getByTestId('rematch-btn'))
    await waitFor(() => {
      expect(screen.queryByTestId('game-over-banner')).not.toBeInTheDocument()
      expect(screen.getByTestId('player-base-hp')).toHaveTextContent('30/30')
    })
  })

  it('exit returns to deck selection', async () => {
    const user = userEvent.setup()
    const onExit = await renderBoard()
    await user.click(screen.getByTestId('exit-btn'))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('shows the diagnostic detail when card loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({}) }))
    const badDeck = { ...DECK, cards: [{ id: 'TST_404', count: 30 }] }
    render(<GameScreen deck={badDeck} opponentDeck={badDeck} onExit={vi.fn()} gameOptions={OPTS} />)

    await waitFor(() => expect(screen.getByTestId('game-error')).toBeInTheDocument())
    expect(screen.getByTestId('game-error-detail')).toHaveTextContent(/TST_404/)
    vi.unstubAllGlobals()
  })
})
