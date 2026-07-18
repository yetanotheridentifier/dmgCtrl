import type { ReactNode } from 'react'
import type { EngineCard } from '../engine/types'
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
  /** A "on <name>" caption under the card — an upgrade's host unit. */
  hostLabel?: string
  dimmed?: boolean
  actionLabel?: string
  onSelect?: () => void
}

/**
 * The one centre-screen "set of cards" overlay (#355): a dark backdrop, an optional prompt, a grid of
 * cards, and an optional footer (buttons / a counter). Consolidates the previous card-choice / card-
 * select / search-reveal / discard overlays. `idPrefix` reproduces each caller's testids
 * (`${idPrefix}-overlay`, `${idPrefix}-prompt`, `${idPrefix}-overlay-content`). `onBackdropClick`
 * dismisses view-only overlays (clicks inside the grid are ignored).
 */
/** One card cell: the card (a click target when selectable), zoom-on-hover, an optional labelled
 *  action button and host caption. */
function GridCardCell({ item, card, width }: { item: CardGridItem; card: EngineCard | undefined; width: number }) {
  const { zoomed, bind } = useCardZoom()
  const clickCard = item.onSelect && !item.actionLabel
  const face = (
    <CardFace card={card} fallbackName={item.cardId} widthPx={width} tight highlight={clickCard && !item.dimmed ? 'accent' : undefined} className={item.dimmed && !clickCard ? 'brightness-[0.45]' : ''} />
  )
  const zoom = zoomed && <CardZoomPopover card={card} fallbackName={item.cardId} />
  return (
    <div className="flex flex-col items-center gap-2">
      {clickCard ? (
        <button data-testid={item.testId} onClick={item.onSelect} disabled={item.dimmed} {...bind} className={`relative w-fit ${item.dimmed ? 'cursor-default opacity-40' : 'cursor-pointer'}`}>
          {face}{zoom}
        </button>
      ) : (
        <div {...bind} className="relative w-fit">{face}{zoom}</div>
      )}
      {item.actionLabel && item.onSelect && (
        <button data-testid={item.testId} onClick={item.onSelect} className="rounded-xl border-2 border-accent px-3 py-1.5 text-xs text-accent shadow-[0_0_12px_rgba(79,195,247,0.3)] hover:bg-accent/10">
          {item.actionLabel}
        </button>
      )}
      {item.hostLabel && <span className="text-[10px] text-ink-faint">on {item.hostLabel}</span>}
    </div>
  )
}

export function CardGridOverlay({
  idPrefix, prompt, cardsById, items, footer, fullWidthCards, cardWidthPx, scrollable, onBackdropClick,
}: {
  idPrefix: string
  prompt?: string
  cardsById: Record<string, EngineCard | undefined>
  items: CardGridItem[]
  footer?: ReactNode
  fullWidthCards?: boolean
  cardWidthPx?: number
  scrollable?: boolean
  onBackdropClick?: () => void
}) {
  const width = cardWidthPx ?? (fullWidthCards ? ZOOM_WIDTH_PX : Math.round(ZOOM_WIDTH_PX * 0.6))
  return (
    <div data-testid={`${idPrefix}-overlay`} onClick={onBackdropClick} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black/75 p-4">
      {prompt && <p data-testid={`${idPrefix}-prompt`} className="text-xs uppercase tracking-[0.14em] text-ink-dim">{prompt}</p>}
      <div
        data-testid={`${idPrefix}-overlay-content`}
        onClick={onBackdropClick ? e => e.stopPropagation() : undefined}
        className={`flex flex-wrap justify-center gap-4${scrollable ? ' max-h-[80vh] max-w-4xl overflow-y-auto rounded-xl border-2 border-line/60 p-4' : ''}`}
        style={scrollable ? { backgroundColor: '#0d1b2a' } : undefined}
      >
        {items.map(item => <GridCardCell key={item.key} item={item} card={cardsById[item.cardId]} width={width} />)}
      </div>
      {footer}
    </div>
  )
}
