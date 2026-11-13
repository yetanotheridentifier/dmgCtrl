import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useUpdateHeld } from '../components/shared/updateHold'

/** Whether a new version may be applied now: one is waiting and nothing holds it. */
export function mayApplyUpdate(waiting: boolean, held: boolean): boolean {
  return waiting && !held
}

/**
 * Registers the service worker and keeps the installed app on the latest version.
 *
 * The browser looks for a new version only when the page loads, and a home-screen app on iOS is
 * mostly resumed rather than relaunched, so it could run an old version for weeks. This looks
 * again each time the app comes back to the foreground. A waiting version is applied, which
 * reloads the page, as soon as nothing holds it (see updateHold), with beforeReload run first so
 * the app can reopen where it was.
 *
 * Sealed, a separate app, has its own rule for the same job (useUpdateOnDeckScreen).
 */
export function useAppUpdate(beforeReload: () => void): void {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const { needRefresh: [waiting], updateServiceWorker } = useRegisterSW({
    onRegisteredSW: (_url, reg) => { registration.current = reg },
  })
  const held = useUpdateHeld()

  // Kept current without re-running the effect below on every render.
  const saveRef = useRef(beforeReload)
  useEffect(() => { saveRef.current = beforeReload })

  useEffect(() => {
    if (!mayApplyUpdate(waiting, held)) return
    saveRef.current()
    void updateServiceWorker(true)
  }, [waiting, held, updateServiceWorker])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      // Offline, or the server unreachable: the next resume looks again.
      registration.current?.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
}
