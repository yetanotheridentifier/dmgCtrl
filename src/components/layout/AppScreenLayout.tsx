const STAR_FIELD_IMAGE = `
  radial-gradient(1px 1px at 10% 20%, rgba(255,255,255,0.6) 0%, transparent 100%),
  radial-gradient(1px 1px at 25% 75%, rgba(255,255,255,0.4) 0%, transparent 100%),
  radial-gradient(1px 1px at 40% 35%, rgba(255,255,255,0.7) 0%, transparent 100%),
  radial-gradient(1px 1px at 55% 60%, rgba(255,255,255,0.3) 0%, transparent 100%),
  radial-gradient(1px 1px at 65% 15%, rgba(255,255,255,0.5) 0%, transparent 100%),
  radial-gradient(1px 1px at 75% 85%, rgba(255,255,255,0.6) 0%, transparent 100%),
  radial-gradient(1px 1px at 85% 40%, rgba(255,255,255,0.4) 0%, transparent 100%),
  radial-gradient(1px 1px at 90% 70%, rgba(255,255,255,0.5) 0%, transparent 100%),
  radial-gradient(1px 1px at 15% 90%, rgba(255,255,255,0.3) 0%, transparent 100%),
  radial-gradient(1px 1px at 50% 10%, rgba(255,255,255,0.6) 0%, transparent 100%),
  radial-gradient(2px 2px at 30% 50%, rgba(255,255,255,0.2) 0%, transparent 100%),
  radial-gradient(2px 2px at 70% 30%, rgba(255,255,255,0.15) 0%, transparent 100%)
`

interface Props {
  children: React.ReactNode
}

function AppScreenLayout({ children }: Props) {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <div
        data-testid="star-field"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: STAR_FIELD_IMAGE,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      <div data-testid="content-wrapper" style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxSizing: 'border-box',
        zIndex: 1,
      }}>
        {children}
      </div>
    </div>
  )
}

export default AppScreenLayout