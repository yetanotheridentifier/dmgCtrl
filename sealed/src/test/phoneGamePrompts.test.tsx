// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GameScreen, { TriggerOrderOverlay } from '../components/gameScreen'
import { PhonePrompt } from '../components/game/phoneLayout'
import { CardInspect } from '../components/useCardZoom'
import { PHONE_LANDSCAPE_QUERY } from '../hooks/useMediaQuery'
import { db } from '../data/db'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import type { UseGameOptions } from '../hooks/useGame'
import { legalMoves } from '../engine/legalMoves'
import { registerAbility, unregisterAbility } from '../engine/abilities'
import { pushChoice } from '../engine/types'
import type { PendingTrigger, PlayerId } from '../engine/types'
import { SettingsProvider } from '../hooks/useSettings'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'

/**
 * The prompts a card raises, on a phone in landscape: one pattern for all of them. A panel over the
 * dimmed board names the card that asked (tappable to see it), asks the question, and answers with the
 * shared buttons, one of them primary. The × takes back your own move, and only while nothing hidden
 * has been seen; a question you cannot take back is set aside to look at the board instead.
 */

function withMedia(matching: string[]) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({ matches: matching.includes(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

/** The shared Button marks its primary by the accent fill. */
const isPrimary = (el: HTMLElement) => el.style.background === 'var(--color-accent)'

describe('PhonePrompt', () => {
  const s = state({ cards: { ...CARDS, TST_U1: card({ id: 'TST_U1', name: 'Maz Kanata', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 4 }) } })

  it('names the card that asked, asks the question, and answers with one primary button', async () => {
    const onYes = vi.fn()
    render(
      <PhonePrompt
        testId="p"
        state={s}
        cardId="TST_U1"
        eyebrow="Maz Kanata"
        question="Attack with a Force unit?"
        buttons={[{ label: "Don't attack", onClick: vi.fn() }, { label: 'Attack', onClick: onYes, primary: true, testId: 'yes' }]}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: /maz kanata: attack with a force unit/i })
    expect(within(dialog).getByText('MAZ KANATA')).toBeInTheDocument()
    const buttons = within(dialog).getAllByRole('button').filter(b => /attack/i.test(b.textContent ?? ''))
    expect(buttons.map(b => b.textContent)).toEqual(["Don't attack", 'Attack'])
    expect(buttons.filter(isPrimary)).toEqual([screen.getByTestId('yes')])
    await userEvent.setup().click(screen.getByTestId('yes'))
    expect(onYes).toHaveBeenCalledOnce()
  })

  it('opens the card that asked full size on a tap', async () => {
    const inspect = vi.fn()
    render(
      <CardInspect.Provider value={inspect}>
        <PhonePrompt testId="p" state={s} cardId="TST_U1" eyebrow="Maz Kanata" question="Attack?" buttons={[]} />
      </CardInspect.Provider>,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: /maz kanata: see the card/i }))
    expect(inspect).toHaveBeenCalledWith({ cardId: 'TST_U1' })
  })

  it('offers the × only when there is a move to take back, and says what it takes back', async () => {
    const onCancel = vi.fn()
    const { rerender } = render(<PhonePrompt testId="p" state={s} question="Choose one" buttons={[]} onCancel={onCancel} cancelLabel="Cancel: take back playing Maz Kanata" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel: take back playing Maz Kanata' }))
    expect(onCancel).toHaveBeenCalledOnce()
    rerender(<PhonePrompt testId="p" state={s} question="Choose one" buttons={[]} />)
    expect(screen.queryByTestId('overlay-dismiss')).toBeNull()
  })

  it('sets a question aside to look at the board when it cannot be taken back', async () => {
    const onSetAside = vi.fn()
    render(<PhonePrompt testId="p" state={s} question="Choose one" buttons={[]} onSetAside={onSetAside} />)
    expect(screen.queryByTestId('overlay-dismiss')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: /look at the board/i }))
    expect(onSetAside).toHaveBeenCalledOnce()
  })
})

describe('who resolves first, on a phone', () => {
  const cards = {
    ...CARDS,
    ASH_116: card({ id: 'ASH_116', name: 'Ant Droid', type: 'unit', arena: 'ground', power: 1, hp: 1 }),
    ASH_153: card({ id: 'ASH_153', name: 'Green Leader', type: 'unit', arena: 'ground', power: 3, hp: 3 }),
  }
  const trigger = (over: Pick<PendingTrigger, 'id' | 'controller' | 'cardId'>): PendingTrigger => ({ point: 'whenDefeated', abilityIndex: 0, layer: 0, ...over })
  const board = state({ cards, players: { player: player({ units: [unit('a', 'ASH_153')] }), opponent: player({ units: [unit('e', 'ASH_116')] }) } })

  it("lists both sides' triggers, with They resolve first beside the primary I resolve first", async () => {
    const onPick = vi.fn()
    render(
      <TriggerOrderOverlay
        phone
        state={board}
        mine={[trigger({ id: 'ours', controller: 'player', cardId: 'ASH_153' })]}
        theirs={[trigger({ id: 'theirs', controller: 'opponent', cardId: 'ASH_116' })]}
        onPick={onPick}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: /who resolves first/i })
    expect(within(screen.getByTestId('trigger-order-mine')).getByText(/Green Leader/)).toBeInTheDocument()
    expect(within(screen.getByTestId('trigger-order-theirs')).getByText(/Ant Droid/)).toBeInTheDocument()
    const theirs = within(dialog).getByTestId('trigger-order-theirs-btn')
    const mine = within(dialog).getByTestId('trigger-order-mine-btn')
    expect(theirs).toHaveTextContent('They resolve first')
    expect(mine).toHaveTextContent('I resolve first')
    expect(isPrimary(mine)).toBe(true)
    expect(isPrimary(theirs)).toBe(false)
    // Primary on the right, as everywhere on the phone.
    expect(theirs.compareDocumentPosition(mine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.setup().click(mine)
    expect(onPick).toHaveBeenCalledWith(0)
  })
})

const other = (p: PlayerId): PlayerId => (p === 'player' ? 'opponent' : 'player')

const SWU: SwuCard[] = [
  { Set: 'TST', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
  { Set: 'TST', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
  { Set: 'TST', Number: '300', Name: 'Filler', Type: 'Unit', Arenas: ['Ground'], Cost: '9', Power: '1', HP: '1' },
  { Set: 'TST', Number: '960', Name: 'Choosy Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
  { Set: 'TST', Number: '961', Name: 'Taxing Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
  { Set: 'TST', Number: '964', Name: 'Peeking Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
  { Set: 'TST', Number: '965', Name: 'Plain Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '1', HP: '1' },
]

const OPTIONS = [
  { label: 'Ground units: +1 power', kind: 'arenaLastingBuff' as const, arena: 'ground' as const, power: 1 },
  { label: 'Space units: +1 power', kind: 'arenaLastingBuff' as const, arena: 'space' as const, power: 1 },
]

beforeAll(() => {
  registerAbility('TST_960', { trigger: 'whenPlayed', description: 'Choose one.', effect: (s, ctx) => pushChoice(s, { kind: 'chooseOne', id: 'pick', controller: ctx.owner, options: OPTIONS }) })
  registerAbility('TST_961', { trigger: 'whenPlayed', description: 'The opponent chooses one.', effect: (s, ctx) => pushChoice(s, { kind: 'chooseOne', id: 'pick', controller: other(ctx.owner), options: OPTIONS }) })
  // Camtono's look at the top card, raised on play: a reveal, so there is nothing to take back after it.
  registerAbility('TST_964', {
    trigger: 'whenPlayed',
    description: 'Look at the top card of your deck.',
    effect: (s, ctx) => pushChoice(s, { kind: 'mayPlayTopFree', id: 'look', controller: ctx.owner, unitId: ctx.sourceInstanceId!, cardId: s.players[ctx.owner].deck[0] }),
  })
})
afterAll(() => { for (const id of ['TST_960', 'TST_961', 'TST_964']) unregisterAbility(id) })

const deck = (id: string, first: string, rest = 'TST_300'): SavedDeck => ({
  id, name: id, leader: 'TST_001', base: 'TST_002', cards: [{ id: first, count: 1 }, { id: rest, count: 29 }], importedAt: 1,
})
const allOf = (cardId: string): SavedDeck => ({ id: cardId, name: cardId, leader: 'TST_001', base: 'TST_002', cards: [{ id: cardId, count: 30 }], importedAt: 1 })

const identity = <T,>(arr: T[]) => arr
const OPTS: UseGameOptions = {
  shuffle: identity,
  firstPlayer: 'player',
  opponentDelayMs: 0,
  ai: s => {
    const moves = legalMoves(s)
    return moves.find(a => a.type === 'playUnit') ?? (moves.length > 0 ? moves[moves.length - 1] : null)
  },
}

/** Keep the opening hand and resource two cards, leaving the deck's first card at hand index 0. */
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

describe('GameScreen prompts on a phone in landscape', () => {
  beforeEach(async () => {
    withMedia([PHONE_LANDSCAPE_QUERY])
    await db.cards.clear()
    await db.games.clear()
    localStorage.clear()
    for (const c of SWU) await db.cards.put({ id: `TST_${c.Number}`, json: c, fetchedAt: 1 })
  })
  afterEach(() => withMedia([]))

  it('asks a choice from your own card in the prompt panel, naming the card, and × takes the play back', async () => {
    const user = await start(deck('p', 'TST_960'), allOf('TST_300'))
    await user.click(screen.getByTestId('hand-card-0'))

    const dialog = screen.getByRole('dialog', { name: /choosy unit: choose one effect/i })
    expect(within(dialog).getByText('CHOOSY UNIT')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /choosy unit: see the card/i })).toBeInTheDocument()
    expect(within(dialog).getByTestId('choice-option-0')).toHaveTextContent('Ground units: +1 power')
    expect(within(dialog).getByTestId('choice-option-1')).toHaveTextContent('Space units: +1 power')
    expect([0, 1].filter(i => isPrimary(screen.getByTestId(`choice-option-${i}`)))).toHaveLength(1)

    await user.click(within(dialog).getByRole('button', { name: /cancel: take back/i }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(unitsOn('player')).toHaveLength(0)
    expect(screen.getByTestId('hand-card-0')).toHaveTextContent(/choosy unit/i)
  })

  it("sets the opponent's question aside to look at the board, and brings it back with Show choice", async () => {
    const user = await start(deck('p', 'TST_300'), allOf('TST_961'))
    await user.click(screen.getByRole('button', { name: /^pass$/i }))
    const dialog = screen.getByTestId('choice-overlay')
    // Nothing of yours to take back.
    expect(within(dialog).queryByTestId('overlay-dismiss')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: /look at the board/i }))
    expect(screen.queryByTestId('choice-overlay')).toBeNull()
    expect(screen.getByTestId('action-prompt')).toHaveTextContent(/taxing unit.*look at the board, then answer/i)
    const show = within(screen.getByTestId('phone-controls')).getByTestId('show-choice-btn')
    expect(isPrimary(show)).toBe(true)

    await user.click(show)
    expect(screen.getByTestId('choice-overlay')).toBeInTheDocument()
  })

  it('shows the top card of your deck beside the question, with no × once it has been seen', async () => {
    const user = await start(deck('p', 'TST_964', 'TST_965'), allOf('TST_300'))
    await user.click(screen.getByTestId('hand-card-0'))

    const dialog = screen.getByRole('dialog', { name: /peeking unit/i })
    expect(within(dialog).getByText(/top of your deck/i)).toBeInTheDocument()
    expect(within(dialog).getByText('Only you see this card.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /plain unit: see the card/i })).toBeInTheDocument()
    // A card has been seen: the play cannot be taken back.
    expect(within(dialog).queryByTestId('overlay-dismiss')).toBeNull()
    const answers = within(dialog).getAllByTestId(/^choice-btn-\d$/)
    expect(answers.length).toBeGreaterThanOrEqual(2)
    expect(answers.filter(isPrimary)).toHaveLength(1)
    expect(isPrimary(answers[0])).toBe(true)

    await user.click(answers[0])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(unitsOn('player')).toHaveLength(2)
  })
})
