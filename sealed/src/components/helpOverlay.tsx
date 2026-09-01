import { useEffect, useMemo, useRef } from 'react'
import { RELEASE } from '../buildIdentity'
import { isDev } from '../env'
import { helpContentFor } from '../utils/helpSections'
import type { HelpContext } from '../utils/helpSections'

/**
 * The user guide, showing the part that belongs to the screen it was opened from.
 *
 * An overlay rather than a screen: routing away unmounts `GameScreen`, and the game lives
 * entirely in `useGame`'s state and refs, so opening help mid-game used to abandon the game and
 * start a different one. Over the board, nothing unmounts and the game is where it was left.
 */
export function HelpOverlay({ context, onClose }: { context: HelpContext; onClose: () => void }) {
  const contentHtml = useMemo(() => helpContentFor(context), [context])
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /**
   * Anywhere off the guide dismisses it. Tested against the panel rather than the backdrop,
   * because the centring wrapper between them also catches clicks beside a short panel.
   */
  const onBackdropClick = (e: React.MouseEvent) => {
    if (!panel.current?.contains(e.target as Node)) onClose()
  }

  return (
    /*
     * Above the board and the card zoom, matching the other overlays.
     *
     * The **backdrop** scrolls, and the panel is left to be as tall as its content. The
     * alternative, a panel capped at a fraction of the viewport with the content scrolling
     * inside it, depends on a flex chain resolving to a definite height, and it did not hold
     * here: the game's help ran off the screen with no way to reach it, while the deck screen's
     * shorter help fitted and looked correct. `min-h-full` with `items-center` centres a short
     * panel but lets a tall one grow downward, so the top of the guide stays reachable rather
     * than being centred off the top of the screen.
     */
    <div
      data-testid="help-overlay"
      onClick={onBackdropClick}
      className="fixed inset-0 z-[120] overflow-y-auto overscroll-contain bg-black/80 p-4"
    >
      <div className="flex min-h-full items-center justify-center">
        <div ref={panel} className="w-full max-w-3xl rounded-xl border-2 border-line/60 bg-surface-solid p-4 shadow-[0_8px_32px_rgba(0,0,0,0.7)]">
          {/* Nothing sticky here: a sticky bar's background is inset by the panel's border, so
              its corners cannot line up with the panel's own rounding and the top border reads
              as clipped. Dismissing is Escape or a click outside, neither of which scrolls away. */}
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-accent text-sm uppercase tracking-[0.12em] font-light">Help</h2>
            <span className="text-[10px] text-ink-faint">Click outside or press Escape to close</span>
          </div>
          <div
            data-testid="help-content"
            className="help-content mt-4 text-ink-body text-sm leading-relaxed space-y-3"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
          {/* Build marker lives here in prod; in dev it's a corner badge. */}
          {!isDev() && (
            <p data-testid="build-tag" className="mt-4 text-[10px] text-ink-faint">
              {RELEASE}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
