import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { useBases } from '../hooks/useBases'

const mockUseTournament = vi.hoisted(() => ({
  tournament: null as null | object,
  matchInProgress: false,
  isComplete: false,
  totals: { won: 0, lost: 0, drawn: 0 },
  points: 0,
  startTournament: vi.fn(),
  startMatch: vi.fn(),
  completeMatch: vi.fn(),
  submitRound: vi.fn(),
  dropTournament: vi.fn(),
  setTournamentId: vi.fn(),
}))
vi.mock('../hooks/useTournament', () => ({
  useTournament: () => mockUseTournament,
}))

const mockOnAppStart = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnGameStart = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnGameEnd = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnAppInstall = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnAppResume = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnTournamentStarted = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnTournamentRoundCompleted = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnTournamentDropped = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnTournamentEnded = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../services/analytics', () => ({
  onAppStart: mockOnAppStart,
  onGameStart: mockOnGameStart,
  onGameEnd: mockOnGameEnd,
  onAppInstall: mockOnAppInstall,
  onAppResume: mockOnAppResume,
  onTournamentStarted: mockOnTournamentStarted,
  onTournamentRoundCompleted: mockOnTournamentRoundCompleted,
  onTournamentDropped: mockOnTournamentDropped,
  onTournamentEnded: mockOnTournamentEnded,
  onDamageDealt: vi.fn(),
  onDamageHealed: vi.fn(),
  onRoundIncremented: vi.fn(),
  onUndoUsed: vi.fn(),
  onEpicActionUsed: vi.fn(),
  onForceGained: vi.fn(),
  onForceUsed: vi.fn(),
  onMatchCompleted: vi.fn(),
  onImageLoadFailed: vi.fn(),
}))

const mockBases = vi.hoisted(() => [
  {
    set: 'SOR',
    number: '026',
    name: 'Catacombs of Cadera',
    subtitle: 'Jedha',
    hp: 30,
    frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png',
    frontArtLowRes: null,
    hyperspaceArt: null,
    hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/292.png',
    epicAction: '',
    aspects: ['Aggression'],
    rarity: 'Common',
  },
  {
    set: 'SOR',
    number: '022',
    name: 'Energy Conversion Lab',
    subtitle: 'Eadu',
    hp: 25,
    frontArt: 'https://cdn.swu-db.com/images/cards/SOR/022.png',
    frontArtLowRes: null,
    hyperspaceArt: null,
    hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/288.png',
    epicAction: 'Epic Action: Play a unit that costs 6 or less.',
    aspects: ['Cunning'],
    rarity: 'Rare',
  },
])

vi.mock('../hooks/useBases', () => ({
  useBases: vi.fn().mockReturnValue({ bases: mockBases, loading: false, error: null }),
}))


const mockUserSettings = vi.hoisted(() => ({
  useHyperspace: true,
  enableForceToken: true,
  enableEpicActions: true,
  enableWakeLock: true,
  enableCompetitiveMode: false,
  enableFavourites: false,
  setUseHyperspace: vi.fn(),
  setEnableForceToken: vi.fn(),
  setEnableEpicActions: vi.fn(),
  setEnableWakeLock: vi.fn(),
}))
vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
}))


// The format and mode selectors are always present; filter them out to get the three
// base-selection dropdowns (set, aspect, base).
const getBaseSelectors = () => {
  const all = screen.getAllByRole('combobox')
  const formatSelect = screen.queryByTestId('format-select')
  const modeSelect = screen.queryByTestId('mode-select')
  return all.filter(el => el !== formatSelect && el !== modeSelect)
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => key === 'pref_format' ? 'eternal' : null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  })
  mockOnAppStart.mockClear()
  mockOnGameStart.mockClear()
  mockOnGameEnd.mockClear()
  mockOnAppInstall.mockClear()
  mockOnAppResume.mockClear()
  mockOnTournamentStarted.mockClear()
  mockOnTournamentRoundCompleted.mockClear()
  mockOnTournamentDropped.mockClear()
  mockOnTournamentEnded.mockClear()
  mockUseTournament.tournament = null
  mockUseTournament.matchInProgress = false
  mockUseTournament.isComplete = false
  mockUseTournament.startTournament.mockReset()
  mockUseTournament.startMatch.mockReset()
  mockUseTournament.completeMatch.mockReset()
  mockUseTournament.dropTournament.mockReset()
  mockUserSettings.enableCompetitiveMode = false
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// useBases is mocked so data is always ready; waitFor handles any async React batching.
async function waitForSetup() {
  await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
}

describe('App', () => {

  it('Shows loading screen on initial load', () => {
    vi.mocked(useBases).mockReturnValueOnce({ bases: [], loading: true, error: null })
    render(<App />)
    expect(screen.getByText('LOADING')).toBeInTheDocument()
  })

  it('Transitions to setup screen after loading', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('dmgCtrl')).toBeInTheDocument())
  })

  it('Does not render the game screen on load', () => {
    render(<App />)
    expect(screen.queryByText(/Remaining:/)).not.toBeInTheDocument()
  })

  it('Setup screen does not show game screen elements on load', () => {
    render(<App />)
    expect(screen.queryByText('+')).not.toBeInTheDocument()
    expect(screen.queryByText('-')).not.toBeInTheDocument()
  })

  it('Navigates to game screen after selecting a base', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByText('Start'))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Game screen reflects the selected base health', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Cunning')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-022')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByText('Start'))
    expect(screen.getByText('Remaining: 25')).toBeInTheDocument()
  })

  it('Does not navigate to game screen if no base is selected', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    expect(screen.getByText('Source:')).toBeInTheDocument()
    expect(screen.queryByText(/Remaining:/)).not.toBeInTheDocument()
  })

  it('Clicking back from game screen returns to setup screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Source:')).toBeInTheDocument()
  })

  // --- Back navigation retains selection ---

  it('Retains selected set after navigating back from game screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect((getBaseSelectors()[0] as HTMLSelectElement).value).toBe('SOR')
  })

  it('Retains selected aspect after navigating back from game screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect((getBaseSelectors()[1] as HTMLSelectElement).value).toBe('Aggression')
  })

  it('Retains selected base after navigating back from game screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect((getBaseSelectors()[2] as HTMLSelectElement).value).toBe('SOR-026')
  })

  it('Submit button is immediately active after navigating back', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Start game' })).not.toBeDisabled()
  })

  it('Can start a new game immediately after navigating back without re-selecting', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByText('Start'))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  // --- Help navigation ---

  it('Help button is visible on setup screen', async () => {
    render(<App />)
    await waitForSetup()
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument()
  })

  it('Clicking help on setup screen shows the help screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByText('Getting Started')).toBeInTheDocument()
  })

  it('Help button is visible on game screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument()
  })

  it('Clicking help on game screen shows the help screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByRole('heading', { level: 2, name: 'During a Game' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Getting Started' })).not.toBeInTheDocument()
  })

  it('Clicking back from help returns to setup when help was opened from setup', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Source:')).toBeInTheDocument()
  })

  it('Clicking back from help returns to game when help was opened from game', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByRole('button', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Clicking help on tournament screen shows tournament help content', async () => {
    mockUseTournament.tournament = {
      base: { set: 'SOR', number: '026', name: 'Catacombs of Cadera', subtitle: 'Jedha', hp: 30,
        frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png', frontArtLowRes: null,
        hyperspaceArt: null, hyperspaceArtHiRes: null, epicAction: '', aspects: ['Aggression'], rarity: 'Common' },
      format: 'premier', playMode: 'bo3', totalRounds: 5, rounds: [],
    }
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Tournament Mode' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Getting Started' })).not.toBeInTheDocument()
  })

  it('Clicking back from tournament help returns to tournament screen', async () => {
    mockUseTournament.tournament = {
      base: { set: 'SOR', number: '026', name: 'Catacombs of Cadera', subtitle: 'Jedha', hp: 30,
        frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png', frontArtLowRes: null,
        hyperspaceArt: null, hyperspaceArtHiRes: null, epicAction: '', aspects: ['Aggression'], rarity: 'Common' },
      format: 'premier', playMode: 'bo3', totalRounds: 5, rounds: [],
    }
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Start Match 1' })).toBeInTheDocument()
  })

  it('Passes useHyperspace=true to game screen when user settings preference is true', async () => {
    mockUserSettings.useHyperspace = true
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    const img = screen.getByAltText('Catacombs of Cadera')
    expect(img).toHaveAttribute('src', 'https://cdn.swu-db.com/images/cards/SOR/292.png')
  })

  it('Passes useHyperspace=false to game screen when user settings preference is false', async () => {
    mockUserSettings.useHyperspace = false
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    const img = screen.getByAltText('Catacombs of Cadera')
    expect(img).toHaveAttribute('src', 'https://cdn.swu-db.com/images/cards/SOR/026.png')
  })


  // --- Settings navigation ---

  it('Settings button is visible on setup screen', async () => {
    render(<App />)
    await waitForSetup()
    expect(screen.getByRole('button', { name: '⚙' })).toBeInTheDocument()
  })

  it('Clicking settings on setup screen shows the settings screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: '⚙' }))
    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument()
  })

  it('Clicking back from settings returns to setup when settings was opened from setup', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: '⚙' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Source:')).toBeInTheDocument()
  })

  it('Settings button is visible on game screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    expect(screen.getByRole('button', { name: '⚙' })).toBeInTheDocument()
  })

  it('Clicking settings on game screen shows the settings screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByRole('button', { name: '⚙' }))
    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument()
  })

  it('Clicking back from settings returns to game when settings was opened from game', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByRole('button', { name: '⚙' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Clicking back from settings returns to setup after settings -> help -> back', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: '⚙' }))
    await user.click(screen.getByRole('button', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Source:')).toBeInTheDocument()
  })

  it('Clicking back from settings returns to game after settings -> help -> back', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByRole('button', { name: '⚙' }))
    await user.click(screen.getByRole('button', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

})

describe('App analytics', () => {

  it('calls onAppStart on mount', async () => {
    render(<App />)
    await waitFor(() => expect(mockOnAppStart).toHaveBeenCalledTimes(1))
  })

  it('calls onGameStart when a game is started', async () => {
    mockUserSettings.useHyperspace = true
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    expect(mockOnGameStart).toHaveBeenCalledWith('SOR-026', 'SOR', true, 'casual')
  })

  it('calls onGameEnd when the back button is pressed from the game screen', async () => {
    mockUserSettings.useHyperspace = false
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(mockOnGameEnd).toHaveBeenCalledWith('SOR-026', 'SOR', false, expect.any(Number), 'casual')
  })

  it('does not call onGameEnd when back is pressed from help screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(mockOnGameEnd).not.toHaveBeenCalled()
  })

})

describe('App lifecycle analytics', () => {

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    Object.defineProperty(window.navigator, 'standalone', { value: undefined, configurable: true })
  })

  it('does not call onAppInstall when not in standalone mode', async () => {
    render(<App />)
    expect(mockOnAppInstall).not.toHaveBeenCalled()
  })

  it('calls onAppInstall on first launch in standalone mode (matchMedia)', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    })
    render(<App />)
    await waitFor(() => expect(mockOnAppInstall).toHaveBeenCalledTimes(1))
  })

  it('calls onAppInstall on first launch via navigator.standalone (iOS)', async () => {
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true })
    render(<App />)
    await waitFor(() => expect(mockOnAppInstall).toHaveBeenCalledTimes(1))
  })

  it('calls onAppInstall with "ios" platform when navigator.standalone is true', async () => {
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true })
    render(<App />)
    await waitFor(() => expect(mockOnAppInstall).toHaveBeenCalledWith('ios'))
  })

  it('calls onAppInstall with "android" platform when userAgent contains Android', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      configurable: true,
    })
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    })
    render(<App />)
    await waitFor(() => expect(mockOnAppInstall).toHaveBeenCalledWith('android'))
  })

  it('does not call onAppInstall if already tracked in localStorage', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockImplementation((key: string) => key === 'pwa_install_tracked' ? '1' : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    })
    render(<App />)
    expect(mockOnAppInstall).not.toHaveBeenCalled()
  })

  it('does not call onAppResume on initial render', async () => {
    render(<App />)
    expect(mockOnAppResume).not.toHaveBeenCalled()
  })

  it('does not call onAppResume when page becomes visible without first being hidden', async () => {
    render(<App />)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(mockOnAppResume).not.toHaveBeenCalled()
  })

  it('calls onAppResume when page becomes visible after being hidden', async () => {
    render(<App />)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(mockOnAppResume).toHaveBeenCalledTimes(1)
  })

})

// ---------------------------------------------------------------------------
// Tournament navigation
// ---------------------------------------------------------------------------

describe('App tournament navigation', () => {

  const getTournamentBaseSelectors = () => {
    const all = screen.getAllByRole('combobox')
    const formatSelect = screen.queryByTestId('format-select')
    const modeSelect = screen.queryByTestId('mode-select')
    const playModeSelect = screen.queryByTestId('play-mode-select')
    return all.filter(el => el !== formatSelect && el !== modeSelect && el !== playModeSelect)
  }

  async function waitForSetupWithTournament() {
    await waitFor(() => expect(screen.queryByTestId('play-mode-select')).toBeInTheDocument())
  }

  beforeEach(() => {
    mockUserSettings.enableCompetitiveMode = true
  })

  it('navigates to tournament screen when tournament mode is confirmed', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetupWithTournament()
    await user.selectOptions(screen.getByTestId('play-mode-select'), 'tournament')
    await waitFor(() => expect(getTournamentBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getTournamentBaseSelectors()[0], 'SOR')
    await user.selectOptions(getTournamentBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getTournamentBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    expect(screen.getByRole('button', { name: 'Start Match 1' })).toBeInTheDocument()
  })

  it('shows tournament screen (not setup) when a tournament is already active on load', async () => {
    mockUseTournament.tournament = {
      base: { set: 'SOR', number: '026', name: 'Catacombs of Cadera', subtitle: 'Jedha', hp: 30,
        frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png', frontArtLowRes: null,
        hyperspaceArt: null, hyperspaceArtHiRes: null, epicAction: '', aspects: ['Aggression'], rarity: 'Common' },
      format: 'premier',
      playMode: 'bo3',
      totalRounds: 5,
      rounds: [],
    }
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Match 1' })).toBeInTheDocument())
  })

  it('game screen state is preserved when navigating game → tournament → game mid-match', async () => {
    const user = userEvent.setup()
    mockUseTournament.tournament = {
      base: { set: 'SOR', number: '026', name: 'Catacombs of Cadera', subtitle: 'Jedha', hp: 30,
        frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png', frontArtLowRes: null,
        hyperspaceArt: null, hyperspaceArtHiRes: null, epicAction: '', aspects: ['Aggression'], rarity: 'Common' },
      format: 'premier',
      playMode: 'bo3',
      totalRounds: 5,
      rounds: [{ roundNumber: 1, playerScore: 0, opponentScore: 0, result: null, submitted: false }],
    }
    mockUseTournament.matchInProgress = true
    render(<App />)

    // Tournament screen loads; navigate to game
    await waitFor(() => expect(screen.getByRole('button', { name: 'Return to Match 1' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Return to Match 1' }))

    // Game screen loads; start game and increment damage
    await waitFor(() => expect(screen.getByText('Start')).toBeInTheDocument())
    await user.click(screen.getByText('Start'))
    await waitFor(() => expect(screen.getByTestId('game-counter')).toHaveTextContent('0'))
    await user.click(screen.getByText('+'))
    await waitFor(() => expect(screen.getByTestId('game-counter')).toHaveTextContent('1'))

    // Navigate back to tournament
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Return to Match 1' })).toBeInTheDocument())

    // Return to game — damage must still be 1
    await user.click(screen.getByRole('button', { name: 'Return to Match 1' }))
    await waitFor(() => expect(screen.getByTestId('game-counter')).toHaveTextContent('1'))
  })

  it('fires onGameStart when navigating to game from tournament', async () => {
    mockUserSettings.useHyperspace = false
    const user = userEvent.setup()
    mockUseTournament.tournament = {
      base: { set: 'SOR', number: '026', name: 'Catacombs of Cadera', subtitle: 'Jedha', hp: 30,
        frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png', frontArtLowRes: null,
        hyperspaceArt: null, hyperspaceArtHiRes: null, epicAction: '', aspects: ['Aggression'], rarity: 'Common' },
      format: 'premier',
      playMode: 'bo3',
      totalRounds: 5,
      rounds: [{ roundNumber: 1, playerScore: 0, opponentScore: 0, result: null, submitted: false }],
    }
    mockUseTournament.matchInProgress = true
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Return to Match 1' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Return to Match 1' }))
    expect(mockOnGameStart).toHaveBeenCalledWith('SOR-026', 'SOR', false, 'bo3')
  })

  it('uses the new base for the game when player changes base in limited bo3', async () => {
    mockUserSettings.useHyperspace = false
    const user = userEvent.setup()
    mockUseTournament.tournament = {
      base: { set: 'SOR', number: '026', name: 'Catacombs of Cadera', subtitle: 'Jedha', hp: 30,
        frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png', frontArtLowRes: null,
        hyperspaceArt: null, hyperspaceArtHiRes: null, epicAction: '', aspects: ['Aggression'], rarity: 'Common' },
      format: 'limited',
      playMode: 'bo3',
      totalRounds: 3,
      rounds: [{ roundNumber: 1, playerScore: 0, opponentScore: 0, result: null, submitted: false }],
    }
    mockUseTournament.matchInProgress = true
    render(<App />)
    // Record game 1 win: navigate to game, click You → Confirm, then Back to tournament
    await waitFor(() => expect(screen.getByRole('button', { name: 'Return to Match 1' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Return to Match 1' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'You' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'You' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    // Now on tournament screen with hasPlayedGameInCurrentMatch=true — change base overlay shows
    await waitFor(() => expect(screen.getByTestId('change-base-overlay')).toBeInTheDocument())
    await user.click(screen.getByTestId('change-base-overlay'))
    await user.selectOptions(screen.getByTestId('change-base-aspect'), 'Cunning')
    await user.selectOptions(screen.getByTestId('change-base-base'), 'SOR-022')
    await user.click(screen.getByRole('button', { name: 'Return to Match 1' }))
    expect(mockOnGameStart).toHaveBeenLastCalledWith('SOR-022', 'SOR', false, 'bo3')
  })

  it('Change Base overlay is not shown when backing out of game 1 without completing it in a limited Bo3 match', async () => {
    const user = userEvent.setup()
    mockUseTournament.tournament = {
      base: { set: 'SOR', number: '026', name: 'Catacombs of Cadera', subtitle: 'Jedha', hp: 30,
        frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png', frontArtLowRes: null,
        hyperspaceArt: null, hyperspaceArtHiRes: null, epicAction: '', aspects: ['Aggression'], rarity: 'Common' },
      format: 'limited',
      playMode: 'bo3',
      totalRounds: 3,
      rounds: [{ roundNumber: 1, playerScore: 0, opponentScore: 0, result: null, submitted: false }],
    }
    mockUseTournament.matchInProgress = true
    render(<App />)
    // Navigate to game screen and press Back immediately without recording any result
    await waitFor(() => expect(screen.getByRole('button', { name: 'Return to Match 1' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Return to Match 1' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Back' }))
    // Change base overlay must NOT appear — no game has been completed yet
    await waitFor(() => expect(screen.getByRole('button', { name: 'Return to Match 1' })).toBeInTheDocument())
    expect(screen.queryByTestId('change-base-overlay')).not.toBeInTheDocument()
  })

  it('fires onGameEnd when pressing Back from a tournament game', async () => {
    const user = userEvent.setup()
    mockUseTournament.tournament = {
      base: { set: 'SOR', number: '026', name: 'Catacombs of Cadera', subtitle: 'Jedha', hp: 30,
        frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png', frontArtLowRes: null,
        hyperspaceArt: null, hyperspaceArtHiRes: null, epicAction: '', aspects: ['Aggression'], rarity: 'Common' },
      format: 'premier',
      playMode: 'bo3',
      totalRounds: 5,
      rounds: [{ roundNumber: 1, playerScore: 0, opponentScore: 0, result: null, submitted: false }],
    }
    mockUseTournament.matchInProgress = true
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Return to Match 1' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Return to Match 1' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(mockOnGameEnd).toHaveBeenCalled())
    expect(mockOnGameEnd).toHaveBeenCalledWith('SOR-026', 'SOR', expect.any(Boolean), expect.any(Number), 'bo3')
  })

})