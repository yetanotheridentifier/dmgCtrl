import { useState } from 'react'

export function useSwuGame() {
  const [count, setCount] = useState(0)
  const [epicActionUsed, setEpicActionUsed] = useState(false)

  const increment = () => setCount(c => c + 1)
  const decrement = () => setCount(c => Math.max(0, c - 1))
  const toggleEpicAction = () => setEpicActionUsed(v => !v)

  return { count, increment, decrement, epicActionUsed, toggleEpicAction }
}