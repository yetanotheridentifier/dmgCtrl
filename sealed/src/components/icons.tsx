/**
 * The header chrome icons, as a set.
 *
 * They sit side by side in the game header, so they are drawn to one specification: a 24-unit
 * viewBox rendered at 16px (`h-4 w-4`), `strokeWidth` 2, round caps and joins, no fill. Keeping
 * them in one file is what makes a mismatch obvious. A new header icon belongs here rather than
 * beside the feature it opens, so it cannot drift and cannot drag that feature's imports into
 * the header (the help page pulls in the whole user guide).
 *
 * The cog and the question mark are the PWA's `CogIcon` and `HelpIcon` paths, so the two apps'
 * chrome matches. Copied rather than imported: the PWA is a separate package and the two are
 * deliberately kept apart (#482). The weights differ from the PWA's, which draws them finer.
 */

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  'aria-hidden': true,
  className: 'h-4 w-4',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export function BugIcon() {
  return (
    <svg {...ICON_PROPS}>
      {/* Antennae, then the shell, then three legs a side. */}
      <path d="M9 5 7.5 3M15 5 16.5 3" />
      <rect x="7.5" y="7" width="9" height="13" rx="4.5" />
      <path d="M7.5 11H4M7.5 15.5H3.5M8.5 19.5 6 21.5" />
      <path d="M16.5 11H20M16.5 15.5H20.5M15.5 19.5 18 21.5" />
    </svg>
  )
}

export function GearIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function HelpIcon() {
  return (
    <svg {...ICON_PROPS}>
      {/* The hook and the dot only: no ring, so it reads at 16px beside the other two.
          Drawn 1.5x the PWA's, about the centre of the box: a bug and a cog fill their
          viewBox, a question mark does not, so at the same scale it looked slighter than its
          neighbours. Scaling the artwork rather than the <svg> keeps the rendered size and the
          apparent stroke weight identical to the other two: stroke is in user units, so a
          larger render would have thickened it. */}
      <path d="M7.64 7.5a4.5 4.5 0 0 1 8.75 1.5c0 3-4.5 4.5-4.5 4.5" />
      <line x1="12" y1="19.5" x2="12.01" y2="19.5" />
    </svg>
  )
}
