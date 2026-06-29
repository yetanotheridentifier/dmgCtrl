import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useXwingFavourites } from '../hooks/useXwingFavourites'
import type { XwingSquadFavourite } from '../hooks/useXwingFavourites'

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

describe('useXwingFavourites', () => {

  // --- Initial state ---

  it('starts with an empty list when storage is empty', () => {
    const { result } = renderHook(() => useXwingFavourites())
    expect(result.current.favourites).toEqual([])
  })

  it('falls back to empty list when storage contains corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{')
    const { result } = renderHook(() => useXwingFavourites())
    expect(result.current.favourites).toEqual([])
  })

  it('loads saved favourites from localStorage on mount', () => {
    const stored: XwingSquadFavourite[] = [
      { id: '1', name: 'Scum Squad', pilots: PILOTS_A },
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    const { result } = renderHook(() => useXwingFavourites())
    expect(result.current.favourites).toHaveLength(1)
    expect(result.current.favourites[0].name).toBe('Scum Squad')
  })

  // --- addFavourite ---

  it('addFavourite adds an entry to the list', () => {
    const { result } = renderHook(() => useXwingFavourites())
    act(() => { result.current.addFavourite('Scum Squad', PILOTS_A) })
    expect(result.current.favourites).toHaveLength(1)
  })

  it('addFavourite stores the name and pilots', () => {
    const { result } = renderHook(() => useXwingFavourites())
    act(() => { result.current.addFavourite('Scum Squad', PILOTS_A) })
    expect(result.current.favourites[0].name).toBe('Scum Squad')
    expect(result.current.favourites[0].pilots).toEqual(PILOTS_A)
  })

  it('addFavourite generates a unique id', () => {
    const { result } = renderHook(() => useXwingFavourites())
    act(() => { result.current.addFavourite('Squad A', PILOTS_A) })
    act(() => { result.current.addFavourite('Squad B', PILOTS_B) })
    const ids = result.current.favourites.map(f => f.id)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('addFavourite appends to existing list', () => {
    const { result } = renderHook(() => useXwingFavourites())
    act(() => { result.current.addFavourite('Squad A', PILOTS_A) })
    act(() => { result.current.addFavourite('Squad B', PILOTS_B) })
    expect(result.current.favourites).toHaveLength(2)
  })

  it('addFavourite persists to localStorage', () => {
    const { result } = renderHook(() => useXwingFavourites())
    act(() => { result.current.addFavourite('Scum Squad', PILOTS_A) })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('Scum Squad')
  })

  // --- removeFavourite ---

  it('removeFavourite removes the entry with the given id', () => {
    const { result } = renderHook(() => useXwingFavourites())
    act(() => { result.current.addFavourite('Squad A', PILOTS_A) })
    act(() => { result.current.addFavourite('Squad B', PILOTS_B) })
    const idToRemove = result.current.favourites[0].id
    act(() => { result.current.removeFavourite(idToRemove) })
    expect(result.current.favourites).toHaveLength(1)
    expect(result.current.favourites[0].name).toBe('Squad B')
  })

  it('removeFavourite is a no-op when the id does not exist', () => {
    const { result } = renderHook(() => useXwingFavourites())
    act(() => { result.current.addFavourite('Squad A', PILOTS_A) })
    act(() => { result.current.removeFavourite('does-not-exist') })
    expect(result.current.favourites).toHaveLength(1)
  })

  it('removeFavourite persists the updated list', () => {
    const { result } = renderHook(() => useXwingFavourites())
    act(() => { result.current.addFavourite('Squad A', PILOTS_A) })
    const id = result.current.favourites[0].id
    act(() => { result.current.removeFavourite(id) })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored).toHaveLength(0)
  })

  // --- clearFavourites ---

  it('clearFavourites empties the list', () => {
    const { result } = renderHook(() => useXwingFavourites())
    act(() => { result.current.addFavourite('Squad A', PILOTS_A) })
    act(() => { result.current.addFavourite('Squad B', PILOTS_B) })
    act(() => { result.current.clearFavourites() })
    expect(result.current.favourites).toEqual([])
  })

  it('clearFavourites persists empty list to localStorage', () => {
    const { result } = renderHook(() => useXwingFavourites())
    act(() => { result.current.addFavourite('Squad A', PILOTS_A) })
    act(() => { result.current.clearFavourites() })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored).toEqual([])
  })

})
