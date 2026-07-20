import { useState } from 'react'
import type { EngineCard, KeywordInstance } from '../engine/types'
import { artUrl } from '../data/thumbnails'
import { CARD_WIDTH_PX, longEdge } from './cardSizing'

interface Props {
  card: EngineCard | undefined
  /** Shown as the name when the card database has no entry for this id. */
  fallbackName?: string
  /** A deployed leader shows its unit (back) side and is portrait; undeployed is landscape. */
  deployed?: boolean
  /** Exhausted cards lie sideways (rotated 90° from their ready orientation) and dim. */
  exhausted?: boolean
  /** A highlight that hugs the card edge (1px in / 1px out): selection, target, playable, or resourcing (green). */
  highlight?: 'accent' | 'red' | 'accent-dim' | 'green'
  /** Frame the card tightly (its own art box, no square slot). For cards that never rotate, e.g. the hand. */
  tight?: boolean
  /** Short-edge size in px. Defaults to 50% of full size; the zoom feature overrides it. */
  widthPx?: number
  /** Extra classes for positioning by the caller. */
  className?: string
}

function keywordLabel(k: KeywordInstance): string {
  return k.value != null ? `${k.name} ${k.value}` : k.name
}

/**
 * A card's *native* orientation (the ready, un-rotated look): bases and
 * undeployed leaders are landscape cards; everything else (units, events,
 * upgrades, deployed leader unit-sides) is portrait. Exhausting rotates the
 * card 90° from this (#5).
 */
function isNativePortrait(card: EngineCard | undefined, deployed: boolean): boolean {
  if (!card) return true
  if (card.type === 'base') return false
  if (card.type === 'leader') return deployed // leader side is landscape, unit side portrait
  return true
}

/**
 * Art-dominant card face (#5): the card is its art, filling a fixed
 * short-edge card frame at the correct orientation. Exhausted cards rotate 90°
 * and reserve the wider footprint so neighbours never overlap. When the art is
 * missing or fails to load, a compact textual fallback (cost, name, power/HP,
 * keywords, abilities) keeps the card readable.
 */
export default function CardFace({
  card,
  fallbackName,
  deployed = false,
  exhausted = false,
  highlight,
  tight = false,
  widthPx = CARD_WIDTH_PX,
  className,
}: Props) {
  const [artFailed, setArtFailed] = useState(false)

  const nativePortrait = isNativePortrait(card, deployed)
  // The un-rotated art box (native orientation).
  const short = widthPx
  const long = longEdge(short)
  const artW = nativePortrait ? short : long
  const artH = nativePortrait ? long : short
  // Every card sits in the SAME square slot (side = long edge), so a card in any
  // orientation — portrait, landscape, or rotated when exhausted — fits without
  // overlapping neighbours, and exhausting causes no layout shift.
  const slot = long
  const orientation = nativePortrait === !exhausted ? 'portrait' : 'landscape'

  // Deployed leaders show their unit (back) side; everything else uses front art.
  const source = deployed && card?.type === 'leader' ? (card.backArt ?? card.frontArt) : card?.frontArt
  const art = artUrl(source)
  const name = card?.name ?? fallbackName ?? 'Unknown card'
  const showArt = Boolean(art) && !artFailed
  const showStats = card && (card.type === 'unit' || card.type === 'leader')

  // Highlight hugs the card: a 2px line straddling its edge (1px in, 1px out).
  const outline =
    highlight === 'accent' ? '2px solid var(--color-accent)'
    : highlight === 'green' ? '2px solid var(--color-green)'
    : highlight === 'red' ? '2px solid var(--color-red)'
    : highlight === 'accent-dim' ? '2px solid rgba(79, 195, 247, 0.55)'
    : undefined

  // Cards that never rotate (the hand) frame tightly to their art; others reserve
  // the square slot so they can rotate when exhausted without overlapping.
  const frameW = tight ? artW : slot
  const frameH = tight ? artH : slot

  return (
    <div
      data-testid="card-face"
      data-art={showArt}
      data-orientation={orientation}
      data-highlight={highlight ?? undefined}
      style={{ width: frameW, height: frameH }}
      className={['inline-flex items-center justify-center', className].filter(Boolean).join(' ')}
    >
      {/* Native-orientation art box, centred in the square slot. Exhausting
          rotates it 90°; the square already fits the card in any orientation,
          so rotated cards never overlap their neighbours. */}
      <div
        style={{ width: artW, height: artH, outline, outlineOffset: outline ? '-1px' : undefined }}
        className={[
          'relative overflow-hidden rounded-lg border border-line/60 bg-surface',
          // Exhausted: rotate and DIM, but stay opaque (a brightness filter, not
          // opacity) so anything behind the card — e.g. an upgrade — can't show
          // through.
          exhausted ? 'rotate-90 brightness-[0.55]' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {showArt ? (
          <img
            src={art!}
            alt={name}
            loading="lazy"
            onError={() => setArtFailed(true)}
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        ) : (
          <div
            data-testid="card-fallback"
            className="absolute inset-0 flex flex-col gap-0.5 p-1.5 text-[10px] leading-tight text-ink"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/20 px-1 font-mono text-[9px] text-accent">
                {card?.cost ?? '?'}
              </span>
              {showStats && (
                <span className="font-mono text-ink-dim">
                  {card!.power ?? 0}/{card!.hp ?? 0}
                </span>
              )}
            </div>
            <div className="mt-0.5 font-semibold">{name}</div>
            {card && card.keywords.length > 0 && (
              <div className="italic text-accent">{card.keywords.map(keywordLabel).join(', ')}</div>
            )}
            {card?.text && <div className="mt-0.5 overflow-hidden text-ink-dim">{card.text}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
