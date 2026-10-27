import { createContext, useContext, useEffect, useState } from 'react'

// How far the screen is turned from the phone's natural (portrait) orientation, in degrees.
function screenAngle(): number {
  const angle = window.screen.orientation?.angle
  if (typeof angle === 'number') return angle
  const legacy = (window as { orientation?: number }).orientation
  return typeof legacy === 'number' ? (legacy + 360) % 360 : 0
}

export function useScreenAngle(): number {
  const [angle, setAngle] = useState(screenAngle)
  useEffect(() => {
    const update = () => setAngle(screenAngle())
    const orientation = window.screen.orientation
    orientation?.addEventListener('change', update)
    window.addEventListener('orientationchange', update)
    return () => {
      orientation?.removeEventListener('change', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  return angle
}

// How far the frame around everything inside is turned clockwise on the screen, in degrees
// (layout/fixedOrientation.tsx provides it; 0 outside a turned frame).
export const FrameTurn = createContext(0)

export function useFrameTurn(): number {
  return useContext(FrameTurn)
}

// How far a pointer moved along "up" on a frame turned clockwise by `turn` degrees, from screen
// coordinates. Unturned, that is up the screen; turned a quarter, it is towards the screen's right.
export function distanceUp(turn: number, dx: number, dy: number): number {
  const radians = (turn * Math.PI) / 180
  return Math.round(dx * Math.sin(radians) - dy * Math.cos(radians))
}
