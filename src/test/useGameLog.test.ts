import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGameLog } from '../hooks/useGameLog'

const mockState = {
  damage: 0,
  epicActionUsed: false,
  forceActive: false,
  forceEnabled: false,
  mysticUsesRemaining: 3,
  round: 1,
}

const entry1 = {
  type: 'hit' as const,
  message: 'Hit: +1 (0 → 1)',
  color: '#ef4444',
  prevState: mockState,
}

const entry2 = {
  type: 'heal' as const,
  message: 'Heal: -1 (2 → 1)',
  color: '#22c55e',
  prevState: { ...mockState, damage: 2 },
}

describe('useGameLog', () => {

  // --- Initial state ---

  it('entries starts empty', () => {
    const { result } = renderHook(() => useGameLog())
    expect(result.current.entries).toHaveLength(0)
  })

  // --- add ---

  it('add appends an entry to the list', () => {
    const { result } = renderHook(() => useGameLog())
    act(() => result.current.add(entry1))
    expect(result.current.entries).toHaveLength(1)
  })

  it('added entry has the correct type and message', () => {
    const { result } = renderHook(() => useGameLog())
    act(() => result.current.add(entry1))
    expect(result.current.entries[0].type).toBe('hit')
    expect(result.current.entries[0].message).toBe('Hit: +1 (0 → 1)')
  })

  it('added entry has a non-empty id', () => {
    const { result } = renderHook(() => useGameLog())
    act(() => result.current.add(entry1))
    expect(result.current.entries[0].id).toBeTruthy()
  })

  it('each added entry has a unique id', () => {
    const { result } = renderHook(() => useGameLog())
    act(() => {
      result.current.add(entry1)
      result.current.add(entry2)
    })
    const ids = result.current.entries.map(e => e.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('multiple entries are in insertion order', () => {
    const { result } = renderHook(() => useGameLog())
    act(() => {
      result.current.add(entry1)
      result.current.add(entry2)
    })
    expect(result.current.entries[0].type).toBe('hit')
    expect(result.current.entries[1].type).toBe('heal')
  })

  it('added entry stores prevState', () => {
    const { result } = renderHook(() => useGameLog())
    act(() => result.current.add(entry1))
    expect(result.current.entries[0].prevState).toEqual(mockState)
  })

  // --- undoLast ---

  it('undoLast removes the last entry', () => {
    const { result } = renderHook(() => useGameLog())
    act(() => {
      result.current.add(entry1)
      result.current.add(entry2)
    })
    act(() => { result.current.undoLast() })
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0].type).toBe('hit')
  })

  it('undoLast returns the removed entry', () => {
    const { result } = renderHook(() => useGameLog())
    act(() => {
      result.current.add(entry1)
      result.current.add(entry2)
    })
    let removed: any = null
    act(() => { removed = result.current.undoLast() })
    expect(removed).not.toBeNull()
    expect(removed.type).toBe('heal')
    expect(removed.message).toBe('Heal: -1 (2 → 1)')
  })

  it('undoLast returns null when entries is empty', () => {
    const { result } = renderHook(() => useGameLog())
    let removed: any = 'sentinel'
    act(() => { removed = result.current.undoLast() })
    expect(removed).toBeNull()
  })

  it('undoLast on a single entry leaves the list empty', () => {
    const { result } = renderHook(() => useGameLog())
    act(() => result.current.add(entry1))
    act(() => { result.current.undoLast() })
    expect(result.current.entries).toHaveLength(0)
  })

  // --- reset ---

  it('reset clears all entries', () => {
    const { result } = renderHook(() => useGameLog())
    act(() => {
      result.current.add(entry1)
      result.current.add(entry2)
    })
    act(() => result.current.reset())
    expect(result.current.entries).toHaveLength(0)
  })

  it('add after reset appends correctly', () => {
    const { result } = renderHook(() => useGameLog())
    act(() => result.current.add(entry1))
    act(() => result.current.reset())
    act(() => result.current.add(entry2))
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0].type).toBe('heal')
  })

})