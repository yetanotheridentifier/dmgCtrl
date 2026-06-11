import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import XwingSetupScreen from '../components/xwingSetupScreen'
import { XWING_NAMED_SCENARIOS } from '../hooks/useXwingSetup'

const VALID_XWS = JSON.stringify({
  pilots: [
    { name: 'asajjventress', ship: 'lancerclasspursuitcraft', points: 15 },
    { name: 'bobafett-armedanddangerous', ship: 'firesprayclasspatrolcraft', points: 18 },
    { name: 'bossk', ship: 'yv666lightfreighter', points: 17 },
    { name: 'nashtahpup', ship: 'z95af4headhunter', points: 0 },
  ],
  points: 50,
})

const VALID_XWS_46 = JSON.stringify({
  pilots: [
    { name: 'pilota', ship: 'shipa', points: 16 },
    { name: 'pilotb', ship: 'shipb', points: 15 },
    { name: 'pilotc', ship: 'shipc', points: 15 },
  ],
  points: 46,
})

const mockSetupState = vi.hoisted(() => ({
  ruleset: 'XWA',
  setRuleset: vi.fn(),
  matchType: 'Casual',
  setMatchType: vi.fn(),
  rounds: 6,
  setRounds: vi.fn(),
  playerListImport: 'None' as 'None' | 'XWA' | 'YASB',
  setPlayerListImport: vi.fn(),
  opponentListImport: 'None' as 'None' | 'XWA' | 'YASB',
  setOpponentListImport: vi.fn(),
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
  mockSetupState.playerListImport = 'None'
  mockSetupState.opponentListImport = 'None'
  mockSetupState.playerDeficit = 0
  mockSetupState.opponentDeficit = 0
  mockSetupState.scenario = 'None'
  mockSetupState.setRuleset.mockClear()
  mockSetupState.setMatchType.mockClear()
  mockSetupState.setRounds.mockClear()
  mockSetupState.setPlayerListImport.mockClear()
  mockSetupState.setOpponentListImport.mockClear()
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

  // --- Player list import dropdown ---

  it('shows player list import dropdown', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('player-list-import-select')).toBeInTheDocument()
  })

  it('player list import dropdown reflects playerListImport', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('player-list-import-select')).toHaveValue('None')
  })

  it('XWA option is enabled in the player import dropdown', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    const select = screen.getByTestId('player-list-import-select') as HTMLSelectElement
    const xwaOption = Array.from(select.options).find(o => o.value === 'XWA')
    expect(xwaOption?.disabled).toBe(false)
  })

  it('YASB option is disabled in the player import dropdown', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    const select = screen.getByTestId('player-list-import-select') as HTMLSelectElement
    const yasbOption = Array.from(select.options).find(o => o.value === 'YASB')
    expect(yasbOption?.disabled).toBe(true)
  })

  // --- Deficit steppers (None mode) ---

  it('player deficit stepper is shown when playerListImport is None', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('player-deficit-stepper')).toBeInTheDocument()
  })

  it('player deficit stepper is hidden when playerListImport is XWA', () => {
    mockSetupState.playerListImport = 'XWA'
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('player-deficit-stepper')).not.toBeInTheDocument()
  })

  // --- Sequential wizard flow ---

  it('opponent section is not shown until player confirms', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('opponent-list-import-select')).not.toBeInTheDocument()
  })

  it('player confirm button is present in None mode', () => {
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('player-confirm-btn')).toBeInTheDocument()
  })

  it('confirming player (None mode) reveals the opponent section', async () => {
    const user = userEvent.setup()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-confirm-btn'))
    expect(screen.getByTestId('opponent-list-import-select')).toBeInTheDocument()
  })

  it('opponent import dropdown has XWA enabled and YASB disabled', async () => {
    const user = userEvent.setup()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-confirm-btn'))
    const select = screen.getByTestId('opponent-list-import-select') as HTMLSelectElement
    const xwaOption = Array.from(select.options).find(o => o.value === 'XWA')
    const yasbOption = Array.from(select.options).find(o => o.value === 'YASB')
    expect(xwaOption?.disabled).toBe(false)
    expect(yasbOption?.disabled).toBe(true)
  })

  it('opponent deficit stepper is shown when opponent confirms with None mode', async () => {
    const user = userEvent.setup()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-confirm-btn'))
    expect(screen.getByTestId('opponent-deficit-stepper')).toBeInTheDocument()
  })

  // --- XWA import flow ---

  it('player textarea is shown when playerListImport is XWA', () => {
    mockSetupState.playerListImport = 'XWA'
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('player-list-textarea')).toBeInTheDocument()
  })

  it('confirming player with valid XWS (XWA mode) reveals opponent section', async () => {
    const user = userEvent.setup()
    mockSetupState.playerListImport = 'XWA'
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.change(screen.getByTestId('player-list-textarea'), { target: { value: VALID_XWS } })
    await user.click(screen.getByTestId('player-confirm-btn'))
    expect(screen.getByTestId('opponent-list-import-select')).toBeInTheDocument()
  })

  it('confirming player with invalid XWS shows inline error and stays on player step', async () => {
    const user = userEvent.setup()
    mockSetupState.playerListImport = 'XWA'
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.type(screen.getByTestId('player-list-textarea'), 'not valid json')
    await user.click(screen.getByTestId('player-confirm-btn'))
    expect(screen.getByTestId('player-import-error')).toBeInTheDocument()
    expect(screen.queryByTestId('opponent-list-import-select')).not.toBeInTheDocument()
  })

  it('opponent textarea is shown when opponentListImport is XWA and player is confirmed', async () => {
    const user = userEvent.setup()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-confirm-btn'))
    await userEvent.selectOptions(screen.getByTestId('opponent-list-import-select'), 'XWA')
    expect(screen.getByTestId('opponent-list-textarea')).toBeInTheDocument()
  })

  // --- Edit buttons ---

  it('player edit button appears after player confirms', async () => {
    const user = userEvent.setup()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-confirm-btn'))
    expect(screen.getByTestId('player-edit-btn')).toBeInTheDocument()
  })

  it('clicking player edit resets player section without affecting confirmed opponent', async () => {
    const user = userEvent.setup()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    // Confirm player
    await user.click(screen.getByTestId('player-confirm-btn'))
    // Confirm opponent
    await user.click(screen.getByTestId('opponent-confirm-btn'))
    // Edit player
    await user.click(screen.getByTestId('player-edit-btn'))
    // Player confirm button returns (player back to entry step)
    expect(screen.getByTestId('player-confirm-btn')).toBeInTheDocument()
    // Opponent section remains confirmed (opponent edit button still present)
    expect(screen.getByTestId('opponent-edit-btn')).toBeInTheDocument()
  })

  it('opponent edit button appears after opponent confirms', async () => {
    const user = userEvent.setup()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-confirm-btn'))
    await user.click(screen.getByTestId('opponent-confirm-btn'))
    expect(screen.getByTestId('opponent-edit-btn')).toBeInTheDocument()
  })

  it('clicking opponent edit resets opponent section without affecting confirmed player', async () => {
    const user = userEvent.setup()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-confirm-btn'))
    await user.click(screen.getByTestId('opponent-confirm-btn'))
    await user.click(screen.getByTestId('opponent-edit-btn'))
    // Opponent back to entry step
    expect(screen.getByTestId('opponent-confirm-btn')).toBeInTheDocument()
    // Player still confirmed
    expect(screen.getByTestId('player-edit-btn')).toBeInTheDocument()
  })

  // --- Start Game ---

  it('Start Game button is hidden until both players confirm', async () => {
    const user = userEvent.setup()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /start game/i })).not.toBeInTheDocument()
    await user.click(screen.getByTestId('player-confirm-btn'))
    expect(screen.queryByRole('button', { name: /start game/i })).not.toBeInTheDocument()
    await user.click(screen.getByTestId('opponent-confirm-btn'))
    expect(screen.getByRole('button', { name: /start game/i })).toBeInTheDocument()
  })

  it('Start Game is hidden again after editing player', async () => {
    const user = userEvent.setup()
    render(<XwingSetupScreen onStart={vi.fn()} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-confirm-btn'))
    await user.click(screen.getByTestId('opponent-confirm-btn'))
    await user.click(screen.getByTestId('player-edit-btn'))
    expect(screen.queryByRole('button', { name: /start game/i })).not.toBeInTheDocument()
  })

  it('clicking Start Game calls onStart with manual deficits and empty pilots (None/None)', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    mockSetupState.playerDeficit = 2
    mockSetupState.opponentDeficit = 1
    mockSetupState.scenario = 'Chance Engagement'
    render(<XwingSetupScreen onStart={onStart} onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-confirm-btn'))
    await user.click(screen.getByTestId('opponent-confirm-btn'))
    await user.click(screen.getByRole('button', { name: /start game/i }))
    expect(onStart).toHaveBeenCalledWith(2, 1, 'Chance Engagement', [], [])
  })

  it('clicking Start Game calls onStart with parsed pilots and computed deficits (XWA/XWA)', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    mockSetupState.playerListImport = 'XWA'
    mockSetupState.opponentListImport = 'XWA'
    render(<XwingSetupScreen onStart={onStart} onBack={vi.fn()} onHelp={vi.fn()} />)
    // Confirm player
    fireEvent.change(screen.getByTestId('player-list-textarea'), { target: { value: VALID_XWS } })
    await user.click(screen.getByTestId('player-confirm-btn'))
    // Confirm opponent (46 points — deficit 4 for opponent)
    fireEvent.change(screen.getByTestId('opponent-list-textarea'), { target: { value: VALID_XWS_46 } })
    await user.click(screen.getByTestId('opponent-confirm-btn'))
    await user.click(screen.getByRole('button', { name: /start game/i }))
    // player total 50, opponent total 46 → playerDeficit=0, opponentDeficit=4
    const [pDef, oDef, , pPilots, oPilots] = onStart.mock.calls[0]
    expect(pDef).toBe(0)
    expect(oDef).toBe(4)
    expect(pPilots).toHaveLength(4)
    expect(oPilots).toHaveLength(3)
  })

  it('clicking Start Game with player XWA and opponent None uses computed player deficit and manual opponent deficit', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    mockSetupState.playerListImport = 'XWA'
    mockSetupState.opponentDeficit = 2
    render(<XwingSetupScreen onStart={onStart} onBack={vi.fn()} onHelp={vi.fn()} />)
    fireEvent.change(screen.getByTestId('player-list-textarea'), { target: { value: VALID_XWS } })
    await user.click(screen.getByTestId('player-confirm-btn'))
    await user.click(screen.getByTestId('opponent-confirm-btn'))
    await user.click(screen.getByRole('button', { name: /start game/i }))
    const [pDef, oDef, , pPilots, oPilots] = onStart.mock.calls[0]
    // player total 50, no opponent list → playerDeficit=0 (no deficit from opponent list), opponentDeficit=2 (manual)
    expect(pDef).toBe(0)
    expect(oDef).toBe(2)
    expect(pPilots).toHaveLength(4)
    expect(oPilots).toEqual([])
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
