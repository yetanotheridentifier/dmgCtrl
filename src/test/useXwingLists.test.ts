import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useXwingLists } from '../hooks/useXwingLists'
import type { XwingList } from '../hooks/useXwingLists'

const STORAGE_KEY = 'xwing_favourites'

const PILOTS_A = [
  { name: 'asajjventress', ship: 'lancerclasspursuitcraft', points: 15 },
  { name: 'bobafett-armedanddangerous', ship: 'firesprayclasspatrolcraft', points: 18 },
  { name: 'bossk', ship: 'yv666lightfreighter', points: 17 },
]

const PILOTS_B = [
  { name: 'darthvader', ship: 'tieadvancedx1', points: 21 },
  { name: 'soontirfel', ship: 'tieinterceptor', points: 15 },
  { name: 'vermeil', ship: 'tiedefender', points: 14 },
]

function makeLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeLocalStorageMock())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useXwingLists', () => {

  // --- Initial state ---

  it('starts with an empty list when storage is empty', () => {
    const { result } = renderHook(() => useXwingLists())
    expect(result.current.lists).toEqual([])
  })

  it('falls back to empty list when storage contains corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{')
    const { result } = renderHook(() => useXwingLists())
    expect(result.current.lists).toEqual([])
  })

  it('loads saved lists from localStorage on mount', () => {
    const stored: XwingList[] = [
      { id: '1', name: 'Scum Squad', pilots: PILOTS_A },
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    const { result } = renderHook(() => useXwingLists())
    expect(result.current.lists).toHaveLength(1)
    expect(result.current.lists[0].name).toBe('Scum Squad')
  })

  // --- addList ---

  it('addList adds an entry to the list', () => {
    const { result } = renderHook(() => useXwingLists())
    act(() => { result.current.addList('Scum Squad', PILOTS_A) })
    expect(result.current.lists).toHaveLength(1)
  })

  it('addList stores the name and pilots', () => {
    const { result } = renderHook(() => useXwingLists())
    act(() => { result.current.addList('Scum Squad', PILOTS_A) })
    expect(result.current.lists[0].name).toBe('Scum Squad')
    expect(result.current.lists[0].pilots).toEqual(PILOTS_A)
  })

  it('addList generates a unique id', () => {
    const { result } = renderHook(() => useXwingLists())
    act(() => { result.current.addList('Squad A', PILOTS_A) })
    act(() => { result.current.addList('Squad B', PILOTS_B) })
    const ids = result.current.lists.map(f => f.id)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('addList appends to existing list', () => {
    const { result } = renderHook(() => useXwingLists())
    act(() => { result.current.addList('Squad A', PILOTS_A) })
    act(() => { result.current.addList('Squad B', PILOTS_B) })
    expect(result.current.lists).toHaveLength(2)
  })

  it('addList persists to localStorage', () => {
    const { result } = renderHook(() => useXwingLists())
    act(() => { result.current.addList('Scum Squad', PILOTS_A) })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('Scum Squad')
  })

  // --- removeList ---

  it('removeList removes the entry with the given id', () => {
    const { result } = renderHook(() => useXwingLists())
    act(() => { result.current.addList('Squad A', PILOTS_A) })
    act(() => { result.current.addList('Squad B', PILOTS_B) })
    const idToRemove = result.current.lists[0].id
    act(() => { result.current.removeList(idToRemove) })
    expect(result.current.lists).toHaveLength(1)
    expect(result.current.lists[0].name).toBe('Squad B')
  })

  it('removeList is a no-op when the id does not exist', () => {
    const { result } = renderHook(() => useXwingLists())
    act(() => { result.current.addList('Squad A', PILOTS_A) })
    act(() => { result.current.removeList('does-not-exist') })
    expect(result.current.lists).toHaveLength(1)
  })

  it('removeList persists the updated list', () => {
    const { result } = renderHook(() => useXwingLists())
    act(() => { result.current.addList('Squad A', PILOTS_A) })
    const id = result.current.lists[0].id
    act(() => { result.current.removeList(id) })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored).toHaveLength(0)
  })

  // --- clearLists ---

  it('clearLists empties the list', () => {
    const { result } = renderHook(() => useXwingLists())
    act(() => { result.current.addList('Squad A', PILOTS_A) })
    act(() => { result.current.addList('Squad B', PILOTS_B) })
    act(() => { result.current.clearLists() })
    expect(result.current.lists).toEqual([])
  })

  it('clearLists persists empty list to localStorage', () => {
    const { result } = renderHook(() => useXwingLists())
    act(() => { result.current.addList('Squad A', PILOTS_A) })
    act(() => { result.current.clearLists() })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored).toEqual([])
  })

})
