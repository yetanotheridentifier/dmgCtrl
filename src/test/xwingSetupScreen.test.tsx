import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import XwingSetupScreen from '../components/xwingSetupScreen'
import { XWING_NAMED_SCENARIOS } from '../hooks/useXwingSetup'

const mockSetupState = vi.hoisted(() => ({
  ruleset: 'XWA',
  setRuleset: vi.fn(),
  matchType: 'Casual',
  setMatchType: vi.fn(),
  rounds: 6,
  setRounds: vi.fn(),
  listImport: 'None',
  setListImport: vi.fn(),
  playerDeficit: 0,
  setPlayerDeficit: vi.fn(),
  opponentDeficit: 0,
  setOpponentDeficit: vi.fn(),
  scenario: 'None',
  setScenario: vi.fn(),
}))

vi.mock('../hooks/useXwingSetup', () => ({
  useXwingSetup: () => mockSetupState,
  XWING_NAMED_SCENARIOS: [
    'Assault at the Satellite Array',
    'Chance Engagement',
    'Salvage Mission',
    'Scramble the Transmissions',
    'Ancient Knowledge',
  ],
}))

beforeEach(() => {
  mockSetupState.ruleset = 'XWA'
  mockSetupState.matchType = 'Casual'
  mockSetupState.rounds = 6
  mockSetupState.listImport = 'None'
  mockSetupState.playerDeficit = 0
  mockSetupState.opponentDeficit = 0
  mockSetupState.scenario = 'None'
  mockSetupState.setRuleset.mockClear()
  mockSetupState.setMatchType.mockClear()
  mockSetupState.setRounds.mockClear()
  mockSetupState.setListImport.mockClear()
  mockSetupState.setPlayerDeficit.mockClear()
  mockSetupState.setOpponentDeficit.mockClear()
  mockSetupState.setScenario.mockClear()
})

describe('XwingSetupScreen', () => {

  // --- Ruleset ---

  it('ruleset dropdown is not shown', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('ruleset-select')).not.toBeInTheDocument()
  })

  // --- Match dropdown ---

  it('shows match dropdown', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('match-select')).toBeInTheDocument()
  })

  it('match dropdown reflects current matchType', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('match-select')).toHaveValue('Casual')
  })

  // --- Rounds stepper ---

  it('rounds stepper is hidden when matchType is Casual', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('rounds-stepper')).not.toBeInTheDocument()
  })

  it('rounds stepper is shown when matchType is Tournament', () => {
    mockSetupState.matchType = 'Tournament'
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('rounds-stepper')).toBeInTheDocument()
  })

  // --- List import dropdown ---

  it('shows list import dropdown', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('list-import-select')).toBeInTheDocument()
  })

  it('list import dropdown reflects current listImport', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('list-import-select')).toHaveValue('None')
  })

  it('YASB and Text list import options are disabled', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    const select = screen.getByTestId('list-import-select') as HTMLSelectElement
    const disabled = Array.from(select.options).filter(o => o.disabled).map(o => o.value)
    expect(disabled).toContain('YASB')
    expect(disabled).toContain('Text')
  })

  // --- Deficit steppers ---

  it('player deficit stepper is shown when listImport is None', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('player-deficit-stepper')).toBeInTheDocument()
  })

  it('opponent deficit stepper is shown when listImport is None', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('opponent-deficit-stepper')).toBeInTheDocument()
  })

  it('deficit steppers are hidden when listImport is not None', () => {
    mockSetupState.listImport = 'YASB'
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('player-deficit-stepper')).not.toBeInTheDocument()
    expect(screen.queryByTestId('opponent-deficit-stepper')).not.toBeInTheDocument()
  })

  // --- Start Game ---

  it('Start Game button is present', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('button', { name: /start game/i })).toBeInTheDocument()
  })

  it('clicking Start Game calls onStart with current deficits and scenario', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    mockSetupState.playerDeficit = 2
    mockSetupState.opponentDeficit = 1
    mockSetupState.scenario = 'Chance Engagement'
    render(<XwingSetupScreen onStart={onStart} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /start game/i }))
    expect(onStart).toHaveBeenCalledWith(2, 1, 'Chance Engagement')
  })

  // --- Scenario ---

  it('scenario dropdown is shown', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('scenario-select')).toBeInTheDocument()
  })

  it('scenario dropdown has None and all 5 named scenarios', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    const select = screen.getByTestId('scenario-select') as HTMLSelectElement
    const values = Array.from(select.options).map(o => o.value)
    expect(values).toContain('None')
    expect(values).toContain('Assault at the Satellite Array')
    expect(values).toContain('Chance Engagement')
    expect(values).toContain('Salvage Mission')
    expect(values).toContain('Scramble the Transmissions')
    expect(values).toContain('Ancient Knowledge')
    expect(values).toHaveLength(6)
  })

  it('scenario dropdown defaults to None', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('scenario-select')).toHaveValue('None')
  })

  it('changing scenario dropdown calls setScenario', async () => {
    const user = userEvent.setup()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.selectOptions(screen.getByTestId('scenario-select'), 'Salvage Mission')
    expect(mockSetupState.setScenario).toHaveBeenCalledWith('Salvage Mission')
  })

  it('random scenario button is shown', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('scenario-random-btn')).toBeInTheDocument()
  })

  it('clicking random button calls setScenario with a named scenario', async () => {
    const user = userEvent.setup()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('scenario-random-btn'))
    expect(mockSetupState.setScenario).toHaveBeenCalledOnce()
    const calledWith = mockSetupState.setScenario.mock.calls[0][0]
    expect(XWING_NAMED_SCENARIOS).toContain(calledWith)
  })

  // --- Navigation ---

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={onBack} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('calls onHelp when help button is clicked', async () => {
    const user = userEvent.setup()
    const onHelp = vi.fn()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={onHelp} />)
    await user.click(screen.getByRole('button', { name: /help/i }))
    expect(onHelp).toHaveBeenCalledOnce()
  })

  it('calls onSettings when settings button is clicked', async () => {
    const user = userEvent.setup()
    const onSettings = vi.fn()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} onSettings={onSettings} />)
    await user.click(screen.getByRole('button', { name: /settings/i }))
    expect(onSettings).toHaveBeenCalledOnce()
  })

})
