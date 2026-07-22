import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'

/**
 * The deck-construction rules for the coverage/representative deck generator (#408), encoded as a
 * checkable report. Two kinds of rule:
 *
 * - **Legality** (hard): exactly 30 cards, at most 3 copies of a card, and every card covered by the
 *   leader + base aspects so nothing takes an aspect penalty.
 * - **Realism shape** (targets): a sane curve, type caps, a pack-like rarity mix, and (for a leader
 *   with an alignment) 40-50% of the deck carrying that alignment. These make decks playable rather
 *   than random piles.
 *
 * The generator builds decks to satisfy this; the coverage sweep relies on it to explain any deck it
 * could not build cleanly. Thresholds come from the format and the observed pack distribution.
 */

export const ALIGNMENTS = ['Heroism', 'Villainy']
export const DECK_SIZE = 30
export const MAX_COPIES = 3
export const CHEAP_COST_MAX = 2
export const CHEAP_UNITS = { min: 6, max: 10 }
export const BOMB_COST_MIN = 7
export const BOMB_UNITS = { min: 2, max: 3 }
export const MAX_UPGRADES = 5
export const MAX_EVENTS = 6
export const RARITY_MIX = {
  Common: { min: 15, max: 20 },
  Uncommon: { min: 5, max: 10 },
  Rare: { min: 0, max: 5 },
  Legendary: { min: 0, max: 3 },
  Special: { min: 0, max: 3 },
}
export const ALIGNMENT_FRACTION = { min: 0.4, max: 0.5 }

export function isAlignment(aspect: string): boolean {
  return ALIGNMENTS.includes(aspect)
}

/** Aspects a leader + base cover; a card is penalty-free iff its aspects are a subset of this. */
export function coveredAspects(leader: SwuCard, base: SwuCard): Set<string> {
  return new Set([...(leader.Aspects ?? []), ...(base.Aspects ?? [])])
}

export interface DeckReport {
  ok: boolean
  size: number
  violations: string[]
  counts: { units: number; events: number; upgrades: number; cheapUnits: number; bombUnits: number }
  rarity: Record<string, number>
  alignmentFraction: number
}

const cost = (card: SwuCard): number => Number(card.Cost ?? 0)

/** Flatten a deck's `{ id, count }` entries into resolved cards (with multiplicity). */
function expand(deck: ParsedDeck, byId: Map<string, SwuCard>): SwuCard[] {
  const out: SwuCard[] = []
  for (const entry of deck.cards) {
    const card = byId.get(entry.id)
    if (!card) throw new Error(`deckReport: no card data for ${entry.id}`)
    for (let i = 0; i < entry.count; i++) out.push(card)
  }
  return out
}

/** Check a deck against every rule, returning a report whose `violations` is empty iff it is valid. */
export function deckReport(deck: ParsedDeck, byId: Map<string, SwuCard>): DeckReport {
  const leader = byId.get(deck.leader)
  const base = byId.get(deck.base)
  if (!leader || !base) throw new Error('deckReport: missing leader/base card data')
  const cards = expand(deck, byId)
  const covered = coveredAspects(leader, base)
  const leaderAlignment = (leader.Aspects ?? []).find(isAlignment)

  const counts = {
    units: cards.filter(c => c.Type === 'Unit').length,
    events: cards.filter(c => c.Type === 'Event').length,
    upgrades: cards.filter(c => c.Type === 'Upgrade').length,
    cheapUnits: cards.filter(c => c.Type === 'Unit' && cost(c) <= CHEAP_COST_MAX).length,
    bombUnits: cards.filter(c => c.Type === 'Unit' && cost(c) >= BOMB_COST_MIN).length,
  }
  const rarity: Record<string, number> = {}
  for (const c of cards) rarity[c.Rarity ?? 'Unknown'] = (rarity[c.Rarity ?? 'Unknown'] ?? 0) + 1

  const alignmentCards = leaderAlignment ? cards.filter(c => (c.Aspects ?? []).includes(leaderAlignment)).length : 0
  const alignmentFraction = cards.length ? alignmentCards / cards.length : 0

  const violations: string[] = []
  const inRange = (n: number, r: { min: number; max: number }) => n >= r.min && n <= r.max

  if (cards.length !== DECK_SIZE) violations.push(`size ${cards.length} != ${DECK_SIZE}`)
  for (const entry of deck.cards) {
    if (entry.count > MAX_COPIES) violations.push(`${entry.count} copies of ${entry.id} (> ${MAX_COPIES})`)
  }
  for (const c of cards) {
    const off = (c.Aspects ?? []).filter(a => !covered.has(a))
    if (off.length) { violations.push(`off-aspect card ${c.Set}_${c.Number} (${off.join(',')})`); break }
  }
  if (!inRange(counts.cheapUnits, CHEAP_UNITS)) violations.push(`cheap units ${counts.cheapUnits} not in ${CHEAP_UNITS.min}-${CHEAP_UNITS.max} (curve)`)
  if (!inRange(counts.bombUnits, BOMB_UNITS)) violations.push(`bomb units ${counts.bombUnits} not in ${BOMB_UNITS.min}-${BOMB_UNITS.max} (curve)`)
  if (counts.upgrades > MAX_UPGRADES) violations.push(`upgrades ${counts.upgrades} > ${MAX_UPGRADES}`)
  if (counts.events > MAX_EVENTS) violations.push(`events ${counts.events} > ${MAX_EVENTS}`)
  for (const [name, r] of Object.entries(RARITY_MIX)) {
    if (!inRange(rarity[name] ?? 0, r)) violations.push(`${name.toLowerCase()} ${rarity[name] ?? 0} not in ${r.min}-${r.max}`)
  }
  if (leaderAlignment && !inRange(alignmentFraction, ALIGNMENT_FRACTION)) {
    violations.push(`alignment fraction ${alignmentFraction.toFixed(2)} not in ${ALIGNMENT_FRACTION.min}-${ALIGNMENT_FRACTION.max}`)
  }

  return { ok: violations.length === 0, size: cards.length, violations, counts, rarity, alignmentFraction }
}
