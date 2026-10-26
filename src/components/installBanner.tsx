import { ShareIcon, HomeScreenIcon, DotsIcon, ChevronDownIcon } from './icons'
import { Button } from './shared/controls'

interface Props {
  platform: 'ios' | 'android'
  onInstall: () => void
  onDismiss: () => void
}

const stepStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '5px' }
const arrow = <li aria-hidden="true" style={{ color: 'var(--color-accent)' }}>›</li>

// One row: the browser's install prompt on Android, the Safari steps on iPhone (Safari offers no
// prompt). Where it sits is up to the screen: under the tiles on game select, over a setup screen.
function InstallBanner({ platform, onInstall, onDismiss }: Props) {
  return (
    <section
      aria-label="Install dmgCtrl"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: platform === 'ios' ? '12px' : '14px',
        minHeight: '72px',
        boxSizing: 'border-box',
        padding: '10px 14px',
        borderRadius: '12px',
        background: 'var(--color-surface-raised)',
        color: 'var(--color-text-primary)',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        WebkitTextSizeAdjust: '100%',
        flexShrink: 0,
      }}
    >
      <img src={`${import.meta.env.BASE_URL}dmgCtrl-icon-192.png`} alt="" style={{ width: '44px', height: '44px', borderRadius: '10px', flexShrink: 0 }} />
      {platform === 'ios' ? (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>Install dmgCtrl from Safari</div>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--color-tonal-text)' }}>
            <li style={stepStyle}>Tap <span role="img" aria-label="the three dots" style={{ display: 'flex' }}><DotsIcon /></span></li>
            {arrow}
            <li style={stepStyle}><ShareIcon />Share</li>
            {arrow}
            <li style={stepStyle}><ChevronDownIcon />View More</li>
            {arrow}
            <li style={stepStyle}><HomeScreenIcon />Add to Home Screen</li>
          </ol>
        </div>
      ) : (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontSize: '16px', fontWeight: 600 }}>Install dmgCtrl</div>
          <div style={{ fontSize: '13px', color: 'var(--color-text-body)' }}>Full screen, an icon on your home screen, and it works offline.</div>
        </div>
      )}
      <Button onClick={onDismiss} style={{ flexShrink: 0 }}>Not now</Button>
      {platform === 'android' && <Button variant="primary" onClick={onInstall} style={{ flexShrink: 0, fontSize: '0.95rem' }}>Install</Button>}
    </section>
  )
}

export default InstallBanner
