import { formatTime } from '../../utils/formatTime'

interface Props {
  remaining: number
  /** data-testid for the wrapper element (default: "timer-display") */
  testId?: string
  /** Style overrides — spread after the component's own colour so callers
   *  control font-size, layout etc. without fighting specificity. */
  style?: React.CSSProperties
}

function timerColor(remaining: number): string {
  if (remaining <= 60) return 'var(--color-error)'
  if (remaining <= 300) return 'var(--color-warning)'
  return 'var(--color-text-muted)'
}

/**
 * Shared countdown display.
 * Renders `formatTime(remaining)` with amber/red colour thresholds:
 *   > 5:00 → --color-text-muted
 *   ≤ 5:00 → --color-warning
 *   ≤ 1:00 → --color-error
 */
export default function TimerDisplay({ remaining, testId = 'timer-display', style }: Props) {
  const formatted = formatTime(remaining)
  const colon = formatted.indexOf(':')
  const minutes = formatted.slice(0, colon)
  const seconds = formatted.slice(colon + 1)

  return (
    <div
      data-testid={testId}
      style={{ display: 'flex', alignItems: 'baseline', color: timerColor(remaining), ...style }}
    >
      {/* Right-align minutes in a fixed 2ch slot so the colon never shifts */}
      <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: '2ch', textAlign: 'right', display: 'inline-block' }}>
        {minutes}
      </span>
      <span>:</span>
      {/* Seconds are always 2 digits (padStart) — fixed width keeps right side stable */}
      <span style={{ fontVariantNumeric: 'tabular-nums', width: '2ch', display: 'inline-block' }}>
        {seconds}
      </span>
    </div>
  )
}
