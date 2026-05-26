import { useState } from 'react'

export interface HistoryEntry<TSnapshot> {
  id: string
  type: string
  message: string
  color: string
  snapshot: TSnapshot
}

export function useGameHistory<TSnapshot>() {
  const [entries, setEntries] = useState<HistoryEntry<TSnapshot>[]>([])

  const add = (entry: Omit<HistoryEntry<TSnapshot>, 'id'>) => {
    setEntries(prev => [...prev, { ...entry, id: crypto.randomUUID() }])
  }

  const undoLast = (): HistoryEntry<TSnapshot> | null => {
    if (entries.length === 0) return null
    const last = entries[entries.length - 1]
    setEntries(prev => prev.slice(0, -1))
    return last
  }

  const reset = () => setEntries([])

  return { entries, add, undoLast, reset }
}
