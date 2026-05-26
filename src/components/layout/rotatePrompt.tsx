import AppScreenLayout from './appScreenLayout'
import { BackIcon } from '../icons'
import { NAV_BTN_STYLE } from '../../styles/navButton'

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
          ...NAV_BTN_STYLE,
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top) + 2vw)',
          left: 'calc(env(safe-area-inset-left) + 2vw)',
          zIndex: 10,
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
