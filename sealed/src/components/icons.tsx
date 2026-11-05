/*
 * The icons for the shared `IconButton`, as a set. `BackIcon`, `DotsIcon` and `LogIcon` are copies of
 * the PWA's (src/components/icons.tsx), kept to its shapes and sizes so the two apps' headers match:
 * they size off the button (a percentage, or 1em of its 22px). Copied rather than imported: the PWA's
 * icons are not among its shared controls.
 */
export function BackIcon() {
  return (
    <svg width="70%" height="70%" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M15.5 5L7 12L15.5 19Z" />
    </svg>
  )
}

/** The game's Log button: a copy of the PWA's `LogIcon` (src/components/icons.tsx). */
export function LogIcon() {
  return (
    <svg width="65%" height="65%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="3" y1="7" x2="21" y2="7"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="17" x2="21" y2="17"/>
    </svg>
  )
}

/** A prompt's ×, for the shared `IconButton`: sized off the button like the icons above. */
export function CloseIcon() {
  return (
    <svg width="45%" height="45%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** A warning's mark, a ring with a stroke and a dot, sized by the caller and coloured by its text. */
export function AlertIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="flex-none">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.5" />
    </svg>
  )
}

export function DotsIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}
