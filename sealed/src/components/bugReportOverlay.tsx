import { useEffect, useState } from 'react'
import { Button, IconButton } from '@pwa-shared/controls'
import { CloseIcon } from './icons'

/** A text field in a game dialog: the name-a-card prompt's input and the bug report's two fields. */
export const GAME_FIELD = 'rounded-xl border-2 border-line/60 bg-[var(--color-surface)] px-3 text-base tracking-normal text-ink outline-none focus:border-accent'

/** A field's label: small capitals above it. */
const LABEL = 'flex flex-col gap-1.5 text-xs uppercase tracking-[0.14em] text-ink-dim'

/**
 * The bug-report form, desktop only: a title and what happened, over a dimmed board.
 *
 * Purely presentational. Assembling the report, putting it on the clipboard and opening GitHub all
 * live with the caller, which is what holds the game state. `fallbackReport` is set when the
 * clipboard was refused, so the text can still be copied by hand rather than lost.
 */
export function BugReportOverlay({ onSubmit, onCancel, fallbackReport }: {
  onSubmit: (title: string, description: string) => void
  onCancel: () => void
  fallbackReport?: string
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    // Above every other layer, the card zoom (z-100) included: nothing on the board is worth
    // reading while the form is open, and a stray element painting over it loses typed text.
    <div data-testid="bug-report-overlay" className="fixed inset-0 z-[120] flex items-center justify-center bg-[var(--color-backdrop)] p-4">
      <div role="dialog" aria-label="Report a bug" className="flex w-full max-w-[560px] flex-col gap-3 rounded-2xl bg-[var(--color-sheet)] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-3">
          <h2 className="m-0 flex-1 text-xl font-medium">Report a bug</h2>
          <IconButton label="Close" onClick={onCancel}><CloseIcon /></IconButton>
        </div>

        <label className={LABEL}>
          Title
          <input data-testid="bug-report-title" value={title} onChange={e => setTitle(e.target.value)} className={`h-11 ${GAME_FIELD}`} />
        </label>
        <label className={LABEL}>
          What happened
          <textarea
            data-testid="bug-report-description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className={`h-[110px] resize-none py-2.5 text-sm leading-5 ${GAME_FIELD}`}
          />
        </label>

        {/* The paste step is explained here rather than prefilled into the issue body, where it
            would survive into every filed report. */}
        <p className="m-0 text-[13px] leading-[19px] text-ink-dim">
          This copies the whole game so far to your clipboard and opens a new GitHub issue with this
          title. Paste into the issue and submit; you'll need to be signed in to GitHub.
        </p>

        {fallbackReport !== undefined && (
          <div className="flex flex-col gap-1.5">
            <p data-testid="bug-report-error" className="m-0 text-xs text-amber">
              Couldn&apos;t reach the clipboard. Copy the report below, then paste it into the issue.
            </p>
            <textarea
              data-testid="bug-report-fallback"
              aria-label="The report, to copy"
              readOnly
              value={fallbackReport}
              rows={6}
              className={`py-2 font-mono text-[10px] ${GAME_FIELD}`}
            />
          </div>
        )}

        <div className="flex justify-end gap-2.5">
          <Button testId="bug-report-cancel" onClick={onCancel} style={{ width: 140 }}>Cancel</Button>
          <Button
            variant="primary"
            testId="bug-report-submit"
            disabled={title.trim().length === 0}
            onClick={() => onSubmit(title.trim(), description.trim())}
            style={{ width: 260, fontSize: '0.95rem' }}
          >
            Copy report and open GitHub
          </Button>
        </div>
      </div>
    </div>
  )
}
