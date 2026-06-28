import AppScreenLayout from './layout/appScreenLayout'
import { useOrientation } from '../hooks/useOrientation'
import { CogIcon } from './icons'
import { NAV_BTN_STYLE } from '../styles/navButton'

interface Props {
  onSelectSwu: () => void
  onSelectXwing: () => void
  onSettings: () => void
}

function GameSelectScreen({ onSelectSwu, onSelectXwing, onSettings }: Props) {
  const { isPortrait } = useOrientation()

  const buttonBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.04)',
    border: '2px solid var(--color-accent)',
    borderRadius: '16px',
    cursor: 'pointer',
    padding: '64px',
    boxSizing: 'border-box',
    boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
    width: 'min(65vmin, 300px)',
    height: 'min(65vmin, 300px)',
    flexShrink: 0,
  }

  return (
    <AppScreenLayout>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: isPortrait ? '2vw' : '2vw 2vw 3vw',
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
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: isPortrait ? '2vw' : '1vw' }}>
            <img
              src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`}
              alt="dmgCtrl"
              style={{ width: '5vw', height: '5vw', minWidth: '36px', minHeight: '36px', objectFit: 'contain' }}
            />
            <h1 style={{
              color: 'var(--color-text-primary)',
              fontWeight: '200',
              fontSize: isPortrait ? 'clamp(1.8rem, 8vw, 3rem)' : 'clamp(1.2rem, 4vw, 1.8rem)',
              letterSpacing: '0.15em',
              margin: 0,
              lineHeight: 0.8,
            }}>
              dmgCtrl
            </h1>
          </div>

          <button
            onClick={onSettings}
            aria-label="Settings"
            style={NAV_BTN_STYLE}
          >
            <CogIcon />
          </button>
        </div>

        {/* Game buttons */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            display: 'flex',
            flexDirection: isPortrait ? 'column' : 'row',
            gap: 'clamp(12px, 4vw, 24px)',
          }}>
            <button
              onClick={onSelectSwu}
              aria-label="Star Wars Unlimited"
              style={buttonBase}
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
              style={buttonBase}
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

export default GameSelectScreen
