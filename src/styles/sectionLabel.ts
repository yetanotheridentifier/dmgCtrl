// The small uppercase label over a section, and the muted note text, on the SWU screens.
export const sectionLabelStyle = (color = 'var(--color-text-muted)'): React.CSSProperties => ({
  fontSize: '0.75rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color,
})

export const mutedStyle: React.CSSProperties = { fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--color-text-muted)' }
