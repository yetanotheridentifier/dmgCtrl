// The small uppercase label over a section, and the muted note text, on the SWU screens.
export const sectionLabelStyle = (color = 'var(--color-text-muted)'): React.CSSProperties => ({
  fontSize: '0.75rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color,
})

export const mutedStyle: React.CSSProperties = { fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--color-text-muted)' }

// A base's name, and its set and HP under it, wherever setup shows a base: one line each, cut short
// with … when there is no room, so a long name never spills out of view or takes height from the art.
const oneLine: React.CSSProperties = { display: 'block', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
export const baseNameStyle: React.CSSProperties = { ...oneLine, fontSize: '0.95rem', lineHeight: 1.25 }
export const baseMetaStyle: React.CSSProperties = { ...oneLine, fontSize: '0.75rem', color: 'var(--color-text-body)' }
