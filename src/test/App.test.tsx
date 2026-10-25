import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
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
  onXwingGameStarted: vi.fn().mockResolvedValue(undefined),
  onXwingGameEnded: vi.fn().mockResolvedValue(undefined),
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
  enableGameSelect: false,
  startScreen: 'swu',
  setUseHyperspace: vi.fn(),
  setEnableForceToken: vi.fn(),
  setEnableEpicActions: vi.fn(),
  setEnableWakeLock: vi.fn(),
}))
vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
}))


// SWU setup is showing once its title does.
const setupMarker = () => screen.getByRole('heading', { level: 1, name: 'Star Wars: Unlimited' })

type User = ReturnType<typeof userEvent.setup>

async function openFromMore(user: User, name: string) {
  await user.click(screen.getByRole('button', { name: 'More' }))
  await user.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name }))
}

async function chooseBase(user: User, name: string) {
  await user.click(within(screen.getByTestId('base-card')).getByRole('button', { name: /Choose your base|Change base/ }))
  await user.click(within(screen.getByRole('dialog', { name: 'Choose your base' })).getByRole('button', { name: new RegExp(`^${name}`) }))
}

async function chooseBaseAndGo(user: User, name: string) {
  await chooseBase(user, name)
  await user.click(screen.getByRole('button', { name: /^Go to (game|tournament)$/ }))
}

let store: Map<string, string>

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
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
  mockUserSettings.startScreen = 'swu'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// useBases is mocked so data is always ready; waitFor handles any async React batching.
async function waitForSetup() {
  await waitFor(() => expect(setupMarker()).toBeInTheDocument())
}

describe('App', () => {

  it('Shows loading screen on initial load', () => {
    vi.mocked(useBases).mockReturnValueOnce({ bases: [], loading: true, error: null })
    render(<App />)
    expect(screen.getByText('LOADING')).toBeInTheDocument()
  })

  it('Transitions to setup screen after loading', async () => {
    render(<App />)
    await waitFor(() => expect(setupMarker()).toBeInTheDocument())
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
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    await user.click(screen.getByText('Start'))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Game screen reflects the selected base health', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Energy Conversion Lab')
    await user.click(screen.getByText('Start'))
    expect(screen.getByText('Remaining: 25')).toBeInTheDocument()
  })

  it('Does not navigate to game screen if no base is selected', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    expect(screen.getByRole('button', { name: 'Go to game' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Go to game' }))
    expect(setupMarker()).toBeInTheDocument()
    expect(screen.queryByText(/Remaining:/)).not.toBeInTheDocument()
  })

  it('Clicking back from game screen returns to setup screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(setupMarker()).toBeInTheDocument()
  })

  // --- Your base is kept ---

  it('Keeps your base after navigating back from game screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(within(screen.getByTestId('base-card')).getByText('Catacombs of Cadera')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to game' })).toBeEnabled()
  })

  it('Can start a new game immediately after navigating back without re-selecting', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Go to game' }))
    await user.click(screen.getByText('Start'))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Keeps your base across launches', async () => {
    const user = userEvent.setup()
    const first = render(<App />)
    await waitForSetup()
    await chooseBase(user, 'Energy Conversion Lab')
    first.unmount()
    render(<App />)
    await waitForSetup()
    expect(within(screen.getByTestId('base-card')).getByText('Energy Conversion Lab')).toBeInTheDocument()
  })

  // --- Help navigation ---

  it('Help is in the More menu on setup screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Help' })).toBeInTheDocument()
  })

  it('Clicking help on setup screen shows the help screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await openFromMore(user, 'Help')
    expect(screen.getByText('Getting Started')).toBeInTheDocument()
  })

  it('Help button is visible on game screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument()
  })

  it('Clicking help on game screen shows the help screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByRole('heading', { level: 2, name: 'During a Game' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Getting Started' })).not.toBeInTheDocument()
  })

  it('Clicking back from help returns to setup when help was opened from setup', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await openFromMore(user, 'Help')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(setupMarker()).toBeInTheDocument()
  })

  it('Clicking back from help returns to game when help was opened from game', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
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

  it('Clicking help from settings screen shows settings-specific content', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await openFromMore(user, 'Settings')
    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByRole('heading', { level: 2, name: 'General' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Getting Started' })).not.toBeInTheDocument()
  })

  it('Passes useHyperspace=true to game screen when user settings preference is true', async () => {
    mockUserSettings.useHyperspace = true
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    const img = screen.getByAltText('Catacombs of Cadera')
    expect(img).toHaveAttribute('src', 'https://cdn.swu-db.com/images/cards/SOR/292.png')
  })

  it('Passes useHyperspace=false to game screen when user settings preference is false', async () => {
    mockUserSettings.useHyperspace = false
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    const img = screen.getByAltText('Catacombs of Cadera')
    expect(img).toHaveAttribute('src', 'https://cdn.swu-db.com/images/cards/SOR/026.png')
  })


  // --- Settings navigation ---

  it('Clicking settings in the More menu on setup screen shows the settings screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await openFromMore(user, 'Settings')
    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument()
  })

  it('Clicking back from settings returns to setup when settings was opened from setup', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await openFromMore(user, 'Settings')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(setupMarker()).toBeInTheDocument()
  })

  it('Settings button is visible on game screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    expect(screen.getByRole('button', { name: '⚙' })).toBeInTheDocument()
  })

  it('Clicking settings on game screen shows the settings screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    await user.click(screen.getByRole('button', { name: '⚙' }))
    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument()
  })

  it('Clicking back from settings returns to game when settings was opened from game', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    await user.click(screen.getByText('Start'))
    await user.click(screen.getByRole('button', { name: '⚙' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Clicking back from settings returns to setup after settings -> help -> back', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await openFromMore(user, 'Settings')
    await user.click(screen.getByRole('button', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(setupMarker()).toBeInTheDocument()
  })

  it('Clicking back from settings returns to game after settings -> help -> back', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
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

  it('calls onGameStart when the user starts a game (clicks Start on the round counter)', async () => {
    mockUserSettings.useHyperspace = true
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    await waitFor(() => expect(screen.getByTestId('game-counter')).toHaveTextContent('Start'))
    await user.click(screen.getByTestId('game-counter'))
    expect(mockOnGameStart).toHaveBeenCalledWith('SOR-026', 'SOR', true, 'casual')
  })

  it('does not call onGameStart when navigating to the game screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    await waitFor(() => expect(screen.getByTestId('game-counter')).toHaveTextContent('Start'))
    expect(mockOnGameStart).not.toHaveBeenCalled()
  })

  it('calls onGameEnd when the back button is pressed from the game screen', async () => {
    mockUserSettings.useHyperspace = false
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    await waitFor(() => expect(screen.getByTestId('game-counter')).toHaveTextContent('Start'))
    await user.click(screen.getByTestId('game-counter'))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(mockOnGameEnd).toHaveBeenCalledWith('SOR-026', 'SOR', false, expect.any(Number), 'casual', expect.any(String))
  })

  it('does not call onGameEnd when back is pressed from help screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await openFromMore(user, 'Help')
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

  it('navigates to tournament screen when tournament mode is confirmed, with Competitive mode off', async () => {
    mockUserSettings.enableCompetitiveMode = false
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: 'Tournament' }))
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    expect(screen.getByRole('button', { name: 'Start Match 1' })).toBeInTheDocument()
  })

  // Format leaves setup for the tournament start sheet; until then a tournament plays Premier.
  it('a tournament started from setup plays Premier, whatever format was stored before', async () => {
    store.set('pref_format', 'eternal')
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: 'Tournament' }))
    await chooseBaseAndGo(user, 'Catacombs of Cadera')
    await user.click(screen.getByRole('button', { name: 'Start Match 1' }))
    expect(mockUseTournament.startTournament).toHaveBeenCalledWith(expect.objectContaining({ set: 'SOR', number: '026' }), 'premier', expect.anything(), expect.anything())
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

  it('fires onGameStart when the user clicks Start within the game screen (not on navigation)', async () => {
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
    // Navigation itself must not count as a game start
    expect(mockOnGameStart).not.toHaveBeenCalled()
    // Starting the game (round counter) must fire onGameStart
    await waitFor(() => expect(screen.getByTestId('game-counter')).toHaveTextContent('Start'))
    await user.click(screen.getByTestId('game-counter'))
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'YOU' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'YOU' }))
    await user.click(screen.getByRole('button', { name: 'WIN' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    // Now on tournament screen with hasPlayedGameInCurrentMatch=true — change base overlay shows
    await waitFor(() => expect(screen.getByTestId('change-base-overlay')).toBeInTheDocument())
    await user.click(screen.getByTestId('change-base-overlay'))
    await user.selectOptions(screen.getByTestId('change-base-aspect'), 'Cunning')
    await user.selectOptions(screen.getByTestId('change-base-base'), 'SOR-022')
    await user.click(screen.getByRole('button', { name: 'Return to Match 1' }))
    await waitFor(() => expect(screen.getByTestId('game-counter')).toHaveTextContent('Start'))
    await user.click(screen.getByTestId('game-counter'))
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
    await waitFor(() => expect(screen.getByTestId('game-counter')).toHaveTextContent('Start'))
    await user.click(screen.getByTestId('game-counter'))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(mockOnGameEnd).toHaveBeenCalled())
    expect(mockOnGameEnd).toHaveBeenCalledWith('SOR-026', 'SOR', expect.any(Boolean), expect.any(Number), 'bo3', expect.any(String))
  })

})

describe('App game select', () => {

  it('transitions to setup screen after loading when startScreen is swu', async () => {
    render(<App />)
    await waitForSetup()
    expect(screen.getByTestId('base-card')).toBeInTheDocument()
  })

  it('transitions to game select screen after loading when startScreen is gameSelect', async () => {
    mockUserSettings.startScreen = 'gameSelect'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars unlimited/i })).toBeInTheDocument())
  })

  // The setup screen is ready once its scenario select shows.
  const xwingSetupMarker = () => screen.getByRole('button', { name: /^Scenario: / })

  async function chooseNoList(user: ReturnType<typeof userEvent.setup>, side: 'player' | 'opponent') {
    await user.click(within(screen.getByTestId(`${side}-card`)).getByRole('button', { name: /choose a list|change list/i }))
    await user.click(screen.getByTestId(`${side}-no-list-btn`))
  }

  it('transitions to xwing setup screen after loading when startScreen is xwing', async () => {
    mockUserSettings.startScreen = 'xwing'
    render(<App />)
    await waitFor(() => expect(xwingSetupMarker()).toBeInTheDocument())
  })

  it('navigates to setup screen when Star Wars Unlimited is clicked on game select', async () => {
    const user = userEvent.setup()
    mockUserSettings.startScreen = 'gameSelect'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars unlimited/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /star wars unlimited/i }))
    await waitForSetup()
    expect(screen.getByTestId('base-card')).toBeInTheDocument()
  })

  it('navigates to xwing setup screen when X-Wing is clicked on game select', async () => {
    const user = userEvent.setup()
    mockUserSettings.startScreen = 'gameSelect'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars x-wing/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /star wars x-wing/i }))
    await waitFor(() => expect(xwingSetupMarker()).toBeInTheDocument())
  })

  it('back from xwing setup returns to game select when startScreen is gameSelect', async () => {
    const user = userEvent.setup()
    mockUserSettings.startScreen = 'gameSelect'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars x-wing/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /star wars x-wing/i }))
    await waitFor(() => expect(xwingSetupMarker()).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars x-wing/i })).toBeInTheDocument())
  })

  it('back from xwing setup returns to game select when startScreen is xwing', async () => {
    const user = userEvent.setup()
    mockUserSettings.startScreen = 'xwing'
    render(<App />)
    await waitFor(() => expect(xwingSetupMarker()).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars x-wing/i })).toBeInTheDocument())
  })

  it('clicking Start Game on xwing setup navigates to xwing game screen', async () => {
    const user = userEvent.setup()
    mockUserSettings.startScreen = 'gameSelect'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars x-wing/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /star wars x-wing/i }))
    await waitFor(() => expect(xwingSetupMarker()).toBeInTheDocument())
    await chooseNoList(user, 'player')
    await chooseNoList(user, 'opponent')
    await user.click(screen.getByRole('button', { name: 'Go to game' }))
    await waitFor(() => expect(screen.getByTestId('start-game-btn')).toBeInTheDocument())
  })

  it('back from xwing game returns to xwing setup screen', async () => {
    const user = userEvent.setup()
    mockUserSettings.startScreen = 'gameSelect'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars x-wing/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /star wars x-wing/i }))
    await waitFor(() => expect(xwingSetupMarker()).toBeInTheDocument())
    await chooseNoList(user, 'player')
    await chooseNoList(user, 'opponent')
    await user.click(screen.getByRole('button', { name: 'Go to game' }))
    await waitFor(() => expect(screen.getByTestId('start-game-btn')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(xwingSetupMarker()).toBeInTheDocument())
  })

  it('back from setup returns to game select when startScreen is swu', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars unlimited/i })).toBeInTheDocument())
  })

  it('clicking help on xwing setup screen shows xwing setup help content', async () => {
    const user = userEvent.setup()
    mockUserSettings.startScreen = 'gameSelect'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars x-wing/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /star wars x-wing/i }))
    await waitFor(() => expect(xwingSetupMarker()).toBeInTheDocument())
    await openFromMore(user, 'Help')
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Match Type' })).toBeInTheDocument())
  })

  it('back from xwing setup help returns to xwing setup screen', async () => {
    const user = userEvent.setup()
    mockUserSettings.startScreen = 'gameSelect'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars x-wing/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /star wars x-wing/i }))
    await waitFor(() => expect(xwingSetupMarker()).toBeInTheDocument())
    await openFromMore(user, 'Help')
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Match Type' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(xwingSetupMarker()).toBeInTheDocument())
  })

  // ── X-Wing Squad Lists ────────────────────────────────────────────────────

  async function openXwingSetup(user: ReturnType<typeof userEvent.setup>) {
    mockUserSettings.startScreen = 'gameSelect'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars x-wing/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /star wars x-wing/i }))
    await waitFor(() => expect(xwingSetupMarker()).toBeInTheDocument())
  }

  it('Squad lists on xwing setup opens the Squad Lists screen', async () => {
    const user = userEvent.setup()
    await openXwingSetup(user)
    await openFromMore(user, 'Squad lists')
    expect(await screen.findByRole('heading', { name: 'Squad Lists' })).toBeInTheDocument()
  })

  it('back from Squad Lists returns to xwing setup', async () => {
    const user = userEvent.setup()
    await openXwingSetup(user)
    await openFromMore(user, 'Squad lists')
    await user.click(await screen.findByRole('button', { name: 'Back' }))
    await waitFor(() => expect(xwingSetupMarker()).toBeInTheDocument())
  })

  it('help on Squad Lists shows the squad lists help, and back returns to Squad Lists', async () => {
    const user = userEvent.setup()
    await openXwingSetup(user)
    await openFromMore(user, 'Squad lists')
    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Creating a List' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Match Type' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Squad Lists' })).toBeInTheDocument()
  })

  it('Manage lists in settings opens Squad Lists, and back returns to settings', async () => {
    const user = userEvent.setup()
    await openXwingSetup(user)
    await openFromMore(user, 'Settings')
    await user.click(screen.getByRole('button', { name: 'Manage lists' }))
    expect(screen.getByRole('heading', { name: 'Squad Lists' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument()
  })

  it('a list created on Squad Lists is offered on xwing setup', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => { store.clear() },
    })
    const user = userEvent.setup()
    await openXwingSetup(user)
    await openFromMore(user, 'Squad lists')
    fireEvent.change(screen.getByTestId('lists-textarea'), { target: { value: JSON.stringify({
      name: 'Round Trip',
      pilots: [
        { name: 'pilota', ship: 'shipa', points: 16 },
        { name: 'pilotb', ship: 'shipb', points: 15 },
        { name: 'pilotc', ship: 'shipc', points: 15 },
      ],
      points: 46,
    }) } })
    await user.click(screen.getByTestId('lists-check-btn'))
    await user.click(screen.getByTestId('lists-save-btn'))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(xwingSetupMarker()).toBeVisible())
    await user.click(within(screen.getByTestId('player-card')).getByRole('button', { name: 'Choose a list' }))
    expect(within(screen.getByRole('dialog', { name: 'Your list' })).getByText('Round Trip')).toBeVisible()
  })

  it('xwing setup choices survive a visit to Squad Lists', async () => {
    const user = userEvent.setup()
    await openXwingSetup(user)
    await user.click(xwingSetupMarker())
    await user.click(screen.getByRole('button', { name: 'Salvage Mission' }))
    await chooseNoList(user, 'player')
    await openFromMore(user, 'Squad lists')
    expect(screen.getByTestId('player-chosen-name')).not.toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('player-chosen-name')).toBeVisible()
    expect(screen.getByTestId('player-chosen-name')).toHaveTextContent('No list')
    expect(screen.getByRole('button', { name: 'Scenario: Salvage Mission' })).toBeVisible()
  })

  it('xwing setup choices survive a visit to Help', async () => {
    const user = userEvent.setup()
    await openXwingSetup(user)
    await chooseNoList(user, 'player')
    await openFromMore(user, 'Help')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('player-chosen-name')).toBeVisible()
  })

  it('after a game, Back returns to setup with both choices kept for a rematch', async () => {
    const user = userEvent.setup()
    await openXwingSetup(user)
    await chooseNoList(user, 'player')
    await chooseNoList(user, 'opponent')
    await user.click(screen.getByRole('button', { name: 'Go to game' }))
    await waitFor(() => expect(screen.getByTestId('start-game-btn')).toBeVisible())
    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(xwingSetupMarker()).toBeVisible())
    expect(screen.getByRole('button', { name: 'Go to game' })).toBeVisible()
  })

  it('leaving X-Wing for game select and coming back starts setup afresh', async () => {
    const user = userEvent.setup()
    await openXwingSetup(user)
    await chooseNoList(user, 'player')
    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars x-wing/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /star wars x-wing/i }))
    await waitFor(() => expect(within(screen.getByTestId('player-card')).getByRole('button', { name: 'Choose a list' })).toBeVisible())
  })

  // ── Settings tab defaults per source screen ───────────────────────────────

  it('settings button is visible on game select screen', async () => {
    mockUserSettings.startScreen = 'gameSelect'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument())
  })

  it('opening settings from game select shows the General tab active', async () => {
    const user = userEvent.setup()
    mockUserSettings.startScreen = 'gameSelect'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /swu/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('opening settings from setup shows the SWU tab active', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await openFromMore(user, 'Settings')
    expect(screen.getByRole('tab', { name: /swu/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('opening settings from xwing shows the X-Wing tab active', async () => {
    const user = userEvent.setup()
    mockUserSettings.startScreen = 'gameSelect'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /star wars x-wing/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /star wars x-wing/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('tab', { name: /x-wing/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'false')
  })

})