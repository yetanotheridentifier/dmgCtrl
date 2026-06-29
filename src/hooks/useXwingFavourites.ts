import { useState } from 'react'
import type { XwingPilot } from '../utils/parseXwsText'

const STORAGE_KEY = 'xwing_favourites'

export interface XwingSquadFavourite {
  id: string
  name: string
  pilots: XwingPilot[]
}

function load(): XwingSquadFavourite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as XwingSquadFavourite[]
  } catch {
    return []
  }
}

function save(favs: XwingSquadFavourite[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favs))
}

export function useXwingFavourites() {
  const [favourites, setFavourites] = useState<XwingSquadFavourite[]>(load)

  function addFavourite(name: string, pilots: XwingPilot[]) {
    setFavourites(prev => {
      const next = [...prev, { id: crypto.randomUUID(), name, pilots }]
      save(next)
      return next
    })
  }

  function removeFavourite(id: string) {
    setFavourites(prev => {
      const next = prev.filter(f => f.id !== id)
      if (next.length === prev.length) return prev
      save(next)
      return next
    })
  }

  function clearFavourites() {
    setFavourites([])
    save([])
  }

  return { favourites, addFavourite, removeFavourite, clearFavourites }
}
