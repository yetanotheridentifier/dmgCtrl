import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * The one centre-screen modal frame: a dark backdrop and a solid panel. The game-over screen and every
 * choice overlay are drawn in it, so they read as one family.
 *
 * Two sizes, by how the overlay is answered:
 * - `panel`: answered with buttons. The game-over screen's size and layout: generous padding, centred
 *   text, a row of buttons.
 * - `cards`: answered by picking cards. Tighter padding, so the cards keep their size and the panel
 *   scrolls rather than overflowing the screen.
 *
 * `onDismiss` adds a close button in the corner, labelled by `dismissLabel` because what dismissing
 * means is the caller's (cancelling an action, or putting the overlay aside). Without it the overlay
 * blocks until answered.
 *
 * Portalled to document.body so it shares the root stacking context with the card zoom popover (also
 * portalled): the backdrop's z-50 then sits below the zoom's z-100, instead of being trapped in a
 * board-tree stacking context that outranks it.
 */
export type OverlaySize = 'panel' | 'cards'

const SIZE: Record<OverlaySize, string> = {
  panel: 'min-w-[min(24rem,100%)] max-w-2xl gap-5 p-8 text-center',
  cards: 'max-h-[90vh] max-w-[90vw] gap-4 overflow-y-auto p-5',
}

const TONE = {
  accent: 'border-accent/60 shadow-[0_0_24px_rgba(79,195,247,0.25)]',
  amber: 'border-amber shadow-[0_0_24px_rgba(245,166,35,0.35)]',
} as const

export function OverlayShell({ testId, panelTestId, size, tone = 'accent', onDismiss, dismissLabel = 'Close', onBackdropClick, children }: {
  testId: string
  panelTestId?: string
  size: OverlaySize
  tone?: keyof typeof TONE
  onDismiss?: () => void
  dismissLabel?: string
  /** Closes a view-only overlay on a click outside the panel; clicks inside it are ignored. */
  onBackdropClick?: () => void
  children: ReactNode
}) {
  return createPortal(
    <div data-testid={testId} onClick={onBackdropClick} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <section
        data-testid={panelTestId}
        data-size={size}
        onClick={onBackdropClick ? e => e.stopPropagation() : undefined}
        className={`relative flex flex-col items-center rounded-xl border-2 bg-surface-solid ${TONE[tone]} ${SIZE[size]}`}
      >
        {onDismiss && (
          <button
            data-testid="overlay-dismiss"
            onClick={onDismiss}
            aria-label={dismissLabel}
            title={dismissLabel}
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-lg leading-none text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            ×
          </button>
        )}
        {children}
      </section>
    </div>,
    document.body,
  )
}

/*
 * The overlay's contents, shared so every overlay reads the same: a header (the question, and an optional
 * line under it), panel buttons in a row, and notes in the header's second-line type. An overlay keeps
 * only what is particular to it (a list, a search box, cards) and builds the rest from these.
 */

/** The question an overlay asks, in the button choice prompt's type. */
export const OVERLAY_TITLE = 'text-lg text-ink first-letter:uppercase'
/** Everything said in passing: the header's second line, a note under the buttons, a list's heading. */
export const OVERLAY_DETAIL = 'text-sm text-ink-dim'

/**
 * The overlay's header: its title, and `detail` under it. `banner` is the game-over screen's outcome
 * (larger, semibold, in the colour class given), the one title that is a result rather than a question.
 */
export function OverlayHeader({ title, detail, banner, testId, detailTestId }: {
  title: ReactNode
  detail?: ReactNode
  banner?: string
  testId?: string
  detailTestId?: string
}) {
  return (
    <header className="px-6 text-center">
      <p data-testid={testId} data-overlay-part="title" className={banner ? `text-2xl font-semibold ${banner}` : OVERLAY_TITLE}>
        {title}
      </p>
      {detail && <p data-testid={detailTestId} className={`mt-1 ${OVERLAY_DETAIL}`}>{detail}</p>}
    </header>
  )
}

/**
 * The overlay's buttons: a centred, wrapping row. `stacked` puts one per line at full width, for
 * answers too long to sit side by side (an ability's text).
 */
export function OverlayButtons({ stacked, children }: { stacked?: boolean; children: ReactNode }) {
  return <div className={stacked ? 'flex w-full flex-col gap-2' : 'flex flex-wrap justify-center gap-3'}>{children}</div>
}

/** The panel's buttons: the game-over screen's, primary in the accent colour and the rest muted. */
export const PANEL_BUTTON = 'rounded-xl border-2 px-5 py-2 text-sm'
export const PANEL_PRIMARY = `${PANEL_BUTTON} border-accent text-accent shadow-[0_0_12px_rgba(79,195,247,0.3)] hover:bg-accent/10`
export const PANEL_SECONDARY = `${PANEL_BUTTON} border-line/60 text-ink-dim hover:text-ink`
