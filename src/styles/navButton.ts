import type React from 'react'

/**
 * Canonical style for all navigation icon buttons (Back, Help, Settings, Log, etc.)
 * across every screen. Dimensions are derived from the SWU and X-Wing game screens,
 * which are the visual reference.
 *
 * Usage: spread this object and add any overrides needed (e.g. position: 'absolute'
 * with top/left/right/bottom for game screens that use absolute layout).
 */
export const NAV_BTN_STYLE: React.CSSProperties = {
  flexShrink: 0,
  width: '5vw',
  height: '5vw',
  minWidth: '36px',
  minHeight: '36px',
  background: 'transparent',
  border: '2px solid var(--color-ui-border)',
  borderRadius: '8px',
  color: 'var(--color-ui-border-muted)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
  boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
}
