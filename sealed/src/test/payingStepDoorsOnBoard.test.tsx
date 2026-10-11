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
import { createCreditTokens, drawCards } from '../engine/effects'
import { pushChoice } from '../engine/types'
import type { PlayerId } from '../engine/types'
import { SettingsProvider } from '../hooks/useSettings'

/**
 * The paying step on the doors that are not a card played from hand, as a player answers it on the
 * game screen: an ability's cost (a leader's action, a unit's action), a cost a choice carries ("you
 * may pay 2"), and a card played out of another zone (Smuggle).
 *
 * A Credit token is paid with a button, a unit that pays as a resource is clicked on the board, and
 * Done is there once what is left is affordable. The step once showed only Undo and Concede: each
 * door is checked for something to press.
 */

const CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '9', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '300', Name: 'Filler', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
  { Set: 'TST', Number: '970', Name: 'Banker', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '5' },
  { Set: 'TST', Number: '971', Name: 'Tinkerer', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '5' },
  { Set: 'TST', Number: '972', Name: 'Toll Taker', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '5' },
  { Set: 'TST', Number: '973', Name: 'Control Ship', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '5' },
  { Set: 'TST', Number: '974', Name: 'Contraband', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '5', FrontText: 'Smuggle [C=3]' },
]

beforeAll(() => {
  registerAbility('TST_970', { trigger: 'whenPlayed', description: 'Create 2 Credit tokens.', effect: (s, ctx) => createCreditTokens(s, ctx.owner, 2) })
  // A leader action that costs more than the two resources the player has.
  registerCard('TST_001', { leaderAbilities: { actions: [{ description: 'Action [C=3]: Draw a card.', cost: 3, effect: (s, ctx) => drawCards(s, ctx.owner, 1) }] } })
  registerCard('TST_971', { actionAbilities: [{ description: 'Action [C=3]: Draw a card.', cost: 3, effect: (s, ctx) => drawCards(s, ctx.owner, 1) }] })
  registerAbility('TST_972', {
    trigger: 'whenPlayed', description: 'You may pay 3. If you do, draw a card.',
    effect: (s, ctx) => pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 3, text: 'draw a card', then: { cardId: 'TST_972', owner: ctx.owner } }),
  })
  registerCard('TST_972', { ifYouDo: (s, ctx) => drawCards(s, ctx.owner, 1) })
  // Vuutun Palaa's shape with no trait to ask for: every friendly unit may be exhausted to pay costs.
  registerCard('TST_973', { unitPaysCosts: () => true, entersReady: () => true })
})
afterAll(() => { for (const id of ['TST_970', 'TST_001', 'TST_971', 'TST_972', 'TST_973']) unregisterAbility(id) })

/** The named cards first, in order, then Fillers. */
const deck = (...first: string[]): SavedDeck => ({
  id: first.join(), name: first.join(), leader: 'TST_001', base: 'TST_002',
  cards: [...first.map(id => ({ id, count: 1 })), { id: 'TST_300', count: 30 - first.length }], importedAt: 1,
})
const fillers: SavedDeck = { id: 'f', name: 'f', leader: 'TST_001', base: 'TST_002', cards: [{ id: 'TST_300', count: 30 }], importedAt: 1 }

const identity = <T,>(arr: T[]) => arr
// The opponent has nothing it can play and takes the passive move (listed last).
const OPTS: UseGameOptions = {
  shuffle: identity,
  firstPlayer: 'player',
  ai: s => {
    const moves = legalMoves(s)
    return moves.length > 0 ? moves[moves.length - 1] : null
  },
}

/** Keep the hand and resource the two cards named by hand position, highest first. */
async function start(playerDeck: SavedDeck, resource: [number, number] = [3, 3]) {
  render(<SettingsProvider><GameScreen deck={playerDeck} opponentDeck={fillers} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} /></SettingsProvider>)
  await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /keep hand/i }))
  await user.click(screen.getByTestId(`hand-card-${resource[0]}`))
  await user.click(screen.getByTestId(`hand-card-${resource[1]}`))
  return user
}

const unitsOn = (side: PlayerId) => within(screen.getByTestId(`${side}-ground-units`)).queryAllByTestId(/^board-unit-u\d+$/)
const creditButtons = () => screen.queryAllByRole('button', { name: /defeat a credit token/i })
const doneButton = () => screen.queryByRole('button', { name: /^done$/i })
const handSize = () => screen.queryAllByTestId(/^hand-card-\d+$/).length

describe('the paying step on the other doors, on the game screen', () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    for (const c of CARDS) await db.cards.put({ id: `TST_${c.Number}`, json: c, fetchedAt: 1 })
  })

  it("pays a leader action's cost with a Credit token button, and says what is being paid for", async () => {
    const user = await start(deck('TST_970'))
    await user.click(screen.getByTestId('hand-card-0')) // the Banker: two Credit tokens
    await waitFor(() => expect(unitsOn('player')).toHaveLength(1))
    const before = handSize()
    // Three to pay with two resources: one token is needed, so there is no Done yet.
    await user.click(screen.getByTestId('player-leader-card'))
    expect(screen.getByTestId('choice-overlay-prompt')).toHaveTextContent(/defeat credit tokens to pay for test leader's action \(3 to pay\)/i)
    expect(creditButtons()).toHaveLength(1)
    expect(doneButton()).toBeNull()
    await user.click(creditButtons()[0])
    // One token and two resources cover it: Done is there, and so is the second token.
    expect(doneButton()).not.toBeNull()
    await user.click(doneButton()!)
    await waitFor(() => expect(handSize()).toBe(before + 1))
    expect(creditButtons()).toHaveLength(0)
  })

  it('backs out of the step with nothing paid: the tokens, the resources and the leader are as they were', async () => {
    const user = await start(deck('TST_970'))
    await user.click(screen.getByTestId('hand-card-0')) // the Banker
    await waitFor(() => expect(unitsOn('player')).toHaveLength(1))
    // Only the player holds any, so theirs is the one pill on screen.
    const tokens = () => screen.getByTestId('credit-tokens').textContent
    const before = handSize()
    await user.click(screen.getByTestId('player-leader-card'))
    await user.click(creditButtons()[0])
    // A token is picked and not yet defeated: the count holds until the step finishes.
    expect(tokens()).toBe('Cred. 2')
    await user.click(screen.getByRole('button', { name: /cancel: take back the action/i }))
    expect(creditButtons()).toHaveLength(0)
    expect(screen.queryByTestId('choice-overlay')).toBeNull()
    expect(tokens()).toBe('Cred. 2')
    expect(handSize()).toBe(before)
    // The action is still there to take, and this time it is paid for.
    await user.click(screen.getByTestId('player-leader-card'))
    await user.click(creditButtons()[0])
    await user.click(doneButton()!)
    await waitFor(() => expect(handSize()).toBe(before + 1))
    expect(tokens()).toBe('Cred. 1')
  })

  it("pays a unit action's cost by clicking a unit that pays as a resource", async () => {
    const user = await start(deck('TST_973', 'TST_971'))
    await user.click(screen.getByTestId('hand-card-0')) // the Control Ship
    await waitFor(() => expect(unitsOn('player')).toHaveLength(1))
    await user.click(screen.getByTestId('hand-card-0')) // the Tinkerer, free: nothing to pay, so no step
    await waitFor(() => expect(unitsOn('player')).toHaveLength(2))
    // The Tinkerer entered exhausted and the opponent has passed: it is the player's turn again.
    const before = handSize()
    await user.click(await screen.findByRole('button', { name: /use tinkerer/i }))
    expect(screen.getByTestId('action-prompt')).toHaveTextContent(/exhaust friendly units to pay for tinkerer's action as if they were resources \(3 to pay\)/i)
    const ship = unitsOn('player')[0]
    expect(ship).toHaveAttribute('data-target', 'true')
    expect(doneButton()).toBeNull()
    await user.click(ship)
    await waitFor(() => expect(handSize()).toBe(before + 1))
  })

  it('pays a "you may pay" with Credit tokens after the choice is accepted', async () => {
    const user = await start(deck('TST_970', 'TST_972'))
    await user.click(screen.getByTestId('hand-card-0')) // the Banker
    await waitFor(() => expect(unitsOn('player')).toHaveLength(1))
    await user.click(screen.getByTestId('hand-card-0')) // the Toll Taker: "you may pay 3"
    const before = handSize()
    await user.click(await screen.findByRole('button', { name: /draw a card/i }))
    expect(creditButtons()).toHaveLength(1)
    expect(doneButton()).toBeNull()
    await user.click(creditButtons()[0])
    await user.click(creditButtons()[0])
    // Two tokens and one resource: the step is still open with nothing more to pick, so Done ends it.
    if (doneButton()) await user.click(doneButton()!)
    await waitFor(() => expect(handSize()).toBe(before + 1))
  })

  it('pays for a Smuggle play with a Credit token, and keeps the tokens when Done is pressed first', async () => {
    // The Contraband is resourced (hand position 1), so it can be smuggled for 3 with two resources.
    const user = await start(deck('TST_970', 'TST_974'), [1, 1])
    await user.click(screen.getByTestId('hand-card-0')) // the Banker
    await waitFor(() => expect(unitsOn('player')).toHaveLength(1))
    await user.click(await screen.findByRole('button', { name: /smuggle/i }))
    expect(screen.getByTestId('choice-overlay-prompt')).toHaveTextContent(/defeat credit tokens to pay for contraband \(3 to pay\)/i)
    expect(creditButtons()).toHaveLength(1)
    expect(doneButton()).toBeNull()
    await user.click(creditButtons()[0])
    expect(doneButton()).not.toBeNull()
    await user.click(doneButton()!)
    await waitFor(() => expect(unitsOn('player')).toHaveLength(2))
  })

  it('does not ask a player who holds nothing to pay with but resources', async () => {
    const user = await start(deck('TST_971'))
    await user.click(screen.getByTestId('hand-card-0')) // the Tinkerer
    await waitFor(() => expect(unitsOn('player')).toHaveLength(1))
    // Two resources against a cost of three: the action is simply not there.
    expect(screen.queryByRole('button', { name: /use tinkerer/i })).toBeNull()
    expect(creditButtons()).toHaveLength(0)
  })
})
