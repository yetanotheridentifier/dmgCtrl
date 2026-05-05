import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { useBases } from '../hooks/useBases'

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
  setUseHyperspace: vi.fn(),
  setEnableForceToken: vi.fn(),
  setEnableEpicActions: vi.fn(),
  setEnableWakeLock: vi.fn(),
}))
vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
}))


// The mode selector is always present; filter it out to get the three
// base-selection dropdowns (set, aspect, base).
const getBaseSelectors = () => {
  const all = screen.getAllByRole('combobox')
  const modeSelect = screen.queryByTestId('mode-select')
  return modeSelect ? all.filter(el => el !== modeSelect) : all
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  })
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
    expect(screen.getByText('Remaining: 25')).toBeInTheDocument()
  })

  it('Does not navigate to game screen if no base is selected', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    expect(screen.getByText('Input Mode:')).toBeInTheDocument()
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
    expect(screen.getByText('Input Mode:')).toBeInTheDocument()
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
    expect(screen.getByText('Getting Started')).toBeInTheDocument()
  })

  it('Clicking back from help returns to setup when help was opened from setup', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.click(screen.getByRole('button', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Input Mode:')).toBeInTheDocument()
  })

  it('Clicking back from help returns to game when help was opened from game', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByRole('button', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
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
    expect(screen.getByText('Input Mode:')).toBeInTheDocument()
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
    expect(screen.getByText('Input Mode:')).toBeInTheDocument()
  })

  it('Clicking back from settings returns to game after settings -> help -> back', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitForSetup()
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    await user.click(screen.getByRole('button', { name: '⚙' }))
    await user.click(screen.getByRole('button', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

})