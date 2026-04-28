import { useOrientation } from '../hooks/useOrientation'
import { BackIcon, HelpIcon } from './icons'

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

interface Props {
  useHyperspace: boolean
  enableForceToken: boolean
  enableEpicActions: boolean
  enableWakeLock: boolean
  onUseHyperspaceChange: (v: boolean) => void
  onEnableForceTokenChange: (v: boolean) => void
  onEnableEpicActionsChange: (v: boolean) => void
  onEnableWakeLockChange: (v: boolean) => void
  onBack: () => void
  onHelp: () => void
}

function SwuSettingsScreenView({
  useHyperspace,
  enableForceToken,
  enableEpicActions,
  enableWakeLock,
  onUseHyperspaceChange,
  onEnableForceTokenChange,
  onEnableEpicActionsChange,
  onEnableWakeLockChange,
  onBack,
  onHelp,
}: Props) {
  const { vmin, isPortrait } = useOrientation()
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

      {/* Toggle list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        paddingBottom: '5vw',
      }}>
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
      </div>

    </div>
  )
}

export default SwuSettingsScreenView