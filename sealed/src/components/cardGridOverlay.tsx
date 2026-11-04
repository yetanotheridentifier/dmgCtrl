import type { EngineCard, GameState } from '../engine/types'
import { OVERLAY_DETAIL, OverlayButtons, OverlayHeader, OverlayShell, PANEL_PRIMARY, PANEL_SECONDARY } from './overlayShell'
import { PhonePrompt, type PromptButton } from './game/phoneLayout'
import { PHONE_LANDSCAPE_QUERY, useMediaQuery } from '../hooks/useMediaQuery'
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
  /** A line under the card saying what it is (whose deck it tops), in the overlay's detail type. */
  caption?: string
  captionTestId?: string
}

/**
 * The one centre-screen "set of cards" overlay: the shared `OverlayShell` at its `cards` size, holding
 * an optional prompt (the shared header), a grid of cards, and an optional footer (its buttons, set in
 * the shared button row). Consolidates the
 * previous card-choice / card-select / search-reveal / discard overlays. `idPrefix` reproduces each
 * caller's testids (`${idPrefix}-overlay`, `${idPrefix}-prompt`, `${idPrefix}-overlay-content`).
 * `onBackdropClick` dismisses view-only overlays (clicks inside the panel are ignored).
 *
 * On a phone in landscape it is the phone's prompt panel (`PhonePrompt`) instead: the question, a row
 * of cards where a selectable card is itself the button, the rest dimmed, and the buttons under them.
 */
/** One card cell: the card (a click target when selectable), zoom-on-hover, an optional labelled
 *  caption and an optional labelled action button. */
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
      {item.caption && <p data-testid={item.captionTestId} className={OVERLAY_DETAIL}>{item.caption}</p>}
      {item.actionLabel && item.onSelect && (
        <button data-testid={item.testId} onClick={item.onSelect} className={PANEL_PRIMARY}>
          {item.actionLabel}
        </button>
      )}
    </div>
  )
}

/** A card in the phone's pick: a selectable card is the button (a tap picks it); the rest are shown,
 *  dimmed when they cannot be chosen. A held card opens full size either way. */
function PhoneGridCard({ item, card }: { item: CardGridItem; card: EngineCard | undefined }) {
  const { bind } = useCardZoom({ cardId: item.cardId })
  const name = card?.name ?? item.cardId
  const pickable = !!item.onSelect && !item.dimmed
  const face = (
    <CardFace card={card} fallbackName={item.cardId} widthPx={PHONE_PICK_CARD_PX} tight highlight={pickable ? 'accent' : undefined} className={item.dimmed ? 'brightness-[0.45]' : ''} />
  )
  return (
    <div className="flex flex-col items-center gap-1">
      {pickable ? (
        <button type="button" data-testid={item.testId} aria-label={item.actionLabel ? `${name}: ${item.actionLabel}` : name} onClick={item.onSelect} {...bind} className="w-fit cursor-pointer border-none bg-transparent p-0">
          {face}
        </button>
      ) : (
        <div data-testid={item.testId} role="img" aria-label={item.dimmed ? `${name}, can't be chosen` : name} {...bind} className="w-fit">{face}</div>
      )}
      {item.caption && <p data-testid={item.captionTestId} className="text-xs text-ink-dim">{item.caption}</p>}
    </div>
  )
}

/** A card in the phone's pick: the design's hand-card size, so eight fit one row of the panel. */
const PHONE_PICK_CARD_PX = 60

export function CardGridOverlay({
  idPrefix, prompt, state, items, buttons = [], fullWidthCards, cardWidthPx, onBackdropClick, onDismiss, dismissLabel,
}: {
  idPrefix: string
  prompt?: string
  state: GameState
  items: CardGridItem[]
  /** The answers besides the cards: Done, Cancel. Primary in the accent colour, the rest muted. */
  buttons?: PromptButton[]
  fullWidthCards?: boolean
  cardWidthPx?: number
  onBackdropClick?: () => void
  /** The shell's corner close button; see `OverlayShell`. */
  onDismiss?: () => void
  dismissLabel?: string
}) {
  const phone = useMediaQuery(PHONE_LANDSCAPE_QUERY)
  if (phone) {
    // The phone's one prompt pattern. The cards are answers in themselves, so a lone button beside them
    // is the primary; a view-only overlay closed by a click beside it gets a Close instead.
    const answers = buttons.length > 0 ? buttons : onBackdropClick ? [{ label: 'Close', onClick: onBackdropClick }] : []
    return (
      <PhonePrompt
        testId={`${idPrefix}-overlay`}
        state={state}
        question={prompt ?? ''}
        questionTestId={`${idPrefix}-prompt`}
        note="Hold a card to read it."
        width={640}
        buttons={answers.length === 1 ? [{ ...answers[0], primary: true }] : answers}
        onCancel={onDismiss}
        cancelLabel={dismissLabel}
      >
        <div data-testid={`${idPrefix}-overlay-content`} className="flex flex-wrap justify-center gap-2">
          {items.map(item => <PhoneGridCard key={item.key} item={item} card={state.cards[item.cardId]} />)}
        </div>
      </PhonePrompt>
    )
  }
  const width = cardWidthPx ?? (fullWidthCards ? ZOOM_WIDTH_PX : Math.round(ZOOM_WIDTH_PX * 0.8))
  return (
    <OverlayShell testId={`${idPrefix}-overlay`} size="cards" onBackdropClick={onBackdropClick} onDismiss={onDismiss} dismissLabel={dismissLabel}>
      {prompt && <OverlayHeader testId={`${idPrefix}-prompt`} title={prompt} />}
      <div data-testid={`${idPrefix}-overlay-content`} className="flex max-w-4xl flex-wrap justify-center gap-4">
        {items.map(item => <GridCardCell key={item.key} item={item} card={state.cards[item.cardId]} width={width} />)}
      </div>
      {buttons.length > 0 && (
        <OverlayButtons>
          {buttons.map((b, i) => (
            <button key={b.testId ?? i} data-testid={b.testId} onClick={b.onClick} className={b.primary ? PANEL_PRIMARY : PANEL_SECONDARY}>
              {b.label}
            </button>
          ))}
        </OverlayButtons>
      )}
    </OverlayShell>
  )
}
