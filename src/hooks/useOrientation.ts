import { useState, useEffect } from 'react'

export function useOrientation() {
  const [isPortrait, setIsPortrait] = useState(() =>
    window.matchMedia('(orientation: portrait)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)')
    const handler = (e: MediaQueryListEvent) => setIsPortrait(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // screen.width/height are the device's physical dimensions and never get stuck
  // after rotation — unlike window.innerWidth/innerHeight which can on iOS.
  const vmin = Math.min(screen.width, screen.height)

  return { isPortrait, vmin }
}
