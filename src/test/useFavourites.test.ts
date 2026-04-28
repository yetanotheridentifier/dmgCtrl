import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFavourites } from '../hooks/useFavourites'
import type { FavouriteBase } from '../hooks/useFavourites'

const STORAGE_KEY = 'favourites'

function makeLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

const FAV_A: FavouriteBase = { key: 'SOR-010', set: 'SOR', name: 'Catacombs of Cadera', hp: 30, aspect: 'Aggression', cardNumber: 10 }
const FAV_B: FavouriteBase = { key: 'SHD-018', set: 'SHD', name: 'Echo Base', hp: 30, aspect: 'Command', cardNumber: 18 }
const FAV_C: FavouriteBase = { key: 'SOR-005', set: 'SOR', name: 'Jedha City', hp: 30, aspect: 'Vigilance', cardNumber: 5 }

beforeEach(() => {
  vi.stubGlobal('localStorage', makeLocalStorageMock())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useFavourites', () => {

  // --- Initial state ---

  it('starts with an empty list when storage is empty', () => {
    const { result } = renderHook(() => useFavourites())
    expect(result.current.favourites).toEqual([])
  })

  it('falls back to empty list when storage contains corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{')
    const { result } = renderHook(() => useFavourites())
    expect(result.current.favourites).toEqual([])
  })

  // --- Add ---

  it('adds a favourite to an empty list', () => {
    const { result } = renderHook(() => useFavourites())
    act(() => { result.current.addFavourite(FAV_A) })
    expect(result.current.favourites).toHaveLength(1)
    expect(result.current.favourites[0]).toEqual(FAV_A)
  })

  it('is a no-op when adding a duplicate (same key)', () => {
    const { result } = renderHook(() => useFavourites())
    act(() => { result.current.addFavourite(FAV_A) })
    act(() => { result.current.addFavourite(FAV_A) })
    expect(result.current.favourites).toHaveLength(1)
  })

  // --- Remove ---

  it('removes a favourite by key', () => {
    const { result } = renderHook(() => useFavourites())
    act(() => { result.current.addFavourite(FAV_A) })
    act(() => { result.current.removeFavourite(FAV_A.key) })
    expect(result.current.favourites).toEqual([])
  })

  it('is a no-op when removing a key that does not exist', () => {
    const { result } = renderHook(() => useFavourites())
    act(() => { result.current.addFavourite(FAV_A) })
    act(() => { result.current.removeFavourite('SHD-999') })
    expect(result.current.favourites).toHaveLength(1)
  })

  // --- Clear ---

  it('clears all favourites', () => {
    const { result } = renderHook(() => useFavourites())
    act(() => { result.current.addFavourite(FAV_A) })
    act(() => { result.current.addFavourite(FAV_B) })
    act(() => { result.current.clearFavourites() })
    expect(result.current.favourites).toEqual([])
  })

  // --- Sort order ---

  it('returns favourites sorted by set ascending then card number ascending', () => {
    const { result } = renderHook(() => useFavourites())
    act(() => { result.current.addFavourite(FAV_B) }) // SHD-018
    act(() => { result.current.addFavourite(FAV_A) }) // SOR-010
    act(() => { result.current.addFavourite(FAV_C) }) // SOR-005
    expect(result.current.favourites.map(f => f.key)).toEqual([
      'SHD-018',
      'SOR-005',
      'SOR-010',
    ])
  })

  // --- Persistence ---

  it('persists favourites to localStorage when a favourite is added', () => {
    const { result } = renderHook(() => useFavourites())
    act(() => { result.current.addFavourite(FAV_A) })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored).toHaveLength(1)
    expect(stored[0].key).toBe(FAV_A.key)
  })

  it('persists the updated list to localStorage when a favourite is removed', () => {
    const { result } = renderHook(() => useFavourites())
    act(() => { result.current.addFavourite(FAV_A) })
    act(() => { result.current.addFavourite(FAV_B) })
    act(() => { result.current.removeFavourite(FAV_A.key) })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored).toHaveLength(1)
    expect(stored[0].key).toBe(FAV_B.key)
  })

  it('loads persisted favourites on remount', () => {
    const { result: r1, unmount } = renderHook(() => useFavourites())
    act(() => { r1.current.addFavourite(FAV_A) })
    unmount()
    const { result: r2 } = renderHook(() => useFavourites())
    expect(r2.current.favourites).toHaveLength(1)
    expect(r2.current.favourites[0].key).toBe(FAV_A.key)
  })

})