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
/**
 * Copies of one card a sealed pool realistically yields, by rarity.
 *
 * **Not a rule of the game.** The 3-copy cap is a constructed-format rule and does not apply in
 * sealed: you may play every copy you opened, five included. What limits you is how unlikely a
 * duplicate is, and that is entirely a function of rarity. A six-pack pool yields roughly 0-3
 * Legendaries in total and essentially never two of the same, a duplicate Rare only a few percent of
 * the time, and 2 or at a push 3 of a given Common.
 *
 * This stands in for a pool the generator does not yet model, which is the real fix: it builds from
 * the **whole set** under rarity quotas, so before this a flat cap let it take three copies of a
 * Legendary, and the first matrix duly put three Zeb Orrelios into four decks.
 *
 * `Special` covers 2 leaders, 6 units and 2 upgrades in this set. The two **leaders** are guaranteed
 * to every player at prerelease and so are always available to build around, but that is a leader
 * availability rule rather than a copy count. The Special non-leaders are about as likely as a
 * Legendary, hence the same cap.
 */
export const MAX_COPIES_BY_RARITY: Record<string, number> = {
  Common: 3,
  Uncommon: 2,
  Rare: 1,
  Legendary: 1,
  Special: 1,
}

/**
 * Chance that a card already in the deck gets **another** copy, by rarity.
 *
 * Rolled per extra copy, so the copies of a card follow a geometric distribution: a Common is
 * doubled 40% of the time and tripled 16%, a Rare doubled 3% of the time, and a Legendary
 * essentially never. That is the shape of opening packs, where a duplicate is a draw rather than a
 * deckbuilding decision, and it replaces {@link MAX_COPIES_BY_RARITY} as the thing that actually
 * governs copy counts; the caps remain only as a backstop.
 *
 * Still an approximation of a pool rather than a pool. The real fix opens six packs and builds from
 * what came out, which would make these probabilities an emergent property instead of a constant.
 */
export const DUPLICATE_CHANCE: Record<string, number> = {
  Common: 0.40,
  Uncommon: 0.10,
  Rare: 0.03,
  Legendary: 0.0001,
  Special: 0.0001,
}
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
