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
  return render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} onLists={vi.fn()} {...props} />)
}

beforeEach(() => {
  const store = new Map<string, string>()
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

describe('XwingSetupScreen', () => {

  // --- Header ---

  it('shows a Squad lists button when onLists is given', () => {
    renderSetup()
    expect(screen.getByRole('button', { name: 'Squad lists' })).toBeInTheDocument()
  })

  it('Squad lists button calls onLists', async () => {
    const user = userEvent.setup()
    const onLists = vi.fn()
    renderSetup({ onLists })
    await user.click(screen.getByRole('button', { name: 'Squad lists' }))
    expect(onLists).toHaveBeenCalledOnce()
  })

  it('portrait: Squad lists button is shown', () => {
    makeMatchMediaMock(true)
    renderSetup()
    expect(screen.getByRole('button', { name: 'Squad lists' })).toBeInTheDocument()
  })

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    renderSetup({ onBack })
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('calls onHelp when help button is clicked', async () => {
    const user = userEvent.setup()
    const onHelp = vi.fn()
    renderSetup({ onHelp })
    await user.click(screen.getByRole('button', { name: /help/i }))
    expect(onHelp).toHaveBeenCalledOnce()
  })

  it('calls onSettings when settings button is clicked', async () => {
    const user = userEvent.setup()
    const onSettings = vi.fn()
    renderSetup({ onSettings })
    await user.click(screen.getByRole('button', { name: /settings/i }))
    expect(onSettings).toHaveBeenCalledOnce()
  })

  // --- Match, rounds and scenario ---

  it('ruleset dropdown is not shown', () => {
    renderSetup()
    expect(screen.queryByTestId('ruleset-select')).not.toBeInTheDocument()
  })

  it('match dropdown defaults to Casual', () => {
    renderSetup()
    expect(screen.getByTestId('match-select')).toHaveValue('Casual')
  })

  it('rounds stepper appears only for a Tournament match', async () => {
    const user = userEvent.setup()
    renderSetup()
    expect(screen.queryByTestId('rounds-stepper')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByTestId('match-select'), 'Tournament')
    expect(screen.getByTestId('rounds-stepper')).toBeInTheDocument()
  })

  it('scenario dropdown has None and all 5 named scenarios, defaulting to None', () => {
    renderSetup()
    const select = screen.getByTestId('scenario-select') as HTMLSelectElement
    expect(Array.from(select.options).map(o => o.value)).toEqual(['None', ...XWING_NAMED_SCENARIOS])
    expect(select).toHaveValue('None')
  })

  it('choosing a scenario updates the dropdown', async () => {
    const user = userEvent.setup()
    renderSetup()
    await user.selectOptions(screen.getByTestId('scenario-select'), 'Salvage Mission')
    expect(screen.getByTestId('scenario-select')).toHaveValue('Salvage Mission')
  })

  it('the random button picks a named scenario', async () => {
    const user = userEvent.setup()
    renderSetup()
    await user.click(screen.getByTestId('scenario-random-btn'))
    expect(XWING_NAMED_SCENARIOS).toContain((screen.getByTestId('scenario-select') as HTMLSelectElement).value)
  })

  // --- The old import controls are gone ---

  it('has no import dropdown, paste box or save star', () => {
    mockXwingLists.lists = [SCUM]
    renderSetup()
    expect(screen.queryByTestId('player-list-import-select')).not.toBeInTheDocument()
    expect(screen.queryByTestId('player-list-textarea')).not.toBeInTheDocument()
    expect(screen.queryByTestId('player-star-btn')).not.toBeInTheDocument()
  })

  // --- Choosing a list ---

  it('offers No list, New list and each saved list with its points and faction', () => {
    mockXwingLists.lists = [SCUM, EMPIRE]
    renderSetup()
    const choices = screen.getByTestId('player-choices')
    expect(within(choices).getByRole('button', { name: 'No list' })).toBeInTheDocument()
    expect(within(choices).getByRole('button', { name: /new list/i })).toBeInTheDocument()
    expect(screen.getByTestId('player-list-option-scum')).toHaveTextContent('Scum Squad')
    expect(screen.getByTestId('player-list-option-scum')).toHaveTextContent('50 pts · Scum and Villainy')
    expect(screen.getByTestId('player-list-option-empire')).toHaveTextContent('47 pts')
  })

  it('with no saved lists, shows a hint instead of list rows', () => {
    renderSetup()
    expect(screen.getByTestId('player-lists-empty-hint')).toHaveTextContent('No saved lists yet')
  })

  it('New list calls onLists', async () => {
    const user = userEvent.setup()
    const onLists = vi.fn()
    renderSetup({ onLists })
    await user.click(screen.getByTestId('player-new-list-btn'))
    expect(onLists).toHaveBeenCalledOnce()
  })

  it('tapping a saved list chooses it and shows its name and pilots', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderSetup()
    await user.click(screen.getByTestId('player-list-option-scum'))
    expect(screen.queryByTestId('player-choices')).not.toBeInTheDocument()
    expect(screen.getByTestId('player-chosen-name')).toHaveTextContent('Scum Squad')
    expect(screen.getByTestId('player-pilot-list')).toHaveTextContent('Asajj Ventress')
  })

  it('choosing No list shows the deficit stepper, which stays adjustable', async () => {
    const user = userEvent.setup()
    renderSetup()
    await user.click(screen.getByTestId('player-no-list-btn'))
    expect(screen.getByTestId('player-chosen-name')).toHaveTextContent('No list')
    const stepper = screen.getByTestId('player-deficit-stepper')
    await user.click(within(stepper).getByRole('button', { name: '+' }))
    expect(stepper).toHaveTextContent('1')
  })

  it('edit returns to the choices', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderSetup()
    await user.click(screen.getByTestId('player-list-option-scum'))
    await user.click(screen.getByTestId('player-edit-btn'))
    expect(screen.getByTestId('player-choices')).toBeInTheDocument()
    expect(screen.queryByTestId('player-pilot-list')).not.toBeInTheDocument()
  })

  it('a chosen list that has since been deleted falls back to the choices', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    const { rerender } = renderSetup()
    await user.click(screen.getByTestId('player-list-option-scum'))
    mockXwingLists.lists = []
    rerender(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} onLists={vi.fn()} />)
    expect(screen.getByTestId('player-choices')).toBeInTheDocument()
  })

  // --- Opponent and the wizard flow ---

  it('portrait: opponent choices appear once the player has chosen', async () => {
    makeMatchMediaMock(true)
    const user = userEvent.setup()
    renderSetup()
    expect(screen.queryByTestId('opponent-choices')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('player-no-list-btn'))
    expect(screen.getByTestId('opponent-choices')).toBeInTheDocument()
  })

  it('landscape: opponent column shows a placeholder until the player has chosen', async () => {
    // landscape is the default test orientation
    const user = userEvent.setup()
    renderSetup()
    expect(screen.getByTestId('opponent-placeholder')).toBeInTheDocument()
    expect(screen.queryByTestId('opponent-choices')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('player-no-list-btn'))
    expect(screen.queryByTestId('opponent-placeholder')).not.toBeInTheDocument()
    expect(screen.getByTestId('opponent-choices')).toBeInTheDocument()
  })

  it('changing the player choice keeps the opponent choice', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM, EMPIRE]
    renderSetup()
    await user.click(screen.getByTestId('player-list-option-scum'))
    await user.click(screen.getByTestId('opponent-list-option-empire'))
    await user.click(screen.getByTestId('player-edit-btn'))
    expect(screen.getByTestId('opponent-chosen-name')).toHaveTextContent('Vader Wing')
  })

  // --- Go to game ---

  it('Go to game appears only once both players have chosen', async () => {
    const user = userEvent.setup()
    renderSetup()
    expect(screen.queryByRole('button', { name: /start game/i })).not.toBeInTheDocument()
    await user.click(screen.getByTestId('player-no-list-btn'))
    expect(screen.queryByRole('button', { name: /start game/i })).not.toBeInTheDocument()
    await user.click(screen.getByTestId('opponent-no-list-btn'))
    expect(screen.getByRole('button', { name: /start game/i })).toBeInTheDocument()
  })

  it('Go to game is hidden again after editing a choice', async () => {
    const user = userEvent.setup()
    renderSetup()
    await user.click(screen.getByTestId('player-no-list-btn'))
    await user.click(screen.getByTestId('opponent-no-list-btn'))
    await user.click(screen.getByTestId('player-edit-btn'))
    expect(screen.queryByRole('button', { name: /start game/i })).not.toBeInTheDocument()
  })

  it('portrait: Go to game sits after the controls', async () => {
    makeMatchMediaMock(true)
    const user = userEvent.setup()
    renderSetup()
    await user.click(screen.getByTestId('player-no-list-btn'))
    await user.click(screen.getByTestId('opponent-no-list-btn'))
    const startBtn = screen.getByRole('button', { name: /start game/i })
    expect(
      screen.getByTestId('scenario-select').compareDocumentPosition(startBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('starts with each list player getting 50 minus the list points, and their pilots', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    mockXwingLists.lists = [SCUM, EMPIRE]
    renderSetup({ onStart })
    await user.selectOptions(screen.getByTestId('scenario-select'), 'Chance Engagement')
    await user.click(screen.getByTestId('player-list-option-scum'))
    await user.click(screen.getByTestId('opponent-list-option-empire'))
    await user.click(screen.getByRole('button', { name: /start game/i }))
    expect(onStart).toHaveBeenCalledWith(0, 3, 'Chance Engagement', SCUM.pilots, EMPIRE.pilots)
  })

  it('starts with a No list player getting the stepper deficit and no pilots', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    mockXwingLists.lists = [EMPIRE]
    renderSetup({ onStart })
    await user.click(screen.getByTestId('player-no-list-btn'))
    const stepper = screen.getByTestId('player-deficit-stepper')
    await user.click(within(stepper).getByRole('button', { name: '+' }))
    await user.click(within(stepper).getByRole('button', { name: '+' }))
    await user.click(screen.getByTestId('opponent-list-option-empire'))
    await user.click(screen.getByRole('button', { name: /start game/i }))
    expect(onStart).toHaveBeenCalledWith(2, 3, 'None', [], EMPIRE.pilots)
  })

  // --- Button sizing ---

  it('portrait: the edit button matches the nav buttons', async () => {
    makeMatchMediaMock(true)
    const user = userEvent.setup()
    renderSetup({ onSettings: vi.fn() })
    await user.click(screen.getByTestId('player-no-list-btn'))
    const action = screen.getByTestId('player-edit-btn')
    const nav = screen.getByRole('button', { name: /back/i })
    expect(action.style.width).toBe(nav.style.width)
    expect(action.style.height).toBe(nav.style.height)
    expect(action.style.minWidth).toBe(nav.style.minWidth)
    expect(action.style.minHeight).toBe(nav.style.minHeight)
    expect(action.style.padding).toBe('0.8vh 1.5vw')
  })

  it('landscape: the edit button keeps its 44px minimum size', async () => {
    const user = userEvent.setup()
    renderSetup()
    await user.click(screen.getByTestId('player-no-list-btn'))
    const action = screen.getByTestId('player-edit-btn')
    expect(action.style.minWidth).toBe('44px')
    expect(action.style.minHeight).toBe('44px')
  })
})
