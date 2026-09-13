import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { seededUnit } from '../engine/rng'
import {
  coveredAspects, deckReport, isAlignment, type DeckReport,
  DECK_SIZE, MAX_COPIES, MAX_COPIES_BY_RARITY, DUPLICATE_CHANCE, CHEAP_COST_MAX, CHEAP_UNITS, BOMB_COST_MIN, BOMB_UNITS,
  MAX_EVENTS, MAX_UPGRADES, RARITY_MIX,
} from './rules'

/**
 * The deck generator (#408): build one legal, penalty-free, realistically shaped deck. Deterministic
 * (seeded), so a deck set is reproducible. `generateDeck` builds for a specific leader + base;
 * `buildDeckForLeader` chooses the best base itself. Reusable by the coverage sweep and by a future
 * "play a random representative deck" setup feature.
 *
 * Construction is a scored greedy: fill 30 slots one at a time, each slot taking the eligible card
 * that best serves the still-unmet quotas (curve, type caps, rarity mix, alignment balance), with a
 * seeded jitter for deterministic variety. `prefer` biases toward specific cards, which is how the
 * coverage sweep steers the pool toward not-yet-covered cards.
 */

const id = (c: SwuCard): string => `${c.Set}_${c.Number}`
const cost = (c: SwuCard): number => Number(c.Cost ?? 0)

/**
 * What the build aims for, as a range rather than a number. Mid-cost units fill the remainder.
 *
 * A fixed target is a quota every deck hits exactly, which describes the constant rather than a
 * deck: before this, every deck had precisely 4 events and 3 upgrades, because the score's +60 for
 * being under target is far larger than the jitter that was meant to vary it. Each range stays
 * inside the legality and shape rules, so a deck built to any point in it still passes `deckReport`.
 */
const CHEAP_TARGET = { base: 8, spread: 1 } // 7-9, inside CHEAP_UNITS 6-10
const BOMB_TARGET = { base: 3, spread: 0 } // BOMB_UNITS allows only 2-3, and 2 reads as light
const EVENT_TARGET = { base: 4, spread: 1 } // 3-5, under MAX_EVENTS 6
const UPGRADE_TARGET = { base: 3, spread: 1 } // 2-4, under MAX_UPGRADES 5
// Fixed, unlike the others. The score tolerates `alignTarget + 2` before it pushes back, so a target
// of 14 admits 16 of 30, which is 0.53 and outside ALIGNMENT_FRACTION's 0.4-0.5. The alignment split
// is a legality-shaped rule rather than a matter of taste, so it does not want jitter.
const ALIGN_TARGET = { base: 13, spread: 0 }

/**
 * A target resolved for one deck. Seeded so the shape is reproducible, and salted per target so the
 * event count and the upgrade count do not move together.
 */
function resolveTarget(seed: number, salt: number, t: { base: number; spread: number }): number {
  if (t.spread === 0) return t.base
  const roll = Math.floor(seededUnit(((seed * 2246822519) ^ salt) >>> 0 || 1) * (2 * t.spread + 1))
  return t.base - t.spread + Math.min(roll, 2 * t.spread)
}
// Coverage steering: preferred (not-yet-covered) cards get this bonus. Moderate on purpose, it
// tips the choice toward uncovered cards WITHIN a role (an uncovered cheap unit over a covered one),
// but stays below the curve role weight (200) so it can never break the curve to chase coverage.
const PREFER_BONUS = 120

export interface GenerateOptions {
  leader: SwuCard
  base: SwuCard
  pool: SwuCard[]
  seed: number
  /** Card ids to prioritise (coverage sweep steers toward not-yet-covered cards). */
  prefer?: Set<string>
  /**
   * Card ids to force in, mapped to how many copies, bypassing the curve and type caps.
   *
   * A count rather than a flag because the two callers want different things from it. The coverage
   * sweep wants one copy, enough to cover a straggler; a deck built to produce a specific board wants
   * the card **drawn**, and one copy in thirty is not a plan. Clamped to `MAX_COPIES`, since a deck
   * that is quietly illegal is worse than one that fails to build.
   */
  require?: Map<string, number>
}

interface Counts {
  size: number
  cheap: number
  bomb: number
  events: number
  upgrades: number
  align: number
  rarity: Record<string, number>
  copies: Map<string, number>
}

/** Deterministic per-card jitter in [0, 1), so tie-breaks vary by seed but are reproducible. */
function jitter(seed: number, card: SwuCard): number {
  return seededUnit(((seed ^ (Number(card.Number) * 2654435761)) >>> 0) || 1)
}

export function generateDeck(opts: GenerateOptions): { deck: ParsedDeck; report: DeckReport } {
  const { leader, base, pool, seed } = opts
  const prefer = opts.prefer ?? new Set<string>()
  const require = opts.require ?? new Map<string, number>()
  const covered = coveredAspects(leader, base)
  const alignment = (leader.Aspects ?? []).find(isAlignment)

  // Resolved once per deck, so the shape varies between decks but is fixed while one is being built.
  const cheapTarget = resolveTarget(seed, 1, CHEAP_TARGET)
  const bombTarget = resolveTarget(seed, 2, BOMB_TARGET)
  const eventTarget = resolveTarget(seed, 3, EVENT_TARGET)
  const upgradeTarget = resolveTarget(seed, 4, UPGRADE_TARGET)
  const alignTarget = resolveTarget(seed, 5, ALIGN_TARGET)

  const eligible = pool.filter(c =>
    (c.Type === 'Unit' || c.Type === 'Event' || c.Type === 'Upgrade') &&
    (c.Aspects ?? []).every(a => covered.has(a)),
  )

  const counts: Counts = {
    size: 0, cheap: 0, bomb: 0, events: 0, upgrades: 0, align: 0,
    rarity: {}, copies: new Map(),
  }
  const chosen: SwuCard[] = []

  const rarityAtMax = (c: SwuCard): boolean => {
    const r = c.Rarity ?? 'Common'
    const cap = RARITY_MIX[r as keyof typeof RARITY_MIX]?.max ?? DECK_SIZE
    return (counts.rarity[r] ?? 0) >= cap
  }
  const rarityBelowMin = (c: SwuCard): boolean => {
    const r = c.Rarity ?? 'Common'
    const min = RARITY_MIX[r as keyof typeof RARITY_MIX]?.min ?? 0
    return (counts.rarity[r] ?? 0) < min
  }

  /**
   * Whether another copy of `c` is allowed: a **roll**, not a cap, at the rarity's duplicate chance.
   *
   * Seeded on the card and on which copy this would be, so a deck is still reproducible from its seed
   * and the second copy's roll is independent of the third's. The cap stays as a backstop for the
   * tail the geometric distribution leaves open.
   */
  const copiesAtMax = (c: SwuCard): boolean => {
    const have = counts.copies.get(id(c)) ?? 0
    if (have === 0) return false
    if (have >= (MAX_COPIES_BY_RARITY[c.Rarity ?? 'Common'] ?? MAX_COPIES)) return true
    const chance = DUPLICATE_CHANCE[c.Rarity ?? 'Common'] ?? 0
    return jitter(seed * 7919 + have * 104729, c) >= chance
  }

  const allowed = (c: SwuCard): boolean => {
    if (copiesAtMax(c)) return false
    if (rarityAtMax(c)) return false
    const isUnit = c.Type === 'Unit'
    if (isUnit && cost(c) <= CHEAP_COST_MAX && counts.cheap >= CHEAP_UNITS.max) return false
    if (isUnit && cost(c) >= BOMB_COST_MIN && counts.bomb >= BOMB_UNITS.max) return false
    if (c.Type === 'Event' && counts.events >= MAX_EVENTS) return false
    if (c.Type === 'Upgrade' && counts.upgrades >= MAX_UPGRADES) return false
    return true
  }

  const score = (c: SwuCard): number => {
    let s = jitter(seed, c) * 0.5
    if (prefer.has(id(c))) s += PREFER_BONUS
    const isUnit = c.Type === 'Unit'
    const cst = cost(c)
    if (isUnit && cst <= CHEAP_COST_MAX && counts.cheap < cheapTarget) s += 200
    if (isUnit && cst >= BOMB_COST_MIN && counts.bomb < bombTarget) s += 200
    if (isUnit && cst > CHEAP_COST_MAX && cst < BOMB_COST_MIN) s += 40
    if (c.Type === 'Event' && counts.events < eventTarget) s += 60
    if (c.Type === 'Upgrade' && counts.upgrades < upgradeTarget) s += 60
    if (rarityBelowMin(c)) s += 90
    if (alignment) {
      const a = (c.Aspects ?? []).includes(alignment)
      if (a && counts.align < alignTarget) s += 130
      if (!a && counts.align >= alignTarget) s += 40
      if (a && counts.align >= alignTarget + 2) s -= 300
    }
    return s
  }

  const add = (c: SwuCard): void => {
    chosen.push(c)
    counts.size++
    counts.copies.set(id(c), (counts.copies.get(id(c)) ?? 0) + 1)
    const r = c.Rarity ?? 'Common'
    counts.rarity[r] = (counts.rarity[r] ?? 0) + 1
    if (c.Type === 'Unit' && cost(c) <= CHEAP_COST_MAX) counts.cheap++
    if (c.Type === 'Unit' && cost(c) >= BOMB_COST_MIN) counts.bomb++
    if (c.Type === 'Event') counts.events++
    if (c.Type === 'Upgrade') counts.upgrades++
    if (alignment && (c.Aspects ?? []).includes(alignment)) counts.align++
  }

  // Force-include required cards first (they bypass the caps), so a targeted straggler deck is
  // guaranteed to cover its card. Only eligible (penalty-free) ones can be forced.
  for (const c of eligible) {
    // A unique card is one copy whatever was asked for, so a wall package naming three of a Unique
    // does not quietly build an illegal deck. `MAX_COPIES` bounds the rest.
    const want = Math.min(require.get(id(c)) ?? 0, c.Unique ? 1 : MAX_COPIES)
    while ((counts.copies.get(id(c)) ?? 0) < want && counts.size < DECK_SIZE) add(c)
  }

  while (counts.size < DECK_SIZE) {
    let best: SwuCard | undefined
    let bestScore = -Infinity
    for (const c of eligible) {
      if (!allowed(c)) continue
      const sc = score(c)
      if (sc > bestScore) { bestScore = sc; best = c }
    }
    if (!best) break // pool exhausted under the caps; report will flag the short size
    add(best)
  }

  // Group into { id, count } entries, in a stable order.
  const grouped = new Map<string, number>()
  for (const c of chosen) grouped.set(id(c), (grouped.get(id(c)) ?? 0) + 1)
  const cards = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cid, count]) => ({ id: cid, count }))

  const deck: ParsedDeck = { name: `${leader.Name} (${base.Aspects?.[0] ?? 'base'})`, leader: id(leader), base: id(base), cards }
  const byIdMap = new Map(pool.map(c => [id(c), c]))
  return { deck, report: deckReport(deck, byIdMap) }
}

/**
 * Build a deck for a leader, choosing the base that yields the best (fewest violations) deck. Tries
 * each distinct base aspect; deterministic. This is the entry point a single-deck consumer uses.
 */
export function buildDeckForLeader(leader: SwuCard, pool: SwuCard[], seed: number, prefer?: Set<string>): { deck: ParsedDeck; report: DeckReport } {
  const bases = pool.filter(c => c.Type === 'Base')
  // One representative base per distinct aspect (bases are mechanically identical, aspect aside).
  const byAspect = new Map<string, SwuCard>()
  for (const b of bases) {
    const key = (b.Aspects ?? []).join(',')
    if (!byAspect.has(key)) byAspect.set(key, b)
  }

  /**
   * **Never double an aspect the leader already supplies.** This set has no card with a doubled
   * aspect, so the overlap buys nothing and one colour cannot fill a deck. Kept as a filter with a
   * fallback rather than an assumption: a leader carrying every base aspect would otherwise have no
   * base at all.
   */
  const leaderAspects = new Set(leader.Aspects ?? [])
  const usable = [...byAspect.values()]
    .filter(b => !(b.Aspects ?? []).some(a => leaderAspects.has(a)))
  const candidates = usable.length > 0 ? usable : [...byAspect.values()]

  // Rotated by seed rather than always tried in pool order, which made the first legal base the
  // answer for almost every leader: two leaders sharing no aspect were landing on the same base.
  const start = Math.floor(seededUnit(((seed * 40503) ^ 0x9e37) >>> 0 || 1) * candidates.length)
  let best: { deck: ParsedDeck; report: DeckReport } | undefined
  for (let i = 0; i < candidates.length; i++) {
    const base = candidates[(start + i) % candidates.length]
    const result = generateDeck({ leader, base, pool, seed, prefer })
    if (!best || result.report.violations.length < best.report.violations.length) best = result
    if (best.report.ok) break
  }
  return best!
}
