import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOrientation } from '../hooks/useOrientation'

describe('useOrientation', () => {

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth',  { writable: true, configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 768 })
  })

  // --- Initial state ---

  it('isPortrait is false when width > height', () => {
    const { result } = renderHook(() => useOrientation())
    expect(result.current.isPortrait).toBe(false)
  })

  it('isPortrait is true when height > width', () => {
    Object.defineProperty(window, 'innerWidth',  { writable: true, configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 844 })
    const { result } = renderHook(() => useOrientation())
    expect(result.current.isPortrait).toBe(true)
  })

  it('isPortrait is false when width equals height', () => {
    Object.defineProperty(window, 'innerWidth',  { writable: true, configurable: true, value: 768 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 768 })
    const { result } = renderHook(() => useOrientation())
    expect(result.current.isPortrait).toBe(false)
  })

  // --- Reactivity ---

  it('updates to portrait when window resizes to portrait', () => {
    const { result } = renderHook(() => useOrientation())
    expect(result.current.isPortrait).toBe(false)
    act(() => {
      Object.defineProperty(window, 'innerWidth',  { writable: true, configurable: true, value: 390 })
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 844 })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current.isPortrait).toBe(true)
  })

  it('updates to landscape when window resizes to landscape', () => {
    Object.defineProperty(window, 'innerWidth',  { writable: true, configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 844 })
    const { result } = renderHook(() => useOrientation())
    expect(result.current.isPortrait).toBe(true)
    act(() => {
      Object.defineProperty(window, 'innerWidth',  { writable: true, configurable: true, value: 844 })
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 390 })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current.isPortrait).toBe(false)
  })

})
