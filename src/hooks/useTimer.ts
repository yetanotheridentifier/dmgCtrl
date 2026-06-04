import { useState, useEffect, useRef, useCallback } from 'react'

interface UseTimerResult {
  remaining: number
  isRunning: boolean
  isExpired: boolean
  start: () => void
  stop: () => void
  reset: () => void
  resume: () => void
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

  /** Freezes the timer at its current remaining value without resetting it.
   *  Used when a terminal game condition is reached (game over, etc.). */
  const stop = () => {
    setIsRunning(false)
  }

  /** Resumes a stopped timer, accounting for time elapsed since it was stopped.
   *  startTimeRef is preserved through stop(), so recalculate() correctly
   *  includes elapsed time during the paused period. No-op if never started. */
  const resume = () => {
    if (startTimeRef.current === null) return
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
    stop,
    reset,
    resume,
  }
}
