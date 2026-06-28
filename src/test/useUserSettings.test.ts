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

describe('useUserSettings', () => {

  // --- Defaults ---

  it('defaults useHyperspace to true when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.useHyperspace).toBe(true)
  })

  it('defaults forceTokenDisplay to lof-only when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.forceTokenDisplay).toBe('lof-only')
  })

  it('defaults enableEpicActions to true when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableEpicActions).toBe(true)
  })

  it('defaults enableWakeLock to true when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableWakeLock).toBe(true)
  })

  it('defaults enableFavourites to true when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableFavourites).toBe(true)
  })

  it('defaults enableActionLog to true when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableActionLog).toBe(true)
  })

  it('defaults enableInitiativeBar to true when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableInitiativeBar).toBe(true)
  })

  it('defaults enableXwingPhases to true when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableXwingPhases).toBe(true)
  })

  it('defaults enableXwingAlwaysIncDec to false when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableXwingAlwaysIncDec).toBe(false)
  })

  // --- Load from storage ---

  it('loads useHyperspace=false from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.useHyperspace).toBe(false)
  })

  it('loads forceTokenDisplay=always-on from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ forceTokenDisplay: 'always-on' }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.forceTokenDisplay).toBe('always-on')
  })

  it('loads forceTokenDisplay=always-off from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ forceTokenDisplay: 'always-off' }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.forceTokenDisplay).toBe('always-off')
  })

  it('migrates stored enableForceToken:false to always-off', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ enableForceToken: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.forceTokenDisplay).toBe('always-off')
  })

  it('migrates stored enableForceToken:true to lof-only (new default)', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ enableForceToken: true }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.forceTokenDisplay).toBe('lof-only')
  })

  it('falls back to lof-only for an invalid forceTokenDisplay value', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ forceTokenDisplay: 'bad-value' }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.forceTokenDisplay).toBe('lof-only')
  })

  it('loads enableEpicActions=false from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ enableEpicActions: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableEpicActions).toBe(false)
  })

  it('loads enableWakeLock=false from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ enableWakeLock: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableWakeLock).toBe(false)
  })

  it('loads enableFavourites=true from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ enableFavourites: true }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableFavourites).toBe(true)
  })

  it('loads enableActionLog=false from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ enableActionLog: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableActionLog).toBe(false)
  })

  it('loads enableInitiativeBar=false from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ enableInitiativeBar: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableInitiativeBar).toBe(false)
  })

  it('loads enableXwingPhases=false from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ enableXwingPhases: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableXwingPhases).toBe(false)
  })

  // --- Saving ---

  it('saves to localStorage when setUseHyperspace is called', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    act(() => result.current.setUseHyperspace(false))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.useHyperspace).toBe(false)
  })

  it('saves to localStorage when setForceTokenDisplay is called', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    act(() => result.current.setForceTokenDisplay('always-off'))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.forceTokenDisplay).toBe('always-off')
  })

  it('saves to localStorage when setEnableEpicActions is called', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    act(() => result.current.setEnableEpicActions(false))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.enableEpicActions).toBe(false)
  })

  it('saves to localStorage when setEnableWakeLock is called', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    act(() => result.current.setEnableWakeLock(false))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.enableWakeLock).toBe(false)
  })

  it('saves to localStorage when setEnableFavourites is called', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    act(() => result.current.setEnableFavourites(true))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.enableFavourites).toBe(true)
  })

  it('saves to localStorage when setEnableActionLog is called', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    act(() => result.current.setEnableActionLog(false))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.enableActionLog).toBe(false)
  })

  it('saves to localStorage when setEnableInitiativeBar is called', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    act(() => result.current.setEnableInitiativeBar(false))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.enableInitiativeBar).toBe(false)
  })

  it('saves to localStorage when setEnableXwingPhases is called', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    act(() => result.current.setEnableXwingPhases(false))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.enableXwingPhases).toBe(false)
  })

  // --- Resilience ---

  it('falls back to all defaults when stored JSON is corrupt', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? 'not-valid-json{{{' : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.useHyperspace).toBe(true)
    expect(result.current.forceTokenDisplay).toBe('lof-only')
    expect(result.current.enableEpicActions).toBe(true)
    expect(result.current.enableWakeLock).toBe(true)
  })

  it('falls back to defaults for a missing key in otherwise valid stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.useHyperspace).toBe(false)
    expect(result.current.forceTokenDisplay).toBe('lof-only')
    expect(result.current.enableEpicActions).toBe(true)
    expect(result.current.enableWakeLock).toBe(true)
  })

  it('falls back to true for enableFavourites when stored JSON is corrupt', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? 'not-valid-json{{{' : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableFavourites).toBe(true)
  })

  it('falls back to true for enableFavourites when missing from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableFavourites).toBe(true)
  })

  it('falls back to true for enableActionLog when stored JSON is corrupt', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? 'not-valid-json{{{' : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableActionLog).toBe(true)
  })

  it('falls back to true for enableActionLog when missing from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableActionLog).toBe(true)
  })

  it('defaults enableCompetitiveMode to true when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableCompetitiveMode).toBe(true)
  })

  it('loads enableCompetitiveMode=true from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ enableCompetitiveMode: true }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableCompetitiveMode).toBe(true)
  })

  it('saves to localStorage when setEnableCompetitiveMode is called', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    act(() => result.current.setEnableCompetitiveMode(true))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.enableCompetitiveMode).toBe(true)
  })

  it('falls back to true for enableCompetitiveMode when stored JSON is corrupt', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? 'not-valid-json{{{' : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableCompetitiveMode).toBe(true)
  })

  it('falls back to true for enableCompetitiveMode when missing from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableCompetitiveMode).toBe(true)
  })

  it('defaults enableGameSelect to true when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableGameSelect).toBe(true)
  })

  it('falls back to true for enableGameSelect when stored JSON is corrupt', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? 'not-valid-json{{{' : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableGameSelect).toBe(true)
  })

  it('falls back to true for enableGameSelect when missing from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.enableGameSelect).toBe(true)
  })

  it('defaults startScreen to gameSelect when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.startScreen).toBe('gameSelect')
  })

  it('falls back to gameSelect for startScreen when stored JSON is corrupt', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? 'not-valid-json{{{' : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.startScreen).toBe('gameSelect')
  })

  it('falls back to gameSelect for startScreen when missing from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: false }) : null
    )
    const { result } = renderHook(() => useUserSettings(), { wrapper: UserSettingsProvider })
    expect(result.current.startScreen).toBe('gameSelect')
  })

})
