import { useState } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import { BackIcon, HelpIcon } from './icons'
import type { FavouriteBase } from '../hooks/useFavourites'
import TimerStepper from './shared/timerStepper'

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

type ForceTokenDisplay = 'always-on' | 'lof-only' | 'always-off'
type Tab = 'general' | 'swu' | 'xwing'
type StartScreen = 'gameSelect' | 'swu' | 'xwing'

interface Props {
  defaultTab: Tab
  useHyperspace: boolean
  forceTokenDisplay: ForceTokenDisplay
  enableEpicActions: boolean
  enableWakeLock: boolean
  enableActionLog: boolean
  enableFavourites: boolean
  enableCompetitiveMode: boolean
  bo1TimerMinutes: number
  bo3TimerMinutes: number
  xwingTimerMinutes: number
  meleePlayerGuid: string
  favourites: FavouriteBase[]
  onUseHyperspaceChange: (v: boolean) => void
  onForceTokenDisplayChange: (v: ForceTokenDisplay) => void
  onEnableEpicActionsChange: (v: boolean) => void
  onEnableWakeLockChange: (v: boolean) => void
  onEnableActionLogChange: (v: boolean) => void
  onEnableFavouritesChange: (v: boolean) => void
  onEnableCompetitiveModeChange: (v: boolean) => void
  onBo1TimerChange: (v: number) => void
  onBo3TimerChange: (v: number) => void
  onXwingTimerChange: (v: number) => void
  onMeleePlayerGuidChange: (v: string) => void
  startScreen: StartScreen
  onStartScreenChange: (v: StartScreen) => void
  onRemoveFavourite: (key: string) => void
  onClearFavourites: () => void
  onBack: () => void
  onHelp: () => void
}

function SettingsScreenView({
  defaultTab,
  useHyperspace,
  forceTokenDisplay,
  enableEpicActions,
  enableWakeLock,
  enableActionLog,
  enableFavourites,
  enableCompetitiveMode,
  bo1TimerMinutes,
  bo3TimerMinutes,
  xwingTimerMinutes,
  meleePlayerGuid,
  favourites,
  onUseHyperspaceChange,
  onForceTokenDisplayChange,
  onEnableEpicActionsChange,
  onEnableWakeLockChange,
  onEnableActionLogChange,
  onEnableFavouritesChange,
  onEnableCompetitiveModeChange,
  onBo1TimerChange,
  onBo3TimerChange,
  onXwingTimerChange,
  onMeleePlayerGuidChange,
  startScreen,
  onStartScreenChange,
  onRemoveFavourite,
  onClearFavourites,
  onBack,
  onHelp,
}: Props) {
  const { vmin, isPortrait } = useOrientation()
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab)

  const scrollableColumn: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    paddingRight: '1rem',
    paddingBottom: '5vw',
  }

  // ── Tab bar ───────────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'swu', label: 'SWU' },
    { id: 'xwing', label: 'X-Wing' },
  ]

  // Portrait: horizontal bar across the top
  // Landscape: vertical sidebar on the left
  const tabBar = (
    <div
      role="tablist"
      style={isPortrait ? {
        display: 'flex',
        flexShrink: 0,
        borderBottom: '1px solid rgba(107, 114, 128, 0.3)',
        marginBottom: '1.5vh',
      } : {
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        alignItems: 'center',
        borderRight: '1px solid rgba(107, 114, 128, 0.3)',
        paddingTop: '0.5vh',
        gap: '0.5vh',
      }}
    >
      {tabs.map(({ id, label }) => {
        const isActive = activeTab === id
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            onClick={() => setActiveTab(id)}
            style={isPortrait ? {
              flex: 1,
              background: 'transparent',
              border: 'none',
              borderBottom: isActive
                ? '2px solid var(--color-accent)'
                : '2px solid transparent',
              color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              fontFamily: "'Segoe UI', Helvetica, Arial, sans-serif",
              fontWeight: isActive ? '400' : '300',
              fontSize: `clamp(0.85rem, ${vmin * 0.032}px, 1.05rem)`,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '0.75vh 0',
              marginBottom: '-1px',
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
              WebkitTapHighlightColor: 'transparent',
            } : {
              flex: 1,
              background: 'transparent',
              border: 'none',
              borderLeft: isActive
                ? '2px solid var(--color-accent)'
                : '2px solid transparent',
              color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              fontFamily: "'Segoe UI', Helvetica, Arial, sans-serif",
              fontWeight: isActive ? '400' : '300',
              fontSize: `clamp(0.75rem, ${vmin * 0.03}px, 0.9rem)`,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
              padding: '0.8vh 0.4vw',
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )

  // ── General tab ───────────────────────────────────────────────────────────

  const generalContent = (
    <>
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '2vw',
        padding: '1.5vh 0 0.5vh',
      }}>
        <label
          htmlFor="select-start-screen"
          style={{
            flex: 1,
            color: 'var(--color-text-primary)',
            fontWeight: '300',
            fontSize: `clamp(0.9rem, ${vmin * 0.035}px, 1.1rem)`,
            letterSpacing: '0.03em',
            cursor: 'pointer',
          }}
        >
          Start Screen
        </label>
        <select
          id="select-start-screen"
          aria-label="Start Screen"
          value={startScreen}
          onChange={e => onStartScreenChange(e.target.value as StartScreen)}
          style={{
            background: 'transparent',
            border: '2px solid var(--color-accent)',
            borderRadius: '12px',
            color: 'var(--color-text-primary)',
            fontSize: `clamp(0.8rem, ${vmin * 0.03}px, 1rem)`,
            padding: '0.3em 0.6em',
            cursor: 'pointer',
            flexShrink: 0,
            outline: 'none',
            boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
            WebkitAppearance: 'none',
          }}
        >
          <option value="gameSelect">Game Select</option>
          <option value="swu">SWU</option>
          <option value="xwing">X-Wing</option>
        </select>
      </div>
      <ToggleRow
        id="toggle-wake-lock"
        label="Enable Screen Wake Lock"
        subtitle="Keeps the screen on during play. May affect battery life."
        checked={enableWakeLock}
        onChange={onEnableWakeLockChange}
        vmin={vmin}
      />
      <ToggleRow
        id="toggle-action-log"
        label="Enable Action Log"
        subtitle="Shows a scrollable log of game actions with undo support. Also enables the round tracker."
        checked={enableActionLog}
        onChange={onEnableActionLogChange}
        vmin={vmin}
      />
    </>
  )

  // ── SWU tab — options column ──────────────────────────────────────────────

  const swuOptions = (
    <>
      <ToggleRow
        id="toggle-hyperspace"
        label="Use Hyperspace Art"
        checked={useHyperspace}
        onChange={onUseHyperspaceChange}
        vmin={vmin}
      />
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '2vw',
        padding: '1.5vh 0',
        borderBottom: '1px solid rgba(107, 114, 128, 0.3)',
      }}>
        <label
          htmlFor="select-force-token"
          style={{
            flex: 1,
            color: 'var(--color-text-primary)',
            fontWeight: '300',
            fontSize: `clamp(0.9rem, ${vmin * 0.035}px, 1.1rem)`,
            letterSpacing: '0.03em',
            cursor: 'pointer',
          }}
        >
          Force Token Display
        </label>
        <select
          id="select-force-token"
          aria-label="Force Token Display"
          value={forceTokenDisplay}
          onChange={e => onForceTokenDisplayChange(e.target.value as ForceTokenDisplay)}
          style={{
            background: 'transparent',
            border: '2px solid var(--color-accent)',
            borderRadius: '12px',
            color: 'var(--color-text-primary)',
            fontSize: `clamp(0.8rem, ${vmin * 0.03}px, 1rem)`,
            padding: '0.3em 0.6em',
            cursor: 'pointer',
            flexShrink: 0,
            outline: 'none',
            boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
            WebkitAppearance: 'none',
          }}
        >
          <option value="always-on">Always on</option>
          <option value="lof-only">LOF bases only</option>
          <option value="always-off">Always off</option>
        </select>
      </div>
      <ToggleRow
        id="toggle-epic-actions"
        label="Enable Epic Actions"
        checked={enableEpicActions}
        onChange={onEnableEpicActionsChange}
        vmin={vmin}
      />
      <ToggleRow
        id="toggle-competitive-mode"
        label="Enable Competitive Mode"
        subtitle="Beta feature. Adds a tournament mode selector to the setup screen."
        checked={enableCompetitiveMode}
        onChange={onEnableCompetitiveModeChange}
        vmin={vmin}
      />
      {enableCompetitiveMode && (
        <div style={{ paddingLeft: '0.5em' }}>
          <TimerStepper
            label="Bo1 Timer"
            value={bo1TimerMinutes}
            min={5}
            max={90}
            step={5}
            onChange={onBo1TimerChange}
            testId="bo1-timer-stepper"
          />
          <TimerStepper
            label="Bo3 Timer"
            value={bo3TimerMinutes}
            min={5}
            max={90}
            step={5}
            onChange={onBo3TimerChange}
            testId="bo3-timer-stepper"
          />
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '2vw',
            padding: '1.5vh 0 0.5vh',
            marginTop: '0.5vh',
          }}>
            <label
              htmlFor="input-melee-player-id"
              style={{
                flex: 1,
                color: 'var(--color-text-primary)',
                fontWeight: '300',
                fontSize: `clamp(0.9rem, ${vmin * 0.035}px, 1.1rem)`,
                letterSpacing: '0.03em',
                cursor: 'pointer',
              }}
            >
              Melee Player ID
            </label>
            <input
              id="input-melee-player-id"
              type="text"
              aria-label="Melee Player ID"
              value={meleePlayerGuid}
              onChange={e => onMeleePlayerGuidChange(e.target.value)}
              placeholder="Enter Player ID"
              style={{
                background: 'transparent',
                border: '2px solid var(--color-accent)',
                borderRadius: '12px',
                color: 'var(--color-text-primary)',
                fontWeight: '300',
                fontSize: `clamp(0.8rem, ${vmin * 0.03}px, 1rem)`,
                padding: '0.3em 0.6em',
                outline: 'none',
                flexShrink: 0,
                width: '45%',
                boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
              }}
            />
          </div>
        </div>
      )}
    </>
  )

  // ── SWU tab — favourites column ───────────────────────────────────────────

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

  // ── X-Wing tab ────────────────────────────────────────────────────────────

  const xwingContent = (
    <TimerStepper
      label="Game Timer"
      value={xwingTimerMinutes}
      values={[5.5, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]}
      formatValue={(v) => v === 5.5 ? '5:30 (test)' : `${v} min`}
      onChange={onXwingTimerChange}
      testId="xwing-timer-stepper"
    />
  )

  // ── Tab content ───────────────────────────────────────────────────────────

  let tabContent: React.ReactNode

  if (activeTab === 'general') {
    tabContent = (
      <div style={scrollableColumn}>
        {generalContent}
      </div>
    )
  } else if (activeTab === 'swu') {
    tabContent = (
      <div style={scrollableColumn}>
        {swuOptions}
        {favouritesSection}
      </div>
    )
  } else {
    tabContent = (
      <div style={scrollableColumn}>
        {xwingContent}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

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
        <>
          {tabBar}
          {tabContent}
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', gap: '2vw', overflow: 'hidden' }}>
          {tabBar}
          {tabContent}
        </div>
      )}

    </div>
  )
}

export default SettingsScreenView
