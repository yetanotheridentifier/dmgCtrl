import { winRate } from '../../data/matchups'
import type { WinLoss } from '../../data/matchups'
import type { EngineCard } from '../../engine/types'
import type { ParsedDeck } from '../../utils/parseProtectThePod'
import { cardRefFromId } from '../../utils/parseProtectThePod'

/**
 * What the setup screen says about a deck, worked out from the deck and the cards it names: its list,
 * grouped and ordered the way a decklist is read, and the summary on the deck card.
 */

/** One line of a deck list. `card` is absent for a card the lookup does not hold yet. */
export interface DeckEntry {
  id: string
  count: number
  name: string
  cost: number
  type: string
  card?: EngineCard
}

export interface DeckGroup {
  title: string
  copies: number
  entries: DeckEntry[]
}

/** The order a decklist is read in. Anything else (a card not looked up yet) follows, as Other. */
const GROUPS: { type: string; title: string }[] = [
  { type: 'unit', title: 'Units' },
  { type: 'upgrade', title: 'Upgrades' },
  { type: 'event', title: 'Events' },
]

/** The deck's cards, by cost and then name: the order a curve is read in, and stable between renders. */
export function deckEntries(deck: ParsedDeck, cards: Record<string, EngineCard | undefined>): DeckEntry[] {
  return deck.cards
    .map(({ id, count }) => {
      const card = cards[id]
      return { id, count, card, name: card?.name ?? id, cost: card?.cost ?? 0, type: card?.type ?? '?' }
    })
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name))
}

/** The entries in their groups, units first. A type with no cards has no group. */
export function deckGroups(entries: DeckEntry[]): DeckGroup[] {
  const known = new Set(GROUPS.map(g => g.type))
  return [...GROUPS, { type: '', title: 'Other' }]
    .map(({ type, title }) => {
      const inGroup = entries.filter(e => (type ? e.type === type : !known.has(e.type)))
      return { title, copies: inGroup.reduce((n, e) => n + e.count, 0), entries: inGroup }
    })
    .filter(g => g.entries.length > 0)
}

/** "19 units, 4 upgrades, 7 events": the groups as a line. */
export function typeSummary(groups: DeckGroup[]): string {
  return groups
    .map(g => {
      const noun = g.title.toLowerCase()
      return `${g.copies} ${g.copies === 1 ? noun.replace(/s$/, '') : noun}`
    })
    .join(', ')
}

/** The labels of the cost curve's bars: 1 or less, each cost to 6, then 7 or more. */
export const CURVE_LABELS = ['1', '2', '3', '4', '5', '6', '7+']

/** Copies at each cost, bucketed as `CURVE_LABELS`. */
export function costCurve(entries: Pick<DeckEntry, 'cost' | 'count'>[]): number[] {
  const curve = CURVE_LABELS.map(() => 0)
  for (const e of entries) curve[Math.min(Math.max(e.cost, 1), 7) - 1] += e.count
  return curve
}

/** The total number of cards in the deck, leader and base aside. */
export function cardCount(deck: ParsedDeck): number {
  return deck.cards.reduce((n, c) => n + c.count, 0)
}

/**
 * The set a deck is from, read from its leader: an imported deck names no set of its own, so a deck
 * mixing sets is matched to its leader's.
 */
export function deckSet(deck: ParsedDeck): string | null {
  return cardRefFromId(deck.leader)?.set.toUpperCase() ?? null
}

/** "Darth Vader · Administrator's Tower · SOR": what a deck row says under the deck's name. */
export function deckLine(deck: ParsedDeck, cards: Record<string, EngineCard | undefined>, withSet = true): string {
  const name = (id: string) => cards[id]?.name ?? id
  return [name(deck.leader), name(deck.base), ...(withSet ? [deckSet(deck) ?? ''] : [])].filter(Boolean).join(' · ')
}

/**
 * "3-2, 60%": the player's wins and losses against a deck (and draws, "1-1-1", only when there are
 * some) and the share of games won. Nothing for a deck never played. Its hyphens and space do not
 * break, so a line that wraps never splits it.
 */
export function recordLine(record: WinLoss | undefined): string | undefined {
  if (!record) return undefined
  const { won, lost, drawn } = record
  return `${[won, lost, ...(drawn > 0 ? [drawn] : [])].join(NB_HYPHEN)},${NB_SPACE}${winRate(record)}`
}

export const NB_HYPHEN = '‑'
export const NB_SPACE = ' '

/** The leader's aspects, then the base's. A base with none (Lake Country) adds nothing. */
export function deckAspects(deck: ParsedDeck, cards: Record<string, EngineCard | undefined>): string[] {
  return [...(cards[deck.leader]?.aspects ?? []), ...(cards[deck.base]?.aspects ?? [])]
}
