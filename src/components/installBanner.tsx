import { ShareIcon, HomeScreenIcon, DotsIcon, ChevronDownIcon } from './icons'

interface Props {
  platform: 'ios' | 'android'
  onInstall: () => void
  onDismiss: () => void
}

const iconWrapStyle: React.CSSProperties = {
  display: 'inline-block',
  verticalAlign: 'middle',
  lineHeight: 1,
  fontSize: '1.1em',
}

function BulletRow({ icon, label }: { icon: React.ReactNode; label: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45em' }}>
      <span style={{ opacity: 0.6 }}>•</span>
      <span style={iconWrapStyle}>{icon}</span>
      <span>{label}</span>
    </div>
  )
}

function InstallBanner({ platform, onInstall, onDismiss }: Props) {
  return (
    <div
      role="region"
      aria-label="Install app"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        padding: 'clamp(0.7rem, 2vw, 1rem) clamp(0.75rem, 3vw, 1.25rem) calc(clamp(0.7rem, 2vw, 1rem) + env(safe-area-inset-bottom))',
        background: 'rgba(20, 20, 30, 0.97)',
        borderTop: '1px solid rgba(255,255,255,0.12)',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        color: '#fff',
        fontSize: 'clamp(0.9rem, 3vw, 1.1rem)',
        WebkitTextSizeAdjust: '100%',
      }}
    >
      <div style={{ flex: 1, lineHeight: 1.7 }}>
        <div>Install locally for the best experience:</div>
        {platform === 'ios' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.05em' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45em' }}>
              <span style={{ opacity: 0.6 }}>•</span>
              <span>Tap <span style={iconWrapStyle}><DotsIcon /></span> then</span>
            </div>
            <BulletRow icon={<ShareIcon />} label="Share" />
            <BulletRow icon={<ChevronDownIcon />} label="View More" />
            <BulletRow icon={<HomeScreenIcon />} label="Add to Home Screen" />
          </div>
        ) : (
          <button
            style={{
              marginTop: '0.35em',
              padding: '0.4rem 1.1rem',
              borderRadius: '6px',
              border: 'none',
              background: 'var(--color-force)',
              color: '#fff',
              fontSize: 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
            }}
            onClick={onInstall}
          >
            Install
          </button>
        )}
      </div>
      <button
        style={{
          flexShrink: 0,
          width: '2rem',
          height: '2rem',
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.25)',
          background: 'transparent',
          color: 'rgba(255,255,255,0.7)',
          fontSize: '1.1rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}

export default InstallBanner
