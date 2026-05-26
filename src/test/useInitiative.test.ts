import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInitiative } from '../hooks/useInitiative'

describe('useInitiative', () => {

  it('starts with initiative null', () => {
    const { result } = renderHook(() => useInitiative())
    expect(result.current.initiative).toBeNull()
  })

  it('setInitiative("player") sets initiative to player', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setInitiative('player'))
    expect(result.current.initiative).toBe('player')
  })

  it('setInitiative("opponent") sets initiative to opponent', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setInitiative('opponent'))
    expect(result.current.initiative).toBe('opponent')
  })

  it('setInitiative(null) clears the selection', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setInitiative('player'))
    act(() => result.current.setInitiative(null))
    expect(result.current.initiative).toBeNull()
  })

  it('can switch from player to opponent', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setInitiative('player'))
    act(() => result.current.setInitiative('opponent'))
    expect(result.current.initiative).toBe('opponent')
  })

  it('reset() returns initiative to null', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setInitiative('opponent'))
    act(() => result.current.reset())
    expect(result.current.initiative).toBeNull()
  })

  // --- cycle ---

  it('cycle() from null sets to player', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.cycle())
    expect(result.current.initiative).toBe('player')
  })

  it('cycle() from player sets to opponent', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setInitiative('player'))
    act(() => result.current.cycle())
    expect(result.current.initiative).toBe('opponent')
  })

  it('cycle() from opponent sets to null', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setInitiative('opponent'))
    act(() => result.current.cycle())
    expect(result.current.initiative).toBeNull()
  })

  it('cycle() completes a full null → player → opponent → null rotation', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.cycle())
    expect(result.current.initiative).toBe('player')
    act(() => result.current.cycle())
    expect(result.current.initiative).toBe('opponent')
    act(() => result.current.cycle())
    expect(result.current.initiative).toBeNull()
  })

  // --- setOpponent ---

  it('setOpponent() from null sets to opponent', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setOpponent())
    expect(result.current.initiative).toBe('opponent')
  })

  it('setOpponent() from opponent stays opponent', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setInitiative('opponent'))
    act(() => result.current.setOpponent())
    expect(result.current.initiative).toBe('opponent')
  })

  it('setOpponent() from player switches to opponent', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setInitiative('player'))
    act(() => result.current.setOpponent())
    expect(result.current.initiative).toBe('opponent')
  })

  // --- setPlayer ---

  it('setPlayer() from null sets to player', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setPlayer())
    expect(result.current.initiative).toBe('player')
  })

  it('setPlayer() from player stays player', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setInitiative('player'))
    act(() => result.current.setPlayer())
    expect(result.current.initiative).toBe('player')
  })

  it('setPlayer() from opponent switches to player', () => {
    const { result } = renderHook(() => useInitiative())
    act(() => result.current.setInitiative('opponent'))
    act(() => result.current.setPlayer())
    expect(result.current.initiative).toBe('player')
  })

})
