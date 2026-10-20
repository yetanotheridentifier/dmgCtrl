import type { XwingPilot } from '../../utils/parseXwsText'
import { displayPilots } from '../../utils/displayPilots'

function importErrorMessage(code: string): string {
  switch (code) {
    case 'too-few-ships': return 'List must contain at least 3 ships.'
    case 'too-many-ships': return 'List must contain no more than 8 ships.'
    case 'invalid-total': return 'Points total must be between 46 and 50.'
    case 'invalid-format': return "Couldn't read list — check you've pasted the XWS export."
    default: return 'Invalid list.'
  }
}

// Textarea base style. font-size: 16px minimum prevents iOS zoom on focus.
// word-break: break-all forces long JSON strings to wrap instead of scrolling horizontally.
const textareaStyle = (small = false, fill = false): React.CSSProperties => ({
  width: '100%',
  ...(fill
    ? { flex: 1, minHeight: 0, resize: 'none' }
    : { minHeight: small ? '14vh' : '25vh', resize: 'vertical' }),
  padding: small ? '0.8vh 1.5vw' : '1.5vh 2vw',
  fontSize: '16px',
  fontWeight: '300',
  background: 'transparent',
  border: '2px solid var(--color-accent)',
  borderRadius: '12px',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
  boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
  wordBreak: 'break-all',
})

export function PilotList({ pilots, testId, small }: { pilots: XwingPilot[], testId: string, small: boolean }) {
  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: small ? '0.4vh' : '0.6vh' }}>
      {displayPilots(pilots).map((p, i) => (
        <div key={i} style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: small ? 'clamp(0.6rem, 1.4vw, 0.75rem)' : 'clamp(0.7rem, 2.5vw, 0.9rem)',
          fontWeight: '300',
          color: 'var(--color-text-muted)',
          letterSpacing: '0.04em',
        }}>
          <span>{p.displayName} - {p.ship}</span>
          <span>{p.points}</span>
        </div>
      ))}
    </div>
  )
}


export function TextareaField({ testId, errorTestId, value, onChange, error, small, fill }: {
  testId: string
  errorTestId: string
  value: string
  onChange: (v: string) => void
  error: string | null
  small: boolean
  fill?: boolean
}) {
  const hasError = error !== null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: fill ? 1 : undefined, minHeight: fill ? 0 : undefined }}>
      <textarea
        data-testid={testId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Paste XWS JSON"
        style={{
          ...textareaStyle(small, fill),
          ...(hasError ? {
            border: '2px solid var(--color-error)',
            borderBottom: 'none',
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            boxShadow: 'none',
          } : {}),
        }}
      />
      {hasError && (
        <div style={{
          borderLeft: '2px solid var(--color-error)',
          borderRight: '2px solid var(--color-error)',
          borderBottom: '2px solid var(--color-error)',
          borderRadius: '0 0 12px 12px',
          padding: small ? '0.4vh 1.5vw 0.5vh' : '0.5vh 2vw 0.7vh',
        }}>
          <p data-testid={errorTestId} style={{
            color: 'var(--color-error)',
            fontWeight: '300',
            fontSize: small ? 'clamp(0.55rem, 1.4vw, 0.7rem)' : 'clamp(0.6rem, 2vw, 0.8rem)',
            margin: 0,
            textAlign: 'center',
            textShadow: '0 1px 4px rgba(0,0,0,0.9)',
          }}>
            {importErrorMessage(error!)}
          </p>
        </div>
      )}
    </div>
  )
}
