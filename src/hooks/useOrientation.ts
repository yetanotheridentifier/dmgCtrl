import { useState, useEffect } from 'react'
import { useFrameTurn } from './useFrameTurn'

export function useOrientation() {
  const [viewportPortrait, setIsPortrait] = useState(() =>
    window.matchMedia('(orientation: portrait)').matches
  )
  // Inside a frame turned a quarter against the screen, the frame's shape is the other one.
  const sideways = useFrameTurn() % 180 !== 0
  const isPortrait = viewportPortrait !== sideways

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)')
    const handler = (e: MediaQueryListEvent) => setIsPortrait(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // screen.width/height are the device's physical dimensions and never get stuck
  // after rotation, unlike window.innerWidth/innerHeight which can on iOS.
  const vmin = Math.min(screen.width, screen.height)

  return { isPortrait, vmin }
}
