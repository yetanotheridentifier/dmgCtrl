import { useId } from 'react'

interface DisclosureProps {
  open: boolean
  onToggle: () => void
  /** What the row says while closed, beside the ▸ that turns as it opens. */
  summary: React.ReactNode
  children: React.ReactNode
  testId?: string
}

/**
 * A row on the surface fill that opens on a tap to show more beneath it, inside the same block:
 * a set's card counts in Card support, a topic in Help.
 */
export function Disclosure({ open, onToggle, summary, children, testId }: DisclosureProps) {
  const id = useId()
  return (
    <div data-testid={testId} style={{ flexShrink: 0, borderRadius: '12px', background: 'var(--color-surface)' }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={onToggle}
        style={{ width: '100%', minHeight: '44px', border: 'none', borderRadius: '12px', background: 'transparent', color: 'var(--color-text-primary)', padding: '0 14px', display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left', fontFamily: 'inherit', fontSize: '0.95rem', cursor: 'pointer' }}
      >
        {summary}
        <span aria-hidden="true" style={{ marginLeft: 'auto', color: 'var(--color-text-muted)', transform: open ? 'rotate(90deg)' : undefined }}>▸</span>
      </button>
      {open && <div id={id} style={{ padding: '0 14px 10px' }}>{children}</div>}
    </div>
  )
}
