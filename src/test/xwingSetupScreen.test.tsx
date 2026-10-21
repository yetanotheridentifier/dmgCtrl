import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import XwingSetupScreen from '../components/xwingSetupScreen'
import { XWING_NAMED_SCENARIOS } from '../hooks/useXwingSetup'
import type { XwingList } from '../hooks/useXwingLists'
import { makeMatchMediaMock } from './setup'

const SCUM: XwingList = {
  id: 'scum',
  name: 'Scum Squad',
  faction: 'scumandvillainy',
  pilots: [
    { name: 'asajjventress', ship: 'lancerclasspursuitcraft', points: 15 },
    { name: 'bobafett-armedanddangerous', ship: 'firesprayclasspatrolcraft', points: 18 },
    { name: 'bossk', ship: 'yv666lightfreighter', points: 17 },
  ],
}

const EMPIRE: XwingList = {
  id: 'empire',
  name: 'Vader Wing',
  pilots: [
    { name: 'darthvader', ship: 'tieadvancedx1', points: 21 },
    { name: 'soontirfel', ship: 'tieinterceptor', points: 15 },
    { name: 'vermeil', ship: 'tiedefender', points: 11 },
  ],
}

const mockXwingLists = vi.hoisted(() => ({
  lists: [] as XwingList[],
  saveList: vi.fn(),
  renameList: vi.fn(),
  removeList: vi.fn(),
  clearLists: vi.fn(),
}))
vi.mock('../hooks/useXwingLists', () => ({
  useXwingLists: () => mockXwingLists,
}))

type Props = Partial<React.ComponentProps<typeof XwingSetupScreen>>

function renderSetup(props: Props = {}) {
  return render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} onSettings={vi.fn()} onLists={vi.fn()} {...props} />)
}

let store: Map<string, string>

beforeEach(() => {
  store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  })
  mockXwingLists.lists = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const card = (side: 'player' | 'opponent') => screen.getByTestId(`${side}-card`)
const goToGame = () => screen.getByRole('button', { name: 'Go to game' })

async function openListSheet(user: ReturnType<typeof userEvent.setup>, side: 'player' | 'opponent') {
  await user.click(within(card(side)).getByRole('button', { name: /choose a list|choose another list|change list/i }))
}

async function choose(user: ReturnType<typeof userEvent.setup>, side: 'player' | 'opponent', testId: string) {
  await openListSheet(user, side)
  await user.click(screen.getByTestId(`${side}-${testId}`))
}

describe('XwingSetupScreen', () => {

  // --- Top bar ---

  it('calls onBack from the back button', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    renderSetup({ onBack })
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it.each([
    ['Squad lists', 'onLists'],
    ['Help', 'onHelp'],
    ['Settings', 'onSettings'],
  ] as const)('More offers %s, which closes the sheet and calls %s', async (name, handler) => {
    const user = userEvent.setup()
    const spy = vi.fn()
    renderSetup({ [handler]: spy })
    await user.click(screen.getByRole('button', { name: 'More' }))
    const sheet = screen.getByRole('dialog', { name: 'More' })
    await user.click(within(sheet).getByRole('button', { name }))
    expect(spy).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('has no outline nav buttons for lists, help or settings in the top bar', () => {
    renderSetup()
    expect(screen.queryByRole('button', { name: 'Squad lists' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
  })

  // --- Match, rounds and scenario ---

  it('match defaults to Casual', () => {
    renderSetup()
    const match = screen.getByRole('group', { name: 'Match' })
    expect(within(match).getByRole('button', { name: 'Casual' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the rounds stepper only for a Tournament match', async () => {
    const user = userEvent.setup()
    renderSetup()
    expect(screen.queryByRole('button', { name: 'Increase rounds' })).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('group', { name: 'Match' })).getByRole('button', { name: 'Tournament' }))
    expect(screen.getByRole('button', { name: 'Increase rounds' })).toBeInTheDocument()
  })

  it('scenario defaults to None, and its sheet offers None and all 5 named scenarios', async () => {
    const user = userEvent.setup()
    renderSetup()
    await user.click(screen.getByRole('button', { name: 'Scenario: None' }))
    const sheet = screen.getByRole('dialog', { name: 'Scenario' })
    expect(within(sheet).getAllByRole('button').filter(b => b.textContent !== '').map(b => b.textContent))
      .toEqual(['None', ...XWING_NAMED_SCENARIOS])
  })

  it('choosing a scenario closes the sheet and shows it', async () => {
    const user = userEvent.setup()
    renderSetup()
    await user.click(screen.getByRole('button', { name: 'Scenario: None' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Scenario' })).getByRole('button', { name: 'Salvage Mission' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scenario: Salvage Mission' })).toBeInTheDocument()
  })

  it('rolling picks a named scenario', async () => {
    const user = userEvent.setup()
    renderSetup()
    await user.click(screen.getByRole('button', { name: 'Roll a scenario' }))
    const chosen = screen.getByRole('button', { name: /^Scenario: / }).getAttribute('aria-label')!.replace('Scenario: ', '')
    expect(XWING_NAMED_SCENARIOS).toContain(chosen)
  })

  // --- The two list cards ---

  it('shows both cards from the start, the opponent asking who you are playing', () => {
    renderSetup()
    expect(within(card('player')).getByRole('button', { name: 'Choose a list' })).toBeInTheDocument()
    expect(card('opponent')).toHaveTextContent('Who are you playing?')
  })

  it('the list sheet offers each saved list, Import XWS, then No list last as a fallback', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM, EMPIRE]
    renderSetup()
    await openListSheet(user, 'player')
    const sheet = screen.getByRole('dialog', { name: 'Your list' })
    expect(screen.getByTestId('player-list-option-scum')).toHaveTextContent('Scum Squad')
    expect(screen.getByTestId('player-list-option-scum')).toHaveTextContent('50 pts · Scum and Villainy')
    expect(screen.getByTestId('player-list-option-empire')).toHaveTextContent('47 pts')
    expect(within(sheet).getByRole('button', { name: 'Import XWS' })).toBeInTheDocument()
    const buttons = within(sheet).getAllByRole('button')
    expect(buttons.at(-1)).toBe(screen.getByTestId('player-no-list-btn'))
    expect(screen.getByTestId('player-no-list-btn')).toHaveTextContent('No ships to tap in the game')
  })

  it('the opponent sheet is titled for the opponent', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openListSheet(user, 'opponent')
    expect(screen.getByRole('dialog', { name: "Opponent's list" })).toBeInTheDocument()
  })

  it('with no saved lists, the sheet says so', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openListSheet(user, 'player')
    expect(screen.getByRole('dialog')).toHaveTextContent('No saved lists yet')
  })

  it('Import XWS closes the sheet and calls onLists', async () => {
    const user = userEvent.setup()
    const onLists = vi.fn()
    renderSetup({ onLists })
    await openListSheet(user, 'player')
    await user.click(screen.getByRole('button', { name: 'Import XWS' }))
    expect(onLists).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('choosing a saved list closes the sheet and shows its name, points, faction and pilots, but no deficit', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderSetup()
    await choose(user, 'player', 'list-option-scum')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('player-chosen-name')).toHaveTextContent('Scum Squad')
    expect(card('player')).toHaveTextContent('50 pts · Scum and Villainy')
    expect(card('player')).toHaveTextContent('Asajj Ventress, Boba Fett, Bossk')
    expect(card('player')).not.toHaveTextContent(/deficit/i)
  })

  it('choosing No list shows the fallback note and an adjustable deficit', async () => {
    const user = userEvent.setup()
    renderSetup()
    await choose(user, 'player', 'no-list-btn')
    expect(screen.getByTestId('player-chosen-name')).toHaveTextContent('No list')
    expect(card('player')).toHaveTextContent('No ships to tap in the game')
    await user.click(within(card('player')).getByRole('button', { name: 'Increase deficit' }))
    expect(card('player')).toHaveTextContent('1')
  })

  it('Change list reopens the sheet so another list can be chosen', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM, EMPIRE]
    renderSetup()
    await choose(user, 'player', 'list-option-scum')
    await choose(user, 'player', 'list-option-empire')
    expect(screen.getByTestId('player-chosen-name')).toHaveTextContent('Vader Wing')
  })

  it('a chosen list that has since been deleted falls back to choosing', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    const { rerender } = renderSetup()
    await choose(user, 'player', 'list-option-scum')
    mockXwingLists.lists = []
    rerender(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} onLists={vi.fn()} />)
    expect(within(card('player')).getByRole('button', { name: 'Choose a list' })).toBeInTheDocument()
  })

  // --- Remembered lists ---

  it('pre-fills your remembered list', () => {
    store.set('xwing_setup', JSON.stringify({ playerListId: 'scum' }))
    mockXwingLists.lists = [SCUM]
    renderSetup()
    expect(screen.getByTestId('player-chosen-name')).toHaveTextContent('Scum Squad')
  })

  it("offers last game's opponent in one tap", async () => {
    const user = userEvent.setup()
    store.set('xwing_setup', JSON.stringify({ lastOpponentListId: 'empire' }))
    mockXwingLists.lists = [SCUM, EMPIRE]
    renderSetup()
    const same = within(card('opponent')).getByRole('button', { name: /Vader Wing.*Same as last game/ })
    await user.click(same)
    expect(screen.getByTestId('opponent-chosen-name')).toHaveTextContent('Vader Wing')
  })

  it("fills last game's opponent like a button, so it reads as tappable", () => {
    store.set('xwing_setup', JSON.stringify({ lastOpponentListId: 'empire' }))
    mockXwingLists.lists = [EMPIRE]
    renderSetup()
    expect(within(card('opponent')).getByRole('button', { name: /Same as last game/ })).toHaveStyle({ background: 'var(--color-tonal)' })
  })

  it('sets its own text colour, so names stay readable on the dark cards', () => {
    renderSetup()
    expect(screen.getByTestId('xwing-setup')).toHaveStyle({ color: 'var(--color-text-primary)' })
  })

  it("doesn't offer last game's opponent once that list is deleted", () => {
    store.set('xwing_setup', JSON.stringify({ lastOpponentListId: 'empire' }))
    mockXwingLists.lists = [SCUM]
    renderSetup()
    expect(card('opponent')).not.toHaveTextContent('Same as last game')
    expect(within(card('opponent')).getByRole('button', { name: 'Choose a list' })).toBeInTheDocument()
  })

  it('with a last opponent offered, the other way in is Choose another list', () => {
    store.set('xwing_setup', JSON.stringify({ lastOpponentListId: 'empire' }))
    mockXwingLists.lists = [EMPIRE]
    renderSetup()
    expect(within(card('opponent')).getByRole('button', { name: 'Choose another list' })).toBeInTheDocument()
  })

  // --- Go to game ---

  it('Go to game is disabled until both sides are chosen', async () => {
    const user = userEvent.setup()
    renderSetup()
    expect(goToGame()).toBeDisabled()
    await choose(user, 'player', 'no-list-btn')
    expect(goToGame()).toBeDisabled()
    await choose(user, 'opponent', 'no-list-btn')
    expect(goToGame()).toBeEnabled()
  })

  it('starts with each list player getting 50 minus the list points, and their pilots', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    mockXwingLists.lists = [SCUM, EMPIRE]
    renderSetup({ onStart })
    await user.click(screen.getByRole('button', { name: 'Scenario: None' }))
    await user.click(screen.getByRole('button', { name: 'Chance Engagement' }))
    await choose(user, 'player', 'list-option-scum')
    await choose(user, 'opponent', 'list-option-empire')
    await user.click(goToGame())
    expect(onStart).toHaveBeenCalledWith(0, 3, 'Chance Engagement', SCUM.pilots, EMPIRE.pilots)
  })

  it('starts with a No list player getting the stepper deficit and no pilots', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    mockXwingLists.lists = [EMPIRE]
    renderSetup({ onStart })
    await choose(user, 'player', 'no-list-btn')
    await user.click(within(card('player')).getByRole('button', { name: 'Increase deficit' }))
    await user.click(within(card('player')).getByRole('button', { name: 'Increase deficit' }))
    await choose(user, 'opponent', 'list-option-empire')
    await user.click(goToGame())
    expect(onStart).toHaveBeenCalledWith(2, 3, 'None', [], EMPIRE.pilots)
  })

  // --- Layout ---

  it('portrait: Go to game comes after the match controls', () => {
    makeMatchMediaMock(true)
    renderSetup()
    expect(
      screen.getByRole('button', { name: 'Scenario: None' }).compareDocumentPosition(goToGame()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
