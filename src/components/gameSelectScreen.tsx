import type { ReactNode } from 'react'
import AppScreenLayout from './layout/appScreenLayout'
import { useOrientation } from '../hooks/useOrientation'
import { Button } from './shared/controls'
import type { Game } from '../utils/appStart'

interface Props {
  lastGame: Game | null
  onSelectSwu: () => void
  onSelectXwing: () => void
  onHelp: () => void
  onSettings: () => void
  // The install banner, under the tiles, when it is showing.
  banner?: ReactNode
}

// Both logos are drawn with the same on-screen area (pt²), so they carry the same visual weight
// whatever their shapes. Each width follows from this and the logo's aspect ratio (its native size).
const LOGO_AREA = 15_000

const TILES: { game: Game; label: string; logo: string; size: [number, number]; alt: string }[] = [
  { game: 'swu', label: 'Star Wars: Unlimited', logo: 'Star-Wars-Unlimited-logo-white.png', size: [959, 686], alt: 'Star Wars Unlimited' },
  { game: 'xwing', label: 'X-Wing', logo: 'Star-Wars-X-wing-logo.png', size: [1830, 750], alt: 'Star Wars X-Wing' },
]

const logoWidth = ([width, height]: [number, number]) => Math.round(Math.sqrt(LOGO_AREA * width / height))

function GameSelectScreen({ lastGame, onSelectSwu, onSelectXwing, onHelp, onSettings, banner }: Props) {
  const { isPortrait } = useOrientation()
  const onSelect: Record<Game, () => void> = { swu: onSelectSwu, xwing: onSelectXwing }

  return (
    <AppScreenLayout>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: banner ? '12px' : '16px', padding: '16px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '44px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isPortrait ? '8px' : '10px' }}>
            <img
              data-testid="app-icon"
              src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`}
              alt=""
              style={{ width: isPortrait ? '32px' : '36px', height: isPortrait ? '32px' : '36px' }}
            />
            <h1 style={{ margin: 0, fontSize: isPortrait ? '22px' : '26px', fontWeight: 200, letterSpacing: '0.15em', color: 'var(--color-text-primary)' }}>
              dmgCtrl
            </h1>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button onClick={onHelp} style={{ padding: isPortrait ? '0 14px' : '0 18px' }}>Help</Button>
            <Button onClick={onSettings} style={{ padding: isPortrait ? '0 14px' : '0 18px' }}>Settings</Button>
          </div>
        </div>

        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gap: '16px',
          ...(isPortrait ? { gridTemplateRows: '1fr 1fr' } : { gridTemplateColumns: '1fr 1fr' }),
        }}>
          {TILES.map(({ game, label, logo, size, alt }) => {
            const last = game === lastGame
            return (
              <button
                key={game}
                type="button"
                aria-label={last ? `${label}, last played` : label}
                onClick={onSelect[game]}
                style={{
                  position: 'relative',
                  minHeight: 0,
                  border: 'none',
                  borderRadius: '12px',
                  background: last ? 'var(--color-tonal)' : 'var(--color-surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: '32px 24px',
                  overflow: 'hidden',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {last && (
                  <span style={{ position: 'absolute', left: '14px', top: '12px', fontSize: '12px', letterSpacing: '0.14em', color: 'var(--color-tonal-text)', fontFamily: 'inherit' }}>
                    LAST PLAYED
                  </span>
                )}
                <img
                  src={`${import.meta.env.BASE_URL}${logo}`}
                  alt={alt}
                  style={{ width: `${logoWidth(size)}px`, maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              </button>
            )
          })}
        </div>

        {banner}
      </div>
    </AppScreenLayout>
  )
}

export default GameSelectScreen
