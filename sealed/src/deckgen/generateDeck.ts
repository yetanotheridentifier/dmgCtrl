import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { minimumDeckSize } from '../utils/parseProtectThePod'
import { seededUnit } from '../engine/rng'
import { settleBase } from './bases'
import { isTurnOnePlay, playedCost, removalKind, removalWeight } from './cardRoles'
import { heuristicScorer, summarisePairing, type DeckScorer } from './scorer'
import {
  deckReport, deckShape, isAlignment, isRareBase, unpaidAspects, unpaidIcons, type DeckReport,
  MAX_COPIES, MAX_COPIES_BY_RARITY, DUPLICATE_CHANCE, CHEAP_COST_MAX, BOMB_COST_MIN,
  MAX_SPLASHES, REMOVAL_PLAYS, TURN_ONE_PLAYS,
} from './rules'

/**
 * The deck generator: build one realistically shaped deck. Deterministic (seeded), so a deck set is
 * reproducible. `generateDeck` builds for a specific leader + base, from the whole set (the coverage
 * sweep) or from an opened pool (`available`); `buildDeckFromPool` builds from a pool as a player
 * would, choosing the leader and base itself, for the setup screen's generated deck and the bench's
 * matchup suites.
 *
 * Construction is a scored greedy: fill the base's deck size (30 unless the base changes it) one slot
 * at a time, each slot taking the eligible card that best serves the still-unmet quotas (curve, type
 * caps, rarity mix, alignment balance), with a seeded jitter for deterministic variety. `prefer`
 * biases toward specific cards, which is how the coverage sweep steers toward not-yet-covered cards.
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
  /**
   * Copies of each card a sealed pool opened. When given, a card is limited to the copies opened and
   * the duplicate roll is not made: a pool's duplicates are whatever came out of the packs.
   */
  available?: Map<string, number>
  /**
   * Build as a player builds a pool deck: the fill leans toward {@link TURN_ONE_PLAYS} and
   * {@link REMOVAL_PLAYS}, and up to {@link MAX_SPLASHES} off-aspect cards are taken on purpose when
   * the scorer values them above the on-aspect card each replaces. The coverage sweep leaves it out,
   * so its whole-set decks stay as they were.
   */
  scorer?: DeckScorer
}

interface Counts {
  size: number
  cheap: number
  bomb: number
  events: number
  upgrades: number
  align: number
  turnOne: number
  removal: number
  rarity: Record<string, number>
  copies: Map<string, number>
}

/**
 * Off-aspect cards a deck may take on purpose: one missing icon, so the penalty is 2, and a card worth
 * paying it for, a Rare, a Legendary or removal.
 *
 * A known limitation: a leader or base that waives or discounts the penalty (a free splash from some
 * leaders, LAW's bases) is not modelled, so such a deck splashes as though it paid in full.
 */
function splashable(card: SwuCard, leader: SwuCard, base: SwuCard): boolean {
  if (unpaidIcons(card, leader, base).length !== 1) return false
  return card.Rarity === 'Rare' || card.Rarity === 'Legendary' || removalKind(card) === 'removal'
}

/** Deterministic per-card jitter in [0, 1), so tie-breaks vary by seed but are reproducible. */
function jitter(seed: number, card: SwuCard): number {
  return seededUnit(((seed ^ (Number(card.Number) * 2654435761)) >>> 0) || 1)
}

export function generateDeck(opts: GenerateOptions): { deck: ParsedDeck; report: DeckReport; splashes: string[] } {
  const { leader, base, pool, seed, scorer } = opts
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

  const deckCards = pool.filter(c => c.Type === 'Unit' || c.Type === 'Event' || c.Type === 'Upgrade')
  const eligible = deckCards.filter(c => unpaidAspects(c, leader, base).length === 0)
  const offAspect = deckCards.filter(c => unpaidAspects(c, leader, base).length > 0)

  const counts: Counts = {
    size: 0, cheap: 0, bomb: 0, events: 0, upgrades: 0, align: 0, turnOne: 0, removal: 0,
    rarity: {}, copies: new Map(),
  }
  const turnOne = (c: SwuCard): boolean => isTurnOnePlay(c, leader, base)
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
    if (opts.available) return have >= (opts.available.get(id(c)) ?? 0)
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
    if (scorer) {
      // Strong below each guideline's minimum, mild up to its maximum, nothing past it.
      if (turnOne(c)) s += counts.turnOne < TURN_ONE_PLAYS.min ? 150 : counts.turnOne < TURN_ONE_PLAYS.max ? 30 : 0
      const w = removalWeight(c)
      if (w > 0) s += w * (counts.removal < REMOVAL_PLAYS.min ? 150 : counts.removal < REMOVAL_PLAYS.max ? 50 : 0)
    }
    return s
  }

  /** Count a card into the deck (`n` 1) or back out of it (`n` -1). */
  const tally = (c: SwuCard, n: 1 | -1): void => {
    counts.size += n
    counts.copies.set(id(c), (counts.copies.get(id(c)) ?? 0) + n)
    const r = c.Rarity ?? 'Common'
    counts.rarity[r] = (counts.rarity[r] ?? 0) + n
    if (c.Type === 'Unit' && cost(c) <= CHEAP_COST_MAX) counts.cheap += n
    if (c.Type === 'Unit' && cost(c) >= BOMB_COST_MIN) counts.bomb += n
    if (c.Type === 'Event') counts.events += n
    if (c.Type === 'Upgrade') counts.upgrades += n
    if (alignment && (c.Aspects ?? []).includes(alignment)) counts.align += n
    if (turnOne(c)) counts.turnOne += n
    counts.removal += n * removalWeight(c)
  }
  const add = (c: SwuCard): void => {
    chosen.push(c)
    tally(c, 1)
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
    // A sealed pool rarely meets every shape cap, and a player fills the deck regardless, so for a
    // pool the caps give way to the deck size: the best card with a copy left, whatever its role.
    if (!best && opts.available) {
      for (const c of eligible) {
        if (copiesAtMax(c)) continue
        const sc = score(c)
        if (sc > bestScore) { bestScore = sc; best = c }
      }
    }
    // A pool too thin in the deck's aspects (a one-aspect leader, most often) is filled the way a
    // player fills it: off-aspect cards paying the penalty, the fewest unpaid icons first.
    if (!best && opts.available) {
      for (const c of offAspect) {
        if (copiesAtMax(c)) continue
        const sc = score(c) - 1000 * unpaidAspects(c, leader, base).length
        if (sc > bestScore) { bestScore = sc; best = c }
      }
    }
    if (!best) break // pool exhausted under the caps; report will flag the short size
    add(best)
  }

  /**
   * Deliberate splashes, best first: each replaces the weakest on-aspect card of its kind (type, and for
   * a unit its cost band as played) when the scorer values it higher. A card the deck needs to stay at a
   * guideline's minimum (a turn-1 play, removal) is not given up for one that is not.
   */
  function splash(s: DeckScorer): string[] {
    const value = (c: SwuCard) => s.card(c, playedCost(c, leader, base))
    const kind = (c: SwuCard): string => {
      if (c.Type !== 'Unit') return c.Type
      const played = playedCost(c, leader, base)
      return played <= CHEAP_COST_MAX ? 'cheap' : played >= BOMB_COST_MIN ? 'bomb' : 'mid'
    }
    const spare = (out: SwuCard, inn: SwuCard): boolean =>
      (!turnOne(out) || turnOne(inn) || counts.turnOne > TURN_ONE_PLAYS.min)
      && counts.removal - removalWeight(out) + removalWeight(inn) >= Math.min(REMOVAL_PLAYS.min, counts.removal)
    const taken: string[] = []
    const candidates = offAspect.filter(c => splashable(c, leader, base))
      .sort((a, b) => value(b) - value(a) || id(a).localeCompare(id(b)))
    for (const c of candidates) {
      while (taken.length < MAX_SPLASHES && !copiesAtMax(c)) {
        const out = chosen
          .filter(d => kind(d) === kind(c) && unpaidAspects(d, leader, base).length === 0 && !require.has(id(d)) && spare(d, c))
          .reduce<SwuCard | undefined>((w, d) => (w === undefined || value(d) < value(w) ? d : w), undefined)
        if (!out || value(c) <= value(out)) break
        chosen.splice(chosen.indexOf(out), 1)
        tally(out, -1)
        add(c)
        taken.push(id(c))
      }
    }
    return taken
  }
  const splashes = scorer ? splash(scorer) : []

  // Group into { id, count } entries, in a stable order.
  const grouped = new Map<string, number>()
  for (const c of chosen) grouped.set(id(c), (grouped.get(id(c)) ?? 0) + 1)
  const cards = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cid, count]) => ({ id: cid, count }))

  const deck: ParsedDeck = { name: `${leader.Name} (${base.Aspects?.[0] ?? 'base'})`, leader: id(leader), base: id(base), cards }
  const byIdMap = new Map(pool.map(c => [id(c), c]))
  return { deck, report: deckReport(deck, byIdMap, { fromPool: opts.available !== undefined }), splashes }
}

/**
 * The base aspect that names a base printing none (JTL's Lake Country). No card carries it, so it is
 * never in a leader's aspects and never pays for a card: a deck on such a base is paid by its leader alone.
 */
export const NO_ASPECT = 'None'

const hasAspect = (aspect: string) => (b: SwuCard): boolean =>
  aspect === NO_ASPECT ? (b.Aspects ?? []).length === 0 : (b.Aspects ?? []).includes(aspect)

/** What a pool deck is built around. Each one left out is chosen by the scorer. */
export interface PoolChoice {
  /** The leader, which the pool must hold: a player's choice, or the bench's leader swapped in. */
  leader?: SwuCard
  /** The base's aspect, including one the leader carries ({@link NO_ASPECT} for a base printing none). */
  baseAspect?: string
  /** How pairings and cards are judged; {@link heuristicScorer} when absent. */
  scorer?: DeckScorer
}

/**
 * Build a deck from an opened sealed pool (`openPool`), as a player builds one. `cards` is the set's
 * card data. Deterministic.
 *
 * **Every pairing is scored** ({@link DeckScorer}): each leader the pool opened, or the one given, on
 * each kind of base it may use (colour, rarity, deck size), and the highest builds the deck, ties
 * broken by the seed. The deck is filled toward the turn-1 and removal guidelines and splashes on
 * purpose (`generateDeck` with a scorer), then settled on the base its cards want among those of its
 * kind ({@link settleBase}).
 *
 * **Any Common base of the set is usable**, as at a sealed event, where common bases are on the table;
 * a rare base only when the pool opened it. A set printing no Common base uses what it has.
 *
 * **A base never doubles an aspect its leader already supplies** unless the aspect is named: one colour
 * rarely fills a deck. A named aspect wins, even one the leader carries, since that is a player asking
 * for the doubled cards, and a leader chosen for a named aspect avoids carrying it where the pool
 * allows. A named aspect the pool cannot offer (JTL's rare, colourless Lake Country, unopened) is taken
 * from the set anyway, as a chosen leader is swapped into the pool.
 */
export function buildDeckFromPool(pool: SwuCard[], cards: SwuCard[], seed: number, choice: PoolChoice = {}): { deck: ParsedDeck; report: DeckReport; splashes: string[] } {
  const { baseAspect } = choice
  const scorer = choice.scorer ?? heuristicScorer
  const available = new Map<string, number>()
  for (const c of pool) available.set(id(c), (available.get(id(c)) ?? 0) + 1)

  const setBases = cards.filter(c => c.Type === 'Base')
  const offered = setBases.filter(b => !isRareBase(b) || available.has(id(b)))
  const open = offered.length > 0 ? offered : setBases
  const from = baseAspect !== undefined && !open.some(hasAspect(baseAspect)) ? setBases : open
  const named = baseAspect === undefined ? [] : from.filter(hasAspect(baseAspect))

  const opened = [...new Set(pool.filter(c => c.Type === 'Leader'))]
  const avoiding = baseAspect === undefined ? opened : opened.filter(l => !(l.Aspects ?? []).includes(baseAspect))
  const leaders = choice.leader ? [choice.leader] : avoiding.length > 0 ? avoiding : opened
  if (leaders.length === 0) throw new Error('buildDeckFromPool: the pool holds no leader')

  const kind = (b: SwuCard) => `${(b.Aspects ?? []).join(',')}|${isRareBase(b)}|${minimumDeckSize(id(b))}`
  const pairings = leaders.flatMap(leader => {
    const usable = from.filter(b => !(b.Aspects ?? []).some(a => (leader.Aspects ?? []).includes(a)))
    const allowed = named.length > 0 ? named : usable.length > 0 ? usable : from
    return [...new Map(allowed.map(b => [kind(b), b])).values()].map(base => ({ leader, base }))
  })
  // Rotated by seed, so equal scores do not always fall to the first leader and colour in card order.
  const start = Math.floor(seededUnit(((seed * 40503) ^ 0x9e37) >>> 0 || 1) * pairings.length)
  let best = pairings[start]
  let bestScore = -Infinity
  for (let i = 0; i < pairings.length; i++) {
    const p = pairings[(start + i) % pairings.length]
    const score = scorer.pairing(summarisePairing(p.leader, p.base, pool))
    if (score > bestScore) { bestScore = score; best = p }
  }

  const known = [...new Map([...pool, ...from].map(c => [id(c), c])).values()]
  const built = generateDeck({ leader: best.leader, base: best.base, pool: known, seed, available, scorer })
  const deck = settleBase(built.deck, known, seed)
  return { deck, report: deckReport(deck, new Map(known.map(c => [id(c), c])), { fromPool: true }), splashes: built.splashes }
}
