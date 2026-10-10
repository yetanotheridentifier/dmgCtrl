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
import { registerAbility, unregisterAbility } from '../engine/abilities'
import { createCreditTokens, createForceToken } from '../engine/effects'
import type { PlayerId } from '../engine/types'
import { SettingsProvider } from '../hooks/useSettings'

/**
 * The tokens a player holds rather than a unit: Credit tokens (a count) and the Force token (one
 * at most). Both are public, so each player's bar shows its own, the opponent's included, and the
 * Credit count is the one the paying step spends.
 */

const CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '300', Name: 'Filler', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
  { Set: 'TST', Number: '970', Name: 'Banker', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '5' },
  { Set: 'TST', Number: '971', Name: 'Pricey Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '3', Power: '1', HP: '5' },
  { Set: 'TST', Number: '972', Name: 'Adept', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '5' },
  { Set: 'TST', Number: '973', Name: 'Benefactor', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '5' },
]

const other = (side: PlayerId): PlayerId => (side === 'player' ? 'opponent' : 'player')

beforeAll(() => {
  registerAbility('TST_970', { trigger: 'whenPlayed', description: 'Create 2 Credit tokens.', effect: (s, ctx) => createCreditTokens(s, ctx.owner, 2) })
  registerAbility('TST_972', { trigger: 'whenPlayed', description: 'The Force is with you.', effect: (s, ctx) => createForceToken(s, ctx.owner) })
  registerAbility('TST_973', {
    trigger: 'whenPlayed',
    description: 'An opponent creates 3 Credit tokens. The Force is with them.',
    effect: (s, ctx) => createForceToken(createCreditTokens(s, other(ctx.owner), 3), other(ctx.owner)),
  })
})
afterAll(() => { for (const id of ['TST_970', 'TST_972', 'TST_973']) unregisterAbility(id) })

/** The named card first, then a second, then Fillers. */
const deck = (first: string, second = 'TST_300'): SavedDeck => ({
  id: first, name: first, leader: 'TST_001', base: 'TST_002',
  cards: [{ id: first, count: 1 }, { id: second, count: 1 }, { id: 'TST_300', count: 28 }], importedAt: 1,
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

/** Keep the hand and resource two Fillers, leaving the deck's first two cards at the front of the hand. */
async function start(playerDeck: SavedDeck) {
  render(<SettingsProvider><GameScreen deck={playerDeck} opponentDeck={fillers} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} /></SettingsProvider>)
  await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /keep hand/i }))
  await user.click(screen.getByTestId('hand-card-2'))
  await user.click(screen.getByTestId('hand-card-2'))
  return user
}

const mat = (side: PlayerId) => within(screen.getByTestId(`${side}-mat`))
const credits = (side: PlayerId) => mat(side).queryByTestId('credit-tokens')
const force = (side: PlayerId) => mat(side).queryByTestId('force-token')
const creditButtons = () => screen.queryAllByRole('button', { name: /defeat a credit token/i })

describe('the tokens a player holds, on the game screen', () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    for (const c of CARDS) await db.cards.put({ id: `TST_${c.Number}`, json: c, fetchedAt: 1 })
  })

  it('shows neither while neither player holds one', async () => {
    await start(deck('TST_300'))
    for (const side of ['player', 'opponent'] as const) {
      expect(credits(side)).toBeNull()
      expect(force(side)).toBeNull()
    }
  })

  it('shows your Credit tokens in your bar, with the count', async () => {
    const user = await start(deck('TST_970'))
    await user.click(screen.getByTestId('hand-card-0'))
    await waitFor(() => expect(credits('player')).toHaveTextContent('2'))
    expect(credits('player')).toHaveAccessibleName('2 Credit tokens')
    expect(credits('opponent')).toBeNull()
    expect(force('player')).toBeNull()
  })

  it('counts a Credit token down as the paying step spends it, and drops the pill at none', async () => {
    const user = await start(deck('TST_970', 'TST_971'))
    await user.click(screen.getByTestId('hand-card-0'))
    await waitFor(() => expect(credits('player')).toHaveTextContent('2'))
    // Three to pay with two resources: one token covers it, and Done leaves the other.
    await user.click(screen.getByTestId('hand-card-0'))
    await user.click(creditButtons()[0])
    await waitFor(() => expect(credits('player')).toHaveTextContent('1'))
    expect(credits('player')).toHaveAccessibleName('1 Credit token')
  })

  it('shows your Force token in your bar', async () => {
    const user = await start(deck('TST_972'))
    await user.click(screen.getByTestId('hand-card-0'))
    await waitFor(() => expect(force('player')).toHaveTextContent(/force/i))
    expect(force('player')).toHaveAccessibleName('The Force is with you')
    expect(force('opponent')).toBeNull()
    expect(credits('player')).toBeNull()
  })

  it("shows the opponent's Credit tokens and Force token in their bar", async () => {
    const user = await start(deck('TST_973'))
    await user.click(screen.getByTestId('hand-card-0'))
    await waitFor(() => expect(credits('opponent')).toHaveTextContent('3'))
    expect(force('opponent')).toHaveAccessibleName('The Force is with the opponent')
    expect(credits('player')).toBeNull()
    expect(force('player')).toBeNull()
  })
})
