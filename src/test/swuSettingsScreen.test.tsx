import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuSettingsScreen from '../components/swuSettingsScreen'
import type { FavouriteBase } from '../hooks/useFavourites'

const mockUserSettings = vi.hoisted(() => ({
  useHyperspace: true,
  enableForceToken: true,
  enableEpicActions: true,
  enableWakeLock: true,
  enableFavourites: true,
  setUseHyperspace: vi.fn(),
  setEnableForceToken: vi.fn(),
  setEnableEpicActions: vi.fn(),
  setEnableWakeLock: vi.fn(),
  setEnableFavourites: vi.fn(),
}))
vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
}))

const mockFavourites = vi.hoisted(() => ({
  favourites: [] as FavouriteBase[],
  removeFavourite: vi.fn(),
  clearFavourites: vi.fn(),
}))
vi.mock('../hooks/useFavourites', () => ({
  useFavourites: () => mockFavourites,
}))

const mockOrientation = vi.hoisted(() => ({
  vmin: 375,
  isPortrait: true,
}))
vi.mock('../hooks/useOrientation', () => ({
  useOrientation: () => mockOrientation,
}))

vi.mock('../flags', () => ({ FEATURE_USER_SETTINGS: true }))

const sampleFavourites: FavouriteBase[] = [
  { key: 'SOR-026', set: 'SOR', name: 'Catacombs of Cadera', hp: 30, aspect: 'Aggression', cardNumber: 26 },
  { key: 'JTL-030', set: 'JTL', name: 'Lake Country', hp: 30, aspect: 'None', cardNumber: 30 },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockUserSettings.useHyperspace = true
  mockUserSettings.enableForceToken = true
  mockUserSettings.enableEpicActions = true
  mockUserSettings.enableWakeLock = true
  mockUserSettings.enableFavourites = true
  mockFavourites.favourites = []
  mockOrientation.isPortrait = true
})

describe('SwuSettingsScreen', () => {

  // --- Rendering ---

  it('renders a Settings heading', () => {
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument()
  })

  it('renders the app icon', () => {
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByAltText('dmgCtrl')).toBeInTheDocument()
  })

  it('renders a back button', () => {
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('renders a help button', () => {
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument()
  })

  it('does not render a settings button on the settings screen', () => {
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '⚙' })).not.toBeInTheDocument()
  })

  // --- Toggles ---

  it('renders Use Hyperspace Art toggle in checked state', () => {
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: /use hyperspace art/i })).toBeChecked()
  })

  it('renders Enable Force Token toggle in checked state', () => {
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: /enable force token/i })).toBeChecked()
  })

  it('renders Enable Epic Actions toggle in checked state', () => {
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: /enable epic actions/i })).toBeChecked()
  })

  it('renders Enable Screen Wake Lock toggle in checked state', () => {
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: /enable screen wake lock/i })).toBeChecked()
  })

  it('calls setUseHyperspace(false) when hyperspace toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('checkbox', { name: /use hyperspace art/i }))
    expect(mockUserSettings.setUseHyperspace).toHaveBeenCalledWith(false)
  })

  it('calls setEnableForceToken(false) when force token toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('checkbox', { name: /enable force token/i }))
    expect(mockUserSettings.setEnableForceToken).toHaveBeenCalledWith(false)
  })

  it('calls setEnableEpicActions(false) when epic actions toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('checkbox', { name: /enable epic actions/i }))
    expect(mockUserSettings.setEnableEpicActions).toHaveBeenCalledWith(false)
  })

  it('calls setEnableWakeLock(false) when wake lock toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('checkbox', { name: /enable screen wake lock/i }))
    expect(mockUserSettings.setEnableWakeLock).toHaveBeenCalledWith(false)
  })

  // --- Navigation ---

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<SwuSettingsScreen onBack={onBack} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('calls onHelp when help button is clicked', async () => {
    const user = userEvent.setup()
    const onHelp = vi.fn()
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={onHelp} />)
    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(onHelp).toHaveBeenCalledOnce()
  })

  // --- Favourites toggle ---

  it('renders Enable Favourites toggle in checked state', () => {
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: /enable favourites/i })).toBeChecked()
  })

  it('calls setEnableFavourites(false) when favourites toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('checkbox', { name: /enable favourites/i }))
    expect(mockUserSettings.setEnableFavourites).toHaveBeenCalledWith(false)
  })

  // --- Favourites list ---

  it('shows "No favourites saved" placeholder when list is empty', () => {
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText(/no favourites saved/i)).toBeInTheDocument()
  })

  it('renders each favourite with set, name, HP and aspect', () => {
    mockFavourites.favourites = sampleFavourites
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText('SOR: Catacombs of Cadera — 30HP (Aggression)')).toBeInTheDocument()
    expect(screen.getByText('JTL: Lake Country — 30HP (None)')).toBeInTheDocument()
  })

  it('hides favourites section when enableFavourites is false', () => {
    mockUserSettings.enableFavourites = false
    mockFavourites.favourites = sampleFavourites
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByText('SOR: Catacombs of Cadera — 30HP (Aggression)')).not.toBeInTheDocument()
    expect(screen.queryByText(/no favourites saved/i)).not.toBeInTheDocument()
  })

  // --- Remove ---

  it('each favourite row has a Remove button', () => {
    mockFavourites.favourites = sampleFavourites
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(2)
  })

  it('clicking Remove calls removeFavourite with the correct key', async () => {
    const user = userEvent.setup()
    mockFavourites.favourites = sampleFavourites
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getAllByRole('button', { name: /remove/i })[0])
    expect(mockFavourites.removeFavourite).toHaveBeenCalledWith('SOR-026')
  })

  // --- Clear All ---

  it('Clear All button is not shown when list is empty', () => {
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument()
  })

  it('Clear All button is shown when list has entries', () => {
    mockFavourites.favourites = sampleFavourites
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument()
  })

  it('clicking Clear All shows inline confirmation', async () => {
    const user = userEvent.setup()
    mockFavourites.favourites = sampleFavourites
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('Cancel dismisses confirmation without calling clearFavourites', async () => {
    const user = userEvent.setup()
    mockFavourites.favourites = sampleFavourites
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockFavourites.clearFavourites).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument()
  })

  it('Confirm calls clearFavourites', async () => {
    const user = userEvent.setup()
    mockFavourites.favourites = sampleFavourites
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(mockFavourites.clearFavourites).toHaveBeenCalledOnce()
  })

  // --- Layout ---

  it('in landscape, general and favourites settings are in separate columns', () => {
    mockOrientation.isPortrait = false
    mockFavourites.favourites = sampleFavourites
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    const generalCol = screen.getByRole('group', { name: /general settings/i })
    const favouritesCol = screen.getByRole('group', { name: /favourites settings/i })
    expect(within(generalCol).getByRole('checkbox', { name: /use hyperspace art/i })).toBeInTheDocument()
    expect(within(generalCol).queryByRole('checkbox', { name: /enable favourites/i })).not.toBeInTheDocument()
    expect(within(favouritesCol).getByRole('checkbox', { name: /enable favourites/i })).toBeInTheDocument()
    expect(within(favouritesCol).queryByRole('checkbox', { name: /use hyperspace art/i })).not.toBeInTheDocument()
  })

  it('in portrait, settings are not split into columns', () => {
    mockOrientation.isPortrait = true
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByRole('group', { name: /general settings/i })).not.toBeInTheDocument()
  })

})