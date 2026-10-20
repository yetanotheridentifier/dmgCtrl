import type React from 'react'

// Form styles shared by the X-Wing setup and lists screens. `small` is the landscape sizing.

export const labelStyle = (small = false): React.CSSProperties => ({
  color: 'var(--color-accent)',
  fontWeight: '300',
  fontSize: small ? 'clamp(0.8rem, 3vw, 1rem)' : 'clamp(0.9rem, 4vw, 1.2rem)',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  flexShrink: 0,
})

export const submitButtonStyle = (small = false): React.CSSProperties => ({
  // Portrait matches the nav buttons' 5vw / 36px square footprint; landscape unchanged (8vh / 44px).
  // Inner padding is kept in both orientations so the %-sized icons render at a consistent size.
  width: small ? '8vh' : '5vw',
  height: small ? undefined : '5vw',
  minWidth: small ? '44px' : '36px',
  minHeight: small ? '44px' : '36px',
  flexShrink: 0,
  padding: '0.8vh 1.5vw',
  fontSize: small ? 'clamp(1rem, 3vh, 1.8rem)' : 'clamp(1rem, 3vw, 1.8rem)',
  fontWeight: '300',
  background: 'transparent',
  color: 'var(--color-text-primary)',
  border: '2px solid var(--color-text-primary)',
  borderRadius: '12px',
  cursor: 'pointer',
  boxShadow: '0 0 12px rgba(255, 255, 255, 0.2)',
  WebkitTapHighlightColor: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
})

export const squadNameInputStyle = (small = false): React.CSSProperties => ({
  flex: 1,
  padding: small ? '0.8vh 1.5vw' : '0 2vw',
  fontSize: small ? 'clamp(0.75rem, 1.8vw, 0.9rem)' : 'clamp(0.9rem, 3vw, 1.2rem)',
  // Matches selectStyle so the read-only name field lines up with the star button (portrait 5vw/36px, landscape 8vh/44px).
  height: small ? '8vh' : '5vw',
  minHeight: small ? '44px' : '36px',
  fontWeight: '300',
  background: 'transparent',
  border: '2px solid var(--color-accent)',
  borderRadius: '12px',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box' as const,
  // Reset the native appearance (like selectStyle) so iOS/WebKit lets the input stretch to
  // width: 100% inside the grid cell; minWidth: 0 lets it fill rather than sit at its intrinsic size.
  WebkitAppearance: 'none',
  minWidth: 0,
  cursor: 'default',
  width: '100%',
})

export const overwriteCancelStyle = (small = false): React.CSSProperties => ({
  background: 'transparent',
  border: '1px solid rgba(107, 114, 128, 0.5)',
  borderRadius: '8px',
  color: 'var(--color-text-muted)',
  fontSize: small ? 'clamp(0.6rem, 1.4vw, 0.75rem)' : 'clamp(0.7rem, 2.5vw, 0.9rem)',
  padding: small ? '0.4vh 0.8vw' : '0.8vh 1.5vw',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
})
