import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Whether a new version may be applied now. Applying it reloads the page, and a game lives only
 * in useGame's memory, so an update waits for the deck screen.
 */
export function mayApplyUpdate(waiting: boolean, gameOpen: boolean): boolean {
  return waiting && !gameOpen
}

/**
 * Registers Sealed's service worker and applies a waiting update as soon as no game is open: at
 * once on the deck screen, or the moment the player leaves a game.
 */
export function useUpdateOnDeckScreen(gameOpen: boolean): void {
  const { needRefresh: [waiting], updateServiceWorker } = useRegisterSW()
  useEffect(() => {
    if (mayApplyUpdate(waiting, gameOpen)) void updateServiceWorker(true)
  }, [waiting, gameOpen, updateServiceWorker])
}
