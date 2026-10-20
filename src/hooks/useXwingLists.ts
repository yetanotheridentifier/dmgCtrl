import { useState } from 'react'
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

export function useXwingLists() {
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
