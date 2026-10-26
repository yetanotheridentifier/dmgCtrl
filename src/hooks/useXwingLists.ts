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

  // Saving under a name that already exists replaces that list in place, keeping its id and
  // createdAt, so a list edited under its own name stays the list setup has chosen. Returns the id.
  function saveList(name: string, pilots: XwingPilot[], faction?: string): string {
    const existing = lists.find(l => l.name === name)
    const entry: XwingList = existing
      ? { id: existing.id, name, pilots, ...(existing.createdAt !== undefined && { createdAt: existing.createdAt }) }
      : { id: crypto.randomUUID(), name, pilots, createdAt: new Date().toISOString() }
    if (faction !== undefined) entry.faction = faction
    const next = existing ? lists.map(l => (l === existing ? entry : l)) : [...lists, entry]
    save(next)
    setLists(next)
    return entry.id
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

  return { lists, saveList, renameList, removeList }
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
