import { useState } from 'react'

export type Initiative = 'player' | 'opponent' | null

export interface UseInitiativeReturn {
  initiative: Initiative
  setInitiative: (v: Initiative) => void
  cycle: () => void
  setOpponent: () => void
  setPlayer: () => void
  reset: () => void
}

export function useInitiative(): UseInitiativeReturn {
  const [initiative, setInitiative] = useState<Initiative>(null)

  const cycle = () => {
    setInitiative(prev =>
      prev === null ? 'player' : prev === 'player' ? 'opponent' : null
    )
  }

  const setOpponent = () => {
    setInitiative('opponent')
  }

  const setPlayer = () => {
    setInitiative('player')
  }

  const reset = () => setInitiative(null)

  return { initiative, setInitiative, cycle, setOpponent, setPlayer, reset }
}
