import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { seededUnit } from '../engine/rng'
import { colourBases, settleBase } from './bases'
import {
  deckReport, deckShape, isAlignment, unpaidAspects, type DeckReport,
  MAX_COPIES, MAX_COPIES_BY_RARITY, DUPLICATE_CHANCE, CHEAP_COST_MAX, BOMB_COST_MIN,
} from './rules'

/**
 * The deck generator (#408): build one legal, penalty-free, realistically shaped deck. Deterministic
 * (seeded), so a deck set is reproducible. `generateDeck` builds for a specific leader + base;
 * `buildDeckForLeader` chooses the best base itself. Reusable by the coverage sweep and by a future
 * "play a random representative deck" setup feature.
 *
 * Construction is a scored greedy: fill the base's deck size (30 unless the base changes it) one slot at a time, each slot taking the eligible card
 * that best serves the still-unmet quotas (curve, type caps, rarity mix, alignment balance), with a
 * seeded jitter for deterministic variety. `prefer` biases toward specific cards, which is how the
 * coverage sweep steers the pool toward not-yet-covered cards.
 */

const id = (c: SwuCard): string => `${c.Set}_${c.Number}`
const cost = (c: SwuCard): number => Number(c.Cost ?? 0)

/**
 * What the build aims for in a 30-card deck, as a range rather than a number, scaled with the rules
 * for a base that changes the size. Mid-cost units fill the remainder.
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
  const alignment = (leader.Aspects ?? []).find(isAlignment)
  const shape = deckShape(base, leader)
  const scaled = (t: { base: number; spread: number }) => ({ ...t, base: shape.scale(t.base) })

  // Resolved once per deck, so the shape varies between decks but is fixed while one is being built.
  const cheapTarget = resolveTarget(seed, 1, scaled(CHEAP_TARGET))
  const bombTarget = resolveTarget(seed, 2, scaled(BOMB_TARGET))
  const eventTarget = resolveTarget(seed, 3, scaled(EVENT_TARGET))
  const upgradeTarget = resolveTarget(seed, 4, scaled(UPGRADE_TARGET))
  // Rounded down rather than to nearest: the score admits `alignTarget + 2`, and 11 of 25 rounded up
  // would admit 13, which is over half.
  const alignTarget = resolveTarget(seed, 5, { ...ALIGN_TARGET, base: Math.floor((ALIGN_TARGET.base * shape.size) / 30) })

  const eligible = pool.filter(c =>
    (c.Type === 'Unit' || c.Type === 'Event' || c.Type === 'Upgrade') &&
    unpaidAspects(c, leader, base).length === 0,
  )

  const counts: Counts = {
    size: 0, cheap: 0, bomb: 0, events: 0, upgrades: 0, align: 0,
    rarity: {}, copies: new Map(),
  }
  const chosen: SwuCard[] = []

  const rarityAtMax = (c: SwuCard): boolean => {
    const r = c.Rarity ?? 'Common'
    const cap = shape.rarity[r]?.max ?? shape.size
    return (counts.rarity[r] ?? 0) >= cap
  }
  const rarityBelowMin = (c: SwuCard): boolean => {
    const r = c.Rarity ?? 'Common'
    const min = shape.rarity[r]?.min ?? 0
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
    if (isUnit && cost(c) <= CHEAP_COST_MAX && counts.cheap >= shape.cheapUnits.max) return false
    if (isUnit && cost(c) >= BOMB_COST_MIN && counts.bomb >= shape.bombUnits.max) return false
    if (c.Type === 'Event' && counts.events >= shape.maxEvents) return false
    if (c.Type === 'Upgrade' && counts.upgrades >= shape.maxUpgrades) return false
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
    // Unique limits the board, not the deck: several copies are legal, and only one can be in play at a
    // time. So a Unique is bounded by `MAX_COPIES` like any other card.
    const want = Math.min(require.get(id(c)) ?? 0, MAX_COPIES)
    while ((counts.copies.get(id(c)) ?? 0) < want && counts.size < shape.size) add(c)
  }

  while (counts.size < shape.size) {
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
 * Build a deck for a leader, choosing its base. Deterministic. This is the entry point a single-deck
 * consumer uses. `baseAspect` restricts it to that aspect, including one the leader already carries.
 *
 * Each colour offers one base to build on ({@link colourBases}: common, or rare on a rare roll), the
 * colours are tried in a seeded order, and the first clean deck wins. The built deck is then settled
 * on the base its cards want among those that build the same deck ({@link settleBase}).
 */
export function buildDeckForLeader(leader: SwuCard, pool: SwuCard[], seed: number, prefer?: Set<string>, baseAspect?: string): { deck: ParsedDeck; report: DeckReport } {
  const all = pool.filter(c => c.Type === 'Base')

  /**
   * **A random base never doubles an aspect the leader already supplies**: one colour rarely fills a
   * deck. A named aspect wins, even one the leader carries, since that is a player asking for the
   * doubled cards rather than the generator stumbling into it. Kept as a filter with a fallback: a
   * leader carrying every base aspect would otherwise have no base at all.
   */
  const leaderAspects = new Set(leader.Aspects ?? [])
  const usable = all.filter(b => !(b.Aspects ?? []).some(a => leaderAspects.has(a)))
  const named = baseAspect === undefined ? [] : all.filter(b => (b.Aspects ?? []).includes(baseAspect))
  const allowed = named.length > 0 ? named : usable.length > 0 ? usable : all

  const candidates = colourBases(allowed, seed)
  // Rotated by seed rather than always tried in pool order, which made the first legal colour the
  // answer for almost every leader.
  const start = Math.floor(seededUnit(((seed * 40503) ^ 0x9e37) >>> 0 || 1) * candidates.length)
  let best: { deck: ParsedDeck; report: DeckReport } | undefined
  for (let i = 0; i < candidates.length; i++) {
    const result = generateDeck({ leader, base: candidates[(start + i) % candidates.length], pool, seed, prefer })
    if (!best || result.report.violations.length < best.report.violations.length) best = result
    if (best.report.ok) break
  }
  return { deck: settleBase(best!.deck, pool, seed), report: best!.report }
}
