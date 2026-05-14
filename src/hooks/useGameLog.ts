import { useState } from 'react'
import type { GameState } from './useSwuGame'

export type GameLogEntryType = 'hit' | 'heal' | 'epic' | 'force-gain' | 'force-use' | 'monastery' | 'round' | 'game-result'

export interface GameLogEntry {
  id: string
  type: GameLogEntryType
  message: string
  color: string
  prevState: GameState
  prevLogEntries?: GameLogEntry[]
  prevMatchState?: { playerScore: number; opponentScore: number }
  undoable?: boolean
}

export function useGameLog() {
  const [entries, setEntries] = useState<GameLogEntry[]>([])

  const add = (entry: Omit<GameLogEntry, 'id'>) => {
    setEntries(prev => [...prev, { ...entry, id: crypto.randomUUID() }])
  }

  const clearAndAdd = (entry: Omit<GameLogEntry, 'id'>) => {
    setEntries([{ ...entry, id: crypto.randomUUID() }])
  }

  const undoLast = (): GameLogEntry | null => {
    if (entries.length === 0) return null
    const last = entries[entries.length - 1]
    if (last.prevLogEntries !== undefined) {
      setEntries(last.prevLogEntries)
    } else {
      setEntries(prev => prev.slice(0, -1))
    }
    return last
  }

  const reset = () => setEntries([])

  return { entries, add, clearAndAdd, undoLast, reset }
}
