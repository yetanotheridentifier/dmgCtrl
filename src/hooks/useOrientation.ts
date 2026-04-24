import { useState, useEffect } from 'react'

export function useOrientation() {
  const [isPortrait, setIsPortrait] = useState(() => window.innerWidth < window.innerHeight)

  useEffect(() => {
    const handler = () => setIsPortrait(window.innerWidth < window.innerHeight)
    window.addEventListener('orientationchange', handler)
    return () => window.removeEventListener('orientationchange', handler)
  }, [])

  return { isPortrait }
}
