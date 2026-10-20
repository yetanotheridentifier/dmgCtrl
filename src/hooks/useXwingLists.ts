import { useState } from 'react'
import type { XwingPilot } from '../utils/parseXwsText'

const STORAGE_KEY = 'xwing_favourites'

export interface XwingList {
  id: string
  name: string
  pilots: XwingPilot[]
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

  function addList(name: string, pilots: XwingPilot[]) {
    setLists(prev => {
      const next = [...prev, { id: crypto.randomUUID(), name, pilots }]
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

  return { lists, addList, removeList, clearLists }
}
