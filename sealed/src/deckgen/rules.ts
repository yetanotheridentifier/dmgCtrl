import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { minimumDeckSize } from '../utils/parseProtectThePod'
import { alternativeAspects } from '../engine/cardDb'

/**
 * The deck-construction rules for the coverage/representative deck generator (#408), encoded as a
 * checkable report. Two kinds of rule:
 *
 * - **Legality** (hard): exactly the base's deck size (30 unless the base changes it), at most 3
 *   copies of a card, and every aspect icon on every card paid by the leader + base so nothing takes
 *   an aspect penalty.
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

/**
 * The aspects a card would take a penalty for: each icon on it needs one icon from the leader or the
 * base, so a card showing two Command needs two between them. Empty when the card is penalty-free.
 *
 * A card with another way to be played (Smuggle, Piloting) is penalty-free when any one of its ways
 * is paid, since that way can be played without the penalty. When none is, the printed aspects are
 * the ones named.
 */
export function unpaidAspects(card: SwuCard, leader: SwuCard, base: SwuCard): string[] {
  const unpaidFor = (aspects: string[]): string[] => {
    const supply = new Map<string, number>()
    for (const a of [...(leader.Aspects ?? []), ...(base.Aspects ?? [])]) supply.set(a, (supply.get(a) ?? 0) + 1)
    const unpaid: string[] = []
    for (const a of aspects) {
      const left = supply.get(a) ?? 0
      if (left > 0) supply.set(a, left - 1)
      else if (!unpaid.includes(a)) unpaid.push(a)
    }
    return unpaid
  }
  const printed = unpaidFor(card.Aspects ?? [])
  if (printed.length === 0) return printed
  return alternativeAspects(card).some(aspects => unpaidFor(aspects).length === 0) ? [] : printed
}

/** Chance that a generated deck is built on a rare base, where its set prints any: a rare a pool has to open. */
export const RARE_BASE_CHANCE = 1 / 25

/** A base from a pack's rare slot rather than its common one: Rare, Legendary or Special. */
export function isRareBase(base: SwuCard): boolean {
  return (base.Rarity ?? 'Common') !== 'Common'
}

type Range = { min: number; max: number }

/** The shape rules for one deck, sized to its base. */
export interface DeckShape {
  size: number
  cheapUnits: Range
  bombUnits: Range
  maxEvents: number
  maxUpgrades: number
  rarity: Record<string, Range>
  /** Scale a count tuned for {@link DECK_SIZE} to this deck's size. */
  scale: (n: number) => number
}

/**
 * The rules above are tuned for a 30-card deck, so a base that changes the size scales them with it:
 * a 40-card Data Vault deck has room for more cheap units and more rares, and a 25-card Thermal
 * Oscillator deck less. A scaled range rounds outward (minimum down, maximum up), since a pool that
 * fills a 30-card shape exactly need not fill a scaled one to the card. A rare base also took a rare
 * slot in the pool, so it leaves one rare fewer for the deck.
 *
 * A base repeating the leader's colour makes a one-colour deck, which draws its big units from one
 * colour's pool, and one colour may not print two it can play (SOR's Aggression and Cunning print one
 * each). It needs one fewer. A random deck never repeats the colour, so this only reaches a pairing
 * chosen for its doubled cards.
 */
export function deckShape(base: SwuCard, leader: SwuCard): DeckShape {
  const size = minimumDeckSize(`${base.Set}_${base.Number}`)
  const ratio = size / DECK_SIZE
  const scale = (n: number) => Math.round(n * ratio)
  const range = (r: Range): Range => ({ min: Math.floor(r.min * ratio), max: Math.ceil(r.max * ratio) })
  const rarity: Record<string, Range> = Object.fromEntries(Object.entries(RARITY_MIX).map(([name, r]) => [name, range(r)]))
  if (isRareBase(base)) rarity.Rare = { ...rarity.Rare, max: Math.max(0, rarity.Rare.max - 1) }
  const bombUnits = range(BOMB_UNITS)
  const oneColour = (base.Aspects ?? []).some(a => (leader.Aspects ?? []).includes(a))
  if (oneColour) bombUnits.min = Math.max(1, bombUnits.min - 1)
  return {
    size,
    cheapUnits: range(CHEAP_UNITS),
    bombUnits,
    maxEvents: Math.ceil(MAX_EVENTS * ratio),
    maxUpgrades: Math.ceil(MAX_UPGRADES * ratio),
    rarity,
    scale,
  }
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
  const shape = deckShape(base, leader)
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

  if (cards.length !== shape.size) violations.push(`size ${cards.length} != ${shape.size}`)
  for (const entry of deck.cards) {
    if (entry.count > MAX_COPIES) violations.push(`${entry.count} copies of ${entry.id} (> ${MAX_COPIES})`)
  }
  for (const c of cards) {
    const off = unpaidAspects(c, leader, base)
    if (off.length) { violations.push(`off-aspect card ${c.Set}_${c.Number} (${off.join(',')})`); break }
  }
  const { cheapUnits, bombUnits, maxUpgrades, maxEvents } = shape
  if (!inRange(counts.cheapUnits, cheapUnits)) violations.push(`cheap units ${counts.cheapUnits} not in ${cheapUnits.min}-${cheapUnits.max} (curve)`)
  if (!inRange(counts.bombUnits, bombUnits)) violations.push(`bomb units ${counts.bombUnits} not in ${bombUnits.min}-${bombUnits.max} (curve)`)
  if (counts.upgrades > maxUpgrades) violations.push(`upgrades ${counts.upgrades} > ${maxUpgrades}`)
  if (counts.events > maxEvents) violations.push(`events ${counts.events} > ${maxEvents}`)
  for (const [name, r] of Object.entries(shape.rarity)) {
    if (!inRange(rarity[name] ?? 0, r)) violations.push(`${name.toLowerCase()} ${rarity[name] ?? 0} not in ${r.min}-${r.max}`)
  }
  if (leaderAlignment && !inRange(alignmentFraction, ALIGNMENT_FRACTION)) {
    violations.push(`alignment fraction ${alignmentFraction.toFixed(2)} not in ${ALIGNMENT_FRACTION.min}-${ALIGNMENT_FRACTION.max}`)
  }

  return { ok: violations.length === 0, size: cards.length, violations, counts, rarity, alignmentFraction }
}
