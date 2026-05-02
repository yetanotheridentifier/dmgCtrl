import { useState } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import { BackIcon, HelpIcon } from './icons'
import type { FavouriteBase } from '../hooks/useFavourites'

interface ToggleRowProps {
  id: string
  label: string
  subtitle?: string
  checked: boolean
  onChange: (value: boolean) => void
  vmin: number
}

function ToggleRow({ id, label, subtitle, checked, onChange, vmin }: ToggleRowProps) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '2vw',
        padding: '1.5vh 0',
        borderBottom: '1px solid rgba(107, 114, 128, 0.3)',
        cursor: 'pointer',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{
          color: 'var(--color-text-primary)',
          fontWeight: '300',
          fontSize: `clamp(0.9rem, ${vmin * 0.035}px, 1.1rem)`,
          letterSpacing: '0.03em',
        }}>
          {label}
        </div>
        {subtitle && (
          <div style={{
            color: 'var(--color-text-muted)',
            fontWeight: '300',
            fontSize: `clamp(0.75rem, ${vmin * 0.028}px, 0.9rem)`,
            marginTop: '0.25em',
          }}>
            {subtitle}
          </div>
        )}
      </div>

      {/* Toggle track */}
      <div style={{
        position: 'relative',
        flexShrink: 0,
        width: '44px',
        height: '24px',
        background: checked ? 'var(--color-accent)' : '#374151',
        borderRadius: '12px',
        transition: 'background 0.2s',
      }}>
        {/* Toggle thumb */}
        <div style={{
          position: 'absolute',
          top: '2px',
          left: checked ? '22px' : '2px',
          width: '20px',
          height: '20px',
          background: '#ffffff',
          borderRadius: '50%',
          transition: 'left 0.2s',
          pointerEvents: 'none',
        }} />
        {/* Hidden native checkbox — accessible to testing and keyboard */}
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          aria-label={label}
          style={{
            position: 'absolute',
            opacity: 0,
            width: '100%',
            height: '100%',
            margin: 0,
            cursor: 'pointer',
          }}
        />
      </div>
    </label>
  )
}

const buttonStyle = (vmin: number): React.CSSProperties => ({
  flexShrink: 0,
  width: '5vw',
  height: '5vw',
  minWidth: '36px',
  minHeight: '36px',
  background: 'transparent',
  border: '2px solid var(--color-ui-border)',
  borderRadius: '8px',
  color: 'var(--color-ui-border-muted)',
  fontSize: `clamp(0.8rem, ${vmin * 0.02}px, 1.2rem)`,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
  boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
})

const smallButtonStyle: React.CSSProperties = {
  padding: '0.4em 0.8em',
  background: 'transparent',
  border: '1px solid rgba(107, 114, 128, 0.5)',
  borderRadius: '6px',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
}

interface Props {
  useHyperspace: boolean
  enableForceToken: boolean
  enableEpicActions: boolean
  enableWakeLock: boolean
  enableFavourites: boolean
  favourites: FavouriteBase[]
  onUseHyperspaceChange: (v: boolean) => void
  onEnableForceTokenChange: (v: boolean) => void
  onEnableEpicActionsChange: (v: boolean) => void
  onEnableWakeLockChange: (v: boolean) => void
  onEnableFavouritesChange: (v: boolean) => void
  onRemoveFavourite: (key: string) => void
  onClearFavourites: () => void
  onBack: () => void
  onHelp: () => void
}

function SwuSettingsScreenView({
  useHyperspace,
  enableForceToken,
  enableEpicActions,
  enableWakeLock,
  enableFavourites,
  favourites,
  onUseHyperspaceChange,
  onEnableForceTokenChange,
  onEnableEpicActionsChange,
  onEnableWakeLockChange,
  onEnableFavouritesChange,
  onRemoveFavourite,
  onClearFavourites,
  onBack,
  onHelp,
}: Props) {
  const { vmin, isPortrait } = useOrientation()
  const [confirmingClear, setConfirmingClear] = useState(false)

  const generalToggles = (
    <>
      <ToggleRow
        id="toggle-hyperspace"
        label="Use Hyperspace Art"
        checked={useHyperspace}
        onChange={onUseHyperspaceChange}
        vmin={vmin}
      />
      <ToggleRow
        id="toggle-force-token"
        label="Enable Force Token"
        checked={enableForceToken}
        onChange={onEnableForceTokenChange}
        vmin={vmin}
      />
      <ToggleRow
        id="toggle-epic-actions"
        label="Enable Epic Actions"
        checked={enableEpicActions}
        onChange={onEnableEpicActionsChange}
        vmin={vmin}
      />
      <ToggleRow
        id="toggle-wake-lock"
        label="Enable Screen Wake Lock"
        subtitle="Keeps the screen on during play. May affect battery life."
        checked={enableWakeLock}
        onChange={onEnableWakeLockChange}
        vmin={vmin}
      />
    </>
  )

  const favouritesSection = (
    <>
      <ToggleRow
        id="toggle-favourites"
        label="Enable Favourites"
        checked={enableFavourites}
        onChange={onEnableFavouritesChange}
        vmin={vmin}
      />
      {enableFavourites && (
        <div style={{
          marginLeft: '0.5em',
          paddingLeft: '1em',
          borderLeft: '2px solid rgba(var(--color-accent-rgb), 0.35)',
          marginTop: '0.5vh',
        }}>
          {favourites.length === 0 ? (
            <div style={{
              color: 'var(--color-text-muted)',
              fontWeight: '300',
              fontSize: `clamp(0.85rem, ${vmin * 0.032}px, 1rem)`,
              padding: '1vh 0',
            }}>
              No favourites saved
            </div>
          ) : (
            <>
              {favourites.map(fav => (
                <div key={fav.key} style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '2vw',
                  padding: '1vh 0',
                  borderBottom: '1px solid rgba(107, 114, 128, 0.15)',
                }}>
                  <span style={{
                    flex: 1,
                    color: 'var(--color-text-primary)',
                    fontWeight: '300',
                    fontSize: `clamp(0.85rem, ${vmin * 0.032}px, 1rem)`,
                  }}>
                    {fav.set}: {fav.name} — {fav.hp}HP ({fav.aspect})
                  </span>
                  <button
                    onClick={() => onRemoveFavourite(fav.key)}
                    aria-label="Remove"
                    style={{
                      ...smallButtonStyle,
                      fontSize: `clamp(0.75rem, ${vmin * 0.028}px, 0.9rem)`,
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}

              <div style={{ marginTop: '1.5vh', display: 'flex', gap: '1.5vw' }}>
                {!confirmingClear ? (
                  <button
                    onClick={() => setConfirmingClear(true)}
                    style={{
                      ...smallButtonStyle,
                      fontSize: `clamp(0.75rem, ${vmin * 0.028}px, 0.9rem)`,
                    }}
                  >
                    Clear All
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => { onClearFavourites(); setConfirmingClear(false) }}
                      style={{
                        ...smallButtonStyle,
                        border: '1px solid var(--color-accent)',
                        color: 'var(--color-accent)',
                        fontSize: `clamp(0.75rem, ${vmin * 0.028}px, 0.9rem)`,
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmingClear(false)}
                      style={{
                        ...smallButtonStyle,
                        fontSize: `clamp(0.75rem, ${vmin * 0.028}px, 0.9rem)`,
                      }}
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )

  const scrollableColumn: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    paddingBottom: '5vw',
  }

  return (
    <div key={isPortrait ? 'portrait' : 'landscape'} style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      padding: '5vw 5vw 0',
      boxSizing: 'border-box',
      fontFamily: "'Segoe UI', Helvetica, Arial, sans-serif",
      WebkitTextSizeAdjust: '100%',
    }}>

      {/* Header row */}
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '3vw',
        paddingBottom: '2vh',
        flexShrink: 0,
      }}>
        <button onClick={onBack} aria-label="Back" style={buttonStyle(vmin)}>
          <BackIcon />
        </button>

        <img
          src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`}
          alt="dmgCtrl"
          style={{ height: `clamp(1.8rem, ${vmin * 0.08}px, 3rem)`, width: 'auto', flexShrink: 0 }}
        />

        <h1 style={{
          flex: 1,
          color: 'var(--color-text-primary)',
          fontWeight: '200',
          fontSize: `clamp(1.8rem, ${vmin * 0.08}px, 3rem)`,
          letterSpacing: '0.15em',
          margin: 0,
          lineHeight: 0.8,
        }}>
          Settings
        </h1>

        <button onClick={onHelp} aria-label="Help" style={buttonStyle(vmin)}>
          <HelpIcon />
        </button>
      </div>

      {isPortrait ? (
        <div style={scrollableColumn}>
          {generalToggles}
          {favouritesSection}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', gap: '4vw', overflow: 'hidden' }}>
          <div role="group" aria-label="General settings" style={scrollableColumn}>
            {generalToggles}
          </div>
          <div role="group" aria-label="Favourites settings" style={scrollableColumn}>
            {favouritesSection}
          </div>
        </div>
      )}

    </div>
  )
}

export default SwuSettingsScreenView