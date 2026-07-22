import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { seededUnit } from '../engine/rng'
import {
  coveredAspects, deckReport, isAlignment, type DeckReport,
  DECK_SIZE, MAX_COPIES, CHEAP_COST_MAX, CHEAP_UNITS, BOMB_COST_MIN, BOMB_UNITS,
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

// In-deck targets the greedy aims for (all inside the rule ranges); mid units fill the remainder.
const CHEAP_TARGET = 8
const BOMB_TARGET = 3
const EVENT_TARGET = 4
const UPGRADE_TARGET = 3
const ALIGN_TARGET = 13 // ~43% of 30, inside 40-50%
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
  /** Card ids to force in (bypassing caps), so a straggler deck definitely covers its target. */
  require?: Set<string>
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
  const require = opts.require ?? new Set<string>()
  const covered = coveredAspects(leader, base)
  const alignment = (leader.Aspects ?? []).find(isAlignment)

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

  const allowed = (c: SwuCard): boolean => {
    if ((counts.copies.get(id(c)) ?? 0) >= MAX_COPIES) return false
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
    if (isUnit && cst <= CHEAP_COST_MAX && counts.cheap < CHEAP_TARGET) s += 200
    if (isUnit && cst >= BOMB_COST_MIN && counts.bomb < BOMB_TARGET) s += 200
    if (isUnit && cst > CHEAP_COST_MAX && cst < BOMB_COST_MIN) s += 40
    if (c.Type === 'Event' && counts.events < EVENT_TARGET) s += 60
    if (c.Type === 'Upgrade' && counts.upgrades < UPGRADE_TARGET) s += 60
    if (rarityBelowMin(c)) s += 90
    if (alignment) {
      const a = (c.Aspects ?? []).includes(alignment)
      if (a && counts.align < ALIGN_TARGET) s += 130
      if (!a && counts.align >= ALIGN_TARGET) s += 40
      if (a && counts.align >= ALIGN_TARGET + 2) s -= 300
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
    if (require.has(id(c)) && (counts.copies.get(id(c)) ?? 0) === 0 && counts.size < DECK_SIZE) add(c)
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

  let best: { deck: ParsedDeck; report: DeckReport } | undefined
  for (const base of byAspect.values()) {
    const result = generateDeck({ leader, base, pool, seed, prefer })
    if (!best || result.report.violations.length < best.report.violations.length) best = result
    if (best.report.ok) break
  }
  return best!
}
