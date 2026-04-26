import { useEffect, useRef } from 'react'

export function useWakeLock(enabled: boolean) {
  const lockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!enabled) return

    const acquire = async () => {
      if (!('wakeLock' in navigator)) return
      try {
        lockRef.current = await navigator.wakeLock.request('screen')
      } catch {
        // Silently fail — battery saver mode, permissions denied, etc.
      }
    }

    acquire()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') acquire()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      lockRef.current?.release().catch(() => {})
      lockRef.current = null
    }
  }, [enabled])
}