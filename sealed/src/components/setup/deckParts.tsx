import type { EngineCard } from '../../engine/types'
import type { ParsedDeck } from '../../utils/parseProtectThePod'
import CardFace from '../cardFace'
import { ZOOM_WIDTH_PX } from '../cardSizing'
import { OverlayShell } from '../overlayShell'
import { deckEntries, deckGroups } from './deckSummary'
import type { DeckEntry } from './deckSummary'
import { aspectIconSrc } from './setupStyle'

/**
 * The pieces a deck is drawn with on the setup screen: its aspect icons, its leader and base, and its
 * card list, each tappable to show the card.
 */

export function AspectIcons({ aspects, size }: { aspects: string[]; size: number }) {
  if (aspects.length === 0) return null
  return (
    <span style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
      {aspects.map((a, i) => <img key={i} src={aspectIconSrc(a)} alt={a} style={{ width: size, height: size }} />)}
    </span>
  )
}

/** The card shown full size, over everything, until a tap puts it away (see `useCardShown`). */
export function CardShown({ card, name, onClose }: { card: EngineCard | undefined; name: string; onClose: () => void }) {
  return (
    <OverlayShell testId="card-shown" onBackdropClick={onClose} onDismiss={onClose}>
      <CardFace card={card} fallbackName={name} widthPx={ZOOM_WIDTH_PX} tight />
    </OverlayShell>
  )
}

const TAP: React.CSSProperties = { border: 'none', background: 'transparent', padding: 0, fontFamily: 'inherit', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }

const label = (card: EngineCard | undefined, fallback: string) =>
  card ? `${[card.name, card.subtitle].filter(Boolean).join(', ')}: see the card` : `${fallback}: see the card`

/**
 * The leader and the base, each drawn at its own shape (a leader's leader side and a base are both
 * landscape cards) and `width` wide, each a button that shows the card.
 */
export function LeaderAndBase({ deck, cards, width, show, row = false }: {
  deck: ParsedDeck
  cards: Record<string, EngineCard | undefined>
  width: number
  show: (card: EngineCard | undefined, name: string) => void
  /** Side by side rather than stacked. */
  row?: boolean
}) {
  // CardFace sizes by the short edge; a landscape card's width is its long edge.
  const shortEdge = Math.round((width * 5) / 7)
  return (
    <div style={{ display: 'flex', flexDirection: row ? 'row' : 'column', gap: '8px', flexShrink: 0 }}>
      {[deck.leader, deck.base].map(id => (
        <button key={id} type="button" aria-label={label(cards[id], id)} onClick={() => show(cards[id], cards[id]?.name ?? id)} style={{ ...TAP, borderRadius: '12px', lineHeight: 0 }}>
          <CardFace card={cards[id]} fallbackName={id} widthPx={shortEdge} tight />
        </button>
      ))}
    </div>
  )
}

const HEAD: React.CSSProperties = {
  margin: 0,
  height: '24px',
  display: 'flex',
  alignItems: 'flex-end',
  paddingBottom: '2px',
  boxSizing: 'border-box',
  fontSize: '0.7rem',
  fontWeight: 400,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
}

function Row({ entry, show }: { entry: DeckEntry; show: (card: EngineCard | undefined, name: string) => void }) {
  return (
    <button
      type="button"
      data-testid="deck-row"
      onClick={() => show(entry.card, entry.name)}
      style={{ ...TAP, display: 'flex', width: '100%', height: '22px', alignItems: 'center', gap: '6px', color: 'var(--color-text-primary)', fontSize: '0.8rem', textAlign: 'left', breakInside: 'avoid' }}
    >
      <span data-testid="deck-row-cost" style={{ flexShrink: 0, width: '16px', textAlign: 'center', fontSize: '0.7rem', fontWeight: 600, lineHeight: '16px', borderRadius: '4px', background: 'var(--color-text-muted)', color: 'var(--color-on-accent)' }}>{entry.cost}</span>
      <span style={{ flexShrink: 0, width: '20px', color: 'var(--color-text-muted)' }}>{entry.count}×</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
    </button>
  )
}

/**
 * The card list, flowed down `columns` columns: units, upgrades, events, each by cost, a type with no
 * cards having no heading. A heading is kept with its first card, so it never ends a column alone.
 */
export function DeckList({ deck, cards, show, columns }: {
  deck: ParsedDeck
  cards: Record<string, EngineCard | undefined>
  show: (card: EngineCard | undefined, name: string) => void
  /** CSS `columns`: a count and a narrowest width. */
  columns: string
}) {
  const groups = deckGroups(deckEntries(deck, cards))
  return (
    <div data-testid="deck-list" style={{ columns, columnGap: '18px' }}>
      {groups.map(group => {
        const [first, ...rest] = group.entries
        return (
          <section key={group.title} data-testid={`deck-group-${group.title}`}>
            <div style={{ breakInside: 'avoid' }}>
              <h4 style={HEAD}>{group.title} · {group.copies}</h4>
              <Row entry={first} show={show} />
            </div>
            {rest.map(e => <Row key={e.id} entry={e} show={show} />)}
          </section>
        )
      })}
    </div>
  )
}
