import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { EngineCard } from '../engine/types'
import CardFace from './cardFace'
import { ZOOM_WIDTH_PX, longEdge } from './cardSizing'
import { useModifierKeys } from './modifierKeys'

/** Keep the zoomed card at least this far from the viewport edge. */
const VIEWPORT_MARGIN_PX = 12

/**
 * The enlarged card shown while zooming: full size, upright and clean (no
 * highlight, exhaustion or tokens), floating above everything else. For a dual-sided
 * leader, holding **Alt** shows the other side (Shift is the zoom trigger, so the flip
 * is Alt; desktop only).
 *
 * It renders through a portal to `document.body` and is positioned `fixed`, so it can
 * never be clipped by an ancestor's `overflow` (e.g. a scrollable overlay) or trapped
 * inside a stacking context. When given an `anchorRef` it centres over that element and
 * then clamps to the viewport so edge cards stay fully on-screen; without one it
 * simply centres in the viewport (used by isolated render tests).
 */
export function CardZoomPopover({
  card,
  deployed = false,
  fallbackName,
  anchorRef,
}: {
  card: EngineCard | undefined
  deployed?: boolean
  fallbackName?: string
  anchorRef?: RefObject<HTMLElement | null>
}) {
  const { alt } = useModifierKeys()
  const dualSided = card?.type === 'leader' && Boolean(card?.backArt)
  const effectiveDeployed = dualSided && alt ? !deployed : deployed

  const ref = useRef<HTMLDivElement>(null)
  // null until the positioning pass runs; 'centred' once it has run with nothing to measure.
  // Keeping "not yet placed" and "no anchor found" distinct matters: collapsing them left a
  // popover that missed its anchor hidden forever instead of falling back to centred.
  const [pos, setPos] = useState<{ left: number; top: number } | 'centred' | null>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef?.current
    const el = ref.current
    if (!anchor || !el) {
      setPos('centred')
      return
    }
    const a = anchor.getBoundingClientRect()
    const w = el.offsetWidth || ZOOM_WIDTH_PX
    const h = el.offsetHeight || longEdge(ZOOM_WIDTH_PX)
    const max = (extent: number, size: number) => Math.max(VIEWPORT_MARGIN_PX, extent - size - VIEWPORT_MARGIN_PX)
    const left = Math.min(Math.max(VIEWPORT_MARGIN_PX, a.left + a.width / 2 - w / 2), max(window.innerWidth, w))
    const top = Math.min(Math.max(VIEWPORT_MARGIN_PX, a.top + a.height / 2 - h / 2), max(window.innerHeight, h))
    setPos({ left, top })
  }, [anchorRef, card, effectiveDeployed])

  const anchored = pos !== null && pos !== 'centred'
  // With an anchor we hide until the positioning pass runs, to avoid a one-frame flash at the
  // wrong spot. Without one we centre immediately (isolated render tests). A pass that ran but
  // found no anchor still reveals the card — centred beats invisible.
  const measuring = anchorRef !== undefined && pos === null
  const style = anchored
    ? { left: pos.left, top: pos.top }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }

  return createPortal(
    <div
      ref={ref}
      data-testid="card-zoom"
      className="pointer-events-none fixed z-[100] drop-shadow-[0_8px_24px_rgba(0,0,0,0.7)]"
      style={{ ...style, visibility: measuring ? 'hidden' : 'visible' }}
    >
      <CardFace card={card} deployed={effectiveDeployed} fallbackName={fallbackName} widthPx={ZOOM_WIDTH_PX} tight />
    </div>,
    document.body,
  )
}
