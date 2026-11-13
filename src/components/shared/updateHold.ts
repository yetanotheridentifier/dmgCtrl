import { useEffect, useSyncExternalStore } from 'react'

/**
 * Holds on a new version. A new version arrives by reloading the page, which drops anything held
 * only in memory, so useAppUpdate applies one only while nothing holds it.
 *
 * Holding is opt-in: a screen, sheet or game that keeps work in memory and not in storage declares
 * it here with useHoldsUpdate, or a reload into a new version loses that work. Today that is a
 * mounted game (App), any open Sheet, the list builder with unsaved pilots, and the Squad Lists
 * paste box. Choices that should merely outlast a reload can go in sessionStorage instead, as
 * X-Wing setup's do.
 *
 * It sits with the shared controls because Sheet holds. Sealed imports Sheet too and has its own
 * update rule (useUpdateOnDeckScreen), so its holds are taken and never read.
 */
let holds = 0
const listeners = new Set<() => void>()

const changed = () => listeners.forEach(listener => listener())

/** Holds updates until the returned release is called. Releasing twice releases once. */
export function holdUpdate(): () => void {
  holds += 1
  changed()
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
    changed()
  }
}

export function isUpdateHeld(): boolean {
  return holds > 0
}

/** Holds updates while active and mounted. */
export function useHoldsUpdate(active: boolean): void {
  useEffect(() => (active ? holdUpdate() : undefined), [active])
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Whether anything holds updates, kept current as holds come and go. */
export function useUpdateHeld(): boolean {
  return useSyncExternalStore(subscribe, isUpdateHeld, () => false)
}
