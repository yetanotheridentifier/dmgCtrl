import type { SwuCard } from '../data/cards'
import { isToken } from '../data/cards'
import { seededRandom } from '../engine/rng'

/**
 * Opening booster packs, so a generated sealed deck is built from a pool rather than the whole set.
 *
 * A pack prints 16 cards: one leader, one base, nine commons, three uncommons, one rare or legendary
 * and one foil of any rarity. That shape, and the two rates the publisher states, are fixed:
 *
 * - a Legendary in the rare slot about **1 in 8** packs for the first three sets, and **1 in 5** from
 *   Jump to Lightspeed on, when each set gained Legendaries and Commons;
 * - a Special card in a pack only as a foil (or Hyperspace) variant, and only from Jump to Lightspeed on.
 *
 * A base that is not Common comes in the rare slot, as through A Lawless Time; later sets print none.
 * Hyperspace and Prestige variants are cosmetic and are not modelled.
 *
 * **Three numbers are estimates, not published rates**, and are the place to correct them: the rare
 * leader rate, the foil slot's rarity (the pack's own 9:3:1 split, the rare share divided as the rare
 * slot divides it), and no repeated common or uncommon within one pack.
 */

/** Sets whose packs open a Legendary about 1 in 8; every later set opens one about 1 in 5. */
const EARLY_SETS = new Set(['SOR', 'SHD', 'TWI'])

export interface PackProfile {
  /** Chance the rare slot holds a Legendary rather than a Rare. Published. */
  legendary: number
  /** Chance the leader slot holds a Rare leader rather than a Common one. An estimate. */
  rareLeader: number
  /** Whether the foil slot can hold a Special card. Published. */
  specialFoils: boolean
}

export function packProfile(set: string): PackProfile {
  const early = EARLY_SETS.has(set)
  return { legendary: early ? 1 / 8 : 1 / 5, rareLeader: 1 / 8, specialFoils: !early }
}

/**
 * One opened pack, slot by slot. A single-card slot is empty when the card list prints nothing for it,
 * which is what a partial cache looks like.
 */
export interface Pack {
  leader?: SwuCard
  base?: SwuCard
  commons: SwuCard[]
  uncommons: SwuCard[]
  rare?: SwuCard
  foil?: SwuCard
}

/** The foil slot's rarity weights: the pack's own commons, uncommons and rare slot. An estimate. */
const FOIL_WEIGHTS = { Common: 9, Uncommon: 3, Rare: 1 }

const isDeckCard = (c: SwuCard): boolean => c.Type !== 'Leader' && c.Type !== 'Base' && !isToken(c)

/** The cards each slot draws on, worked out once per card list. */
interface Sheets {
  profile: PackProfile
  commonLeaders: SwuCard[]
  rareLeaders: SwuCard[]
  bases: SwuCard[]
  commons: SwuCard[]
  uncommons: SwuCard[]
  rares: SwuCard[]
  legendaries: SwuCard[]
  specials: SwuCard[]
}

const sheetCache = new WeakMap<SwuCard[], Sheets>()

function sheets(cards: SwuCard[]): Sheets {
  const cached = sheetCache.get(cards)
  if (cached) return cached
  const set = cards.find(c => c.Type === 'Leader')?.Set ?? cards[0]?.Set ?? ''
  const of = (pred: (c: SwuCard) => boolean) => cards.filter(c => !isToken(c) && pred(c))
  const built: Sheets = {
    profile: packProfile(set),
    commonLeaders: of(c => c.Type === 'Leader' && c.Rarity === 'Common'),
    rareLeaders: of(c => c.Type === 'Leader' && c.Rarity === 'Rare'),
    bases: of(c => c.Type === 'Base' && c.Rarity === 'Common'),
    commons: of(c => isDeckCard(c) && c.Rarity === 'Common'),
    uncommons: of(c => isDeckCard(c) && c.Rarity === 'Uncommon'),
    // A base that is not Common is opened in the rare slot, as a Rare.
    rares: of(c => (isDeckCard(c) && c.Rarity === 'Rare') || (c.Type === 'Base' && c.Rarity === 'Rare')),
    legendaries: of(c => (isDeckCard(c) || c.Type === 'Base') && c.Rarity === 'Legendary'),
    specials: of(c => isDeckCard(c) && c.Rarity === 'Special'),
  }
  sheetCache.set(cards, built)
  return built
}

const pick = (from: SwuCard[], rand: () => number): SwuCard | undefined => from[Math.floor(rand() * from.length)]

/** `n` different cards from `from`, or as many as it holds. */
function pickDistinct(from: SwuCard[], n: number, rand: () => number): SwuCard[] {
  const left = [...from]
  const out: SwuCard[] = []
  while (out.length < n && left.length > 0) out.push(left.splice(Math.floor(rand() * left.length) % left.length, 1)[0])
  return out
}

function rareSlot(s: Sheets, rand: () => number, withSpecials: boolean): SwuCard | undefined {
  if (s.legendaries.length > 0 && rand() < s.profile.legendary) return pick(s.legendaries, rand)
  return pick(withSpecials ? [...s.rares, ...s.specials] : s.rares, rand)
}

/** Open one pack from a set's card list, drawing from `rand`. */
export function openPack(cards: SwuCard[], rand: () => number): Pack {
  const s = sheets(cards)
  const rareLeader = s.rareLeaders.length > 0 && rand() < s.profile.rareLeader
  const leader = pick(rareLeader || s.commonLeaders.length === 0 ? s.rareLeaders : s.commonLeaders, rand)
  const base = pick(s.bases, rand)
  const commons = pickDistinct(s.commons, 9, rand)
  const uncommons = pickDistinct(s.uncommons, 3, rand)
  const rare = rareSlot(s, rand, false)

  const total = FOIL_WEIGHTS.Common + FOIL_WEIGHTS.Uncommon + FOIL_WEIGHTS.Rare
  const roll = rand() * total
  const foil = roll < FOIL_WEIGHTS.Common ? pick(s.commons, rand)
    : roll < FOIL_WEIGHTS.Common + FOIL_WEIGHTS.Uncommon ? pick(s.uncommons, rand)
      : rareSlot(s, rand, s.profile.specialFoils)

  return { leader, base, commons, uncommons, rare, foil }
}

export interface PoolOptions {
  /** Packs to open. A sealed pool is six. */
  packs?: number
  /**
   * A leader the pool must hold, swapped into the first pack's leader slot. How the bench, and a
   * player choosing a leader the pool did not open, build around a named leader without re-rolling
   * until one turns up, which would skew the rest of the pool; it mirrors the leader a prerelease
   * guarantees. The rest of the pool is the one the same seed opens without it.
   */
  leader?: SwuCard
}

/** Open a sealed pool from one set's card list: every card opened, duplicates included. Seeded. */
export function openPool(cards: SwuCard[], seed: number, opts: PoolOptions = {}): SwuCard[] {
  const rand = seededRandom(seed)
  const opened = Array.from({ length: opts.packs ?? 6 }, () => openPack(cards, rand))
  if (opts.leader && opened.length > 0) opened[0] = { ...opened[0], leader: opts.leader }
  return opened.flatMap(p => [p.leader, p.base, ...p.commons, ...p.uncommons, p.rare, p.foil])
    .filter((c): c is SwuCard => c !== undefined)
}
