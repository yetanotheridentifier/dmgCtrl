import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsScreen from '../components/settingsScreen'
import type { FavouriteBase } from '../hooks/useFavourites'

const mockOnSettingChanged = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnFavouriteRemovedSettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnFavouritesCleared = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../services/analytics', () => ({
  onSettingChanged: mockOnSettingChanged,
  onFavouriteRemoved: mockOnFavouriteRemovedSettings,
  onFavouritesCleared: mockOnFavouritesCleared,
}))

const mockUserSettings = vi.hoisted(() => ({
  useHyperspace: true,
  forceTokenDisplay: 'lof-only' as 'always-on' | 'lof-only' | 'always-off',
  enableEpicActions: true,
  enableWakeLock: true,
  enableFavourites: true,
  setUseHyperspace: vi.fn(),
  setForceTokenDisplay: vi.fn(),
  setEnableEpicActions: vi.fn(),
  setEnableWakeLock: vi.fn(),
  setEnableFavourites: vi.fn(),
  enableActionLog: true,
  setEnableActionLog: vi.fn(),
  enableCompetitiveMode: false,
  setEnableCompetitiveMode: vi.fn(),
  bo1TimerMinutes: 25,
  bo3TimerMinutes: 55,
  setBo1TimerMinutes: vi.fn(),
  setBo3TimerMinutes: vi.fn(),
  xwingTimerMinutes: 75,
  setXwingTimerMinutes: vi.fn(),
  meleePlayerGuid: '',
  setMeleePlayerGuid: vi.fn(),
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
  mockUserSettings.forceTokenDisplay = 'lof-only'
  mockUserSettings.enableEpicActions = true
  mockUserSettings.enableWakeLock = true
  mockUserSettings.enableFavourites = true
  mockUserSettings.enableActionLog = true
  mockUserSettings.enableCompetitiveMode = false
  mockUserSettings.bo1TimerMinutes = 25
  mockUserSettings.bo3TimerMinutes = 55
  mockUserSettings.xwingTimerMinutes = 75
  mockUserSettings.meleePlayerGuid = ''
  mockFavourites.favourites = []
  mockOrientation.isPortrait = true
})

describe('SettingsScreen', () => {

  // ── Header / navigation ───────────────────────────────────────────────────

  it('renders a Settings heading', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument()
  })

  it('renders the app icon', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.getByAltText('dmgCtrl')).toBeInTheDocument()
  })

  it('renders a back button', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('renders a help button', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument()
  })

  it('does not render a settings button on the settings screen', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.queryByRole('button', { name: '⚙' })).not.toBeInTheDocument()
  })

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<SettingsScreen onBack={onBack} onHelp={vi.fn()} defaultTab="general" />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('calls onHelp when help button is clicked', async () => {
    const user = userEvent.setup()
    const onHelp = vi.fn()
    render(<SettingsScreen onBack={vi.fn()} onHelp={onHelp} defaultTab="general" />)
    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(onHelp).toHaveBeenCalledOnce()
  })

  // ── Tab navigation ────────────────────────────────────────────────────────

  it('renders a General tab', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.getByRole('tab', { name: /general/i })).toBeInTheDocument()
  })

  it('renders a SWU tab', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.getByRole('tab', { name: /swu/i })).toBeInTheDocument()
  })

  it('renders an X-Wing tab', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.getByRole('tab', { name: /x-wing/i })).toBeInTheDocument()
  })

  it('General tab is active when defaultTab is "general"', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /swu/i })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: /x-wing/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('SWU tab is active when defaultTab is "swu"', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('tab', { name: /swu/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: /x-wing/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('X-Wing tab is active when defaultTab is "xwing"', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
    expect(screen.getByRole('tab', { name: /x-wing/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: /swu/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('clicking the SWU tab activates it', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    await user.click(screen.getByRole('tab', { name: /swu/i }))
    expect(screen.getByRole('tab', { name: /swu/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('clicking the X-Wing tab activates it', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    await user.click(screen.getByRole('tab', { name: /x-wing/i }))
    expect(screen.getByRole('tab', { name: /x-wing/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('clicking the General tab activates it when SWU was active', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('tab', { name: /general/i }))
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /swu/i })).toHaveAttribute('aria-selected', 'false')
  })

  // ── General tab content ───────────────────────────────────────────────────

  it('General tab shows Enable Screen Wake Lock', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.getByRole('checkbox', { name: /enable screen wake lock/i })).toBeInTheDocument()
  })

  it('General tab shows Enable Action Log', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.getByRole('checkbox', { name: /enable action log/i })).toBeInTheDocument()
  })

  it('General tab does not show Use Hyperspace Art', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.queryByRole('checkbox', { name: /use hyperspace art/i })).not.toBeInTheDocument()
  })

  it('General tab does not show Enable Epic Actions', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.queryByRole('checkbox', { name: /enable epic actions/i })).not.toBeInTheDocument()
  })

  it('General tab does not show Enable Favourites', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.queryByRole('checkbox', { name: /enable favourites/i })).not.toBeInTheDocument()
  })

  it('General tab does not show the X-Wing timer stepper', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.queryByTestId('xwing-timer-stepper')).not.toBeInTheDocument()
  })

  // ── SWU tab content ───────────────────────────────────────────────────────

  it('SWU tab shows Use Hyperspace Art', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('checkbox', { name: /use hyperspace art/i })).toBeInTheDocument()
  })

  it('SWU tab shows Force Token Display', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('combobox', { name: /force token/i })).toBeInTheDocument()
  })

  it('SWU tab shows Enable Epic Actions', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('checkbox', { name: /enable epic actions/i })).toBeInTheDocument()
  })

  it('SWU tab shows Enable Competitive Mode', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('checkbox', { name: /enable competitive mode/i })).toBeInTheDocument()
  })

  it('SWU tab shows Enable Favourites', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('checkbox', { name: /enable favourites/i })).toBeInTheDocument()
  })

  it('SWU tab does not show Enable Screen Wake Lock', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.queryByRole('checkbox', { name: /enable screen wake lock/i })).not.toBeInTheDocument()
  })

  it('SWU tab does not show Enable Action Log', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.queryByRole('checkbox', { name: /enable action log/i })).not.toBeInTheDocument()
  })

  it('SWU tab does not show the X-Wing timer stepper', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.queryByTestId('xwing-timer-stepper')).not.toBeInTheDocument()
  })

  // ── X-Wing tab content ────────────────────────────────────────────────────

  it('X-Wing tab shows the X-Wing timer stepper', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
    expect(screen.getByTestId('xwing-timer-stepper')).toBeInTheDocument()
  })

  it('X-Wing tab does not show Use Hyperspace Art', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
    expect(screen.queryByRole('checkbox', { name: /use hyperspace art/i })).not.toBeInTheDocument()
  })

  it('X-Wing tab does not show Enable Screen Wake Lock', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
    expect(screen.queryByRole('checkbox', { name: /enable screen wake lock/i })).not.toBeInTheDocument()
  })

  it('X-Wing tab does not show Enable Action Log', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
    expect(screen.queryByRole('checkbox', { name: /enable action log/i })).not.toBeInTheDocument()
  })

  // ── General tab — toggles ─────────────────────────────────────────────────

  it('renders Enable Screen Wake Lock toggle in checked state', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.getByRole('checkbox', { name: /enable screen wake lock/i })).toBeChecked()
  })

  it('calls setEnableWakeLock(false) when wake lock toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    await user.click(screen.getByRole('checkbox', { name: /enable screen wake lock/i }))
    expect(mockUserSettings.setEnableWakeLock).toHaveBeenCalledWith(false)
  })

  it('renders Enable Action Log toggle in checked state', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    expect(screen.getByRole('checkbox', { name: /enable action log/i })).toBeChecked()
  })

  it('calls setEnableActionLog(false) when action log toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    await user.click(screen.getByRole('checkbox', { name: /enable action log/i }))
    expect(mockUserSettings.setEnableActionLog).toHaveBeenCalledWith(false)
  })

  // ── SWU tab — toggles ─────────────────────────────────────────────────────

  it('renders Use Hyperspace Art toggle in checked state', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('checkbox', { name: /use hyperspace art/i })).toBeChecked()
  })

  it('renders Force Token Display dropdown with lof-only selected by default', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    const select = screen.getByRole('combobox', { name: /force token/i })
    expect(select).toHaveValue('lof-only')
  })

  it('renders Enable Epic Actions toggle in checked state', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('checkbox', { name: /enable epic actions/i })).toBeChecked()
  })

  it('calls setUseHyperspace(false) when hyperspace toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('checkbox', { name: /use hyperspace art/i }))
    expect(mockUserSettings.setUseHyperspace).toHaveBeenCalledWith(false)
  })

  it('calls setForceTokenDisplay when force token dropdown is changed', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.selectOptions(screen.getByRole('combobox', { name: /force token/i }), 'always-off')
    expect(mockUserSettings.setForceTokenDisplay).toHaveBeenCalledWith('always-off')
  })

  it('calls setEnableEpicActions(false) when epic actions toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('checkbox', { name: /enable epic actions/i }))
    expect(mockUserSettings.setEnableEpicActions).toHaveBeenCalledWith(false)
  })

  it('renders Enable Competitive Mode toggle in unchecked state', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('checkbox', { name: /enable competitive mode/i })).not.toBeChecked()
  })

  it('calls setEnableCompetitiveMode(true) when competitive mode toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('checkbox', { name: /enable competitive mode/i }))
    expect(mockUserSettings.setEnableCompetitiveMode).toHaveBeenCalledWith(true)
  })

  // ── SWU tab — timer duration steppers ────────────────────────────────────

  it('Bo1 timer stepper is not shown when competitive mode is off', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.queryByTestId('bo1-timer-stepper')).not.toBeInTheDocument()
  })

  it('Bo3 timer stepper is not shown when competitive mode is off', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.queryByTestId('bo3-timer-stepper')).not.toBeInTheDocument()
  })

  it('Bo1 timer stepper is shown when competitive mode is on', () => {
    mockUserSettings.enableCompetitiveMode = true
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByTestId('bo1-timer-stepper')).toBeInTheDocument()
  })

  it('Bo3 timer stepper is shown when competitive mode is on', () => {
    mockUserSettings.enableCompetitiveMode = true
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByTestId('bo3-timer-stepper')).toBeInTheDocument()
  })

  it('Bo1 timer stepper shows the current value in minutes', () => {
    mockUserSettings.enableCompetitiveMode = true
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByTestId('bo1-timer-stepper')).toHaveTextContent('25')
  })

  it('Bo3 timer stepper shows the current value in minutes', () => {
    mockUserSettings.enableCompetitiveMode = true
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByTestId('bo3-timer-stepper')).toHaveTextContent('55')
  })

  it('clicking + on Bo1 timer calls setBo1TimerMinutes with value + 5', async () => {
    mockUserSettings.enableCompetitiveMode = true
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(within(screen.getByTestId('bo1-timer-stepper')).getByRole('button', { name: '+' }))
    expect(mockUserSettings.setBo1TimerMinutes).toHaveBeenCalledWith(30)
  })

  it('clicking − on Bo1 timer calls setBo1TimerMinutes with value − 5', async () => {
    mockUserSettings.enableCompetitiveMode = true
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(within(screen.getByTestId('bo1-timer-stepper')).getByRole('button', { name: '−' }))
    expect(mockUserSettings.setBo1TimerMinutes).toHaveBeenCalledWith(20)
  })

  it('clicking + on Bo3 timer calls setBo3TimerMinutes with value + 5', async () => {
    mockUserSettings.enableCompetitiveMode = true
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(within(screen.getByTestId('bo3-timer-stepper')).getByRole('button', { name: '+' }))
    expect(mockUserSettings.setBo3TimerMinutes).toHaveBeenCalledWith(60)
  })

  it('clicking − on Bo3 timer calls setBo3TimerMinutes with value − 5', async () => {
    mockUserSettings.enableCompetitiveMode = true
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(within(screen.getByTestId('bo3-timer-stepper')).getByRole('button', { name: '−' }))
    expect(mockUserSettings.setBo3TimerMinutes).toHaveBeenCalledWith(50)
  })

  it('+ on Bo1 timer is disabled at maximum (90)', async () => {
    mockUserSettings.enableCompetitiveMode = true
    mockUserSettings.bo1TimerMinutes = 90
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(within(screen.getByTestId('bo1-timer-stepper')).getByRole('button', { name: '+' })).toBeDisabled()
  })

  it('− on Bo1 timer is disabled at minimum (5)', async () => {
    mockUserSettings.enableCompetitiveMode = true
    mockUserSettings.bo1TimerMinutes = 5
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(within(screen.getByTestId('bo1-timer-stepper')).getByRole('button', { name: '−' })).toBeDisabled()
  })

  // ── SWU tab — Melee Player ID ─────────────────────────────────────────────

  it('renders Melee Player ID input when competitive mode is on', () => {
    mockUserSettings.enableCompetitiveMode = true
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('textbox', { name: /melee.*player.*id/i })).toBeInTheDocument()
  })

  it('does not render Melee Player ID input when competitive mode is off', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.queryByRole('textbox', { name: /melee.*player.*id/i })).not.toBeInTheDocument()
  })

  it('Melee Player ID input reflects the current stored value', () => {
    mockUserSettings.enableCompetitiveMode = true
    mockUserSettings.meleePlayerGuid = 'abc-123'
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('textbox', { name: /melee.*player.*id/i })).toHaveValue('abc-123')
  })

  it('Changing Melee Player ID input calls setMeleePlayerGuid', async () => {
    mockUserSettings.enableCompetitiveMode = true
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.type(screen.getByRole('textbox', { name: /melee.*player.*id/i }), 'x')
    expect(mockUserSettings.setMeleePlayerGuid).toHaveBeenCalled()
  })

  // ── SWU tab — Favourites ──────────────────────────────────────────────────

  it('renders Enable Favourites toggle in checked state', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('checkbox', { name: /enable favourites/i })).toBeChecked()
  })

  it('calls setEnableFavourites(false) when favourites toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('checkbox', { name: /enable favourites/i }))
    expect(mockUserSettings.setEnableFavourites).toHaveBeenCalledWith(false)
  })

  it('shows "No favourites saved" placeholder when list is empty', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByText(/no favourites saved/i)).toBeInTheDocument()
  })

  it('renders each favourite with set, name, HP and aspect', () => {
    mockFavourites.favourites = sampleFavourites
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByText('SOR: Catacombs of Cadera — 30HP (Aggression)')).toBeInTheDocument()
    expect(screen.getByText('JTL: Lake Country — 30HP (None)')).toBeInTheDocument()
  })

  it('hides favourites section when enableFavourites is false', () => {
    mockUserSettings.enableFavourites = false
    mockFavourites.favourites = sampleFavourites
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.queryByText('SOR: Catacombs of Cadera — 30HP (Aggression)')).not.toBeInTheDocument()
    expect(screen.queryByText(/no favourites saved/i)).not.toBeInTheDocument()
  })

  it('each favourite row has a Remove button', () => {
    mockFavourites.favourites = sampleFavourites
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(2)
  })

  it('clicking Remove calls removeFavourite with the correct key', async () => {
    const user = userEvent.setup()
    mockFavourites.favourites = sampleFavourites
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getAllByRole('button', { name: /remove/i })[0])
    expect(mockFavourites.removeFavourite).toHaveBeenCalledWith('SOR-026')
  })

  it('Clear All button is not shown when list is empty', () => {
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument()
  })

  it('Clear All button is shown when list has entries', () => {
    mockFavourites.favourites = sampleFavourites
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument()
  })

  it('clicking Clear All shows inline confirmation', async () => {
    const user = userEvent.setup()
    mockFavourites.favourites = sampleFavourites
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('Cancel dismisses confirmation without calling clearFavourites', async () => {
    const user = userEvent.setup()
    mockFavourites.favourites = sampleFavourites
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockFavourites.clearFavourites).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument()
  })

  it('Confirm calls clearFavourites', async () => {
    const user = userEvent.setup()
    mockFavourites.favourites = sampleFavourites
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(mockFavourites.clearFavourites).toHaveBeenCalledOnce()
  })

  // ── Layout ────────────────────────────────────────────────────────────────

  it('in landscape on the SWU tab, SWU options and favourites are in separate columns', () => {
    mockOrientation.isPortrait = false
    mockFavourites.favourites = sampleFavourites
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    const optionsCol = screen.getByRole('group', { name: /swu options/i })
    const favouritesCol = screen.getByRole('group', { name: /favourites settings/i })
    expect(within(optionsCol).getByRole('checkbox', { name: /use hyperspace art/i })).toBeInTheDocument()
    expect(within(optionsCol).queryByRole('checkbox', { name: /enable favourites/i })).not.toBeInTheDocument()
    expect(within(favouritesCol).getByRole('checkbox', { name: /enable favourites/i })).toBeInTheDocument()
    expect(within(favouritesCol).queryByRole('checkbox', { name: /use hyperspace art/i })).not.toBeInTheDocument()
  })

  it('in portrait on the SWU tab, settings are not split into columns', async () => {
    mockOrientation.isPortrait = true
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    expect(screen.queryByRole('group', { name: /swu options/i })).not.toBeInTheDocument()
  })

})

describe('SettingsScreen analytics', () => {

  beforeEach(() => {
    mockOnSettingChanged.mockClear()
    mockOnFavouriteRemovedSettings.mockClear()
    mockOnFavouritesCleared.mockClear()
  })

  it('calls onSettingChanged with useHyperspace and new value when hyperspace toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('checkbox', { name: /hyperspace/i }))
    expect(mockOnSettingChanged).toHaveBeenCalledWith('useHyperspace', false)
  })

  it('calls onSettingChanged with forceTokenDisplay and new value when force token dropdown is changed', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.selectOptions(screen.getByRole('combobox', { name: /force token/i }), 'always-off')
    expect(mockOnSettingChanged).toHaveBeenCalledWith('forceTokenDisplay', 'always-off')
  })

  it('calls onSettingChanged with enableEpicActions and new value when epic actions toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('checkbox', { name: /epic actions/i }))
    expect(mockOnSettingChanged).toHaveBeenCalledWith('enableEpicActions', false)
  })

  it('calls onSettingChanged with enableWakeLock and new value when wake lock toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    await user.click(screen.getByRole('checkbox', { name: /wake lock/i }))
    expect(mockOnSettingChanged).toHaveBeenCalledWith('enableWakeLock', false)
  })

  it('calls onSettingChanged with enableActionLog and new value when action log toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="general" />)
    await user.click(screen.getByRole('checkbox', { name: /action log/i }))
    expect(mockOnSettingChanged).toHaveBeenCalledWith('enableActionLog', false)
  })

  it('calls onSettingChanged with enableFavourites and new value when favourites toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('checkbox', { name: /favourites/i }))
    expect(mockOnSettingChanged).toHaveBeenCalledWith('enableFavourites', false)
  })

  it('calls onSettingChanged with enableCompetitiveMode and new value when competitive mode toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('checkbox', { name: /competitive mode/i }))
    expect(mockOnSettingChanged).toHaveBeenCalledWith('enableCompetitiveMode', true)
  })

  it('calls onFavouriteRemoved with baseKey and baseSet when Remove is clicked', async () => {
    mockFavourites.favourites = [
      { key: 'SOR-026', set: 'SOR', name: 'Catacombs of Cadera', hp: 30, aspect: 'Aggression', cardNumber: 26 },
    ]
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('button', { name: /remove/i }))
    expect(mockOnFavouriteRemovedSettings).toHaveBeenCalledWith('SOR-026', 'SOR')
  })

  it('calls onFavouritesCleared when Clear All is confirmed', async () => {
    mockFavourites.favourites = [
      { key: 'SOR-026', set: 'SOR', name: 'Catacombs of Cadera', hp: 30, aspect: 'Aggression', cardNumber: 26 },
    ]
    const user = userEvent.setup()
    render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="swu" />)
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(mockOnFavouritesCleared).toHaveBeenCalledOnce()
  })

  // ── X-Wing timer stepper ──────────────────────────────────────────────────

  describe('X-Wing timer stepper', () => {

    it('is always shown on the X-Wing tab (not gated behind competitive mode)', () => {
      mockUserSettings.enableCompetitiveMode = false
      render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
      expect(screen.getByTestId('xwing-timer-stepper')).toBeInTheDocument()
    })

    it('shows the current xwingTimerMinutes value', () => {
      render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
      expect(screen.getByTestId('xwing-timer-stepper')).toHaveTextContent('75')
    })

    it('clicking + calls setXwingTimerMinutes with value + 5', async () => {
      const user = userEvent.setup()
      render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
      await user.click(within(screen.getByTestId('xwing-timer-stepper')).getByRole('button', { name: '+' }))
      expect(mockUserSettings.setXwingTimerMinutes).toHaveBeenCalledWith(80)
    })

    it('clicking − calls setXwingTimerMinutes with value − 5', async () => {
      const user = userEvent.setup()
      render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
      await user.click(within(screen.getByTestId('xwing-timer-stepper')).getByRole('button', { name: '−' }))
      expect(mockUserSettings.setXwingTimerMinutes).toHaveBeenCalledWith(70)
    })

    it('+ is disabled at maximum (90 minutes)', () => {
      mockUserSettings.xwingTimerMinutes = 90
      render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
      expect(within(screen.getByTestId('xwing-timer-stepper')).getByRole('button', { name: '+' })).toBeDisabled()
    })

    it('− is disabled at the test minimum (5.5 = 5:30)', () => {
      mockUserSettings.xwingTimerMinutes = 5.5
      render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
      expect(within(screen.getByTestId('xwing-timer-stepper')).getByRole('button', { name: '−' })).toBeDisabled()
    })

    it('− is enabled at 30 minutes (steps down to test value)', () => {
      mockUserSettings.xwingTimerMinutes = 30
      render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
      expect(within(screen.getByTestId('xwing-timer-stepper')).getByRole('button', { name: '−' })).not.toBeDisabled()
    })

    it('clicking − from 30 calls setXwingTimerMinutes with 5.5', async () => {
      const user = userEvent.setup()
      mockUserSettings.xwingTimerMinutes = 30
      render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
      await user.click(within(screen.getByTestId('xwing-timer-stepper')).getByRole('button', { name: '−' }))
      expect(mockUserSettings.setXwingTimerMinutes).toHaveBeenCalledWith(5.5)
    })

    it('clicking + from 5.5 calls setXwingTimerMinutes with 30', async () => {
      const user = userEvent.setup()
      mockUserSettings.xwingTimerMinutes = 5.5
      render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
      await user.click(within(screen.getByTestId('xwing-timer-stepper')).getByRole('button', { name: '+' }))
      expect(mockUserSettings.setXwingTimerMinutes).toHaveBeenCalledWith(30)
    })

    it('shows "5:30 (test)" when xwingTimerMinutes is 5.5', () => {
      mockUserSettings.xwingTimerMinutes = 5.5
      render(<SettingsScreen onBack={vi.fn()} onHelp={vi.fn()} defaultTab="xwing" />)
      expect(screen.getByTestId('xwing-timer-stepper')).toHaveTextContent('5:30 (test)')
    })

  })

})
