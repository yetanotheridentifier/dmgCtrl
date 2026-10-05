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
import { dealDamageToUnit, dealIndirectDamage } from '../engine/combat'
import { pushChoice } from '../engine/types'
import type { GameState, PlayerId } from '../engine/types'
import { SettingsProvider } from '../hooks/useSettings'

/**
 * Choices that pick a unit or a base are answered by clicking it on the board: the candidates are
 * highlighted, and the action column carries only the decline (Done for a repeatable pick), never a
 * "Choose X" button per candidate. A repeatable allocation shows how much of it is spent.
 */

const other = (p: PlayerId): PlayerId => (p === 'player' ? 'opponent' : 'player')

const CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '300', Name: 'Filler', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
  { Set: 'TST', Number: '965', Name: 'Plain Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
  { Set: 'TST', Number: '970', Name: 'Dealer Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '2', HP: '3' },
  { Set: 'TST', Number: '971', Name: 'Bouncer Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
  { Set: 'TST', Number: '972', Name: 'Healer Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
  { Set: 'TST', Number: '973', Name: 'Indirect Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
  { Set: 'TST', Number: '974', Name: 'Base Hitter', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
]

const unitsOf = (s: GameState, side: PlayerId) => s.players[side].units.map(u => u.instanceId)
const damageBase = (s: GameState, side: PlayerId, damage: number): GameState =>
  ({ ...s, players: { ...s.players, [side]: { ...s.players[side], base: { ...s.players[side].base, damage } } } })

beforeAll(() => {
  // Overgrowth's shape: a friendly unit, then an enemy unit, each a `selectUnitThen`.
  registerCard('TST_970', {
    abilities: [{
      trigger: 'whenPlayed',
      description: 'A friendly unit deals damage equal to its power to an enemy unit.',
      effect: (s, ctx) => pushChoice(s, { kind: 'selectUnitThen', id: 'dealer', controller: ctx.owner, targets: unitsOf(s, ctx.owner), text: 'choose the unit that deals the damage', then: { cardId: ctx.cardId, owner: ctx.owner, sourceInstanceId: ctx.sourceInstanceId, step: 'dealer' } }),
    }],
    ifYouDo: (s, ctx) => ctx.step === 'dealer'
      ? pushChoice(s, { kind: 'selectUnitThen', id: 'target', controller: ctx.owner, targets: unitsOf(s, other(ctx.owner)), text: 'choose the enemy unit to damage', then: { cardId: ctx.cardId, owner: ctx.owner, sourceInstanceId: ctx.sourceInstanceId, step: 'target', unit: ctx.targetInstanceId } })
      : dealDamageToUnit(s, ctx.targetInstanceId!, 2),
  })
  // A "may return a unit" pick.
  registerAbility('TST_971', { trigger: 'whenPlayed', description: 'You may return an enemy unit to its owner\'s hand.', effect: (s, ctx) => pushChoice(s, { kind: 'selectUnitToReturn', id: 'bounce', controller: ctx.owner, targets: unitsOf(s, other(ctx.owner)), optional: true }) })
  // Heal up to 2 damage from your base, one point at a time.
  registerAbility('TST_972', { trigger: 'whenPlayed', description: 'Heal up to 2 damage among your base.', effect: (s, ctx) => pushChoice(damageBase(s, ctx.owner, 5), { kind: 'distributeHealing', id: 'heal', controller: ctx.owner, remaining: 2, healed: 0, unitTargets: [], baseTargets: [ctx.owner] }) })
  // The opponent's unit deals 2 indirect damage to you.
  registerAbility('TST_973', { trigger: 'whenPlayed', description: 'Deal 2 indirect damage to each opponent.', effect: (s, ctx) => dealIndirectDamage(s, other(ctx.owner), 2, { cardId: ctx.cardId, controller: ctx.owner }) })
  // Deal 1 damage to each of any number of bases.
  registerAbility('TST_974', { trigger: 'whenPlayed', description: 'Deal 1 damage to any number of bases.', effect: (s, ctx) => pushChoice(s, { kind: 'damageAnyBases', id: 'bases', controller: ctx.owner, remaining: ['player', 'opponent'], amount: 1 }) })
})
afterAll(() => { for (const id of ['TST_970', 'TST_971', 'TST_972', 'TST_973', 'TST_974']) unregisterAbility(id) })

const deck = (id: string, first: string): SavedDeck => ({
  id, name: id, leader: 'TST_001', base: 'TST_002', cards: [{ id: first, count: 1 }, { id: 'TST_300', count: 29 }], importedAt: 1,
})
const allOf = (cardId: string): SavedDeck => ({ id: cardId, name: cardId, leader: 'TST_001', base: 'TST_002', cards: [{ id: cardId, count: 30 }], importedAt: 1 })

const identity = <T,>(arr: T[]) => arr
// The opponent plays any unit it can, else takes the passive move (listed last).
const OPTS: UseGameOptions = {
  shuffle: identity,
  firstPlayer: 'player',
  ai: s => {
    const moves = legalMoves(s)
    return moves.find(a => a.type === 'playUnit') ?? (moves.length > 0 ? moves[moves.length - 1] : null)
  },
}

/** Keep the opening hand and resource two Fillers, leaving the deck's first card at hand index 0. */
async function start(playerDeck: SavedDeck, opponentDeck: SavedDeck) {
  render(<SettingsProvider><GameScreen deck={playerDeck} opponentDeck={opponentDeck} onExit={vi.fn()} onHelp={vi.fn()} gameOptions={OPTS} /></SettingsProvider>)
  await waitFor(() => expect(screen.getByTestId('game-board')).toBeInTheDocument())
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /keep hand/i }))
  await user.click(screen.getByTestId('hand-card-1'))
  await user.click(screen.getByTestId('hand-card-1'))
  return user
}

/** The opponent passes its turn's first unit onto the board, then the player plays its card. */
async function opponentUnitThenPlay(user: Awaited<ReturnType<typeof start>>) {
  await user.click(screen.getByRole('button', { name: /^pass$/i }))
  expect(unitsOn('opponent')).toHaveLength(1)
  await user.click(screen.getByTestId('hand-card-0'))
}

const unitsOn = (side: PlayerId) => within(screen.getByTestId(`${side}-ground-units`)).queryAllByTestId(/^board-unit-u\d+$/)
const actionColumn = () => within(screen.getByTestId('player-mat'))
// No button per candidate: none reading "Choose ...", and none naming a unit or base on offer.
const noChooseButtons = () => expect(actionColumn().queryByRole('button', { name: /^choose |plain unit|dealer unit|test base/i })).toBeNull()

describe('unit and base picks answered on the board', () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    for (const c of CARDS) await db.cards.put({ id: `TST_${c.Number}`, json: c, fetchedAt: 1 })
  })

  it('asks both of Overgrowth-style steps on the board, with no Choose buttons', async () => {
    const user = await start(deck('p', 'TST_970'), allOf('TST_965'))
    await opponentUnitThenPlay(user)

    // Step one: the friendly unit that deals the damage.
    expect(screen.getByTestId('action-prompt')).toHaveTextContent(/choose the unit that deals the damage/i)
    expect(screen.queryByTestId('choice-overlay')).toBeNull()
    noChooseButtons()
    const [dealer] = unitsOn('player')
    expect(dealer).toHaveAttribute('data-target', 'true')
    expect(unitsOn('opponent')[0]).not.toHaveAttribute('data-target', 'true')
    await user.click(dealer)

    // Step two: the enemy unit to damage.
    expect(screen.getByTestId('action-prompt')).toHaveTextContent(/choose the enemy unit to damage/i)
    noChooseButtons()
    const [enemy] = unitsOn('opponent')
    expect(enemy).toHaveAttribute('data-target', 'true')
    // Mandatory: no decline offered.
    expect(screen.queryByTestId('decline-choice-btn')).toBeNull()
    const enemyId = enemy.getAttribute('data-testid')!
    await user.click(enemy)

    // Defeated by the damage (the opponent then plays another unit on its turn).
    expect(screen.queryByTestId(enemyId)).toBeNull()
    expect(screen.queryByTestId('action-prompt')).toBeNull()
  })

  it('answers an optional return pick on the board, with Decline in the action column', async () => {
    const user = await start(deck('p', 'TST_971'), allOf('TST_965'))
    await opponentUnitThenPlay(user)

    noChooseButtons()
    expect(screen.getByTestId('decline-choice-btn')).toHaveTextContent('Decline')
    const [enemy] = unitsOn('opponent')
    expect(enemy).toHaveAttribute('data-target', 'true')
    const enemyId = enemy.getAttribute('data-testid')!
    await user.click(enemy)
    expect(screen.queryByTestId(enemyId)).toBeNull()
  })

  it('allocates healing on the board with the HUD and Done', async () => {
    const user = await start(deck('p', 'TST_972'), allOf('TST_300'))
    await user.click(screen.getByTestId('hand-card-0'))

    noChooseButtons()
    expect(screen.getByTestId('decline-choice-btn')).toHaveTextContent('Done')
    expect(screen.getByTestId('distribute-hud')).toHaveTextContent(/healing allocated 0 \/ 2/i)
    await user.click(screen.getByTestId('target-player-base'))
    expect(screen.getByTestId('distribute-hud')).toHaveTextContent(/healing allocated 1 \/ 2/i)
    await user.click(screen.getByTestId('decline-choice-btn'))
    expect(screen.queryByTestId('distribute-hud')).toBeNull()
  })

  it('assigns indirect damage on the board with the HUD and no decline', async () => {
    const user = await start(deck('p', 'TST_300'), allOf('TST_973'))
    await user.click(screen.getByRole('button', { name: /^pass$/i }))

    noChooseButtons()
    expect(screen.queryByTestId('decline-choice-btn')).toBeNull()
    expect(screen.getByTestId('distribute-hud')).toHaveTextContent(/indirect damage allocated 0 \/ 2/i)
    await user.click(screen.getByTestId('target-player-base'))
    expect(screen.getByTestId('distribute-hud')).toHaveTextContent(/indirect damage allocated 1 \/ 2/i)
  })

  it('picks bases one at a time on the board, with Done', async () => {
    const user = await start(deck('p', 'TST_974'), allOf('TST_300'))
    await user.click(screen.getByTestId('hand-card-0'))

    noChooseButtons()
    expect(screen.getByTestId('decline-choice-btn')).toHaveTextContent('Done')
    // The base readout shows damage taken.
    expect(screen.getByTestId('opponent-base-hp')).toHaveTextContent(/^0$/)
    await user.click(screen.getByTestId('target-opponent-base'))
    expect(screen.getByTestId('opponent-base-hp')).toHaveTextContent(/^1$/)
    expect(screen.getByTestId('decline-choice-btn')).toHaveTextContent('Done')
  })
})
