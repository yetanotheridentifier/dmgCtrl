import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUserSettings } from '../hooks/useUserSettings'

beforeEach(() => {
  localStorage.clear()
})

describe('useUserSettings', () => {

  describe('default values', () => {
    it('useHyperspace defaults to true', () => {
      const { result } = renderHook(() => useUserSettings())
      expect(result.current.useHyperspace).toBe(true)
    })

    it('enableForceToken defaults to true', () => {
      const { result } = renderHook(() => useUserSettings())
      expect(result.current.enableForceToken).toBe(true)
    })

    it('enableEpicActions defaults to true', () => {
      const { result } = renderHook(() => useUserSettings())
      expect(result.current.enableEpicActions).toBe(true)
    })

    it('enableWakeLock defaults to true', () => {
      const { result } = renderHook(() => useUserSettings())
      expect(result.current.enableWakeLock).toBe(true)
    })
  })

  describe('setUseHyperspace', () => {
    it('updates useHyperspace to false', () => {
      const { result } = renderHook(() => useUserSettings())
      act(() => result.current.setUseHyperspace(false))
      expect(result.current.useHyperspace).toBe(false)
    })

    it('can be set back to true', () => {
      const { result } = renderHook(() => useUserSettings())
      act(() => result.current.setUseHyperspace(false))
      act(() => result.current.setUseHyperspace(true))
      expect(result.current.useHyperspace).toBe(true)
    })
  })

  describe('setEnableForceToken', () => {
    it('updates enableForceToken to false', () => {
      const { result } = renderHook(() => useUserSettings())
      act(() => result.current.setEnableForceToken(false))
      expect(result.current.enableForceToken).toBe(false)
    })

    it('can be set back to true', () => {
      const { result } = renderHook(() => useUserSettings())
      act(() => result.current.setEnableForceToken(false))
      act(() => result.current.setEnableForceToken(true))
      expect(result.current.enableForceToken).toBe(true)
    })
  })

  describe('setEnableEpicActions', () => {
    it('updates enableEpicActions to false', () => {
      const { result } = renderHook(() => useUserSettings())
      act(() => result.current.setEnableEpicActions(false))
      expect(result.current.enableEpicActions).toBe(false)
    })

    it('can be set back to true', () => {
      const { result } = renderHook(() => useUserSettings())
      act(() => result.current.setEnableEpicActions(false))
      act(() => result.current.setEnableEpicActions(true))
      expect(result.current.enableEpicActions).toBe(true)
    })
  })

  describe('setEnableWakeLock', () => {
    it('updates enableWakeLock to false', () => {
      const { result } = renderHook(() => useUserSettings())
      act(() => result.current.setEnableWakeLock(false))
      expect(result.current.enableWakeLock).toBe(false)
    })

    it('can be set back to true', () => {
      const { result } = renderHook(() => useUserSettings())
      act(() => result.current.setEnableWakeLock(false))
      act(() => result.current.setEnableWakeLock(true))
      expect(result.current.enableWakeLock).toBe(true)
    })
  })

  describe('persistence', () => {
    it('persists useHyperspace change to localStorage', () => {
      const { result } = renderHook(() => useUserSettings())
      act(() => result.current.setUseHyperspace(false))
      const stored = JSON.parse(localStorage.getItem('user_settings') ?? '{}')
      expect(stored.useHyperspace).toBe(false)
    })

    it('persists enableForceToken change to localStorage', () => {
      const { result } = renderHook(() => useUserSettings())
      act(() => result.current.setEnableForceToken(false))
      const stored = JSON.parse(localStorage.getItem('user_settings') ?? '{}')
      expect(stored.enableForceToken).toBe(false)
    })

    it('persists enableEpicActions change to localStorage', () => {
      const { result } = renderHook(() => useUserSettings())
      act(() => result.current.setEnableEpicActions(false))
      const stored = JSON.parse(localStorage.getItem('user_settings') ?? '{}')
      expect(stored.enableEpicActions).toBe(false)
    })

    it('persists enableWakeLock change to localStorage', () => {
      const { result } = renderHook(() => useUserSettings())
      act(() => result.current.setEnableWakeLock(false))
      const stored = JSON.parse(localStorage.getItem('user_settings') ?? '{}')
      expect(stored.enableWakeLock).toBe(false)
    })

    it('reads persisted values on remount', () => {
      const { result, unmount } = renderHook(() => useUserSettings())
      act(() => result.current.setUseHyperspace(false))
      act(() => result.current.setEnableForceToken(false))
      unmount()

      const { result: result2 } = renderHook(() => useUserSettings())
      expect(result2.current.useHyperspace).toBe(false)
      expect(result2.current.enableForceToken).toBe(false)
      expect(result2.current.enableEpicActions).toBe(true)
      expect(result2.current.enableWakeLock).toBe(true)
    })
  })

  describe('corrupt storage', () => {
    it('falls back to defaults when localStorage contains invalid JSON', () => {
      localStorage.setItem('user_settings', 'not-valid-json')
      const { result } = renderHook(() => useUserSettings())
      expect(result.current.useHyperspace).toBe(true)
      expect(result.current.enableForceToken).toBe(true)
      expect(result.current.enableEpicActions).toBe(true)
      expect(result.current.enableWakeLock).toBe(true)
    })

    it('applies defaults for missing individual keys', () => {
      localStorage.setItem('user_settings', JSON.stringify({ useHyperspace: false }))
      const { result } = renderHook(() => useUserSettings())
      expect(result.current.useHyperspace).toBe(false)
      expect(result.current.enableForceToken).toBe(true)
      expect(result.current.enableEpicActions).toBe(true)
      expect(result.current.enableWakeLock).toBe(true)
    })
  })

})