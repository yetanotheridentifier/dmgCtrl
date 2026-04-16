import { useState, useEffect } from 'react'

export function useOrientation() {
  const [isPortrait, setIsPortrait] = useState(() => window.innerWidth < window.innerHeight)

  useEffect(() => {
    const handler = () => setIsPortrait(window.innerWidth < window.innerHeight)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  return { isPortrait }
}
