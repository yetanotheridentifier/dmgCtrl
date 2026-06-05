import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import XwingSetupScreen from '../components/xwingSetupScreen'

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
}))

vi.mock('../hooks/useXwingSetup', () => ({
  useXwingSetup: () => mockSetupState,
}))

beforeEach(() => {
  mockSetupState.ruleset = 'XWA'
  mockSetupState.matchType = 'Casual'
  mockSetupState.rounds = 6
  mockSetupState.listImport = 'None'
  mockSetupState.playerDeficit = 0
  mockSetupState.opponentDeficit = 0
  mockSetupState.setRuleset.mockClear()
  mockSetupState.setMatchType.mockClear()
  mockSetupState.setRounds.mockClear()
  mockSetupState.setListImport.mockClear()
  mockSetupState.setPlayerDeficit.mockClear()
  mockSetupState.setOpponentDeficit.mockClear()
})

describe('XwingSetupScreen', () => {

  // --- Ruleset dropdown ---

  it('shows ruleset dropdown', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('ruleset-select')).toBeInTheDocument()
  })

  it('ruleset dropdown reflects current ruleset', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('ruleset-select')).toHaveValue('XWA')
  })

  it('XWA is the only enabled ruleset option', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    const select = screen.getByTestId('ruleset-select') as HTMLSelectElement
    const enabled = Array.from(select.options).filter(o => !o.disabled).map(o => o.value)
    expect(enabled).toEqual(['XWA'])
  })

  it('Legacy, AMG, 2.0, and 1.0 ruleset options are disabled', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    const select = screen.getByTestId('ruleset-select') as HTMLSelectElement
    const disabled = Array.from(select.options).filter(o => o.disabled).map(o => o.value)
    expect(disabled).toContain('Legacy')
    expect(disabled).toContain('AMG')
    expect(disabled).toContain('2.0')
    expect(disabled).toContain('1.0')
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

  it('clicking Start Game calls onStart with current deficits', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    mockSetupState.playerDeficit = 2
    mockSetupState.opponentDeficit = 1
    render(<XwingSetupScreen onStart={onStart} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /start game/i }))
    expect(onStart).toHaveBeenCalledWith(2, 1)
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
