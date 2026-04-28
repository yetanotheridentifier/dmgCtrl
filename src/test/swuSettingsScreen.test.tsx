import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuSettingsScreen from '../components/swuSettingsScreen'

const mockSetters = vi.hoisted(() => ({
  setUseHyperspace: vi.fn(),
  setEnableForceToken: vi.fn(),
  setEnableEpicActions: vi.fn(),
  setEnableWakeLock: vi.fn(),
}))

vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: vi.fn().mockReturnValue({
    useHyperspace: true,
    enableForceToken: true,
    enableEpicActions: true,
    enableWakeLock: true,
    ...mockSetters,
  }),
}))

vi.mock('../flags', () => ({ FEATURE_USER_SETTINGS: true }))

beforeEach(() => {
  vi.clearAllMocks()
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
    expect(mockSetters.setUseHyperspace).toHaveBeenCalledWith(false)
  })

  it('calls setEnableForceToken(false) when force token toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('checkbox', { name: /enable force token/i }))
    expect(mockSetters.setEnableForceToken).toHaveBeenCalledWith(false)
  })

  it('calls setEnableEpicActions(false) when epic actions toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('checkbox', { name: /enable epic actions/i }))
    expect(mockSetters.setEnableEpicActions).toHaveBeenCalledWith(false)
  })

  it('calls setEnableWakeLock(false) when wake lock toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuSettingsScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('checkbox', { name: /enable screen wake lock/i }))
    expect(mockSetters.setEnableWakeLock).toHaveBeenCalledWith(false)
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

})