import { useState } from 'react'

export function useSwuGame() {
  const [count, setCount] = useState(0)

  const increment = () => setCount(c => c + 1)
  const decrement = () => setCount(c => Math.max(0, c - 1))

  return { count, increment, decrement }
}