import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A centre-screen modal frame for showing cards: a dark backdrop and a solid panel, padded tightly so
 * the cards keep their size and the panel scrolls rather than overflowing the screen.
 *
 * `onDismiss` adds a close button in the corner, labelled by `dismissLabel`. `onBackdropClick` closes
 * it on a click outside the panel; clicks inside it are ignored.
 *
 * Portalled to document.body so it shares the root stacking context with the card zoom popover (also
 * portalled): the backdrop's z-50 then sits below the zoom's z-100, instead of being trapped in a
 * stacking context that outranks it.
 */
export function OverlayShell({ testId, onDismiss, dismissLabel = 'Close', onBackdropClick, children }: {
  testId: string
  onDismiss?: () => void
  dismissLabel?: string
  onBackdropClick?: () => void
  children: ReactNode
}) {
  return createPortal(
    <div data-testid={testId} onClick={onBackdropClick} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <section
        onClick={onBackdropClick ? e => e.stopPropagation() : undefined}
        className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-4 overflow-y-auto rounded-xl border-2 border-accent/60 bg-surface-solid p-5 shadow-[0_0_24px_rgba(79,195,247,0.25)]"
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
