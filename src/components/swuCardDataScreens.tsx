import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, WifiOffIcon } from './icons'
import { Button, IconButton } from './shared/controls'

// What SWU shows in place of its setup while it has no card data: the splash while the data is on
// its way, and the offline screen when it could not be fetched. Game select and X-Wing need no
// card data, so they never show either.

const centred: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
  boxSizing: 'border-box',
  color: 'var(--color-text-primary)',
  textAlign: 'center',
}

export function SwuSplash() {
  return (
    <AppScreenLayout>
      <div style={{ ...centred, gap: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <img src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`} alt="" style={{ width: '72px', height: '72px' }} />
          <div style={{ fontSize: '44px', fontWeight: 200, letterSpacing: '0.15em' }}>dmgCtrl</div>
        </div>
        <div role="progressbar" aria-label="Loading card data" style={{ width: '200px', height: '4px', borderRadius: '2px', background: 'var(--color-surface-raised)', overflow: 'hidden' }}>
          <div className="splash-progress" style={{ width: '45%', height: '4px', borderRadius: '2px', background: 'var(--color-accent)', animation: 'splash-progress 1.4s ease-in-out infinite' }} />
        </div>
        <div style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>Getting SWU card data</div>
      </div>
    </AppScreenLayout>
  )
}

interface OfflineProps {
  onRetry: () => void
  onPlayXwing: () => void
  onBack: () => void
}

export function SwuOffline({ onRetry, onPlayXwing, onBack }: OfflineProps) {
  return (
    <AppScreenLayout>
      <div style={{ position: 'absolute', left: '16px', top: '16px' }}>
        <IconButton label="Back to game select" onClick={onBack}><BackIcon /></IconButton>
      </div>
      <div style={{ ...centred, gap: '16px' }}>
        <span style={{ color: 'var(--color-text-muted)', display: 'flex' }}><WifiOffIcon /></span>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 300 }}>SWU needs a connection the first time</h1>
        <p style={{ margin: 0, maxWidth: '520px', fontSize: '15px', lineHeight: '22px', color: 'var(--color-text-body)' }}>
          It gets its card data once, then keeps it for playing offline. X-Wing works without a connection.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px', marginTop: '8px' }}>
          <Button variant="primary" onClick={onRetry} style={{ width: '180px', height: '52px' }}>Try again</Button>
          <Button onClick={onPlayXwing} style={{ width: '180px', height: '52px' }}>Play X-Wing</Button>
        </div>
      </div>
    </AppScreenLayout>
  )
}
