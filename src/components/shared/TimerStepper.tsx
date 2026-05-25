interface Props {
  label: string
  value: number
  min: number
  max: number
  step: number
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
  flex: 1,
  textAlign: 'center',
  fontSize: '0.95em',
  color: 'var(--color-text-muted)',
  letterSpacing: '0.03em',
}

/**
 * Shared [−] value [+] stepper for timer duration settings.
 * Used by SWU (bo1/bo3) and X-Wing timer settings.
 */
export default function TimerStepper({ label, value, min, max, step, onChange, testId }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.3em 0', gap: '0.5em' }}>
      <span style={{ fontSize: '0.85em', color: 'var(--color-text-muted)', flex: 2 }}>{label}</span>
      <div data-testid={testId} style={{ display: 'flex', alignItems: 'center', gap: '0.4em' }}>
        <button
          aria-label="−"
          disabled={value <= min}
          onClick={() => onChange(value - step)}
          style={btnStyle(value <= min)}
        >−</button>
        <span style={valueStyle}>{value} min</span>
        <button
          aria-label="+"
          disabled={value >= max}
          onClick={() => onChange(value + step)}
          style={btnStyle(value >= max)}
        >+</button>
      </div>
    </div>
  )
}
