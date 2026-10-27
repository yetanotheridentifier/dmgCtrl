interface Props {
  children: React.ReactNode
}

function AppScreenLayout({ children }: Props) {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <div data-testid="content-wrapper" style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        paddingTop: 'var(--edge-top)',
        paddingRight: 'var(--edge-right)',
        paddingBottom: 'var(--edge-bottom)',
        paddingLeft: 'var(--edge-left)',
        boxSizing: 'border-box',
        zIndex: 1,
      }}>
        {children}
      </div>
    </div>
  )
}

export default AppScreenLayout