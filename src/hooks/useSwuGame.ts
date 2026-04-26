import { useState } from 'react'

export function useSwuGame(maxHp: number) {
  const [count, setCount] = useState(0)
  const [epicActionUsed, setEpicActionUsed] = useState(false)
  const [forceActive, setForceActive] = useState(false)
  const [forceEnabled, setForceEnabled] = useState(false)

  const increment = () => setCount(c => Math.min(maxHp, c + 1))
  const decrement = () => setCount(c => Math.max(0, c - 1))
  const toggleEpicAction = () => setEpicActionUsed(v => !v)
  const toggleForce = () => setForceActive(v => !v)
  const enableForce = () => setForceEnabled(true)

  return { count, increment, decrement, epicActionUsed, toggleEpicAction, forceActive, toggleForce, forceEnabled, enableForce }
}