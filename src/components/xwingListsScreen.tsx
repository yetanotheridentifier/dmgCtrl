import { useState } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import { useXwingLists } from '../hooks/useXwingLists'
import type { XwingList } from '../hooks/useXwingLists'
import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, HelpIcon } from './icons'
import { Button, IconButton } from './shared/controls'
import { FactionIcon } from './factionIcon'
import XwingListBuilder from './xwingListBuilder'
import { XwingSaveListSheet } from './xwingSaveListSheet'
import { parseXwsText } from '../utils/parseXwsText'
import type { XwingPilot } from '../utils/parseXwsText'
import { displayPilots } from '../utils/displayPilots'
import { listDetail, pilotSummary } from '../utils/xwingListInfo'
import { pilotProblems } from '../utils/xwingListRules'

interface Props {
  onBack: () => void
  onHelp: () => void
  // Opened from setup's Import XWS: start at the paste box, and Back leaves the screen.
  startWith?: 'import'
}

type Mode = { kind: 'lists' } | { kind: 'import' } | { kind: 'build'; editing?: XwingList }

type Checked =
  | { ok: false; error: string }
  | { ok: true; pilots: XwingPilot[]; faction: string | undefined; name: string | undefined; problems: string[] }

function importErrorMessage(code: string): string {
  switch (code) {
    case 'too-few-ships': return 'List must contain at least 3 ships.'
    case 'too-many-ships': return 'List must contain no more than 8 ships.'
    case 'invalid-total': return 'Points total must be between 46 and 50.'
    case 'invalid-format': return "Couldn't read list: check you've pasted the XWS export."
    default: return 'Invalid list.'
  }
}

const mutedStyle: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--color-text-muted)' }
const panelStyle: React.CSSProperties = { background: 'var(--color-surface)', borderRadius: '16px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }
const inputStyle: React.CSSProperties = {
  height: '44px', boxSizing: 'border-box', border: '2px solid var(--color-accent)', borderRadius: '12px', background: 'var(--color-bg-deep)',
  color: 'var(--color-text-primary)', fontFamily: 'inherit', fontSize: '16px', padding: '0 12px', outline: 'none', minWidth: 0,
}

export default function XwingListsScreen({ onBack, onHelp, startWith }: Props) {
  const { isPortrait } = useOrientation()
  const { lists, saveList, renameList, removeList } = useXwingLists()
  const [mode, setMode] = useState<Mode>(startWith === 'import' ? { kind: 'import' } : { kind: 'lists' })
  const toLists = () => setMode({ kind: 'lists' })

  if (mode.kind === 'build') {
    return (
      <XwingListBuilder
        editing={mode.editing}
        onBack={toLists}
        onSaved={toLists}
        onImport={mode.editing ? undefined : () => setMode({ kind: 'import' })}
      />
    )
  }

  if (mode.kind === 'import') {
    return (
      <ImportXws
        isPortrait={isPortrait}
        lists={lists}
        onBack={startWith === 'import' ? onBack : toLists}
        onSave={(name, pilots, faction) => { saveList(name, pilots, faction); toLists() }}
      />
    )
  }

  return (
    <AppScreenLayout>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', overflowY: 'auto', color: 'var(--color-text-primary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, flexWrap: 'wrap' }}>
          <IconButton label="Back" onClick={onBack}><BackIcon /></IconButton>
          <h1 style={{ flex: 1, margin: 0, fontSize: '1.4rem', fontWeight: 300, letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>Squad Lists</h1>
          <Button onClick={() => setMode({ kind: 'import' })}>Import XWS</Button>
          <Button variant="primary" onClick={() => setMode({ kind: 'build' })}>New list</Button>
          <IconButton label="Help" onClick={onHelp}><HelpIcon /></IconButton>
        </div>
        {lists.length === 0 && <div data-testid="xwing-lists-empty" style={mutedStyle}>No saved lists</div>}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isPortrait ? 1 : 2}, minmax(0, 1fr))`, gap: '12px', alignItems: 'start' }}>
          {lists.map(list => (
            <ListCard
              key={list.id}
              list={list}
              lists={lists}
              onEdit={() => setMode({ kind: 'build', editing: list })}
              onRename={name => renameList(list.id, name)}
              onDelete={() => removeList(list.id)}
            />
          ))}
        </div>
      </div>
    </AppScreenLayout>
  )
}

function ListCard({ list, lists, onEdit, onRename, onDelete }: {
  list: XwingList
  lists: XwingList[]
  onEdit: () => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameError, setRenameError] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const t = (id: string) => `list-${id}-${list.id}`

  const saveRename = () => {
    const name = (renaming ?? '').trim()
    if (lists.some(l => l.id !== list.id && l.name === name)) {
      setRenameError(true)
      return
    }
    onRename(name)
    setRenaming(null)
  }

  return (
    <div data-testid={`list-row-${list.id}`} style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <span style={{ color: 'var(--color-text-body)', display: 'flex' }}><FactionIcon faction={list.faction} /></span>
        <div style={{ fontSize: '1.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</div>
      </div>
      <div data-testid={t('meta')} style={mutedStyle}>{listDetail(list.pilots, list.faction)}</div>
      <div style={{ fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--color-text-body)' }}>{pilotSummary(list.pilots)}</div>
      {renaming !== null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.75rem', letterSpacing: '0.14em', color: 'var(--color-accent)' }}>
            RENAME
            <input
              data-testid={t('rename-input')}
              aria-label="New name"
              value={renaming}
              onChange={e => { setRenaming(e.target.value); setRenameError(false) }}
              style={{ ...inputStyle, width: '100%', marginTop: '6px', letterSpacing: 'normal' }}
            />
          </label>
          {renameError && <div data-testid={t('rename-error')} style={{ ...mutedStyle, color: 'var(--color-error)' }}>Another list already has that name.</div>}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button testId={t('rename-cancel')} onClick={() => setRenaming(null)}>Cancel</Button>
            <Button testId={t('rename-save')} variant="primary" disabled={renaming.trim() === ''} onClick={saveRename}>Save name</Button>
          </div>
        </div>
      ) : deleting ? (
        <div role="alertdialog" aria-label={`Delete ${list.name}?`} style={{ borderRadius: '12px', background: 'rgba(var(--color-error-rgb), 0.12)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '0.95rem' }}>Delete {list.name}?</div>
          <div style={mutedStyle}>{listDetail(list.pilots, list.faction)}. This can't be undone.</div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button testId={t('delete-cancel')} onClick={() => setDeleting(false)}>Cancel</Button>
            <Button testId={t('delete-confirm')} onClick={() => { onDelete(); setDeleting(false) }} style={{ color: 'var(--color-error)' }}>Delete</Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button testId={t('edit-btn')} onClick={onEdit}>Edit</Button>
          <Button testId={t('rename-btn')} onClick={() => { setRenaming(list.name); setRenameError(false) }}>Rename</Button>
          <Button testId={t('delete-btn')} onClick={() => setDeleting(true)}>Delete</Button>
        </div>
      )}
    </div>
  )
}

function ImportXws({ isPortrait, lists, onBack, onSave }: {
  isPortrait: boolean
  lists: XwingList[]
  onBack: () => void
  onSave: (name: string, pilots: XwingPilot[], faction: string | undefined) => void
}) {
  const [text, setText] = useState('')
  const [checked, setChecked] = useState<Checked | null>(null)
  const [saving, setSaving] = useState(false)

  const check = () => {
    const result = parseXwsText(text)
    setChecked(result.ok
      ? { ok: true, pilots: result.pilots, faction: result.faction, name: result.name, problems: pilotProblems(result.pilots) }
      : { ok: false, error: result.error })
  }
  const canSave = checked?.ok === true && checked.problems.length === 0

  const result = checked === null ? (
    <div style={mutedStyle}>Paste a list and check it.</div>
  ) : !checked.ok ? (
    <div role="alert" data-testid="lists-error" style={{ fontSize: '0.9rem', color: 'var(--color-error)' }}>{importErrorMessage(checked.error)}</div>
  ) : checked.problems.length > 0 ? (
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: '1.05rem' }}>{checked.name ?? 'This list'} can't be saved yet</div>
      <div style={{ fontSize: '0.75rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-error)' }}>
        {checked.problems.length} {checked.problems.length === 1 ? 'problem' : 'problems'}
      </div>
      {checked.problems.map((problem, i) => (
        <div key={problem} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <span style={{ flexShrink: 0, width: '22px', height: '22px', borderRadius: '11px', background: 'rgba(var(--color-error-rgb), 0.2)', color: 'var(--color-error)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
          <span style={{ fontSize: '0.9rem', lineHeight: 1.4 }}>{problem}</span>
        </div>
      ))}
    </div>
  ) : (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ color: 'var(--color-text-body)', display: 'flex' }}><FactionIcon faction={checked.faction} /></span>
        <div style={{ fontSize: '1.05rem' }}>{checked.name ?? 'Unnamed list'}</div>
      </div>
      <div data-testid="lists-new-meta" style={mutedStyle}>{listDetail(checked.pilots, checked.faction)}</div>
      <div data-testid="lists-preview" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {displayPilots(checked.pilots).map((p, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '0.85rem', color: 'var(--color-text-body)' }}>
            <span>{p.displayName} · {p.ship}</span>
            <span>{p.points}</span>
          </div>
        ))}
      </div>
    </>
  )

  return (
    <AppScreenLayout>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', overflowY: isPortrait ? 'auto' : undefined, color: 'var(--color-text-primary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <IconButton label="Back" onClick={onBack}><BackIcon /></IconButton>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 300, letterSpacing: '0.08em' }}>Import XWS</h1>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Export your list as XWS from any squad builder, copy, paste here</div>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0, minHeight: isPortrait ? '30vh' : 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <textarea
              data-testid="lists-textarea"
              aria-label="XWS text"
              placeholder="Paste XWS JSON"
              value={text}
              onChange={e => setText(e.target.value)}
              style={{
                flex: 1, minHeight: isPortrait ? '30vh' : 0, resize: 'none', boxSizing: 'border-box', border: '2px solid var(--color-surface-raised)', borderRadius: '12px',
                background: 'var(--color-bg-deep)', color: 'var(--color-text-body)', fontFamily: "Consolas, 'Courier New', monospace", fontSize: '16px',
                padding: '10px 12px', outline: 'none', wordBreak: 'break-all',
              }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button onClick={() => { setText(''); setChecked(null) }} style={{ flex: 1 }}>Clear</Button>
              <Button onClick={check} style={{ flex: 1 }}>Check</Button>
            </div>
          </div>
          <div style={{ width: isPortrait ? undefined : '340px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
            <div style={{ ...panelStyle, flex: isPortrait ? undefined : 1, overflowY: 'auto', minHeight: 0 }}>{result}</div>
            <Button variant="primary" disabled={!canSave} onClick={() => setSaving(true)} style={{ minHeight: '52px', flexShrink: 0 }}>Save list</Button>
          </div>
        </div>
      </div>
      {checked?.ok && (
        <XwingSaveListSheet
          open={saving}
          pilots={checked.pilots}
          faction={checked.faction}
          lists={lists}
          initialName={checked.name ?? ''}
          onClose={() => setSaving(false)}
          onSave={name => { setSaving(false); onSave(name, checked.pilots, checked.faction) }}
        />
      )}
    </AppScreenLayout>
  )
}
