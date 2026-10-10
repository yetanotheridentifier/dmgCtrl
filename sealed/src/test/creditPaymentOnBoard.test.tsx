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
import { registerAbility, registerCard, unregisterAbility } from '../engine/abilities'
import { createCreditTokens } from '../engine/effects'
import type { PlayerId } from '../engine/types'
import { SettingsProvider } from '../hooks/useSettings'

/**
 * The standing paying step, as a player answers it on the game screen.
 *
 * A Credit token is not on the board, so its picks are buttons, one per token, with Done beside them
 * once what is left is affordable. A unit that pays as a resource is on the board and is clicked
 * there. The step is asked for a unit and for an upgrade played from hand alike.
 */

const CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '300', Name: 'Filler', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
  { Set: 'TST', Number: '980', Name: 'Banker', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '5' },
  { Set: 'TST', Number: '981', Name: 'Pricey Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '4', Power: '1', HP: '5' },
  { Set: 'TST', Number: '982', Name: 'Pricey Gear', Type: 'Upgrade', Cost: '4', Power: '1', HP: '1' },
  { Set: 'TST', Number: '983', Name: 'Control Ship', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '5' },
  { Set: 'TST', Number: '984', Name: 'Mid Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '3', Power: '1', HP: '5' },
]

beforeAll(() => {
  registerAbility('TST_980', { trigger: 'whenPlayed', description: 'Create 2 Credit tokens.', effect: (s, ctx) => createCreditTokens(s, ctx.owner, 2) })
  // Vuutun Palaa's shape, with no trait to ask for: every friendly unit may be exhausted to pay costs.
  // It enters ready so it can pay on the next turn, with no round to wait out.
  registerCard('TST_983', { unitPaysCosts: () => true, entersReady: () => true })
})
afterAll(() => { for (const id of ['TST_980', 'TST_983']) unregisterAbility(id) })

/** The Banker first, then the card to pay for, then Fillers. */
const deck = (second: string): SavedDeck => ({
  id: second, name: second, leader: 'TST_001', base: 'TST_002',
  cards: [{ id: 'TST_980', count: 1 }, { id: second, count: 1 }, { id: 'TST_300', count: 28 }], importedAt: 1,
})
const fillers: SavedDeck = { id: 'f', name: 'f', leader: 'TST_001', base: 'TST_002', cards: [{ id: 'TST_300', count: 30 }], importedAt: 1 }

const identity = <T,>(arr: T[]) => arr
// The opponent has nothing it can play, so it takes the passive move (listed last).
const OPTS: UseGameOptions = {
  shuffle: identity,
  firstPlayer: 'player',
  ai: s => {
    const moves = legalMoves(s)
    return moves.length > 0 ? moves[moves.length - 1] : null
  },
}

/** Keep the hand, resource two Fillers, and play the Banker: two resources and two Credit tokens. */
async function startWithCredits(playerDeck: SavedDeck) {
  render(<SettingsProvider><GameScreen deck={playerDeck} opponentDeck={fillers} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} /></SettingsProvider>)
  await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /keep hand/i }))
  await user.click(screen.getByTestId('hand-card-2'))
  await user.click(screen.getByTestId('hand-card-2'))
  await user.click(screen.getByTestId('hand-card-0'))
  return user
}

const unitsOn = (side: PlayerId) => within(screen.getByTestId(`${side}-ground-units`)).queryAllByTestId(/^board-unit-u\d+$/)
const creditButtons = () => screen.queryAllByRole('button', { name: /defeat a credit token/i })

describe('the standing paying step on the game screen', () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    for (const c of CARDS) await db.cards.put({ id: `TST_${c.Number}`, json: c, fetchedAt: 1 })
  })

  it('offers a button for each Credit token while paying for a unit, and plays it once they cover the cost', async () => {
    const user = await startWithCredits(deck('TST_981'))
    expect(unitsOn('player')).toHaveLength(1)
    // Four to pay with two resources: both tokens are needed, so there is no Done yet.
    await user.click(screen.getByTestId('hand-card-0'))
    expect(creditButtons().length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /^done$/i })).toBeNull()
    await user.click(creditButtons()[0])
    await user.click(creditButtons()[0])
    expect(unitsOn('player')).toHaveLength(2)
  })

  it('pays with units that count as resources by clicking them on the board', async () => {
    // The Control Ship first: every friendly unit may be exhausted to pay, itself included.
    const controlDeck: SavedDeck = {
      id: 'c', name: 'c', leader: 'TST_001', base: 'TST_002',
      cards: [{ id: 'TST_983', count: 1 }, { id: 'TST_984', count: 1 }, { id: 'TST_300', count: 28 }], importedAt: 1,
    }
    render(<SettingsProvider><GameScreen deck={controlDeck} opponentDeck={fillers} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} /></SettingsProvider>)
    await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /keep hand/i }))
    await user.click(screen.getByTestId('hand-card-2'))
    await user.click(screen.getByTestId('hand-card-2'))
    await user.click(screen.getByTestId('hand-card-0')) // the Control Ship
    await waitFor(() => expect(unitsOn('player')).toHaveLength(1))
    await user.click(screen.getByTestId('hand-card-0')) // the Mid Unit: three to pay with two resources
    expect(screen.getByTestId('action-prompt')).toHaveTextContent(/exhaust friendly units to pay for mid unit/i)
    const [ship] = unitsOn('player')
    expect(ship).toHaveAttribute('data-target', 'true')
    // The one unit that can pay covers what is left, so picking it finishes the play.
    await user.click(ship)
    expect(unitsOn('player')).toHaveLength(2)
  })

  it('asks the same of an upgrade played from hand', async () => {
    const user = await startWithCredits(deck('TST_982'))
    const [banker] = unitsOn('player')
    await user.click(screen.getByTestId('hand-card-0'))
    await user.click(banker)
    expect(creditButtons().length).toBeGreaterThan(0)
    await user.click(creditButtons()[0])
    await user.click(creditButtons()[0])
    expect(creditButtons()).toHaveLength(0)
    expect(within(unitsOn('player')[0]).getByText(/pricey gear/i)).toBeInTheDocument()
  })
})
