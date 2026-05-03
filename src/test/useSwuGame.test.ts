import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSwuGame } from '../hooks/useSwuGame'

describe('useSwuGame', () => {

  // --- Damage counter ---

  it('counter starts at zero', () => {
    const { result } = renderHook(() => useSwuGame(30))
    expect(result.current.count).toBe(0)
  })

  it('increment increases count by 1', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.increment())
    expect(result.current.count).toBe(1)
  })

  it('increment can be called multiple times', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => {
      result.current.increment()
      result.current.increment()
      result.current.increment()
    })
    expect(result.current.count).toBe(3)
  })

  it('decrement decreases count by 1', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.increment())
    act(() => result.current.increment())
    act(() => result.current.decrement())
    expect(result.current.count).toBe(1)
  })

  it('decrement does not go below zero', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.decrement())
    act(() => result.current.decrement())
    expect(result.current.count).toBe(0)
  })

  it('increment does not exceed maxHp', () => {
    const { result } = renderHook(() => useSwuGame(3))
    act(() => {
      result.current.increment()
      result.current.increment()
      result.current.increment()
      result.current.increment()
    })
    expect(result.current.count).toBe(3)
  })

  it('incrementBy increases count by n', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.incrementBy(5))
    expect(result.current.count).toBe(5)
  })

  it('incrementBy does not exceed maxHp', () => {
    const { result } = renderHook(() => useSwuGame(10))
    act(() => result.current.incrementBy(15))
    expect(result.current.count).toBe(10)
  })

  it('decrementBy decreases count by n', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.incrementBy(10))
    act(() => result.current.decrementBy(4))
    expect(result.current.count).toBe(6)
  })

  it('decrementBy does not go below zero', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.decrementBy(5))
    expect(result.current.count).toBe(0)
  })

  // --- Force ---

  it('forceActive starts as false', () => {
    const { result } = renderHook(() => useSwuGame(30))
    expect(result.current.forceActive).toBe(false)
  })

  it('toggleForce sets forceActive to true', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.toggleForce())
    expect(result.current.forceActive).toBe(true)
  })

  it('toggleForce called again sets forceActive back to false', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.toggleForce())
    act(() => result.current.toggleForce())
    expect(result.current.forceActive).toBe(false)
  })

  it('forceEnabled starts as false', () => {
    const { result } = renderHook(() => useSwuGame(30))
    expect(result.current.forceEnabled).toBe(false)
  })

  it('enableForce sets forceEnabled to true', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.enableForce())
    expect(result.current.forceEnabled).toBe(true)
  })

  it('enableForce does not affect forceActive', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.enableForce())
    expect(result.current.forceActive).toBe(false)
  })

  // --- Mystic Monastery ---

  it('mysticUsesRemaining starts at 3', () => {
    const { result } = renderHook(() => useSwuGame(30))
    expect(result.current.mysticUsesRemaining).toBe(3)
  })

  it('gainForceViaMonastery decrements mysticUsesRemaining', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.gainForceViaMonastery())
    expect(result.current.mysticUsesRemaining).toBe(2)
  })

  it('gainForceViaMonastery sets forceActive to true', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.gainForceViaMonastery())
    expect(result.current.forceActive).toBe(true)
  })

  // --- Epic action ---

  it('epicActionUsed starts as false', () => {
    const { result } = renderHook(() => useSwuGame(30))
    expect(result.current.epicActionUsed).toBe(false)
  })

  it('markEpicActionUsed sets epicActionUsed to true', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.markEpicActionUsed())
    expect(result.current.epicActionUsed).toBe(true)
  })

  it('markEpicActionUsed is one-way — calling twice stays true', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.markEpicActionUsed())
    act(() => result.current.markEpicActionUsed())
    expect(result.current.epicActionUsed).toBe(true)
  })

  // --- Round tracker ---

  it('round starts at 1', () => {
    const { result } = renderHook(() => useSwuGame(30))
    expect(result.current.round).toBe(1)
  })

  it('incrementRound increases round by 1', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.incrementRound())
    expect(result.current.round).toBe(2)
  })

  it('incrementRound caps at 99', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => {
      for (let i = 0; i < 100; i++) result.current.incrementRound()
    })
    expect(result.current.round).toBe(99)
  })

  // --- Snapshot and restore ---

  it('snapshot returns the current state', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => result.current.increment())
    const snap = result.current.snapshot()
    expect(snap).toEqual({
      damage: 1,
      epicActionUsed: false,
      forceActive: false,
      forceEnabled: false,
      mysticUsesRemaining: 3,
      round: 1,
    })
  })

  it('restoreState restores all fields', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => {
      result.current.incrementBy(5)
      result.current.markEpicActionUsed()
      result.current.enableForce()
      result.current.incrementRound()
    })
    const snap = result.current.snapshot()
    act(() => result.current.incrementBy(3))
    expect(result.current.count).toBe(8)
    act(() => result.current.restoreState(snap))
    expect(result.current.count).toBe(5)
    expect(result.current.epicActionUsed).toBe(true)
    expect(result.current.forceEnabled).toBe(true)
    expect(result.current.round).toBe(2)
  })

  it('restoreState can set epicActionUsed back to false (undo)', () => {
    const { result } = renderHook(() => useSwuGame(30))
    const initial = result.current.snapshot()
    act(() => result.current.markEpicActionUsed())
    expect(result.current.epicActionUsed).toBe(true)
    act(() => result.current.restoreState(initial))
    expect(result.current.epicActionUsed).toBe(false)
  })

  // --- Reset ---

  it('reset restores initial state', () => {
    const { result } = renderHook(() => useSwuGame(30))
    act(() => {
      result.current.incrementBy(10)
      result.current.markEpicActionUsed()
      result.current.enableForce()
      result.current.toggleForce()
      result.current.gainForceViaMonastery()
      result.current.incrementRound()
    })
    act(() => result.current.reset())
    expect(result.current.count).toBe(0)
    expect(result.current.epicActionUsed).toBe(false)
    expect(result.current.forceActive).toBe(false)
    expect(result.current.forceEnabled).toBe(false)
    expect(result.current.mysticUsesRemaining).toBe(3)
    expect(result.current.round).toBe(1)
  })

})