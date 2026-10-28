import type { Base } from '../hooks/useBases'
import type { MatchResult } from '../hooks/useMatch'

// Styles and words the one-player and two-player SWU game screens share (components: swuGamePieces.tsx).

export const CARD_NATURAL_WIDTH = 1560
export const CARD_NATURAL_HEIGHT = 1120
export const CARD_ASPECT_RATIO = CARD_NATURAL_WIDTH / CARD_NATURAL_HEIGHT

// Where a base prints its text box (the epic action), in percent of the card's height: its top border
// measures 62.6% to 62.8% on the printed art. The readout on the open art (Start, the damage and HP left)
// stands on a line just above it and grows upward, in the same place on every base, so it never covers
// an epic action's text. The shading behind the readout and the drag amount beside it follow it.
export const EPIC_TEXT_TOP = 62
export const READOUT_BOTTOM = EPIC_TEXT_TOP - 1
// Where the damage readout's middle falls, for the shading and the drag amount.
export const READOUT_MIDDLE = READOUT_BOTTOM - 15

export const RESULT_WORD: Record<MatchResult, string> = { won: 'won', lost: 'lost', drawn: 'drawn' }

// Whether a base has an epic action to mark: its text can be a passive ability instead.
export const hasEpicAction = (base: Base) => /epic action/i.test(base.epicAction)

// A size on the card: n hundredths of its height, given one hundredth as `unit`.
export const scaled = (unit: string, n: number) => `calc(${n} * ${unit})`

export const marginButton = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  width: '60px',
  height: '52px',
  flexShrink: 0,
  border: 'none',
  borderRadius: '12px',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '2px',
  background: 'var(--color-surface-raised)',
  color: 'var(--color-text-body)',
  ...extra,
})

export const DISABLED_BTN: React.CSSProperties = {
  background: 'var(--color-surface)',
  color: 'var(--color-text-disabled)',
  cursor: 'default',
  boxShadow: 'none',
}

// An initiative control, in one player and two: outlined until its side takes the initiative, then filled.
export const initiativeLook = (held: boolean): React.CSSProperties => (held
  ? { border: 'none', background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontWeight: 700 }
  : { border: '2px solid var(--color-surface-raised)', background: 'transparent', color: 'var(--color-text-muted)', fontWeight: 500 })

export const mutedText: React.CSSProperties = { fontSize: '0.85rem', lineHeight: 1.45, color: 'var(--color-text-muted)' }
