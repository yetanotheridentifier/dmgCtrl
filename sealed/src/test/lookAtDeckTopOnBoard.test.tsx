// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GameScreen from '../components/gameScreen'
import { db } from '../data/db'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import type { UseGameOptions } from '../hooks/useGame'
import { legalMoves } from '../engine/legalMoves'
import { registerCard, unregisterAbility } from '../engine/abilities'
import { SettingsProvider } from '../hooks/useSettings'

/**
 * "You may look at the top card of your deck at any time", on the game screen: the player who holds
 * the permission clicks their own deck to see its top card. Looking is not a move, so it reaches
 * neither the log nor the opponent, and the opponent's deck is never a click target whoever holds what.
 */

const CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '300', Name: 'Filler', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
  { Set: 'TST', Number: '301', Name: 'Deep Filler', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
  { Set: 'TST', Number: '980', Name: 'Lookout', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '5' },
  { Set: 'TST', Number: '981', Name: 'Secret On Top', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
]

beforeAll(() => registerCard('TST_980', { looksAtOwnDeckTop: true }))
afterAll(() => unregisterAbility('TST_980'))

/** Six cards for the opening hand with `first` at the front, then Secret On Top as the seventh: the top of the deck. */
const deck = (first: string): SavedDeck => ({
  id: first, name: first, leader: 'TST_001', base: 'TST_002',
  cards: [{ id: first, count: 1 }, { id: 'TST_300', count: 5 }, { id: 'TST_981', count: 1 }, { id: 'TST_301', count: 23 }], importedAt: 1,
})

const identity = <T,>(arr: T[]) => arr
// The opponent plays a unit when it can, and otherwise takes the passive move (listed last).
const OPTS: UseGameOptions = {
  shuffle: identity,
  firstPlayer: 'player',
  ai: s => {
    const moves = legalMoves(s)
    return moves.find(m => m.type === 'playUnit') ?? (moves.length > 0 ? moves[moves.length - 1] : null)
  },
}

/** Keep the hand and resource two Fillers, leaving the deck's first card at the front of the hand. */
async function start(playerDeck: SavedDeck, opponentDeck: SavedDeck) {
  render(<SettingsProvider><GameScreen deck={playerDeck} opponentDeck={opponentDeck} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} /></SettingsProvider>)
  await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /keep hand/i }))
  await user.click(screen.getByTestId('hand-card-2'))
  await user.click(screen.getByTestId('hand-card-2'))
  return user
}

const lookButton = () => screen.queryByTestId('player-deck-look')
const logText = () => screen.getByTestId('game-log').textContent

describe('looking at the top card of your deck, on the game screen', () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    for (const c of CARDS) await db.cards.put({ id: `TST_${c.Number}`, json: c, fetchedAt: 1 })
  })

  it('offers nothing on the deck until a card gives the permission', async () => {
    await start(deck('TST_980'), deck('TST_300'))
    expect(lookButton()).toBeNull()
    expect(screen.queryByTestId('opponent-deck-look')).toBeNull()
  })

  it('makes your deck a highlighted click target once the card is in play, and shows its top card', async () => {
    const user = await start(deck('TST_980'), deck('TST_300'))
    await user.click(screen.getByTestId('hand-card-0'))
    await waitFor(() => expect(lookButton()).not.toBeNull())
    expect(within(screen.getByTestId('player-mat')).getByTestId('player-deck-look')).toHaveAttribute('data-highlight', 'accent-dim')

    await user.click(lookButton()!)
    const overlay = screen.getByTestId('deck-top-overlay')
    expect(within(overlay).getAllByTestId('card-face')).toHaveLength(1)
    expect(overlay).toHaveTextContent('Secret On Top')
  })

  it('tells nobody: looking adds no line to the log and names the card nowhere outside the overlay', async () => {
    const user = await start(deck('TST_980'), deck('TST_300'))
    await user.click(screen.getByTestId('hand-card-0'))
    await waitFor(() => expect(lookButton()).not.toBeNull())
    const before = logText()

    await user.click(lookButton()!)
    expect(screen.getByTestId('deck-top-overlay')).toHaveTextContent('Secret On Top')
    await user.click(screen.getByTestId('deck-top-overlay'))
    expect(screen.queryByTestId('deck-top-overlay')).toBeNull()

    expect(logText()).toBe(before)
    expect(logText()).not.toContain('Secret On Top')
    expect(screen.getByTestId('game-board')).not.toHaveTextContent('Secret On Top')
  })

  it("never makes the opponent's deck a click target, even when the opponent holds the permission", async () => {
    const user = await start(deck('TST_300'), deck('TST_980'))
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    await waitFor(() => expect(within(screen.getByTestId('opponent-ground-units')).queryAllByTestId(/^board-unit-u\d+$/)).toHaveLength(1))
    expect(screen.queryByTestId('opponent-deck-look')).toBeNull()
    expect(lookButton()).toBeNull()
    expect(screen.getByTestId('game-board')).not.toHaveTextContent('Secret On Top')
  })
})
