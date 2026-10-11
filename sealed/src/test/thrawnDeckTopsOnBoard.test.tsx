// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GameScreen from '../components/gameScreen'
import { db } from '../data/db'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import type { UseGameOptions } from '../hooks/useGame'
import { legalMoves } from '../engine/legalMoves'
import { SettingsProvider } from '../hooks/useSettings'

/**
 * Grand Admiral Thrawn's "When the action phase starts: Look at the top card of each player's deck", on
 * the game screen: his controller is shown both cards in one overlay and dismisses it with one click.
 * The cards reach nobody else: the log line says only that the look is done, and a Thrawn across the
 * table looks without anything appearing on this side.
 */

const THRAWN: SwuCard = { Set: 'SOR', Number: '016', Name: 'Grand Admiral Thrawn', Subtitle: 'Patient and Insightful', Type: 'Leader', VariantType: 'Normal', Cost: '6', Power: '3', HP: '9', Arenas: ['Ground'] }
const CARDS: SwuCard[] = [
  THRAWN,
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '300', Name: 'Filler', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
  { Set: 'TST', Number: '981', Name: 'My Secret', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
  { Set: 'TST', Number: '982', Name: 'Their Secret', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
]

const MINE = 'TST_981'
const THEIRS = 'TST_982'
/**
 * The player's deck is six Fillers for the opening hand, kept, then nothing but My Secret. The
 * opponent's is nothing but Their Secret, so it is on top whether or not its setup takes a mulligan;
 * its hand and resources are face-down and at nine resources a card it never plays one.
 */
const deck = (leader: string, top: string): SavedDeck => ({
  id: `${leader}-${top}`, name: leader, leader, base: 'TST_002',
  cards: top === THEIRS ? [{ id: top, count: 30 }] : [{ id: 'TST_300', count: 6 }, { id: top, count: 24 }], importedAt: 1,
})

const identity = <T,>(arr: T[]) => arr
// The opponent answers whatever it is asked and otherwise takes the passive move (listed last).
const OPTS: UseGameOptions = {
  shuffle: identity,
  firstPlayer: 'player',
  rngSeed: 1,
  ai: s => {
    const moves = legalMoves(s)
    return moves.length > 0 ? moves[moves.length - 1] : null
  },
}

/** Keep the hand and resource two cards: setup ends and the first action phase starts. */
async function start(playerDeck: SavedDeck, opponentDeck: SavedDeck) {
  render(<SettingsProvider><GameScreen deck={playerDeck} opponentDeck={opponentDeck} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} /></SettingsProvider>)
  await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /keep hand/i }))
  await user.click(screen.getByTestId('hand-card-0'))
  await user.click(screen.getByTestId('hand-card-0'))
  return user
}

const overlay = () => screen.queryByTestId('deck-tops-overlay')
const logText = () => screen.getByTestId('game-log').textContent ?? ''

describe("Grand Admiral Thrawn's look at the top card of each deck, on the game screen", () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    for (const c of CARDS) await db.cards.put({ id: `${c.Set}_${c.Number}`, json: c, fetchedAt: 1 })
  })

  it('shows his controller both top cards, each labelled with whose deck it is, as the action phase starts', async () => {
    await start(deck('SOR_016', MINE), deck('TST_001', THEIRS))
    await waitFor(() => expect(overlay()).not.toBeNull())
    const shown = overlay()!
    expect(within(shown).getAllByTestId('card-face')).toHaveLength(2)
    expect(shown).toHaveTextContent('My Secret')
    expect(shown).toHaveTextContent('Their Secret')
    expect(within(shown).getByTestId('deck-tops-caption-player')).toHaveTextContent('Your deck')
    expect(within(shown).getByTestId('deck-tops-caption-opponent')).toHaveTextContent("Opponent's deck")
    expect(within(shown).getByTestId('deck-tops-prompt')).toHaveTextContent('Grand Admiral Thrawn')
  })

  it('is dismissed with one click on Done, and play carries on', async () => {
    const user = await start(deck('SOR_016', MINE), deck('TST_001', THEIRS))
    await waitFor(() => expect(overlay()).not.toBeNull())
    expect(within(overlay()!).getAllByRole('button').filter(b => b.getAttribute('data-testid') !== 'overlay-dismiss')).toHaveLength(1)

    await user.click(screen.getByTestId('deck-tops-done'))
    expect(overlay()).toBeNull()
    expect(screen.getByRole('button', { name: /^pass$/i })).toBeInTheDocument()
  })

  it('is dismissed by clicking beside it too', async () => {
    const user = await start(deck('SOR_016', MINE), deck('TST_001', THEIRS))
    await waitFor(() => expect(overlay()).not.toBeNull())
    await user.click(overlay()!)
    expect(overlay()).toBeNull()
    expect(screen.getByRole('button', { name: /^pass$/i })).toBeInTheDocument()
  })

  it('names the cards nowhere but the overlay: not in the log, and not on the board once it is closed', async () => {
    const user = await start(deck('SOR_016', MINE), deck('TST_001', THEIRS))
    await waitFor(() => expect(overlay()).not.toBeNull())
    expect(logText()).not.toMatch(/My Secret|Their Secret/)

    await user.click(screen.getByTestId('deck-tops-done'))
    expect(logText()).not.toMatch(/My Secret|Their Secret/)
    expect(screen.getByTestId('game-board')).not.toHaveTextContent(/My Secret|Their Secret/)
  })

  it("shows this side nothing when the opponent's Thrawn looks", async () => {
    await start(deck('TST_001', MINE), deck('SOR_016', THEIRS))
    await waitFor(() => expect(screen.getByRole('button', { name: /^pass$/i })).toBeInTheDocument())
    expect(overlay()).toBeNull()
    expect(logText()).not.toMatch(/My Secret|Their Secret/)
    expect(screen.getByTestId('game-board')).not.toHaveTextContent(/My Secret|Their Secret/)
  })

  it('asks nothing of a player whose leader is not Thrawn', async () => {
    await start(deck('TST_001', MINE), deck('TST_001', THEIRS))
    await waitFor(() => expect(screen.getByRole('button', { name: /^pass$/i })).toBeInTheDocument())
    expect(overlay()).toBeNull()
  })
})
