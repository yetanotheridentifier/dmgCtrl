import type { ReactNode } from 'react'
import { Button, IconButton } from '@pwa-shared/controls'
import { AlertIcon, BackIcon, CloseIcon } from '../icons'
import type { LoadProgress } from '../../hooks/useGame'

/**
 * The states around a game rather than in it: starting it, failing to start it, and the cards that
 * play with printed stats only. Drawn the same on a phone and a desktop.
 */

/** A whole screen with the way back in its corner, for a game that is not on the board yet. */
function EdgeScreen({ testId, role, onExit, children }: { testId: string; role: 'status' | 'alert'; onExit: () => void; children: ReactNode }) {
  return (
    <div data-testid={testId} className="flex h-screen w-full flex-col p-2">
      <div className="flex">
        <IconButton label="Back to setup" onClick={onExit}><BackIcon /></IconButton>
      </div>
      <div role={role} className="flex flex-1 flex-col items-center justify-center gap-3 pb-11 text-center">
        {children}
      </div>
    </div>
  )
}

export function GameLoading({ title, progress, onExit }: { title: string; progress: LoadProgress; onExit: () => void }) {
  const percent = progress.total > 0 ? Math.round((100 * progress.done) / progress.total) : 0
  return (
    <EdgeScreen testId="game-loading" role="status" onExit={onExit}>
      <div className="text-xs tracking-[0.14em] text-accent">STARTING THE GAME</div>
      <div className="text-[22px] font-light">{title}</div>
      <div
        role="progressbar"
        aria-label="Loading cards"
        aria-valuemin={0}
        aria-valuenow={progress.done}
        aria-valuemax={progress.total}
        className="h-2 w-[min(360px,80vw)] overflow-hidden rounded bg-[var(--color-surface)]"
      >
        <div className="h-full rounded bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <div className="text-sm text-ink-dim">Loading cards · {progress.done} of {progress.total}</div>
      <div className="text-[13px] text-ink-faint">Then both players draw 6, and you choose to keep or mulligan.</div>
    </EdgeScreen>
  )
}

export function GameLoadError({ deckName, detail, offline, onRetry, onExit }: {
  deckName: string
  /** What failed, for whoever is diagnosing it: shown small, under the plain reason. */
  detail: string | null
  offline: boolean
  onRetry: () => void
  onExit: () => void
}) {
  return (
    <EdgeScreen testId="game-error" role="alert" onExit={onExit}>
      <span className="text-[color:var(--color-opponent)]"><AlertIcon size={36} /></span>
      <div className="text-[22px] font-light">This game couldn't start</div>
      <p className="m-0 max-w-[460px] text-sm leading-5 text-ink">
        Some cards in {deckName} couldn't be loaded.
        {offline ? " You're offline, and they aren't saved on this device yet." : ' Check your connection and try again.'}
      </p>
      {detail && <p data-testid="game-error-detail" className="m-0 max-w-[460px] font-mono text-xs text-ink-faint">{detail}</p>}
      <div className="mt-2.5 flex gap-2.5">
        <Button onClick={onRetry} style={{ width: 160 }}>Try again</Button>
        <Button variant="primary" testId="error-back-btn" onClick={onExit} style={{ width: 180 }}>Back to setup</Button>
      </div>
    </EdgeScreen>
  )
}

/** "A", "A and B", "A, B and C". */
function andList(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Cards whose printing could not be matched to a Normal id play as vanilla bodies. Named, because the
 * symptom (an ability simply not happening) is otherwise indistinguishable from a broken one.
 * Placed by the caller (`className`), over the top of the board.
 */
export function PrintedStatsNotice({ names, onDismiss, className = '' }: { names: string[]; onDismiss: () => void; className?: string }) {
  const one = names.length === 1
  return (
    <div
      data-testid="unresolved-printings"
      role="status"
      className={`z-40 flex items-center gap-3 rounded-xl border-2 border-amber/60 bg-[var(--color-sheet)] px-3 py-2.5 shadow-[0_6px_20px_rgba(0,0,0,0.5)] ${className}`}
    >
      <span className="text-amber"><AlertIcon size={20} /></span>
      <p className="m-0 flex-1 text-[13px] leading-[18px] text-ink">
        <b className="text-amber">{names.length} {one ? 'card plays with its' : 'cards play with their'} printed stats and keywords only:</b>{' '}
        {andList(names)}. {one ? 'Its printing' : 'Their printings'} couldn't be identified.
      </p>
      <IconButton label="Dismiss" onClick={onDismiss}><CloseIcon /></IconButton>
    </div>
  )
}
