import { useState, type ReactNode } from 'react'
import type { GameState, PlayerId } from '../engine/types'
import CardFace from './cardFace'
import { CARD_WIDTH_PX, longEdge } from './cardSizing'
import { useCardZoom } from './useCardZoom'
import { CardZoomPopover } from './cardZoom'
import { CardGridOverlay } from './cardGridOverlay'
import { PILL_W, TOKEN_H, TOKEN_BORDER, TOKEN_SHADOW, PLAYER_TOKEN_SPEC } from './tokens'
import type { PlayerTokenKind } from './tokens'
import { highlightOutline } from './highlight'
import type { Highlight } from './highlight'

/** Mat cards (deck/resources/discard/opponent-hand) are smaller than the hand. */
export const MAT_CARD_PX = 84

function dims(short: number, landscape: boolean) {
  return landscape ? { width: longEdge(short), height: short } : { width: short, height: longEdge(short) }
}

/**
 * A face-down card back: the transparent dmgCtrl symbol on an opaque card in the
 * darker background colour (not the paler play-area surface).
 */
export function CardBack({ widthPx = MAT_CARD_PX, landscape = false, symbol = true, highlight }: { widthPx?: number; landscape?: boolean; symbol?: boolean; highlight?: Highlight }) {
  return (
    <div
      style={{ ...dims(widthPx, landscape), backgroundColor: 'var(--color-bg)', ...highlightOutline(highlight) }}
      className="flex items-center justify-center rounded-lg border border-line/40"
    >
      {symbol && <img src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`} alt="" className="w-3/5 opacity-90" />}
    </div>
  )
}

/** An empty pile / slot: a solid pale-grey card outline. */
export function EmptySlot({ widthPx = MAT_CARD_PX, landscape = false }: { widthPx?: number; landscape?: boolean }) {
  return <div style={dims(widthPx, landscape)} className="rounded-lg border border-line/50" />
}

/**
 * A pile's count across the top of the card — transparent (no banner) with a
 * drop shadow for legibility, so the card art/symbol stays fully visible. Shared
 * by the deck, resources and discard for a consistent placement and size.
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

/** Which highlight says "you can click this": the same one a leader with a usable ability carries. */
const CLICKABLE: Highlight = 'accent-dim'

/**
 * The draw deck: a card back with the remaining count in a top chip.
 *
 * `canLook` is "you may look at the top card of your deck at any time" (`mayLookAtDeckTop`), passed
 * for the human's own deck only. The pile then highlights and becomes a click target that shows the
 * top card centre-screen, dismissed by clicking outside it, like the discard pile beside it. Looking
 * is not a move: it goes nowhere near the engine, so it reaches neither the log nor the opponent. The
 * card shown is read live, so it is always the one on top now, and it closes if the permission goes.
 */
export function DeckPile({ state, side, canLook = false }: { state: GameState; side: PlayerId; canLook?: boolean }) {
  const [open, setOpen] = useState(false)
  const deck = state.players[side].deck
  const top = canLook ? deck[0] : undefined
  return (
    <div data-testid="deck-pile" className="relative w-fit">
      {top === undefined ? (
        <>
          <CardBack />
          <CountChip>{deck.length}</CountChip>
        </>
      ) : (
        <button
          data-testid={`${side}-deck-look`}
          data-highlight={CLICKABLE}
          aria-label="Look at the top card of your deck"
          onClick={() => setOpen(true)}
          className="relative block w-fit cursor-pointer"
        >
          <CardBack highlight={CLICKABLE} />
          <CountChip>{deck.length}</CountChip>
        </button>
      )}
      {open && top !== undefined && (
        <CardGridOverlay
          idPrefix="deck-top"
          prompt="The top card of your deck"
          cardsById={state.cards}
          cardWidthPx={CARD_WIDTH_PX}
          onBackdropClick={() => setOpen(false)}
          items={[{ cardId: top, key: top }]}
        />
      )}
    </div>
  )
}

function ResourceCounter({ count, exhausted, testid }: { count: number; exhausted?: boolean; testid: string }) {
  // Exhausted resources are shown landscape (turned 90°), like the physical game —
  // the turn alone marks them as spent, with no dimming overlay.
  return (
    <div data-testid={testid} className="relative w-fit">
      <CardBack landscape={exhausted} />
      <CountChip>{count}</CountChip>
    </div>
  )
}

/** One of a player's own tokens: the label pill a unit's tokens use, from `PLAYER_TOKEN_SPEC`. */
function PlayerTokenPill({ kind, testid, title, children }: { kind: PlayerTokenKind; testid: string; title: string; children: ReactNode }) {
  const spec = PLAYER_TOKEN_SPEC[kind]
  return (
    <span
      data-testid={testid}
      role="img"
      aria-label={title}
      className="flex items-center justify-center whitespace-nowrap select-none tabular-nums"
      style={{
        width: PILL_W,
        height: TOKEN_H,
        borderRadius: TOKEN_H / 2,
        background: spec.background,
        color: spec.ink,
        fontSize: `${Math.round(TOKEN_H * 0.5)}px`,
        fontWeight: 700,
        lineHeight: 1,
        border: TOKEN_BORDER,
        boxShadow: TOKEN_SHADOW,
      }}
    >
      {children}
    </span>
  )
}

/**
 * Resources as two statically-placed slots: a ready card showing the number of
 * available resources, and — once any are spent — an exhausted (turned) card
 * showing the number used. Ready + exhausted = total; the ready card disappears
 * at 0; the column width never changes.
 *
 * The tokens the player holds rather than a unit sit here too, as pills laid over the foot of the
 * two slots like tokens on a card: the Credit tokens (with the count) and the Force token. They
 * are out of the layout, so holding one moves nothing, and absent while none is held.
 */
export function ResourceStack({ ready, exhausted, credits = 0, force = false, owner = 'player' }: { ready: number; exhausted: number; credits?: number; force?: boolean; owner?: PlayerId }) {
  return (
    <div data-testid="resources" className="relative flex items-center gap-1">
      <div style={{ width: MAT_CARD_PX }} className="flex justify-center">
        {ready > 0 && <ResourceCounter count={ready} testid="resources-ready" />}
      </div>
      <div style={{ width: longEdge(MAT_CARD_PX) }} className="flex justify-center">
        {exhausted > 0 && <ResourceCounter count={exhausted} exhausted testid="resources-exhausted" />}
      </div>
      {(credits > 0 || force) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center gap-1">
          {credits > 0 && (
            <PlayerTokenPill kind="credit" testid="credit-tokens" title={`${credits} Credit ${credits === 1 ? 'token' : 'tokens'}`}>Cred. {credits}</PlayerTokenPill>
          )}
          {force && (
            <PlayerTokenPill kind="force" testid="force-token" title={`The Force is with ${owner === 'player' ? 'you' : 'the opponent'}`}>Force</PlayerTokenPill>
          )}
        </div>
      )}
    </div>
  )
}

function DiscardOverlay({ cardIds, state, onClose }: { cardIds: string[]; state: GameState; onClose: () => void }) {
  return (
    <CardGridOverlay
      idPrefix="discard"
      cardsById={state.cards}
      cardWidthPx={CARD_WIDTH_PX}
      onBackdropClick={onClose}
      items={cardIds.map((id, i) => ({ cardId: id, key: `${id}-${i}` }))}
    />
  )
}

/**
 * The discard pile: face-up, most-recent card on top, with a count. Clicking it
 * opens an overlay listing every discarded card; clicking outside dismisses.
 */
export function DiscardPile({ state, side }: { state: GameState; side: PlayerId }) {
  const [open, setOpen] = useState(false)
  const { zoomed, bind, anchorRef, setAnchor } = useCardZoom()
  const discard = state.players[side].discard
  const top = discard[discard.length - 1]
  return (
    <div className="w-fit">
      {discard.length === 0 ? (
        <EmptySlot />
      ) : (
        <button
          ref={setAnchor}
          data-testid={`${side}-discard-pile`}
          onClick={() => setOpen(true)}
          {...bind}
          className="relative block w-fit cursor-pointer"
        >
          <CardFace card={state.cards[top]} fallbackName={top} tight widthPx={MAT_CARD_PX} />
          <CountChip>{discard.length}</CountChip>
          {zoomed && <CardZoomPopover card={state.cards[top]} fallbackName={top} anchorRef={anchorRef} />}
        </button>
      )}
      {open && <DiscardOverlay cardIds={discard} state={state} onClose={() => setOpen(false)} />}
    </div>
  )
}

/**
 * The opponent's hidden hand: overlaid card backs, each layered over the last.
 * Only the top card carries the dmgCtrl symbol; the covered cards are plain, so
 * the stack never smears symbols however the cards overlap.
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
