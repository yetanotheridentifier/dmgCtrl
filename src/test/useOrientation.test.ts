import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOrientation } from '../hooks/useOrientation'

// Helper: set up a matchMedia mock and return a trigger to fire the change event
function setupMatchMedia(isPortrait: boolean) {
  const listeners = new Set<(e: Partial<MediaQueryListEvent>) => void>()
  let currentMatches = isPortrait

  const mq = {
    get matches() { return currentMatches },
    addEventListener: (_type: string, cb: (e: Partial<MediaQueryListEvent>) => void) => { listeners.add(cb) },
    removeEventListener: (_type: string, cb: (e: Partial<MediaQueryListEvent>) => void) => { listeners.delete(cb) },
  }

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => mq,
  })

  return {
    triggerChange: (newIsPortrait: boolean) => {
      currentMatches = newIsPortrait
      listeners.forEach(cb => cb({ matches: newIsPortrait }))
    }
  }
}

describe('useOrientation', () => {

  beforeEach(() => {
    Object.defineProperty(screen, 'width',  { writable: true, configurable: true, value: 390 })
    Object.defineProperty(screen, 'height', { writable: true, configurable: true, value: 844 })
  })

  // --- Initial state ---

  it('isPortrait is true when matchMedia reports portrait', () => {
    setupMatchMedia(true)
    const { result } = renderHook(() => useOrientation())
    expect(result.current.isPortrait).toBe(true)
  })

  it('isPortrait is false when matchMedia reports landscape', () => {
    setupMatchMedia(false)
    const { result } = renderHook(() => useOrientation())
    expect(result.current.isPortrait).toBe(false)
  })

  it('vmin is the smaller of screen.width and screen.height', () => {
    setupMatchMedia(true)
    const { result } = renderHook(() => useOrientation())
    expect(result.current.vmin).toBe(390)
  })

  it('vmin uses screen dimensions, not window inner dimensions', () => {
    setupMatchMedia(false)
    // screen is 390x844 (portrait physical), even in landscape orientation
    const { result } = renderHook(() => useOrientation())
    expect(result.current.vmin).toBe(390)
  })

  // --- Reactivity ---

  it('updates isPortrait when matchMedia fires a landscape change', () => {
    const { triggerChange } = setupMatchMedia(true)
    const { result } = renderHook(() => useOrientation())
    expect(result.current.isPortrait).toBe(true)
    act(() => triggerChange(false))
    expect(result.current.isPortrait).toBe(false)
  })

  it('updates isPortrait when matchMedia fires a portrait change', () => {
    const { triggerChange } = setupMatchMedia(false)
    const { result } = renderHook(() => useOrientation())
    expect(result.current.isPortrait).toBe(false)
    act(() => triggerChange(true))
    expect(result.current.isPortrait).toBe(true)
  })

  it('removes the matchMedia listener on unmount', () => {
    const { triggerChange } = setupMatchMedia(true)
    const { result, unmount } = renderHook(() => useOrientation())
    unmount()
    act(() => triggerChange(false))
    // After unmount, isPortrait should not have updated
    expect(result.current.isPortrait).toBe(true)
  })

})
