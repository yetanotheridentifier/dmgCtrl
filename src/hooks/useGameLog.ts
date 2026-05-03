import { useState } from 'react'
import type { GameState } from './useSwuGame'

export type GameLogEntryType = 'hit' | 'heal' | 'epic' | 'force-gain' | 'force-use' | 'monastery' | 'round'

export interface GameLogEntry {
  id: string
  type: GameLogEntryType
  message: string
  color: string
  prevState: GameState
}

export function useGameLog() {
  const [entries, setEntries] = useState<GameLogEntry[]>([])

  const add = (entry: Omit<GameLogEntry, 'id'>) => {
    setEntries(prev => [...prev, { ...entry, id: crypto.randomUUID() }])
  }

  const undoLast = (): GameLogEntry | null => {
    if (entries.length === 0) return null
    const last = entries[entries.length - 1]
    setEntries(prev => prev.slice(0, -1))
    return last
  }

  const reset = () => setEntries([])

  return { entries, add, undoLast, reset }
}
