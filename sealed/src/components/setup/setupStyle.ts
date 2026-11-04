import { NO_ASPECT } from '../../deckgen/randomDeck'

/** The small pieces of the setup screen's look its components share: kept apart so each stays a component file. */

/**
 * An aspect's icon. A copy of the PWA's `aspectIconSrc` (src/utils/baseAspect.ts), reading the copies
 * of its icons in this package's public/.
 */
export const aspectIconSrc = (aspect: string) => `${import.meta.env.BASE_URL}${aspect.toLowerCase()}.png`

/** A base aspect as the sheets and the opponent card name it. */
export const aspectName = (aspect: string) => (aspect === NO_ASPECT ? 'No aspect' : aspect)

/** The quiet line under a heading or beside a control, as the X-Wing setup screen sets it. */
export const mutedStyle: React.CSSProperties = { fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--color-text-muted)', margin: 0 }
