import { useState, useEffect, useRef, useCallback } from 'react'

interface UseTimerResult {
  remaining: number
  isRunning: boolean
  isExpired: boolean
  start: () => void
  reset: () => void
}

export function useTimer(durationSeconds: number): UseTimerResult {
  const [remaining, setRemaining] = useState(durationSeconds)
  const [isRunning, setIsRunning] = useState(false)
  const startedRef = useRef(false)
  const startTimeRef = useRef<number | null>(null)

  const recalculate = useCallback(() => {
    if (startTimeRef.current === null) return
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000)
    const newRemaining = Math.max(0, durationSeconds - elapsed)
    setRemaining(newRemaining)
    if (newRemaining === 0) setIsRunning(false)
  }, [durationSeconds])

  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(recalculate, 1000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') recalculate()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isRunning, recalculate])

  const start = () => {
    if (startedRef.current) return
    startedRef.current = true
    startTimeRef.current = Date.now()
    setIsRunning(true)
  }

  const reset = () => {
    startedRef.current = false
    startTimeRef.current = null
    setIsRunning(false)
    setRemaining(durationSeconds)
  }

  return {
    remaining,
    isRunning,
    isExpired: remaining === 0,
    start,
    reset,
  }
}
