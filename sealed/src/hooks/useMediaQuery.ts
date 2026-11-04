import { useSyncExternalStore } from 'react'

/** A phone held upright: the query the PWA's `useOrientation` reads, so a Sheet and its screen agree. */
export const PORTRAIT_QUERY = '(orientation: portrait)'

/** Room for the chosen deck's contents beside the setup cards. */
export const DESKTOP_QUERY = '(min-width: 1024px) and (min-height: 600px)'

/** A phone on its side: the game screen's phone layout, the board and its controls in one screen. */
export const PHONE_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)'

/** A phone held upright, where the board does not fit: the game asks for it to be turned. */
export const PHONE_PORTRAIT_QUERY = '(orientation: portrait) and (max-width: 500px)'

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
