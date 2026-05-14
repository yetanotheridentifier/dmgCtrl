import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimer } from '../hooks/useTimer'

describe('useTimer', () => {

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('remaining equals the duration in seconds', () => {
      const { result } = renderHook(() => useTimer(1500))
      expect(result.current.remaining).toBe(1500)
    })

    it('isRunning is false initially', () => {
      const { result } = renderHook(() => useTimer(1500))
      expect(result.current.isRunning).toBe(false)
    })

    it('isExpired is false initially', () => {
      const { result } = renderHook(() => useTimer(1500))
      expect(result.current.isExpired).toBe(false)
    })

    it('remaining does not change before start is called', () => {
      const { result } = renderHook(() => useTimer(1500))
      act(() => { vi.advanceTimersByTime(5000) })
      expect(result.current.remaining).toBe(1500)
    })
  })

  describe('start', () => {
    it('sets isRunning to true', () => {
      const { result } = renderHook(() => useTimer(1500))
      act(() => result.current.start())
      expect(result.current.isRunning).toBe(true)
    })

    it('decrements remaining by 1 after 1 second', () => {
      const { result } = renderHook(() => useTimer(1500))
      act(() => result.current.start())
      act(() => { vi.advanceTimersByTime(1000) })
      expect(result.current.remaining).toBe(1499)
    })

    it('decrements remaining by 60 after 60 seconds', () => {
      const { result } = renderHook(() => useTimer(1500))
      act(() => result.current.start())
      act(() => { vi.advanceTimersByTime(60000) })
      expect(result.current.remaining).toBe(1440)
    })

    it('calling start again while running has no additional effect', () => {
      const { result } = renderHook(() => useTimer(1500))
      act(() => result.current.start())
      act(() => { vi.advanceTimersByTime(1000) })
      act(() => result.current.start())
      act(() => { vi.advanceTimersByTime(1000) })
      expect(result.current.remaining).toBe(1498)
    })
  })

  describe('expiry', () => {
    it('isExpired becomes true when remaining reaches 0', () => {
      const { result } = renderHook(() => useTimer(3))
      act(() => result.current.start())
      act(() => { vi.advanceTimersByTime(3000) })
      expect(result.current.isExpired).toBe(true)
    })

    it('isRunning becomes false when timer expires', () => {
      const { result } = renderHook(() => useTimer(3))
      act(() => result.current.start())
      act(() => { vi.advanceTimersByTime(3000) })
      expect(result.current.isRunning).toBe(false)
    })

    it('remaining does not go below 0', () => {
      const { result } = renderHook(() => useTimer(3))
      act(() => result.current.start())
      act(() => { vi.advanceTimersByTime(10000) })
      expect(result.current.remaining).toBe(0)
    })
  })

  describe('visibility recovery', () => {
    it('recalculates remaining when page becomes visible after time has passed', () => {
      const { result } = renderHook(() => useTimer(60))
      const t0 = Date.now()
      act(() => result.current.start())
      // Advance the clock 30 s without firing any interval ticks
      vi.setSystemTime(t0 + 30000)
      // Simulate the screen turning back on
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(result.current.remaining).toBe(30)
    })
  })

  describe('reset', () => {
    it('resets remaining to the original duration', () => {
      const { result } = renderHook(() => useTimer(1500))
      act(() => result.current.start())
      act(() => { vi.advanceTimersByTime(60000) })
      act(() => result.current.reset())
      expect(result.current.remaining).toBe(1500)
    })

    it('sets isRunning to false', () => {
      const { result } = renderHook(() => useTimer(1500))
      act(() => result.current.start())
      act(() => result.current.reset())
      expect(result.current.isRunning).toBe(false)
    })

    it('clears isExpired', () => {
      const { result } = renderHook(() => useTimer(3))
      act(() => result.current.start())
      act(() => { vi.advanceTimersByTime(3000) })
      expect(result.current.isExpired).toBe(true)
      act(() => result.current.reset())
      expect(result.current.isExpired).toBe(false)
    })

    it('timer does not continue after reset', () => {
      const { result } = renderHook(() => useTimer(1500))
      act(() => result.current.start())
      act(() => result.current.reset())
      act(() => { vi.advanceTimersByTime(5000) })
      expect(result.current.remaining).toBe(1500)
    })
  })

})
