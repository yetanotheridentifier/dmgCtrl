import type { EngineCard } from '../engine/types'
import CardFace from './cardFace'
import { ZOOM_WIDTH_PX } from './cardSizing'
import { useModifierKeys } from './modifierKeys'

/**
 * The enlarged card shown while zooming (#321): full size, upright and clean (no
 * highlight, exhaustion or tokens), centred over the source card and floating
 * above neighbours. For a dual-sided leader, holding **Alt** shows the other side
 * (Shift is the zoom trigger, so the flip is Alt; desktop only). Positioning is
 * centred-on-source for the MVP; on-screen clamping near edges is the follow-up (#331).
 */
export function CardZoomPopover({
  card,
  deployed = false,
  fallbackName,
}: {
  card: EngineCard | undefined
  deployed?: boolean
  fallbackName?: string
}) {
  const { alt } = useModifierKeys()
  const dualSided = card?.type === 'leader' && Boolean(card?.backArt)
  const effectiveDeployed = dualSided && alt ? !deployed : deployed

  return (
    <div
      data-testid="card-zoom"
      className="pointer-events-none absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_8px_24px_rgba(0,0,0,0.7)]"
    >
      <CardFace card={card} deployed={effectiveDeployed} fallbackName={fallbackName} widthPx={ZOOM_WIDTH_PX} tight />
    </div>
  )
}
