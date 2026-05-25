import AppScreenLayout from './appScreenLayout'
import { BackIcon } from '../icons'

interface Props {
  onBack: () => void
}

export default function RotatePrompt({ onBack }: Props) {
  return (
    <AppScreenLayout>
      <button
        onClick={onBack}
        aria-label="Back"
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top) + 5vw)',
          left: 'calc(env(safe-area-inset-left) + 5vw)',
          width: '5vw',
          height: '5vw',
          minWidth: '36px',
          minHeight: '36px',
          background: 'transparent',
          border: '2px solid var(--color-ui-border)',
          borderRadius: '8px',
          color: 'var(--color-ui-border-muted)',
          fontSize: 'clamp(0.8rem, 2vw, 1.2rem)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          WebkitTapHighlightColor: 'transparent',
          boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
        }}
      >
        <BackIcon />
      </button>
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2rem',
        zIndex: 1,
      }}>
        <div style={{ fontSize: '3rem', color: 'var(--color-accent)' }}>↻</div>
        <p style={{
          color: 'var(--color-text-primary)',
          fontWeight: '300',
          fontSize: 'clamp(1rem, 5vw, 1.4rem)',
          letterSpacing: '0.05em',
          margin: 0,
          textAlign: 'center',
          padding: '0 10vw',
        }}>
          Please rotate to landscape
        </p>
      </div>
    </AppScreenLayout>
  )
}
