import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsScreen from '../components/settingsScreen'
import type { StartScreen } from '../hooks/useUserSettings'

const mockOnSettingChanged = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../services/analytics', () => ({
  onSettingChanged: mockOnSettingChanged,
}))

const mockUserSettings = vi.hoisted(() => ({
  useHyperspace: true,
  forceTokenDisplay: 'lof-only' as 'always-on' | 'lof-only' | 'always-off',
  enableInitiativeBar: true,
  enableDamageButtons: false,
  enableXwingPhases: false,
  enableXwingAlwaysIncDec: false,
  meleePlayerGuid: '',
  startScreen: 'gameSelect' as StartScreen,
  setUseHyperspace: vi.fn(),
  setForceTokenDisplay: vi.fn(),
  setEnableInitiativeBar: vi.fn(),
  setEnableDamageButtons: vi.fn(),
  setEnableXwingPhases: vi.fn(),
  setEnableXwingAlwaysIncDec: vi.fn(),
  setMeleePlayerGuid: vi.fn(),
  setStartScreen: vi.fn(),
}))
vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
}))

const mockOrientation = vi.hoisted(() => ({ vmin: 390, isPortrait: false }))
vi.mock('../hooks/useOrientation', () => ({
  useOrientation: () => mockOrientation,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockUserSettings.useHyperspace = true
  mockUserSettings.forceTokenDisplay = 'lof-only'
  mockUserSettings.enableInitiativeBar = true
  mockUserSettings.enableDamageButtons = false
  mockUserSettings.enableXwingPhases = false
  mockUserSettings.enableXwingAlwaysIncDec = false
  mockUserSettings.meleePlayerGuid = ''
  mockUserSettings.startScreen = 'gameSelect'
  mockOrientation.isPortrait = false
})

const show = (props: Partial<React.ComponentProps<typeof SettingsScreen>> = {}) =>
  render(<SettingsScreen onBack={vi.fn()} onManageXwingLists={vi.fn()} {...props} />)

const section = (name: string) => screen.getByRole('region', { name })
const toggle = (name: string) => screen.getByRole('switch', { name })

describe('SettingsScreen: page', () => {

  it('is one page headed Settings, with no tabs', () => {
    show()
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('groups the settings General, Star Wars: Unlimited and X-Wing', () => {
    show()
    expect(section('General')).toBeInTheDocument()
    expect(section('Star Wars: Unlimited')).toBeInTheDocument()
    expect(section('X-Wing')).toBeInTheDocument()
  })

  it('Back calls onBack', async () => {
    const onBack = vi.fn()
    show({ onBack })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('has no Help button', () => {
    show()
    expect(screen.queryByRole('button', { name: /help/i })).not.toBeInTheDocument()
  })

  it('in landscape, General and X-Wing share the left column and SWU has the right', () => {
    show()
    const left = screen.getByTestId('settings-left')
    const right = screen.getByTestId('settings-right')
    expect(within(left).getByRole('region', { name: 'General' })).toBeInTheDocument()
    expect(within(left).getByRole('region', { name: 'X-Wing' })).toBeInTheDocument()
    expect(within(right).getByRole('region', { name: 'Star Wars: Unlimited' })).toBeInTheDocument()
  })

  it('in portrait, the groups stack General, SWU, X-Wing', () => {
    mockOrientation.isPortrait = true
    show()
    expect(screen.queryByTestId('settings-left')).not.toBeInTheDocument()
    const names = screen.getAllByRole('region').map(r => r.getAttribute('aria-label'))
    expect(names).toEqual(['General', 'Star Wars: Unlimited', 'X-Wing'])
  })

  it('shows none of the retired settings', () => {
    show()
    for (const name of [/wake lock/i, /action log/i, /epic action/i, /competitive/i, /favourite/i, /timer/i, /clear all/i]) {
      expect(screen.queryByText(name)).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /decrease/i })).not.toBeInTheDocument()
  })

})

describe('SettingsScreen: General', () => {

  it('Start screen shows the current choice', () => {
    mockUserSettings.startScreen = 'xwing'
    show()
    expect(within(section('General')).getByRole('button', { name: 'Start screen: X-Wing' })).toBeInTheDocument()
  })

  it('Start screen opens a sheet of Game select, Star Wars: Unlimited and X-Wing, the current one marked', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Start screen: Game select' }))
    const sheet = screen.getByRole('dialog', { name: 'Start screen' })
    expect(within(sheet).getByRole('button', { name: 'Game select' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(sheet).getByRole('button', { name: 'Star Wars: Unlimited' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(sheet).getByRole('button', { name: 'X-Wing' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('choosing a start screen saves it, reports it and closes the sheet', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Start screen: Game select' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Start screen' })).getByRole('button', { name: 'Star Wars: Unlimited' }))
    expect(mockUserSettings.setStartScreen).toHaveBeenCalledWith('swu')
    expect(mockOnSettingChanged).toHaveBeenCalledWith('startScreen', 'swu')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

})

describe('SettingsScreen: Star Wars: Unlimited', () => {

  const switches: [string, keyof typeof mockUserSettings, string, string][] = [
    ['Hyperspace art', 'useHyperspace', 'setUseHyperspace', 'useHyperspace'],
    ['Damage −/+ buttons', 'enableDamageButtons', 'setEnableDamageButtons', 'enableDamageButtons'],
    ['Initiative', 'enableInitiativeBar', 'setEnableInitiativeBar', 'enableInitiativeBar'],
  ]

  it.each(switches)('%s is a switch in the SWU group showing its stored value', (name, key) => {
    (mockUserSettings as Record<string, unknown>)[key] = true
    show()
    expect(within(section('Star Wars: Unlimited')).getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true')
  })

  it.each(switches)('%s flips its stored value and reports it', async (name, key, setter, reported) => {
    (mockUserSettings as Record<string, unknown>)[key] = false
    show()
    await userEvent.click(toggle(name))
    expect((mockUserSettings as unknown as Record<string, ReturnType<typeof vi.fn>>)[setter]).toHaveBeenCalledWith(true)
    expect(mockOnSettingChanged).toHaveBeenCalledWith(reported, true)
  })

  it('Force tokens is a segmented choice of Always, LOF bases and Off', () => {
    show()
    const group = within(section('Star Wars: Unlimited')).getByRole('group', { name: 'Force tokens' })
    expect(within(group).getByRole('button', { name: 'Always' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(group).getByRole('button', { name: 'LOF bases' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'false')
  })

  it.each([['Always', 'always-on'], ['Off', 'always-off']] as const)('Force tokens %s saves %s', async (label, value) => {
    show()
    await userEvent.click(within(screen.getByRole('group', { name: 'Force tokens' })).getByRole('button', { name: label }))
    expect(mockUserSettings.setForceTokenDisplay).toHaveBeenCalledWith(value)
    expect(mockOnSettingChanged).toHaveBeenCalledWith('forceTokenDisplay', value)
  })

  it('Melee player ID shows the stored ID and saves what is typed', async () => {
    mockUserSettings.meleePlayerGuid = 'abc'
    show()
    const input = within(section('Star Wars: Unlimited')).getByRole('textbox', { name: 'Melee player ID' })
    expect(input).toHaveValue('abc')
    await userEvent.type(input, 'd')
    expect(mockUserSettings.setMeleePlayerGuid).toHaveBeenLastCalledWith('abcd')
  })

})

describe('SettingsScreen: X-Wing', () => {

  const switches: [string, keyof typeof mockUserSettings, string, string][] = [
    ['Phase tracker', 'enableXwingPhases', 'setEnableXwingPhases', 'enableXwingPhases'],
    ['Score −/+ buttons', 'enableXwingAlwaysIncDec', 'setEnableXwingAlwaysIncDec', 'enableXwingAlwaysIncDec'],
  ]

  it.each(switches)('%s is a switch in the X-Wing group showing its stored value', (name, key) => {
    (mockUserSettings as Record<string, unknown>)[key] = true
    show()
    expect(within(section('X-Wing')).getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true')
  })

  it.each(switches)('%s flips its stored value and reports it', async (name, key, setter, reported) => {
    (mockUserSettings as Record<string, unknown>)[key] = true
    show()
    await userEvent.click(toggle(name))
    expect((mockUserSettings as unknown as Record<string, ReturnType<typeof vi.fn>>)[setter]).toHaveBeenCalledWith(false)
    expect(mockOnSettingChanged).toHaveBeenCalledWith(reported, false)
  })

  it('Squad lists opens the squad lists screen', async () => {
    const onManageXwingLists = vi.fn()
    show({ onManageXwingLists })
    await userEvent.click(within(section('X-Wing')).getByRole('button', { name: 'Squad lists' }))
    expect(onManageXwingLists).toHaveBeenCalledOnce()
  })

})
