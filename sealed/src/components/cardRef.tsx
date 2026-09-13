import { useCallback, useRef, useState } from 'react'
import type { GameState, PlayerId, EngineCard } from '../engine/types'
import type { DescribePart } from '../utils/describeAction'
import { CardZoomPopover } from './cardZoom'

/**
 * A card named in the log or in an action prompt, shown as a link-styled reference: bold and
 * coloured by who controls it, using the same accent/amber pairing as the log's actor column.
 *
 * Hovering shows the full card, reusing `CardZoomPopover`. Unlike a card on the board this
 * needs **no Shift** — that gate exists so hovering the play area doesn't obscure the board
 * mid-play, which does not apply to a line of text in the log.
 *
 * It is styled like a link but is deliberately a `<span>`, not an `<a>`: there is nowhere to
 * navigate, and clicking does nothing. An anchor would have screen readers announce a link
 * that goes nowhere.
 *
 * `pointer-events-auto` keeps a reference hoverable inside the action prompt, which is itself
 * click-through so it never intercepts the board it is describing.
 */
export function CardRef({ state, cardId, controller, text }: {
  /** Null only while the game is still loading, when there is no card db to zoom into. */
  state: GameState | null
  cardId: string
  controller: PlayerId
  text: string
}) {
  const [hovering, setHovering] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  // Stable callback ref: an unstable one is detached and re-attached around the popover's
  // layout effect, which leaves the zoom permanently invisible (see #367 and useCardZoom).
  const setAnchor = useCallback((el: HTMLElement | null) => { anchorRef.current = el }, [])

  return (
    <span
      ref={setAnchor}
      data-testid="card-ref"
      data-card-id={cardId}
      onPointerEnter={e => { if (e.pointerType === 'mouse') setHovering(true) }}
      onPointerLeave={() => setHovering(false)}
      onPointerCancel={() => setHovering(false)}
      className={`pointer-events-auto font-semibold underline decoration-dotted underline-offset-2 ${controller === 'player' ? 'text-accent' : 'text-amber'}`}
    >
      {text}
      {hovering && state && <CardZoomPopover card={state.cards[cardId]} fallbackName={text} anchorRef={anchorRef} />}
    </span>
  )
}

/**
 * The same hover-to-zoom reference, for somewhere there is no game in progress.
 *
 * `CardRef` reads its card out of `state.cards`, which only exists once a game has started. The deck
 * screen has a card db built straight from the cached set instead, so this takes the card itself.
 * Styled neutrally rather than by controller, since outside a game nobody controls it.
 */
export function StaticCardRef({ card, text }: {
  card: EngineCard | undefined
  text: string
}) {
  const [hovering, setHovering] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  // Stable callback ref, for the reason `CardRef` documents: an unstable one is detached around the
  // popover's layout effect and the zoom never becomes visible.
  const setAnchor = useCallback((el: HTMLElement | null) => { anchorRef.current = el }, [])

  return (
    <span
      ref={setAnchor}
      data-testid="static-card-ref"
      data-card-id={card?.id}
      onPointerEnter={e => { if (e.pointerType === 'mouse') setHovering(true) }}
      onPointerLeave={() => setHovering(false)}
      onPointerCancel={() => setHovering(false)}
      className="pointer-events-auto underline decoration-dotted underline-offset-2 cursor-help"
    >
      {text}
      {hovering && <CardZoomPopover card={card} fallbackName={text} anchorRef={anchorRef} />}
    </span>
  )
}

/** A described action rendered in place: plain text as text, card tokens as hover references. */
export function DescribedParts({ state, parts }: { state: GameState | null; parts: DescribePart[] }) {
  return (
    <span data-testid="described-parts">
      {parts.map((part, i) =>
        typeof part === 'string'
          ? part
          : <CardRef key={i} state={state} cardId={part.cardId} controller={part.controller} text={part.text} />,
      )}
    </span>
  )
}
