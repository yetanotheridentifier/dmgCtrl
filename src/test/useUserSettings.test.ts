import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUserSettings, UserSettingsProvider } from '../hooks/useUserSettings'

const STORAGE_KEY = 'user_settings'

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

// Stores `settings` under the settings key (raw text when a string), and `others` under their own keys.
function stored(settings: Record<string, unknown> | string | null, others: Record<string, string> = {}) {
  vi.mocked(localStorage.getItem).mockImplementation((key) => {
    if (key === STORAGE_KEY) {
      if (settings === null) return null
      return typeof settings === 'string' ? settings : JSON.stringify(settings)
    }
    return others[key] ?? null
  })
}

const render = () => renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })

const lastSaved = () => JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])

describe('useUserSettings', () => {

  // --- Defaults ---

  it('defaults useHyperspace to true when storage is empty', () => {
    expect(render().result.current.useHyperspace).toBe(true)
  })

  it('defaults forceTokenDisplay to lof-only when storage is empty', () => {
    expect(render().result.current.forceTokenDisplay).toBe('lof-only')
  })

  it('defaults Initiative (enableInitiativeBar) to on when storage is empty', () => {
    expect(render().result.current.enableInitiativeBar).toBe(true)
  })

  it('defaults enableXwingAlwaysIncDec to false when storage is empty', () => {
    expect(render().result.current.enableXwingAlwaysIncDec).toBe(false)
  })

  it('defaults enableDamageButtons to false when storage is empty', () => {
    expect(render().result.current.enableDamageButtons).toBe(false)
  })

  it('defaults startScreen to gameSelect when storage is empty', () => {
    expect(render().result.current.startScreen).toBe('gameSelect')
  })

  // --- Phase tracker: off for a new install, kept for an existing one ---

  it('turns the phase tracker off for a new install (nothing stored at all)', () => {
    expect(render().result.current.enableXwingPhases).toBe(false)
  })

  it('saves a new install\'s settings at first load, so the phase tracker stays off once other data exists', () => {
    render()
    expect(lastSaved().enableXwingPhases).toBe(false)
  })

  it('keeps the phase tracker on for an existing player with app data but no stored settings', () => {
    stored(null, { xwing_setup: '{}' })
    expect(render().result.current.enableXwingPhases).toBe(true)
  })

  it('saves an existing player\'s phase tracker at first load, so it is pinned', () => {
    stored(null, { swu_setup: '{}' })
    render()
    expect(lastSaved().enableXwingPhases).toBe(true)
  })

  it('keeps the phase tracker on when stored settings predate the key', () => {
    stored({ useHyperspace: false })
    expect(render().result.current.enableXwingPhases).toBe(true)
  })

  it('keeps a stored phase tracker value, on or off', () => {
    stored({ enableXwingPhases: false })
    expect(render().result.current.enableXwingPhases).toBe(false)
    stored({ enableXwingPhases: true })
    expect(render().result.current.enableXwingPhases).toBe(true)
  })

  // --- Initiative: on by default, a stored value kept ---

  it('keeps a stored Initiative value of off', () => {
    stored({ enableInitiativeBar: false })
    expect(render().result.current.enableInitiativeBar).toBe(false)
  })

  it('turns Initiative on when stored settings predate the key', () => {
    stored({ useHyperspace: false })
    expect(render().result.current.enableInitiativeBar).toBe(true)
  })

  // --- Load from storage ---

  it('loads useHyperspace=false from stored JSON', () => {
    stored({ useHyperspace: false })
    expect(render().result.current.useHyperspace).toBe(false)
  })

  it('loads forceTokenDisplay=always-on from stored JSON', () => {
    stored({ forceTokenDisplay: 'always-on' })
    expect(render().result.current.forceTokenDisplay).toBe('always-on')
  })

  it('loads forceTokenDisplay=always-off from stored JSON', () => {
    stored({ forceTokenDisplay: 'always-off' })
    expect(render().result.current.forceTokenDisplay).toBe('always-off')
  })

  it('migrates stored enableForceToken:false to always-off', () => {
    stored({ enableForceToken: false })
    expect(render().result.current.forceTokenDisplay).toBe('always-off')
  })

  it('migrates stored enableForceToken:true to lof-only (new default)', () => {
    stored({ enableForceToken: true })
    expect(render().result.current.forceTokenDisplay).toBe('lof-only')
  })

  it('falls back to lof-only for an invalid forceTokenDisplay value', () => {
    stored({ forceTokenDisplay: 'bad-value' })
    expect(render().result.current.forceTokenDisplay).toBe('lof-only')
  })

  it('loads enableDamageButtons=true from stored JSON', () => {
    stored({ enableDamageButtons: true })
    expect(render().result.current.enableDamageButtons).toBe(true)
  })

  it('loads the timer lengths the game screens set', () => {
    stored({ bo1TimerMinutes: 30, bo3TimerMinutes: 60, xwingTimerMinutes: 80 })
    const { result } = render()
    expect(result.current.bo1TimerMinutes).toBe(30)
    expect(result.current.bo3TimerMinutes).toBe(60)
    expect(result.current.xwingTimerMinutes).toBe(80)
  })

  // --- Saving ---

  it('saves to localStorage when setUseHyperspace is called', () => {
    const { result } = render()
    act(() => result.current.setUseHyperspace(false))
    expect(lastSaved().useHyperspace).toBe(false)
  })

  it('saves to localStorage when setForceTokenDisplay is called', () => {
    const { result } = render()
    act(() => result.current.setForceTokenDisplay('always-off'))
    expect(lastSaved().forceTokenDisplay).toBe('always-off')
  })

  it('saves to localStorage when setEnableInitiativeBar is called', () => {
    const { result } = render()
    act(() => result.current.setEnableInitiativeBar(false))
    expect(lastSaved().enableInitiativeBar).toBe(false)
  })

  it('saves to localStorage when setEnableDamageButtons is called', () => {
    const { result } = render()
    act(() => result.current.setEnableDamageButtons(true))
    expect(lastSaved().enableDamageButtons).toBe(true)
  })

  it('saves to localStorage when setEnableXwingPhases is called', () => {
    stored({})
    const { result } = render()
    act(() => result.current.setEnableXwingPhases(false))
    expect(lastSaved().enableXwingPhases).toBe(false)
  })

  // --- Resilience ---

  it('falls back to defaults when stored JSON is corrupt', () => {
    stored('not-valid-json{{{')
    const { result } = render()
    expect(result.current.useHyperspace).toBe(true)
    expect(result.current.forceTokenDisplay).toBe('lof-only')
    expect(result.current.startScreen).toBe('gameSelect')
  })

  it('falls back to defaults for a missing key in otherwise valid stored JSON', () => {
    stored({ useHyperspace: false })
    const { result } = render()
    expect(result.current.useHyperspace).toBe(false)
    expect(result.current.forceTokenDisplay).toBe('lof-only')
    expect(result.current.startScreen).toBe('gameSelect')
  })

  // --- Retired keys: the feature is always on, or nothing used it ---

  const RETIRED = {
    enableGameSelect: false,
    enableEpicActions: false,
    enableWakeLock: false,
    enableActionLog: false,
    enableFavourites: false,
    enableCompetitiveMode: false,
    enableLongPress: false,
  }

  it('loads stored settings that still carry the retired keys', () => {
    stored({ ...RETIRED, useHyperspace: false, startScreen: 'xwing' })
    const { result } = render()
    expect(result.current.useHyperspace).toBe(false)
    expect(result.current.startScreen).toBe('xwing')
    for (const key of Object.keys(RETIRED)) expect(key in result.current).toBe(false)
  })

  it('drops the retired keys on the next save', () => {
    stored({ ...RETIRED })
    const { result } = render()
    act(() => result.current.setUseHyperspace(false))
    const saved = lastSaved()
    expect(saved.useHyperspace).toBe(false)
    for (const key of Object.keys(RETIRED)) expect(key in saved).toBe(false)
  })

})
