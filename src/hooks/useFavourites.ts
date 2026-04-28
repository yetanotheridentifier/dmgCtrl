import { useState } from 'react'

const STORAGE_KEY = 'favourites'

export interface FavouriteBase {
  key: string
  set: string
  name: string
  hp: number
  aspect: string
  cardNumber: number
}

function sortFavourites(favs: FavouriteBase[]): FavouriteBase[] {
  return [...favs].sort((a, b) => {
    if (a.set !== b.set) return a.set.localeCompare(b.set)
    return a.cardNumber - b.cardNumber
  })
}

function load(): FavouriteBase[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as FavouriteBase[]
  } catch {
    return []
  }
}

function save(favs: FavouriteBase[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favs))
}

export function useFavourites() {
  const [favourites, setFavourites] = useState<FavouriteBase[]>(() => sortFavourites(load()))

  function addFavourite(fav: FavouriteBase) {
    setFavourites(prev => {
      if (prev.some(f => f.key === fav.key)) return prev
      const next = sortFavourites([...prev, fav])
      save(next)
      return next
    })
  }

  function removeFavourite(key: string) {
    setFavourites(prev => {
      const next = prev.filter(f => f.key !== key)
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