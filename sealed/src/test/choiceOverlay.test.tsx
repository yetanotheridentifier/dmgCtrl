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
import { pushChoice } from '../engine/types'
import type { PlayerId } from '../engine/types'
import { SettingsProvider } from '../hooks/useSettings'
import { answeredWithButtons } from '../utils/describeChoice'

/**
 * Triggered choices in the game screen: where they are asked, and what dismissing them does.
 *
 * A choice answered with buttons is asked in a centre-screen overlay rather than in the action
 * column, which holds only what the player initiates. Every overlay can be dismissed on the player's
 * OWN trigger, and dismissing cancels the action that raised it. On the opponent's trigger there is
 * no action of the player's to take back: the button overlay can still be put aside to look at the
 * board (and reopened from the action column), while the dedicated overlays stay blocking.
 */

const other = (p: PlayerId): PlayerId => (p === 'player' ? 'opponent' : 'player')

const CARDS: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '300', Name: 'Filler', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
  { Set: 'TST', Number: '960', Name: 'Choosy Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
  { Set: 'TST', Number: '961', Name: 'Taxing Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
  { Set: 'TST', Number: '962', Name: 'Naming Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
  { Set: 'TST', Number: '963', Name: 'Asking Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
  { Set: 'TST', Number: '965', Name: 'Plain Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
  { Set: 'TST', Number: '966', Name: 'Ambusher', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '3', HP: '3', Keywords: ['Ambush'], FrontText: 'Ambush' },
]

const OPTIONS = [
  { label: 'Ground units: +1 power', kind: 'arenaLastingBuff' as const, arena: 'ground' as const, power: 1 },
  { label: 'Space units: +1 power', kind: 'arenaLastingBuff' as const, arena: 'space' as const, power: 1 },
]

beforeAll(() => {
  // A button choice for the unit's own controller, and the same choice handed to the other player.
  registerAbility('TST_960', { trigger: 'whenPlayed', description: 'Choose one.', effect: (s, ctx) => pushChoice(s, { kind: 'chooseOne', id: 'pick', controller: ctx.owner, options: OPTIONS }) })
  registerAbility('TST_961', { trigger: 'whenPlayed', description: 'The opponent chooses one.', effect: (s, ctx) => pushChoice(s, { kind: 'chooseOne', id: 'pick', controller: other(ctx.owner), options: OPTIONS }) })
  // A choice with a dedicated overlay (name a Trait), for each side in the same way.
  registerAbility('TST_962', { trigger: 'whenPlayed', description: 'Name a Trait.', effect: (s, ctx) => pushChoice(s, { kind: 'nameTrait', id: 'trait', controller: ctx.owner, losesIt: other(ctx.owner) }) })
  registerAbility('TST_963', { trigger: 'whenPlayed', description: 'The opponent names a Trait.', effect: (s, ctx) => pushChoice(s, { kind: 'nameTrait', id: 'trait', controller: other(ctx.owner), losesIt: ctx.owner }) })
})
afterAll(() => { for (const id of ['TST_960', 'TST_961', 'TST_962', 'TST_963']) unregisterAbility(id) })

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

const unitsOn = (side: PlayerId) => within(screen.getByTestId(`${side}-ground-units`)).queryAllByTestId(/^board-unit-u\d+$/)

describe('triggered choices in the game screen', () => {
  beforeEach(async () => {
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    for (const c of CARDS) await db.cards.put({ id: `TST_${c.Number}`, json: c, fetchedAt: 1 })
  })

  it('asks a button choice in an overlay, not in the action column', async () => {
    const user = await start(deck('p', 'TST_960'), allOf('TST_300'))
    await user.click(screen.getByTestId('hand-card-0'))

    const overlay = screen.getByTestId('choice-overlay')
    // Answered with buttons, so drawn at the game-over screen's size.
    expect(overlay.querySelector('section')).toHaveAttribute('data-size', 'panel')
    expect(within(overlay).getByTestId('choice-overlay-prompt')).toHaveTextContent(/choose one effect/i)
    expect(within(overlay).getByTestId('choice-option-0')).toHaveTextContent('Ground units: +1 power')
    expect(within(overlay).getByTestId('choice-option-1')).toHaveTextContent('Space units: +1 power')
    // The action column no longer carries the options.
    expect(within(screen.getByTestId('player-mat')).queryByRole('button', { name: /units: \+1 power/i })).toBeNull()
    // The overlay carries the prompt, so the floating one under the round tracker is not shown twice.
    expect(screen.queryByTestId('action-prompt')).toBeNull()
  })

  it('answers the choice from the overlay', async () => {
    const user = await start(deck('p', 'TST_960'), allOf('TST_300'))
    await user.click(screen.getByTestId('hand-card-0'))
    await user.click(screen.getByTestId('choice-option-0'))
    expect(screen.queryByTestId('choice-overlay')).toBeNull()
    expect(unitsOn('player')).toHaveLength(1)
  })

  it('cancels your own action when its overlay is dismissed', async () => {
    const user = await start(deck('p', 'TST_960'), allOf('TST_300'))
    await user.click(screen.getByTestId('hand-card-0'))
    expect(unitsOn('player')).toHaveLength(1)

    await user.click(within(screen.getByTestId('choice-overlay')).getByTestId('overlay-dismiss'))
    expect(screen.queryByTestId('choice-overlay')).toBeNull()
    // The unit is back in hand and off the board: the play never happened.
    expect(unitsOn('player')).toHaveLength(0)
    expect(screen.getByTestId('hand-card-0')).toHaveTextContent(/choosy unit/i)
  })

  /**
   * The opponent's trigger cannot be cancelled, but a button choice can still be set aside to look at
   * the board, and brought back from the action column.
   */
  it("hides a button choice on the opponent's trigger, and reopens it from the action column", async () => {
    const user = await start(deck('p', 'TST_300'), allOf('TST_961'))
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    expect(unitsOn('opponent')).toHaveLength(1)

    await user.click(within(screen.getByTestId('choice-overlay')).getByTestId('overlay-dismiss'))
    expect(screen.queryByTestId('choice-overlay')).toBeNull()
    // Nothing was taken back: the opponent's unit is still in play, and the choice is still owed.
    expect(unitsOn('opponent')).toHaveLength(1)
    // With the overlay put aside, the board prompt says what is still being asked.
    expect(screen.getByTestId('action-prompt')).toHaveTextContent(/choose one effect/i)

    await user.click(screen.getByTestId('show-choice-btn'))
    expect(screen.getByTestId('choice-overlay')).toBeInTheDocument()
  })

  it('lets a dedicated overlay be dismissed on your own trigger, cancelling the action', async () => {
    const user = await start(deck('p', 'TST_962'), allOf('TST_300'))
    await user.click(screen.getByTestId('hand-card-0'))
    const overlay = screen.getByTestId('name-card-overlay')
    await user.click(within(overlay).getByTestId('overlay-dismiss'))
    expect(screen.queryByTestId('name-card-overlay')).toBeNull()
    expect(unitsOn('player')).toHaveLength(0)
  })

  it("keeps a dedicated overlay blocking on the opponent's trigger", async () => {
    const user = await start(deck('p', 'TST_300'), allOf('TST_963'))
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    const overlay = screen.getByTestId('name-card-overlay')
    expect(within(overlay).queryByTestId('overlay-dismiss')).toBeNull()
  })

  /**
   * Ambush is answered by clicking an enemy unit; its only button is the decline. An overlay over
   * the board would leave nothing to click but "Don't ambush", so it must stay on the board.
   */
  it('keeps Ambush on the board: no overlay, the enemy unit a target, the decline in the action column', async () => {
    const user = await start(deck('p', 'TST_966'), allOf('TST_965'))
    // The opponent plays a unit into the ground arena, then the Ambusher enters with it there.
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    expect(unitsOn('opponent')).toHaveLength(1)
    await user.click(screen.getByTestId('hand-card-0'))

    expect(screen.queryByTestId('choice-overlay')).toBeNull()
    expect(within(screen.getByTestId('player-mat')).getByRole('button', { name: /don't ambush/i })).toBeInTheDocument()

    const [ambusher] = unitsOn('player')
    expect(ambusher).toHaveAttribute('data-actionable', 'true')
    await user.click(ambusher)
    const [enemy] = unitsOn('opponent')
    expect(enemy).toHaveAttribute('data-target', 'true')
    const enemyId = enemy.getAttribute('data-testid')!
    await user.click(enemy)
    // The ambush attack defeated it (the opponent may since have played another unit).
    expect(screen.queryByTestId(enemyId)).toBeNull()
  })
})

/**
 * Which choices the button overlay takes: those answered by picking a button that isn't a decline.
 * A choice answered on the board (an attack, a unit or base target) or from the hand keeps that
 * affordance, with its decline beside it in the action column.
 */
describe('answeredWithButtons', () => {
  const id = 'c'
  const skip = { type: 'skipTrigger' as const, choiceId: id }

  it('takes a choice answered by option buttons, with or without a decline', () => {
    expect(answeredWithButtons([{ type: 'acceptChoice', choiceId: id, optionIndex: 0 }, { type: 'acceptChoice', choiceId: id, optionIndex: 1 }])).toBe(true)
    expect(answeredWithButtons([{ type: 'acceptChoice', choiceId: id }, skip])).toBe(true)
  })

  it('leaves a choice whose only button is the decline', () => {
    expect(answeredWithButtons([skip])).toBe(false)
  })

  it('leaves a choice answered by attacking (Ambush, Support, an attack-now)', () => {
    expect(answeredWithButtons([{ type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' }, choiceId: id }, skip])).toBe(false)
  })

  it('leaves a choice answered by picking a unit, a base or a hand card', () => {
    expect(answeredWithButtons([{ type: 'acceptChoice', choiceId: id, targetInstanceId: 'e1' }, skip])).toBe(false)
    expect(answeredWithButtons([{ type: 'acceptChoice', choiceId: id, baseTarget: 'opponent' }])).toBe(false)
    expect(answeredWithButtons([{ type: 'acceptChoice', choiceId: id, handIndex: 0 }, skip])).toBe(false)
  })
})
