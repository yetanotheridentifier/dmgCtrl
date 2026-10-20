import { useState } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, CheckIcon, EditIcon, HelpIcon } from './icons'
import { NAV_BTN_STYLE } from '../styles/navButton'
import { labelStyle, submitButtonStyle, squadNameInputStyle, overwriteCancelStyle } from '../styles/xwingForm'
import { PilotList, TextareaField } from './shared/xwsListFields'
import type { XwingList } from '../hooks/useXwingLists'
import type { XwingPilot } from '../utils/parseXwsText'
import { listMeta } from '../utils/xwingListInfo'

interface Props {
  lists: XwingList[]
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onClear: () => void
  text: string
  onTextChange: (v: string) => void
  error: string | null
  onCheck: () => void
  parsedPilots: XwingPilot[] | null
  parsedFaction: string | undefined
  onEdit: () => void
  name: string
  onNameChange: (v: string) => void
  onSave: () => void
  onBack: () => void
  onHelp: () => void
}

const smallButtonStyle = (small: boolean, accent = false): React.CSSProperties => ({
  ...overwriteCancelStyle(small),
  ...(accent ? { border: '1px solid var(--color-accent)', color: 'var(--color-accent)' } : {}),
})

const nameInputStyle = (small: boolean): React.CSSProperties => ({
  ...squadNameInputStyle(small),
  cursor: 'text',
  fontSize: '16px', // 16px minimum prevents iOS zoom on focus
})

const panelHeadingStyle = (small: boolean): React.CSSProperties => ({
  ...labelStyle(small),
  paddingBottom: '0.5vh',
  borderBottom: '1px solid rgba(107, 114, 128, 0.3)',
})

const mutedTextStyle = (small: boolean): React.CSSProperties => ({
  color: 'var(--color-text-muted)',
  fontWeight: '300',
  fontSize: small ? 'clamp(0.6rem, 1.4vw, 0.75rem)' : 'clamp(0.7rem, 2.5vw, 0.9rem)',
  letterSpacing: '0.04em',
})

export default function XwingListsScreenView({
  lists,
  onRename,
  onDelete,
  onClear,
  text,
  onTextChange,
  error,
  onCheck,
  parsedPilots,
  parsedFaction,
  onEdit,
  name,
  onNameChange,
  onSave,
  onBack,
  onHelp,
}: Props) {
  const { isPortrait } = useOrientation()
  const small = !isPortrait
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [showOverwrite, setShowOverwrite] = useState(false)

  const trimmedName = name.trim()

  const startRename = (list: XwingList) => {
    setRenamingId(list.id)
    setRenameDraft(list.name)
    setRenameError(false)
  }

  const saveRename = (id: string) => {
    const newName = renameDraft.trim()
    if (lists.some(l => l.id !== id && l.name === newName)) {
      setRenameError(true)
      return
    }
    onRename(id, newName)
    setRenamingId(null)
  }

  const handleSave = () => {
    if (lists.some(l => l.name === trimmedName)) {
      setShowOverwrite(true)
      return
    }
    onSave()
  }

  const confirmOverwrite = () => {
    setShowOverwrite(false)
    onSave()
  }

  const newPanel = (
    <div data-testid="lists-new-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5vh', flex: small ? 1 : undefined, minWidth: 0 }}>
      <div style={panelHeadingStyle(small)}>New list</div>
      {parsedPilots === null ? (
        <>
          <TextareaField
            testId="lists-textarea"
            errorTestId="lists-error"
            value={text}
            onChange={onTextChange}
            error={error}
            small={small}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '1.5vw' }}>
            <label style={labelStyle(small)}>Check list</label>
            <button data-testid="lists-check-btn" onClick={onCheck} aria-label="Check list" style={submitButtonStyle(small)}>
              <CheckIcon />
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5vw' }}>
            <input
              data-testid="lists-name-input"
              value={name}
              onChange={e => { onNameChange(e.target.value); setShowOverwrite(false) }}
              placeholder="List name"
              aria-label="List name"
              style={nameInputStyle(small)}
            />
            <button data-testid="lists-edit-btn" onClick={() => { setShowOverwrite(false); onEdit() }} aria-label="Edit list" style={submitButtonStyle(small)}>
              <EditIcon />
            </button>
          </div>
          <div data-testid="lists-new-meta" style={mutedTextStyle(small)}>{listMeta(parsedPilots, parsedFaction)}</div>
          <PilotList pilots={parsedPilots} testId="lists-preview" small={small} />
          {showOverwrite ? (
            <div data-testid="lists-overwrite" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '1.5vw' }}>
              <span style={{ ...labelStyle(small), textTransform: 'none', letterSpacing: '0.04em' }}>Overwrite '{trimmedName}'?</span>
              <button data-testid="lists-overwrite-confirm-btn" onClick={confirmOverwrite} aria-label="Confirm overwrite" style={submitButtonStyle(small)}>
                <CheckIcon />
              </button>
              <button data-testid="lists-overwrite-cancel-btn" onClick={() => setShowOverwrite(false)} aria-label="Cancel overwrite" style={overwriteCancelStyle(small)}>
                ✕
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '1.5vw' }}>
              <label style={labelStyle(small)}>Save list</label>
              <button
                data-testid="lists-save-btn"
                onClick={handleSave}
                disabled={trimmedName === ''}
                aria-label="Save list"
                style={{ ...submitButtonStyle(small), opacity: trimmedName === '' ? 0.4 : 1, cursor: trimmedName === '' ? 'not-allowed' : 'pointer' }}
              >
                <CheckIcon />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )

  const savedPanel = (
    <div data-testid="lists-saved-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5vh', flex: small ? 1 : undefined, minWidth: 0 }}>
      <div style={panelHeadingStyle(small)}>Saved lists</div>
      {lists.length === 0 ? (
        <div data-testid="xwing-lists-empty" style={{ ...mutedTextStyle(small), padding: '1vh 0' }}>
          No saved lists
        </div>
      ) : (
        <>
          {lists.map(list => (
            <div key={list.id} data-testid={`list-row-${list.id}`} style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.8vh',
              padding: '1vh 0',
              borderBottom: '1px solid rgba(107, 114, 128, 0.15)',
            }}>
              {renamingId === list.id ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5vw' }}>
                    <input
                      data-testid={`list-rename-input-${list.id}`}
                      value={renameDraft}
                      onChange={e => { setRenameDraft(e.target.value); setRenameError(false) }}
                      aria-label="New name"
                      style={nameInputStyle(small)}
                    />
                    <button
                      data-testid={`list-rename-save-${list.id}`}
                      onClick={() => saveRename(list.id)}
                      disabled={renameDraft.trim() === ''}
                      aria-label="Save name"
                      style={{ ...submitButtonStyle(small), opacity: renameDraft.trim() === '' ? 0.4 : 1 }}
                    >
                      <CheckIcon />
                    </button>
                    <button data-testid={`list-rename-cancel-${list.id}`} onClick={() => setRenamingId(null)} aria-label="Cancel rename" style={overwriteCancelStyle(small)}>
                      ✕
                    </button>
                  </div>
                  {renameError && (
                    <div data-testid={`list-rename-error-${list.id}`} style={{ ...mutedTextStyle(small), color: 'var(--color-error)' }}>
                      Another list already has that name.
                    </div>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5vw' }}>
                  <button
                    data-testid={`list-toggle-${list.id}`}
                    onClick={() => setExpandedId(expandedId === list.id ? null : list.id)}
                    aria-expanded={expandedId === list.id}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '0.3vh',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      textAlign: 'left',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <span style={{
                      color: 'var(--color-text-primary)',
                      fontWeight: '300',
                      fontSize: small ? 'clamp(0.8rem, 1.9vw, 1rem)' : 'clamp(0.9rem, 3.5vw, 1.1rem)',
                    }}>
                      {list.name}
                    </span>
                    <span data-testid={`list-meta-${list.id}`} style={mutedTextStyle(small)}>
                      {listMeta(list.pilots, list.faction)}
                    </span>
                  </button>
                  {deletingId === list.id ? (
                    <>
                      <button data-testid={`list-delete-confirm-${list.id}`} onClick={() => { onDelete(list.id); setDeletingId(null) }} style={smallButtonStyle(small, true)}>
                        Delete
                      </button>
                      <button data-testid={`list-delete-cancel-${list.id}`} onClick={() => setDeletingId(null)} style={smallButtonStyle(small)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button data-testid={`list-rename-btn-${list.id}`} onClick={() => startRename(list)} style={smallButtonStyle(small)}>
                        Rename
                      </button>
                      <button data-testid={`list-delete-btn-${list.id}`} onClick={() => setDeletingId(list.id)} style={smallButtonStyle(small)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              )}
              {expandedId === list.id && (
                <PilotList pilots={list.pilots} testId={`list-pilots-${list.id}`} small={small} />
              )}
            </div>
          ))}
          <div style={{ marginTop: '1.5vh', display: 'flex', gap: '1.5vw' }}>
            {confirmingClear ? (
              <>
                <button data-testid="lists-clear-confirm-btn" onClick={() => { onClear(); setConfirmingClear(false) }} style={smallButtonStyle(small, true)}>
                  Confirm
                </button>
                <button onClick={() => setConfirmingClear(false)} style={smallButtonStyle(small)}>
                  Cancel
                </button>
              </>
            ) : (
              <button data-testid="lists-clear-btn" onClick={() => setConfirmingClear(true)} style={smallButtonStyle(small)}>
                Clear All
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )

  return (
    <AppScreenLayout>
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '2vw',
        gap: '2vh',
        overflowY: 'auto',
        minHeight: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2vw', flexShrink: 0 }}>
          <button onClick={onBack} aria-label="Back" style={NAV_BTN_STYLE}>
            <BackIcon />
          </button>
          <h1 style={{
            flex: 1,
            color: 'var(--color-text-primary)',
            fontWeight: '200',
            fontSize: small ? 'clamp(1.2rem, 4vw, 1.8rem)' : 'clamp(1.8rem, 8vw, 3rem)',
            letterSpacing: '0.15em',
            margin: 0,
            lineHeight: 0.8,
          }}>
            Squad Lists
          </h1>
          <button onClick={onHelp} aria-label="Help" style={NAV_BTN_STYLE}>
            <HelpIcon />
          </button>
        </div>

        <div data-testid="lists-layout" style={{
          display: 'flex',
          flexDirection: small ? 'row' : 'column',
          alignItems: small ? 'flex-start' : 'stretch',
          gap: small ? '4vw' : '3vh',
        }}>
          {savedPanel}
          {newPanel}
        </div>
      </div>
    </AppScreenLayout>
  )
}
