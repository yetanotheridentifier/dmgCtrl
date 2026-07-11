import { useState, type ReactNode } from 'react'
import type { EngineCard, GameState, PlayerId } from '../engine/types'
import CardFace from './cardFace'
import { longEdge } from './cardSizing'
import { useCardZoom } from './useCardZoom'
import { CardZoomPopover } from './cardZoom'

/** Mat cards (deck/resources/discard/opponent-hand) are smaller than the hand. */
export const MAT_CARD_PX = 84

function dims(short: number, landscape: boolean) {
  return landscape ? { width: longEdge(short), height: short } : { width: short, height: longEdge(short) }
}

/**
 * A face-down card back: the transparent dmgCtrl symbol on an opaque card in the
 * darker background colour (not the paler play-area surface) (#332).
 */
export function CardBack({ widthPx = MAT_CARD_PX, landscape = false, symbol = true }: { widthPx?: number; landscape?: boolean; symbol?: boolean }) {
  return (
    <div
      style={{ ...dims(widthPx, landscape), backgroundColor: 'var(--color-bg)' }}
      className="flex items-center justify-center rounded-lg border border-line/40"
    >
      {symbol && <img src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`} alt="" className="w-3/5 opacity-90" />}
    </div>
  )
}

/** An empty pile / slot: a solid pale-grey card outline (#332). */
export function EmptySlot({ widthPx = MAT_CARD_PX, landscape = false }: { widthPx?: number; landscape?: boolean }) {
  return <div style={dims(widthPx, landscape)} className="rounded-lg border border-line/50" />
}

/**
 * A pile's count across the top of the card — transparent (no banner) with a
 * drop shadow for legibility, so the card art/symbol stays fully visible. Shared
 * by the deck, resources and discard for a consistent placement and size (#332).
 */
function CountChip({ children }: { children: ReactNode }) {
  return (
    <span
      className="absolute inset-x-0 top-0 py-0.5 text-center text-sm font-semibold text-ink tabular-nums"
      style={{ textShadow: '0 1px 3px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.95)' }}
    >
      {children}
    </span>
  )
}

/** The draw deck: a card back with the remaining count in a top chip. */
export function DeckPile({ count }: { count: number }) {
  return (
    <div data-testid="deck-pile" className="relative w-fit">
      <CardBack />
      <CountChip>{count}</CountChip>
    </div>
  )
}

function ResourceCounter({ count, exhausted, testid }: { count: number; exhausted?: boolean; testid: string }) {
  // Exhausted resources are shown landscape (turned 90°), like the physical game —
  // the turn alone marks them as spent, with no dimming overlay (#332).
  return (
    <div data-testid={testid} className="relative w-fit">
      <CardBack landscape={exhausted} />
      <CountChip>{count}</CountChip>
    </div>
  )
}

/**
 * Resources as two statically-placed slots: a ready card showing the number of
 * available resources, and — once any are spent — an exhausted (turned) card
 * showing the number used. Ready + exhausted = total; the ready card disappears
 * at 0; the column width never changes (#332).
 */
export function ResourceStack({ ready, exhausted }: { ready: number; exhausted: number }) {
  return (
    <div data-testid="resources" className="flex items-center gap-1">
      <div style={{ width: MAT_CARD_PX }} className="flex justify-center">
        {ready > 0 && <ResourceCounter count={ready} testid="resources-ready" />}
      </div>
      <div style={{ width: longEdge(MAT_CARD_PX) }} className="flex justify-center">
        {exhausted > 0 && <ResourceCounter count={exhausted} exhausted testid="resources-exhausted" />}
      </div>
    </div>
  )
}

/** A discarded card that zooms on Shift+hover / long-press, like the hand (#332). */
function DiscardCard({ card, fallbackName }: { card: EngineCard | undefined; fallbackName: string }) {
  const { zoomed, bind } = useCardZoom()
  return (
    <div {...bind} className="relative w-fit">
      <CardFace card={card} fallbackName={fallbackName} tight />
      {zoomed && <CardZoomPopover card={card} fallbackName={fallbackName} />}
    </div>
  )
}

function DiscardOverlay({ cardIds, state, onClose }: { cardIds: string[]; state: GameState; onClose: () => void }) {
  return (
    <div
      data-testid="discard-overlay"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
    >
      <div
        data-testid="discard-overlay-content"
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: '#0d1b2a' }}
        className="max-h-[80vh] max-w-4xl overflow-y-auto rounded-xl border-2 border-line/60 p-4"
      >
        <div className="flex flex-wrap gap-2">
          {cardIds.map((id, i) => (
            <DiscardCard key={`${id}-${i}`} card={state.cards[id]} fallbackName={id} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The discard pile: face-up, most-recent card on top, with a count. Clicking it
 * opens an overlay listing every discarded card; clicking outside dismisses (#332).
 */
export function DiscardPile({ state, side }: { state: GameState; side: PlayerId }) {
  const [open, setOpen] = useState(false)
  const { zoomed, bind } = useCardZoom()
  const discard = state.players[side].discard
  const top = discard[discard.length - 1]
  return (
    <div className="w-fit">
      {discard.length === 0 ? (
        <EmptySlot />
      ) : (
        <button
          data-testid={`${side}-discard-pile`}
          onClick={() => setOpen(true)}
          {...bind}
          className="relative block w-fit cursor-pointer"
        >
          <CardFace card={state.cards[top]} fallbackName={top} tight widthPx={MAT_CARD_PX} />
          <CountChip>{discard.length}</CountChip>
          {zoomed && <CardZoomPopover card={state.cards[top]} fallbackName={top} />}
        </button>
      )}
      {open && <DiscardOverlay cardIds={discard} state={state} onClose={() => setOpen(false)} />}
    </div>
  )
}

/**
 * The opponent's hidden hand: overlaid card backs, each layered over the last.
 * Only the top card carries the dmgCtrl symbol; the covered cards are plain, so
 * the stack never smears symbols however the cards overlap (#332).
 */
export function OpponentHand({ count }: { count: number }) {
  const STEP_PX = 18 // exposed left edge of each covered card
  return (
    <div data-testid="opponent-hand-fan" className="flex justify-center">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ marginLeft: i === 0 ? 0 : -(MAT_CARD_PX - STEP_PX) }}>
          <CardBack symbol={i === count - 1} />
        </div>
      ))}
    </div>
  )
}
