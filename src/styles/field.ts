import type React from 'react'

// The style of every text field (input and textarea): spread it and override what differs. Its text
// is 16px because iOS zooms the page in when a smaller field takes focus, and stays zoomed, cutting
// off the screen's edges.
export const FIELD_STYLE: React.CSSProperties = {
  height: '44px', minWidth: 0, boxSizing: 'border-box', border: 'none', borderRadius: '12px', background: 'var(--color-surface-raised)',
  color: 'var(--color-text-primary)', fontFamily: 'inherit', fontSize: '16px', padding: '0 14px', outline: 'none',
}
