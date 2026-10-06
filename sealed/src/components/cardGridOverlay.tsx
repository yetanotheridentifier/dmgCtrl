import type { ReactNode } from 'react'
import type { EngineCard } from '../engine/types'
import { OverlayButtons, OverlayHeader, OverlayShell, PANEL_PRIMARY } from './overlayShell'
import CardFace from './cardFace'
import { ZOOM_WIDTH_PX } from './cardSizing'
import { useCardZoom } from './useCardZoom'
import { CardZoomPopover } from './cardZoom'

/**
 * One card in a `CardGridOverlay`. `onSelect` makes it interactive: with an `actionLabel` a labelled
 * button renders under the card (e.g. search's "Discard"); without one, the card itself is the click
 * target. No `onSelect` = view-only. `dimmed` reveals a card that isn't eligible.
 */
export interface CardGridItem {
  cardId: string
  key: string | number
  /** testid for the interactive control (e.g. `card-select-1`, `search-pick-1`). */
  testId?: string
  dimmed?: boolean
  actionLabel?: string
  onSelect?: () => void
}

/**
 * The one centre-screen "set of cards" overlay: the shared `OverlayShell` at its `cards` size, holding
 * an optional prompt (the shared header), a grid of cards, and an optional footer (its buttons, set in
 * the shared button row). Consolidates the
 * previous card-choice / card-select / search-reveal / discard overlays. `idPrefix` reproduces each
 * caller's testids (`${idPrefix}-overlay`, `${idPrefix}-prompt`, `${idPrefix}-overlay-content`).
 * `onBackdropClick` dismisses view-only overlays (clicks inside the panel are ignored).
 */
/** One card cell: the card (a click target when selectable), zoom-on-hover, an optional labelled
 *  action button and host caption. */
function GridCardCell({ item, card, width }: { item: CardGridItem; card: EngineCard | undefined; width: number }) {
  const { zoomed, bind, anchorRef, setAnchor } = useCardZoom()
  const clickCard = item.onSelect && !item.actionLabel
  const face = (
    <CardFace card={card} fallbackName={item.cardId} widthPx={width} tight highlight={clickCard && !item.dimmed ? 'accent' : undefined} className={item.dimmed && !clickCard ? 'brightness-[0.45]' : ''} />
  )
  const zoom = zoomed && <CardZoomPopover card={card} fallbackName={item.cardId} anchorRef={anchorRef} />
  return (
    <div className="flex flex-col items-center gap-2">
      {clickCard ? (
        <button ref={setAnchor} data-testid={item.testId} onClick={item.onSelect} disabled={item.dimmed} {...bind} className={`relative w-fit ${item.dimmed ? 'cursor-default opacity-40' : 'cursor-pointer'}`}>
          {face}{zoom}
        </button>
      ) : (
        <div ref={setAnchor} {...bind} className="relative w-fit">{face}{zoom}</div>
      )}
      {item.actionLabel && item.onSelect && (
        <button data-testid={item.testId} onClick={item.onSelect} className={PANEL_PRIMARY}>
          {item.actionLabel}
        </button>
      )}
    </div>
  )
}

export function CardGridOverlay({
  idPrefix, prompt, cardsById, items, footer, fullWidthCards, cardWidthPx, onBackdropClick, onDismiss, dismissLabel,
}: {
  idPrefix: string
  prompt?: string
  cardsById: Record<string, EngineCard | undefined>
  items: CardGridItem[]
  footer?: ReactNode
  fullWidthCards?: boolean
  cardWidthPx?: number
  onBackdropClick?: () => void
  /** The shell's corner close button; see `OverlayShell`. */
  onDismiss?: () => void
  dismissLabel?: string
}) {
  const width = cardWidthPx ?? (fullWidthCards ? ZOOM_WIDTH_PX : Math.round(ZOOM_WIDTH_PX * 0.8))
  return (
    <OverlayShell testId={`${idPrefix}-overlay`} size="cards" onBackdropClick={onBackdropClick} onDismiss={onDismiss} dismissLabel={dismissLabel}>
      {prompt && <OverlayHeader testId={`${idPrefix}-prompt`} title={prompt} />}
      <div data-testid={`${idPrefix}-overlay-content`} className="flex max-w-4xl flex-wrap justify-center gap-4">
        {items.map(item => <GridCardCell key={item.key} item={item} card={cardsById[item.cardId]} width={width} />)}
      </div>
      {footer && <OverlayButtons>{footer}</OverlayButtons>}
    </OverlayShell>
  )
}
