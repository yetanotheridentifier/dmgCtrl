interface Props {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  values?: number[]
  formatValue?: (v: number) => string
  onChange: (v: number) => void
  testId: string
}

const btnStyle = (disabled: boolean): React.CSSProperties => ({
  background: 'transparent',
  border: `1px solid ${disabled ? 'var(--color-ui-border-muted)' : 'var(--color-ui-border)'}`,
  borderRadius: '4px',
  color: disabled ? 'var(--color-text-muted)' : '#ffffff',
  cursor: disabled ? 'default' : 'pointer',
  fontSize: '1em',
  width: '2em',
  height: '2em',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
  opacity: disabled ? 0.4 : 1,
})

const valueStyle: React.CSSProperties = {
  minWidth: '2.5em',
  textAlign: 'center',
  fontSize: '0.95em',
  color: 'var(--color-text-muted)',
  letterSpacing: '0.03em',
}

/**
 * Shared [−] value [+] stepper for timer duration settings.
 * Used by SWU (bo1/bo3) and X-Wing timer settings.
 *
 * Two navigation modes:
 * - `min`/`max`/`step` (default): uniform step navigation within a range.
 * - `values` list: navigate through an explicit ordered list, supporting
 *   non-uniform steps (e.g. a test value of 5.5 minutes alongside integer steps).
 *
 * Display is controlled by the optional `formatValue` prop; when absent the
 * default is `"${v} min"`.
 */
export default function TimerStepper({ label, value, min, max, step, values, formatValue, onChange, testId }: Props) {
  const display = formatValue ? formatValue(value) : `${value} min`

  let atMin: boolean
  let atMax: boolean
  let handleDecrement: () => void
  let handleIncrement: () => void

  if (values && values.length > 0) {
    const idx = values.indexOf(value)
    atMin = idx <= 0
    atMax = idx >= values.length - 1

    handleDecrement = () => {
      if (idx > 0) onChange(values[idx - 1])
    }
    handleIncrement = () => {
      if (idx < values.length - 1) onChange(values[idx + 1])
    }
  } else {
    const lo = min ?? 0
    const hi = max ?? 100
    const inc = step ?? 1
    atMin = value <= lo
    atMax = value >= hi

    handleDecrement = () => onChange(value - inc)
    handleIncrement = () => onChange(value + inc)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.3em 0', gap: '0.5em' }}>
      <span style={{ fontSize: '0.85em', color: 'var(--color-text-muted)', flex: 2 }}>{label}</span>
      <div data-testid={testId} style={{ display: 'flex', alignItems: 'center', gap: '0.4em' }}>
        <button
          aria-label="−"
          disabled={atMin}
          onClick={handleDecrement}
          style={btnStyle(atMin)}
        >−</button>
        <span style={valueStyle}>{display}</span>
        <button
          aria-label="+"
          disabled={atMax}
          onClick={handleIncrement}
          style={btnStyle(atMax)}
        >+</button>
      </div>
    </div>
  )
}
