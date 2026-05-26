import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGameHistory } from '../hooks/useGameHistory'

type S = { score: number }

describe('useGameHistory', () => {

  // --- Initial state ---

  it('starts with no entries', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    expect(result.current.entries).toHaveLength(0)
  })

  // --- add ---

  it('add() appends an entry', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    act(() => result.current.add({ type: 'score', message: 'test', color: 'red', snapshot: { score: 0 } }))
    expect(result.current.entries).toHaveLength(1)
  })

  it('add() assigns a unique id', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    act(() => {
      result.current.add({ type: 'score', message: 'a', color: 'red', snapshot: { score: 0 } })
      result.current.add({ type: 'score', message: 'b', color: 'red', snapshot: { score: 1 } })
    })
    const [a, b] = result.current.entries
    expect(a.id).toBeTruthy()
    expect(b.id).toBeTruthy()
    expect(a.id).not.toBe(b.id)
  })

  it('add() preserves type, message, color and snapshot', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    act(() => result.current.add({ type: 'round', message: 'Round 2', color: 'blue', snapshot: { score: 5 } }))
    const entry = result.current.entries[0]
    expect(entry.type).toBe('round')
    expect(entry.message).toBe('Round 2')
    expect(entry.color).toBe('blue')
    expect(entry.snapshot).toEqual({ score: 5 })
  })

  it('add() appends in insertion order', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    act(() => {
      result.current.add({ type: 'score', message: 'first', color: 'red', snapshot: { score: 0 } })
      result.current.add({ type: 'score', message: 'second', color: 'red', snapshot: { score: 1 } })
    })
    expect(result.current.entries[0].message).toBe('first')
    expect(result.current.entries[1].message).toBe('second')
  })

  // --- undoLast ---

  it('undoLast() returns null when there are no entries', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    let returned: ReturnType<typeof result.current.undoLast>
    act(() => { returned = result.current.undoLast() })
    expect(returned!).toBeNull()
  })

  it('undoLast() returns the last entry', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    act(() => {
      result.current.add({ type: 'score', message: 'first', color: 'red', snapshot: { score: 0 } })
      result.current.add({ type: 'score', message: 'last', color: 'red', snapshot: { score: 7 } })
    })
    let returned: ReturnType<typeof result.current.undoLast>
    act(() => { returned = result.current.undoLast() })
    expect(returned!.message).toBe('last')
    expect(returned!.snapshot).toEqual({ score: 7 })
  })

  it('undoLast() removes the last entry', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    act(() => {
      result.current.add({ type: 'score', message: 'first', color: 'red', snapshot: { score: 0 } })
      result.current.add({ type: 'score', message: 'second', color: 'red', snapshot: { score: 1 } })
    })
    act(() => result.current.undoLast())
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0].message).toBe('first')
  })

  it('undoLast() on the only entry leaves an empty list', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    act(() => result.current.add({ type: 'score', message: 'only', color: 'red', snapshot: { score: 0 } }))
    act(() => result.current.undoLast())
    expect(result.current.entries).toHaveLength(0)
  })

  it('undoLast() does not affect remaining entries', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    act(() => {
      result.current.add({ type: 'score', message: 'a', color: 'red', snapshot: { score: 0 } })
      result.current.add({ type: 'score', message: 'b', color: 'red', snapshot: { score: 1 } })
      result.current.add({ type: 'score', message: 'c', color: 'red', snapshot: { score: 2 } })
    })
    act(() => result.current.undoLast())
    expect(result.current.entries).toHaveLength(2)
    expect(result.current.entries[1].message).toBe('b')
  })

  it('undoLast() called twice removes the last two entries', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    act(() => {
      result.current.add({ type: 'score', message: 'a', color: 'red', snapshot: { score: 0 } })
      result.current.add({ type: 'score', message: 'b', color: 'red', snapshot: { score: 1 } })
      result.current.add({ type: 'score', message: 'c', color: 'red', snapshot: { score: 2 } })
    })
    act(() => result.current.undoLast())
    act(() => result.current.undoLast())
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0].message).toBe('a')
  })

  // --- reset ---

  it('reset() clears all entries', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    act(() => {
      result.current.add({ type: 'score', message: 'a', color: 'red', snapshot: { score: 0 } })
      result.current.add({ type: 'score', message: 'b', color: 'red', snapshot: { score: 1 } })
    })
    act(() => result.current.reset())
    expect(result.current.entries).toHaveLength(0)
  })

  it('reset() on an empty list is a no-op', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    expect(() => act(() => result.current.reset())).not.toThrow()
    expect(result.current.entries).toHaveLength(0)
  })

  it('entries can be added again after reset()', () => {
    const { result } = renderHook(() => useGameHistory<S>())
    act(() => result.current.add({ type: 'score', message: 'before', color: 'red', snapshot: { score: 0 } }))
    act(() => result.current.reset())
    act(() => result.current.add({ type: 'score', message: 'after', color: 'red', snapshot: { score: 0 } }))
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0].message).toBe('after')
  })

})
