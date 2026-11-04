import { useSyncExternalStore } from 'react'

/** A phone held upright: the query the PWA's `useOrientation` reads, so a Sheet and its screen agree. */
export const PORTRAIT_QUERY = '(orientation: portrait)'

/** Room for the chosen deck's contents beside the setup cards. */
export const DESKTOP_QUERY = '(min-width: 1024px) and (min-height: 600px)'

/** Whether a media query matches, kept current as the window changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    onChange => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
