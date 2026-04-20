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