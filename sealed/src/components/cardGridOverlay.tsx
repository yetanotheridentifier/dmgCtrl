import type { EngineCard, GameState } from '../engine/types'
import { PhonePrompt, type PromptButton } from './game/phoneLayout'
import CardFace from './cardFace'
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
 * The one "set of cards" prompt: the prompt panel (`PhonePrompt`) holding the question, a row of
 * cards where a selectable card is itself the button, the rest dimmed, and the buttons under them.
 * `idPrefix` gives each caller its testids (`${idPrefix}-overlay`, `${idPrefix}-prompt`,
 * `${idPrefix}-overlay-content`).
 */

/** A card in the pick: a selectable card is the button (a tap picks it); the rest are shown, dimmed
 *  when they cannot be chosen. A held card opens full size either way, and Shift over one with a
 *  mouse shows it beside the panel. */
function GridCard({ item, card }: { item: CardGridItem; card: EngineCard | undefined }) {
  const { zoomed, bind, anchorRef, setAnchor } = useCardZoom({ cardId: item.cardId })
  const name = card?.name ?? item.cardId
  const pickable = !!item.onSelect && !item.dimmed
  const face = (
    <CardFace card={card} fallbackName={item.cardId} widthPx={PICK_CARD_PX} tight highlight={pickable ? 'accent' : undefined} className={item.dimmed ? 'brightness-[0.45]' : ''} />
  )
  const zoom = zoomed && <CardZoomPopover card={card} fallbackName={item.cardId} anchorRef={anchorRef} />
  return (
    <div className="flex flex-col items-center gap-1">
      {pickable ? (
        <button type="button" ref={setAnchor} data-testid={item.testId} aria-label={item.actionLabel ? `${name}: ${item.actionLabel}` : name} onClick={item.onSelect} {...bind} className="relative w-fit cursor-pointer border-none bg-transparent p-0">
          {face}{zoom}
        </button>
      ) : (
        <div ref={setAnchor} data-testid={item.testId} role="img" aria-label={item.dimmed ? `${name}, can't be chosen` : name} {...bind} className="relative w-fit">{face}{zoom}</div>
      )}
      {item.caption && <p data-testid={item.captionTestId} className="text-xs text-ink-dim">{item.caption}</p>}
    </div>
  )
}

/** A card in the pick: the phone's hand-card size, so eight fit one row of the panel. */
const PICK_CARD_PX = 60

const HOLD_NOTE = 'Hold a card, or Shift over it with a mouse, to read it.'

export function CardGridOverlay({
  idPrefix, prompt, state, items, buttons = [], onClose, onDismiss, dismissLabel,
}: {
  idPrefix: string
  prompt?: string
  state: GameState
  items: CardGridItem[]
  /** The answers besides the cards: Done, Cancel. One primary, the rest tonal. */
  buttons?: PromptButton[]
  /** A view-only overlay's Close, offered when it has no other button. */
  onClose?: () => void
  /** The prompt's ×; see `PhonePrompt`. */
  onDismiss?: () => void
  dismissLabel?: string
}) {
  // The one prompt pattern. The cards are answers in themselves, so a lone button beside them is the
  // primary; a view-only overlay gets a Close.
  const answers = buttons.length > 0 ? buttons : onClose ? [{ label: 'Close', onClick: onClose }] : []
  return (
    <PhonePrompt
      testId={`${idPrefix}-overlay`}
      state={state}
      question={prompt ?? ''}
      questionTestId={`${idPrefix}-prompt`}
      note={HOLD_NOTE}
      width={640}
      buttons={answers.length === 1 ? [{ ...answers[0], primary: true }] : answers}
      onCancel={onDismiss}
      cancelLabel={dismissLabel}
    >
      <div data-testid={`${idPrefix}-overlay-content`} className="flex flex-wrap justify-center gap-2">
        {items.map(item => <GridCard key={item.key} item={item} card={state.cards[item.cardId]} />)}
      </div>
    </PhonePrompt>
  )
}
