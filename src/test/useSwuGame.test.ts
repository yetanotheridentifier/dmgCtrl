import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSwuGame } from '../hooks/useSwuGame'

describe('useSwuGame', () => {

  it('Counter starts at zero', () => {
    const { result } = renderHook(() => useSwuGame())
    expect(result.current.count).toBe(0)
  })

  it('increment increases count by 1', () => {
    const { result } = renderHook(() => useSwuGame())
    act(() => result.current.increment())
    expect(result.current.count).toBe(1)
  })

  it('increment can be called multiple times', () => {
    const { result } = renderHook(() => useSwuGame())
    act(() => {
      result.current.increment()
      result.current.increment()
      result.current.increment()
    })
    expect(result.current.count).toBe(3)
  })

  it('decrement decreases count by 1', () => {
    const { result } = renderHook(() => useSwuGame())
    act(() => result.current.increment())
    act(() => result.current.increment())
    act(() => result.current.decrement())
    expect(result.current.count).toBe(1)
  })

  it('decrement does not go below zero', () => {
    const { result } = renderHook(() => useSwuGame())
    act(() => result.current.decrement())
    act(() => result.current.decrement())
    expect(result.current.count).toBe(0)
  })

})