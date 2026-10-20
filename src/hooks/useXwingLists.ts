import { createContext, createElement, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import type { XwingPilot } from '../utils/parseXwsText'

const STORAGE_KEY = 'xwing_favourites'

export interface XwingList {
  id: string
  name: string
  pilots: XwingPilot[]
  // Absent on lists saved before these fields existed.
  faction?: string
  createdAt?: string
}

function load(): XwingList[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as XwingList[]
  } catch {
    return []
  }
}

function save(lists: XwingList[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lists))
}

function useXwingListsState() {
  const [lists, setLists] = useState<XwingList[]>(load)

  // Saving under a name that already exists replaces that list in place.
  function saveList(name: string, pilots: XwingPilot[], faction?: string) {
    setLists(prev => {
      const entry: XwingList = { id: crypto.randomUUID(), name, pilots, createdAt: new Date().toISOString() }
      if (faction !== undefined) entry.faction = faction
      const idx = prev.findIndex(l => l.name === name)
      const next = idx === -1 ? [...prev, entry] : prev.map((l, i) => (i === idx ? entry : l))
      save(next)
      return next
    })
  }

  function renameList(id: string, name: string) {
    setLists(prev => {
      if (prev.some(l => l.name === name && l.id !== id)) return prev
      const next = prev.map(l => (l.id === id ? { ...l, name } : l))
      save(next)
      return next
    })
  }

  function removeList(id: string) {
    setLists(prev => {
      const next = prev.filter(f => f.id !== id)
      if (next.length === prev.length) return prev
      save(next)
      return next
    })
  }

  function clearLists() {
    setLists([])
    save([])
  }

  return { lists, saveList, renameList, removeList, clearLists }
}

type XwingListsValue = ReturnType<typeof useXwingListsState>

// Shared so a list saved on Squad Lists shows at once on the setup screen, which stays mounted.
const XwingListsContext = createContext<XwingListsValue | null>(null)

export function XwingListsProvider({ children }: { children: ReactNode }) {
  return createElement(XwingListsContext.Provider, { value: useXwingListsState() }, children)
}

export function useXwingLists(): XwingListsValue {
  const ctx = useContext(XwingListsContext)
  if (!ctx) throw new Error('useXwingLists must be used within XwingListsProvider')
  return ctx
}
