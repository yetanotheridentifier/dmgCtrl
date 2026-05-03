import { useState } from 'react'

export type GameState = {
  damage: number
  epicActionUsed: boolean
  forceActive: boolean
  forceEnabled: boolean
  mysticUsesRemaining: number
  round: number
}

export function useSwuGame(maxHp: number) {
  const [count, setCount] = useState(0)
  const [epicActionUsed, setEpicActionUsed] = useState(false)
  const [forceActive, setForceActive] = useState(false)
  const [forceEnabled, setForceEnabled] = useState(false)
  const [mysticUsesRemaining, setMysticUsesRemaining] = useState(3)
  const [round, setRound] = useState(1)

  const increment = () => setCount(c => Math.min(maxHp, c + 1))
  const decrement = () => setCount(c => Math.max(0, c - 1))
  const incrementBy = (n: number) => setCount(c => Math.min(maxHp, c + n))
  const decrementBy = (n: number) => setCount(c => Math.max(0, c - n))
  const markEpicActionUsed = () => setEpicActionUsed(true)
  const toggleForce = () => setForceActive(v => !v)
  const enableForce = () => setForceEnabled(true)
  const gainForceViaMonastery = () => {
    setMysticUsesRemaining(n => n - 1)
    setForceActive(true)
  }
  const incrementRound = () => setRound(r => Math.min(99, r + 1))

  const snapshot = (): GameState => ({
    damage: count,
    epicActionUsed,
    forceActive,
    forceEnabled,
    mysticUsesRemaining,
    round,
  })

  const restoreState = (s: GameState) => {
    setCount(s.damage)
    setEpicActionUsed(s.epicActionUsed)
    setForceActive(s.forceActive)
    setForceEnabled(s.forceEnabled)
    setMysticUsesRemaining(s.mysticUsesRemaining)
    setRound(s.round)
  }

  const reset = () => {
    setCount(0)
    setEpicActionUsed(false)
    setForceActive(false)
    setForceEnabled(false)
    setMysticUsesRemaining(3)
    setRound(1)
  }

  return {
    count,
    increment,
    decrement,
    incrementBy,
    decrementBy,
    epicActionUsed,
    markEpicActionUsed,
    forceActive,
    toggleForce,
    forceEnabled,
    enableForce,
    mysticUsesRemaining,
    gainForceViaMonastery,
    round,
    incrementRound,
    snapshot,
    restoreState,
    reset,
  }
}
