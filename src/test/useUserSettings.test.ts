import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUserSettings } from '../hooks/useUserSettings'

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
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.useHyperspace).toBe(true)
  })

  it('defaults enableForceToken to true when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.enableForceToken).toBe(true)
  })

  it('defaults enableEpicActions to true when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.enableEpicActions).toBe(true)
  })

  it('defaults enableWakeLock to true when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.enableWakeLock).toBe(true)
  })

  it('defaults enableFavourites to false when storage is empty', () => {
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.enableFavourites).toBe(false)
  })

  // --- Load from storage ---

  it('loads useHyperspace=false from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: false, enableForceToken: true, enableEpicActions: true, enableWakeLock: true }) : null
    )
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.useHyperspace).toBe(false)
  })

  it('loads enableForceToken=false from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: true, enableForceToken: false, enableEpicActions: true, enableWakeLock: true }) : null
    )
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.enableForceToken).toBe(false)
  })

  it('loads enableEpicActions=false from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: true, enableForceToken: true, enableEpicActions: false, enableWakeLock: true }) : null
    )
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.enableEpicActions).toBe(false)
  })

  it('loads enableWakeLock=false from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: true, enableForceToken: true, enableEpicActions: true, enableWakeLock: false }) : null
    )
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.enableWakeLock).toBe(false)
  })

  it('loads enableFavourites=true from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: true, enableForceToken: true, enableEpicActions: true, enableWakeLock: true, enableFavourites: true }) : null
    )
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.enableFavourites).toBe(true)
  })

  // --- Saving ---

  it('saves to localStorage when setUseHyperspace is called', () => {
    const { result } = renderHook(() => useUserSettings())
    act(() => result.current.setUseHyperspace(false))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.useHyperspace).toBe(false)
  })

  it('saves to localStorage when setEnableForceToken is called', () => {
    const { result } = renderHook(() => useUserSettings())
    act(() => result.current.setEnableForceToken(false))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.enableForceToken).toBe(false)
  })

  it('saves to localStorage when setEnableEpicActions is called', () => {
    const { result } = renderHook(() => useUserSettings())
    act(() => result.current.setEnableEpicActions(false))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.enableEpicActions).toBe(false)
  })

  it('saves to localStorage when setEnableWakeLock is called', () => {
    const { result } = renderHook(() => useUserSettings())
    act(() => result.current.setEnableWakeLock(false))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.enableWakeLock).toBe(false)
  })

  it('saves to localStorage when setEnableFavourites is called', () => {
    const { result } = renderHook(() => useUserSettings())
    act(() => result.current.setEnableFavourites(true))
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved.enableFavourites).toBe(true)
  })

  // --- Resilience ---

  it('falls back to all defaults when stored JSON is corrupt', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === STORAGE_KEY ? 'not-valid-json{{{' : null
    )
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.useHyperspace).toBe(true)
    expect(result.current.enableForceToken).toBe(true)
    expect(result.current.enableEpicActions).toBe(true)
    expect(result.current.enableWakeLock).toBe(true)
  })

  it('falls back to true for a missing key in otherwise valid stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: false }) : null
    )
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.useHyperspace).toBe(false)
    expect(result.current.enableForceToken).toBe(true)
    expect(result.current.enableEpicActions).toBe(true)
    expect(result.current.enableWakeLock).toBe(true)
  })

  it('falls back to false for enableFavourites when stored JSON is corrupt', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === STORAGE_KEY ? 'not-valid-json{{{' : null
    )
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.enableFavourites).toBe(false)
  })

  it('falls back to false for enableFavourites when missing from stored JSON', () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === STORAGE_KEY ? JSON.stringify({ useHyperspace: false }) : null
    )
    const { result } = renderHook(() => useUserSettings())
    expect(result.current.enableFavourites).toBe(false)
  })

})