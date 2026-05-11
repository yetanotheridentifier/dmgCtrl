import { useEffect, useRef } from 'react'
import { onWakeLockFailed } from '../services/analytics'

export function useWakeLock(enabled: boolean) {
  const lockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!enabled) return

    const acquire = async () => {
      if (!('wakeLock' in navigator) || !navigator.wakeLock) return
      try {
        lockRef.current = await navigator.wakeLock.request('screen')
      } catch (err) {
        const reason = err instanceof DOMException ? err.name : 'unknown'
        void onWakeLockFailed(reason)
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