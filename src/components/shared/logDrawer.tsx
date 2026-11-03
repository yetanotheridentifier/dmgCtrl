import { Sheet } from './controls'
import type { HistoryEntry } from '../../hooks/useGameHistory'

// What the drawer shows of an entry: the snapshot stays with the screen that undoes it.
export type LogEntry = Omit<HistoryEntry<unknown>, 'snapshot'>

const MUTED_CAPS: React.CSSProperties = { fontSize: '11px', letterSpacing: '0.1em', color: 'var(--color-text-muted)', textTransform: 'uppercase' }

// The game log of every game screen: newest first, under the round each entry belongs to, with Undo
// on the newest. A 'round' entry starts its round, and its detail shows under the round's title.
export function LogDrawer({ open, entries, onClose, onUndo }: {
  open: boolean
  entries: LogEntry[]
  onClose: () => void
  onUndo: () => void
}) {
  const groups: { title: string; entry?: LogEntry; items: LogEntry[] }[] = []
  for (const e of entries) {
    if (e.type === 'round') groups.push({ title: e.message, entry: e, items: [] })
    else if (groups.length === 0) groups.push({ title: 'Before the game', items: [e] })
    else groups[groups.length - 1].items.push(e)
  }
  const newest = entries[entries.length - 1]
  const undo = (
    <button type="button" data-testid="log-undo-btn" onClick={onUndo} style={{ height: '44px', padding: '0 14px', border: 'none', borderRadius: '10px', background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontFamily: 'inherit', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
      Undo
    </button>
  )
  return (
    <Sheet open={open} title="Log" onClose={onClose}>
      {entries.length === 0 && <div style={{ color: 'var(--color-text-muted)' }}>No actions yet</div>}
      {[...groups].reverse().map((g, gi) => (
        <div key={g.entry?.id ?? `g${gi}`} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '24px' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={MUTED_CAPS}><span data-testid="log-round">{g.title}</span>{gi === 0 && ' · newest first'}</span>
              {g.entry?.detail && <span data-testid="log-detail" style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{g.entry.detail}</span>}
            </div>
            {g.entry && g.entry === newest && undo}
          </div>
          {[...g.items].reverse().map(e => (
            <div key={e.id} data-testid="log-entry" style={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: '44px', padding: '4px 4px 4px 8px', boxSizing: 'border-box', borderRadius: '12px', background: e === newest ? 'var(--color-tonal)' : 'var(--color-surface)' }}>
              {/* The colour of what it logs, as on the control that did it. */}
              <span data-testid="log-colour" style={{ width: '4px', alignSelf: 'stretch', margin: '4px 0', borderRadius: '2px', background: e.color, flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span data-testid="log-message" style={{ fontSize: '14px' }}>{e.message}</span>
                {e.detail && <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{e.detail}</span>}
              </div>
              {e === newest && undo}
            </div>
          ))}
        </div>
      ))}
      {entries.length > 0 && (
        <div style={{ fontSize: '12px', lineHeight: '16px', color: 'var(--color-text-muted)' }}>Undo takes back the newest entry. Repeat to step further back.</div>
      )}
    </Sheet>
  )
}
