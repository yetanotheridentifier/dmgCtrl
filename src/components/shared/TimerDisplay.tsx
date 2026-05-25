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
  return (
    <div
      data-testid={testId}
      style={{ color: timerColor(remaining), ...style }}
    >
      {formatTime(remaining)}
    </div>
  )
}
