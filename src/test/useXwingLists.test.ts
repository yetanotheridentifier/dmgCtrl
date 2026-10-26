import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useXwingLists, XwingListsProvider } from '../hooks/useXwingLists'
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
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    expect(result.current.lists).toEqual([])
  })

  it('falls back to empty list when storage contains corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{')
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    expect(result.current.lists).toEqual([])
  })

  it('loads saved lists from localStorage on mount', () => {
    const stored: XwingList[] = [
      { id: '1', name: 'Scum Squad', pilots: PILOTS_A },
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    expect(result.current.lists).toHaveLength(1)
    expect(result.current.lists[0].name).toBe('Scum Squad')
  })

  it('loads lists saved before faction and createdAt existed', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: '1', name: 'Old Squad', pilots: PILOTS_A }]))
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    expect(result.current.lists[0]).toEqual({ id: '1', name: 'Old Squad', pilots: PILOTS_A })
  })

  // --- saveList ---

  it('saveList adds an entry to the list', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Scum Squad', PILOTS_A) })
    expect(result.current.lists).toHaveLength(1)
  })

  it('saveList stores the name and pilots', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Scum Squad', PILOTS_A) })
    expect(result.current.lists[0].name).toBe('Scum Squad')
    expect(result.current.lists[0].pilots).toEqual(PILOTS_A)
  })

  it('saveList stores the faction when given', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Scum Squad', PILOTS_A, 'scumandvillainy') })
    expect(result.current.lists[0].faction).toBe('scumandvillainy')
  })

  it('saveList records when the list was created', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Scum Squad', PILOTS_A) })
    expect(result.current.lists[0].createdAt).toBe('2026-10-20T12:00:00.000Z')
    vi.useRealTimers()
  })

  it('saveList generates a unique id', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Squad A', PILOTS_A) })
    act(() => { result.current.saveList('Squad B', PILOTS_B) })
    const ids = result.current.lists.map(f => f.id)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('saveList appends to existing list', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Squad A', PILOTS_A) })
    act(() => { result.current.saveList('Squad B', PILOTS_B) })
    expect(result.current.lists).toHaveLength(2)
  })

  it('saveList with an existing name replaces that list in place', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Squad A', PILOTS_A) })
    act(() => { result.current.saveList('Squad B', PILOTS_B) })
    act(() => { result.current.saveList('Squad A', PILOTS_B) })
    expect(result.current.lists.map(l => l.name)).toEqual(['Squad A', 'Squad B'])
    expect(result.current.lists[0].pilots).toEqual(PILOTS_B)
  })

  it('saveList persists to localStorage', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Scum Squad', PILOTS_A) })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('Scum Squad')
  })

  it('saveList returns the id of the list it saved', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    let id = ''
    act(() => { id = result.current.saveList('Squad A', PILOTS_A) })
    expect(result.current.lists[0].id).toBe(id)
  })

  // Editing a list saves it under its own name, so it must stay the same list: a setup choice or
  // last game's opponent points at it by id.
  it('saveList over an existing name keeps that list\'s id and createdAt, and returns that id', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { id: '1', name: 'Squad A', pilots: PILOTS_A, faction: 'scumandvillainy', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: '2', name: 'Squad B', pilots: PILOTS_B },
    ]))
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    let id = ''
    act(() => { id = result.current.saveList('Squad A', PILOTS_B, 'galacticempire') })
    expect(id).toBe('1')
    expect(result.current.lists[0]).toEqual({ id: '1', name: 'Squad A', pilots: PILOTS_B, faction: 'galacticempire', createdAt: '2026-01-01T00:00:00.000Z' })
    expect(result.current.lists[1].name).toBe('Squad B')
  })

  // --- renameList ---

  it('renameList changes the name of the list with the given id', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Squad A', PILOTS_A) })
    const id = result.current.lists[0].id
    act(() => { result.current.renameList(id, 'Renamed') })
    expect(result.current.lists[0].name).toBe('Renamed')
    expect(result.current.lists[0].pilots).toEqual(PILOTS_A)
  })

  it('renameList persists the new name', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Squad A', PILOTS_A) })
    const id = result.current.lists[0].id
    act(() => { result.current.renameList(id, 'Renamed') })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored[0].name).toBe('Renamed')
  })

  it('renameList is a no-op when another list already has that name', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Squad A', PILOTS_A) })
    act(() => { result.current.saveList('Squad B', PILOTS_B) })
    const id = result.current.lists[0].id
    act(() => { result.current.renameList(id, 'Squad B') })
    expect(result.current.lists.map(l => l.name)).toEqual(['Squad A', 'Squad B'])
  })

  // --- removeList ---

  it('removeList removes the entry with the given id', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Squad A', PILOTS_A) })
    act(() => { result.current.saveList('Squad B', PILOTS_B) })
    const idToRemove = result.current.lists[0].id
    act(() => { result.current.removeList(idToRemove) })
    expect(result.current.lists).toHaveLength(1)
    expect(result.current.lists[0].name).toBe('Squad B')
  })

  it('removeList is a no-op when the id does not exist', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Squad A', PILOTS_A) })
    act(() => { result.current.removeList('does-not-exist') })
    expect(result.current.lists).toHaveLength(1)
  })

  it('removeList persists the updated list', () => {
    const { result } = renderHook(() => useXwingLists(), { wrapper: XwingListsProvider })
    act(() => { result.current.saveList('Squad A', PILOTS_A) })
    const id = result.current.lists[0].id
    act(() => { result.current.removeList(id) })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored).toHaveLength(0)
  })

  // --- Shared store ---

  it('every consumer under one provider sees the same lists', () => {
    const { result } = renderHook(() => ({ a: useXwingLists(), b: useXwingLists() }), { wrapper: XwingListsProvider })
    act(() => { result.current.a.saveList('Scum Squad', PILOTS_A) })
    expect(result.current.b.lists.map(l => l.name)).toEqual(['Scum Squad'])
  })

  it('throws when used outside XwingListsProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useXwingLists())).toThrow('useXwingLists must be used within XwingListsProvider')
  })

})
