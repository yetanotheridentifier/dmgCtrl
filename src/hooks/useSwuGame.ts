import { useState } from 'react'

export function useSwuGame() {
  const [count, setCount] = useState(0)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  const increment = () => setCount(c => c + 1)
  const decrement = () => setCount(c => Math.max(0, c - 1))
  const handleImageLoad = () => setImageLoaded(true)
  const handleImageError = () => setImageError(true)

  return { count, imageLoaded, imageError, increment, decrement, handleImageLoad, handleImageError }
}