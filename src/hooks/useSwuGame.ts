import { useState } from 'react'

export function useSwuGame(imageSrcs: string[] = []) {
  const [count, setCount] = useState(0)
  const [imageSrcIndex, setImageSrcIndex] = useState(0)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  const increment = () => setCount(c => c + 1)
  const decrement = () => setCount(c => Math.max(0, c - 1))
  const handleImageLoad = () => setImageLoaded(true)
  const handleImageError = () => {
    if (imageSrcIndex < imageSrcs.length - 1) {
      setImageSrcIndex(i => i + 1)
      setImageLoaded(false)
    } else {
      setImageError(true)
    }
  }

  const currentImageSrc = imageSrcs[imageSrcIndex] ?? ''

  return { count, imageLoaded, imageError, currentImageSrc, increment, decrement, handleImageLoad, handleImageError }
}