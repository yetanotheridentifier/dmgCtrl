import type { TargetIntent } from '../engine/types'

/** The edge highlights a card can carry (`data-highlight`), face up or face down. */
export type Highlight = 'accent' | 'accent-dim' | 'green' | 'red' | 'yellow' | 'white'

const OUTLINE: Record<Highlight, string> = {
  accent: '2px solid var(--color-accent)',
  green: '2px solid var(--color-green)',
  red: '2px solid var(--color-red)',
  yellow: '2px solid var(--color-yellow)',
  white: '2px solid var(--color-ink)',
  'accent-dim': '2px solid rgba(79, 195, 247, 0.55)',
}

/** A highlight hugs the card: a 2px line straddling its edge (1px in, 1px out). */
export function highlightOutline(highlight: Highlight | undefined): { outline?: string; outlineOffset?: string } {
  return highlight ? { outline: OUTLINE[highlight], outlineOffset: '-1px' } : {}
}

/**
 * A target's highlight says what the effect does to it: green helps, red harms, yellow is cunning
 * (exhaust, capture, return, take control), white attaches a real upgrade card. Blue (accent) stays
 * selection. A target with no stated intent is an attack, so red.
 */
const INTENT_HIGHLIGHT: Record<TargetIntent, Highlight> = { help: 'green', harm: 'red', cunning: 'yellow', attach: 'white' }

export const intentHighlight = (intent: TargetIntent | undefined): Highlight => INTENT_HIGHLIGHT[intent ?? 'harm']
