import type { TargetIntent } from '../engine/types'

/** The edge highlights a `CardFace` can carry (`data-highlight`). */
export type Highlight = 'accent' | 'accent-dim' | 'green' | 'red' | 'yellow' | 'white'

/**
 * A target's highlight says what the effect does to it: green helps, red harms, yellow is cunning
 * (exhaust, capture, return, take control), white attaches a real upgrade card. Blue (accent) stays
 * selection. A target with no stated intent is an attack, so red.
 */
const INTENT_HIGHLIGHT: Record<TargetIntent, Highlight> = { help: 'green', harm: 'red', cunning: 'yellow', attach: 'white' }

export const intentHighlight = (intent: TargetIntent | undefined): Highlight => INTENT_HIGHLIGHT[intent ?? 'harm']
