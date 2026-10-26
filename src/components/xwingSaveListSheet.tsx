import { useId, useState } from 'react'
import { Button, Sheet } from './shared/controls'
import type { XwingList } from '../hooks/useXwingLists'
import type { XwingPilot } from '../utils/parseXwsText'
import { listDetail, listMeta, pilotSummary } from '../utils/xwingListInfo'
import { defaultListName } from '../utils/xwingListRules'

interface Props {
  open: boolean
  pilots: XwingPilot[]
  faction: string | undefined
  lists: XwingList[]
  // The name the box starts with: the list being edited, an imported list's own, or blank.
  initialName: string
  // The saved list being edited, if any: saving under its name updates it.
  editing?: XwingList
  onClose: () => void
  onSave: (name: string) => void
}

const noteStyle: React.CSSProperties = { borderRadius: '12px', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '2px' }

// Naming a list before it's saved, from the builder or Import XWS. A blank name saves as the
// faction default; a name another list has replaces that list, and says so first.
export function XwingSaveListSheet({ open, editing, onClose, ...rest }: Props) {
  return (
    <Sheet open={open} title={editing ? 'Save changes' : 'Save list'} onClose={onClose}>
      <SaveListForm editing={editing} {...rest} />
    </Sheet>
  )
}

function SaveListForm({ pilots, faction, lists, initialName, editing, onSave }: Omit<Props, 'open' | 'onClose'>) {
  const [draft, setDraft] = useState(initialName)
  const inputId = useId()
  const fallback = defaultListName(faction, lists.map(l => l.name))
  const name = draft.trim() || fallback
  const updating = editing !== undefined && name === editing.name
  const replaces = updating ? undefined : lists.find(l => l.name === name)

  const note = updating
    ? { title: `Updates ${editing.name}`, detail: `Was ${listMeta(editing.pilots, undefined)}. Change the name to save a copy instead.`, warn: false }
    : replaces
      ? { title: `Replaces your saved ${replaces.name}`, detail: `${listMeta(replaces.pilots, replaces.faction)}. Change the name to keep both.`, warn: true }
      : null
  const label = updating ? 'Save changes' : replaces ? `Overwrite ${replaces.name}` : editing ? 'Save copy' : 'Save list'

  return (
    <>
      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{listDetail(pilots, faction)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label htmlFor={inputId} style={{ fontSize: '0.75rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Name</label>
        <input
          id={inputId}
          value={draft}
          placeholder={fallback}
          onChange={e => setDraft(e.target.value)}
          style={{
            height: '48px',
            boxSizing: 'border-box',
            border: `2px solid ${replaces ? 'var(--color-warning)' : 'var(--color-accent)'}`,
            borderRadius: '12px',
            background: 'var(--color-surface)',
            color: 'var(--color-text-primary)',
            fontFamily: 'inherit',
            fontSize: '16px', // 16px minimum prevents iOS zoom on focus
            padding: '0 14px',
            outline: 'none',
          }}
        />
        {note ? (
          <div role="status" style={{ ...noteStyle, background: note.warn ? 'rgba(var(--color-warning-rgb), 0.18)' : 'var(--color-tonal)', color: note.warn ? 'var(--color-warning)' : 'var(--color-tonal-text)' }}>
            <span style={{ fontSize: '0.9rem' }}>{note.title}</span>
            <span style={{ fontSize: '0.75rem' }}>{note.detail}</span>
          </div>
        ) : draft.trim() === '' && (
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            Left blank, it's saved as <span style={{ color: 'var(--color-text-primary)' }}>{fallback}</span>
          </div>
        )}
      </div>
      <div style={{ fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--color-text-body)' }}>{pilotSummary(pilots)}</div>
      <Button variant="primary" onClick={() => onSave(name)} style={{ marginTop: 'auto', minHeight: '52px', flexShrink: 0 }}>{label}</Button>
    </>
  )
}
