import type React from 'react'

/**
 * Shared visual style for vertical bar containers (initiative bar, score panel).
 * Spread this alongside position/sizing/padding in each view file.
 */
export const BAR_CONTAINER_STYLE: React.CSSProperties = {
  background: 'rgba(0,0,0,0.2)',
  border: '2px solid var(--color-ui-border)',
  borderRadius: '8px',
  boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
}

/**
 * Shared typographic style for bar labels (initiative toggle, score panel).
 * Matches the small uppercase labels used throughout the vertical bars.
 * Note: does not include pointerEvents — add that separately where needed.
 */
export const BAR_LABEL_STYLE: React.CSSProperties = {
  fontSize: 'clamp(0.35rem, 0.8vw, 0.55rem)',
  letterSpacing: '0.08em',
  fontWeight: 700,
  lineHeight: 1,
}
