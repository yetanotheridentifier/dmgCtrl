export type GameLogEntryType = 'hit' | 'heal' | 'epic' | 'force-gain' | 'force-use' | 'monastery' | 'round'

export interface GameLogEntry {
  id: string
  type: GameLogEntryType
  message: string
  color: string
  prevState: object
}

export function useGameLog() {
  return {
    entries: [] as GameLogEntry[],
    add: (_entry: Omit<GameLogEntry, 'id'>) => {},
    undoLast: (): GameLogEntry | null => null,
    reset: () => {},
  }
}