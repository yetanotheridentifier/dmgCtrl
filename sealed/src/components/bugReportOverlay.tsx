import { useEffect, useState } from 'react'

/**
 * A bug, in the same flat line-art style as the rest of the chrome. Sized smaller than the button's
 * text glyphs so it sits with clear padding inside the 9x9 square rather than filling it.
 */
export function BugIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* Antennae, then the shell, then three legs a side. */}
      <path d="M9 5 7.5 3M15 5 16.5 3" />
      <rect x="7.5" y="7" width="9" height="13" rx="4.5" />
      <path d="M7.5 11H4M7.5 15.5H3.5M8.5 19.5 6 21.5" />
      <path d="M16.5 11H20M16.5 15.5H20.5M15.5 19.5 18 21.5" />
    </svg>
  )
}

/**
 * The bug-report form (#373): a title and a description over a dark backdrop.
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

  const field = 'w-full rounded-lg border-2 border-line/60 bg-bg-dark px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'

  return (
    // Above every other layer, the card zoom (z-100) included: nothing on the board is worth
    // reading while the form is open, and a stray element painting over it loses typed text.
    <div data-testid="bug-report-overlay" className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-lg rounded-xl border-2 border-line/60 bg-surface-solid p-4 shadow-[0_8px_32px_rgba(0,0,0,0.7)]">
        <h2 className="text-accent text-sm uppercase tracking-[0.12em] font-light">Report a bug</h2>
        {/* The paste step is explained here rather than prefilled into the issue body, where it
            would survive into every filed report. */}
        <p className="mt-1 text-xs text-ink-faint">
          Submitting copies the report, including the game so far, and opens GitHub.
          <strong className="text-ink-dim"> Paste it into the issue body</strong> and submit there.
        </p>

        <label className="mt-3 block text-xs text-ink-dim" htmlFor="bug-title">Title</label>
        <input
          id="bug-title"
          data-testid="bug-report-title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What went wrong, in a few words"
          className={`mt-1 ${field}`}
        />

        <label className="mt-3 block text-xs text-ink-dim" htmlFor="bug-description">Description</label>
        <textarea
          id="bug-description"
          data-testid="bug-report-description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={5}
          placeholder="What you did, what you expected, what happened instead"
          className={`mt-1 ${field}`}
        />

        {fallbackReport !== undefined && (
          <div className="mt-3">
            <p data-testid="bug-report-error" className="text-xs text-amber">
              Couldn&apos;t reach the clipboard. Copy the report below, then paste it into the issue.
            </p>
            <textarea
              data-testid="bug-report-fallback"
              readOnly
              value={fallbackReport}
              rows={6}
              className={`mt-1 font-mono text-[10px] ${field}`}
            />
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            data-testid="bug-report-cancel"
            onClick={onCancel}
            className="rounded-xl border-2 border-line/60 px-4 py-1.5 text-xs text-ink-dim hover:text-ink"
          >
            Cancel
          </button>
          <button
            data-testid="bug-report-submit"
            disabled={title.trim().length === 0}
            onClick={() => onSubmit(title.trim(), description.trim())}
            className="rounded-xl border-2 border-accent px-4 py-1.5 text-xs text-accent shadow-[0_0_12px_rgba(79,195,247,0.3)] hover:bg-accent/10 disabled:cursor-not-allowed disabled:border-line/40 disabled:text-ink-faint disabled:shadow-none"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  )
}
