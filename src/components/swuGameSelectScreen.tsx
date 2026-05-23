import AppScreenLayout from './layout/AppScreenLayout'
import { useOrientation } from '../hooks/useOrientation'
import { HelpIcon } from './icons'

interface Props {
  onSelectSwu: () => void
  onSelectXwing: () => void
  onHelp: () => void
}

function SwuGameSelectScreen({ onSelectSwu, onSelectXwing, onHelp }: Props) {
  const { isPortrait } = useOrientation()

  const buttonBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    aspectRatio: '1 / 1',
    background: 'rgba(255,255,255,0.04)',
    border: '2px solid var(--color-accent)',
    borderRadius: '16px',
    cursor: 'pointer',
    padding: '12%',
    boxSizing: 'border-box',
    boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
  }

  return (
    <AppScreenLayout>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: isPortrait ? '5vw' : '3vw 4vw 3vw',
        boxSizing: 'border-box',
        gap: isPortrait ? '2vh' : 'clamp(12px, 3vw, 20px)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: isPortrait ? '3vw' : '1vw' }}>
            <img
              src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`}
              alt="dmgCtrl"
              style={{ height: isPortrait ? 'clamp(1.8rem, 8vw, 3rem)' : 'clamp(1.2rem, 4vw, 1.8rem)', width: 'auto' }}
            />
            <h1 style={{
              color: 'var(--color-text-primary)',
              fontWeight: '200',
              fontSize: isPortrait ? 'clamp(1.8rem, 8vw, 3rem)' : 'clamp(1.2rem, 4vw, 1.8rem)',
              letterSpacing: '0.15em',
              margin: 0,
            }}>
              dmgCtrl
            </h1>
          </div>
          <button
            onClick={onHelp}
            aria-label="Help"
            style={{
              width: isPortrait ? '5vw' : '5vh',
              height: isPortrait ? '5vw' : '5vh',
              minWidth: '36px',
              minHeight: '36px',
              flexShrink: 0,
              background: 'transparent',
              border: '2px solid var(--color-ui-border)',
              borderRadius: '8px',
              color: 'var(--color-ui-border-muted)',
              fontSize: isPortrait ? 'clamp(0.8rem, 2vw, 1.2rem)' : 'clamp(0.8rem, 2vh, 1.2rem)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <HelpIcon />
          </button>
        </div>

        {/* Game buttons */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: isPortrait ? '0 10%' : '0 5%',
        }}>
          <div style={{
            display: 'flex',
            flexDirection: isPortrait ? 'column' : 'row',
            gap: 'clamp(12px, 4vw, 24px)',
            width: '100%',
            maxWidth: isPortrait ? '320px' : '640px',
          }}>
            <button
              onClick={onSelectSwu}
              aria-label="Star Wars Unlimited"
              style={{ ...buttonBase, flex: 1 }}
            >
              <img
                src={`${import.meta.env.BASE_URL}Star-Wars-Unlimited-logo-white.png`}
                alt="Star Wars Unlimited"
                style={{ width: '100%', height: 'auto', objectFit: 'contain' }}
              />
            </button>

            <button
              onClick={onSelectXwing}
              aria-label="Star Wars X-Wing"
              style={{ ...buttonBase, flex: 1 }}
            >
              <img
                src={`${import.meta.env.BASE_URL}Star-Wars-X-wing-logo.png`}
                alt="Star Wars X-Wing"
                style={{ width: '100%', height: 'auto', objectFit: 'contain' }}
              />
            </button>
          </div>
        </div>
      </div>
    </AppScreenLayout>
  )
}

export default SwuGameSelectScreen
