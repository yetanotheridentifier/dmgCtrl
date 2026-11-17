import ashSet from '../test/fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import type { CardDb } from '../engine/types'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { buildCardDb } from '../engine/cardDb'
import { seededUnit } from '../engine/rng'
import { minimumDeckSize } from '../utils/parseProtectThePod'
import { settleBase } from '../deckgen/bases'
import { buildDeckFromPool, generateDeck } from '../deckgen/generateDeck'
import { openPool } from '../deckgen/packs'
import { isRareBase } from '../deckgen/rules'
import { buildCoverageDecks } from './coverageDecks'
import { buildLockoutDecks } from './lockoutDecks'
import { buildMatchupDecks } from './matchupDecks'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability

/**
 * The bench's fixed deck. Comparability across tickets depends on the deck never drifting, so it is
 * built deterministically from the offline ASH snapshot (the same fixture the tests use, reused
 * rather than duplicated: both are dev-only, the browser build never imports this file).
 *
 * For #390 the same deck is played on both sides (a mirror), which removes deck strength as a
 * variable so a win-rate difference is down to the AI, not the cards. A second deck and per-matchup
 * breakdown arrive with the role-aware work (#395); the runner already takes two decks, so that is
 * a fixture change, not a code change.
 */
const SET = ashSet as unknown as SwuCard[]

/** Ahsoka Tano (Command / Heroism) and Ancient Henge (Aggression, 30 HP): a wide, penalty-free pool. */
const LEADER_ID = 'ASH_009'
const BASE_ID = 'ASH_023'
const DECK_SIZE = 30

const cardId = (c: SwuCard): string => `${c.Set}_${c.Number}`

/**
 * Leader + base + 30 units, all covered by the leader and base aspects so nothing carries an aspect
 * penalty. Units only, so the board always develops and games reach a result rather than stalling.
 */
export function buildBenchDeck(cards: SwuCard[]): ParsedDeck {
  const byId = new Map(cards.map(c => [cardId(c), c]))
  const leader = byId.get(LEADER_ID)
  const base = byId.get(BASE_ID)
  if (!leader || !base) throw new Error('Bench deck leader/base missing from card set')

  const covered = new Set([...(leader.Aspects ?? []), ...(base.Aspects ?? [])])
  const units = cards
    .filter(c => c.Type === 'Unit')
    .filter(c => (c.Aspects ?? []).every(a => covered.has(a)))
    .sort((a, b) => Number(a.Number) - Number(b.Number))
    .slice(0, DECK_SIZE)

  return {
    name: 'Bench Mirror',
    leader: LEADER_ID,
    base: BASE_ID,
    cards: units.map(c => ({ id: cardId(c), count: 1 })),
  }
}

/** The deck plus a card database covering the whole set, ready to hand to `initGame`. */
export function benchInputs(): { deck: ParsedDeck; cardDb: CardDb } {
  return { deck: buildBenchDeck(SET), cardDb: buildCardDb(SET) }
}

/**
 * Which deck population an A/B plays over.
 *
 * **This decides what can be measured at all.** `mirror` is one fixed deck of the first 30
 * aspect-matching units, and a term whose cards are not among those 30 cannot fire: it reports
 * neutral rather than failing, which is indistinguishable from a genuine null. Measured on the mirror
 * deck: Advantage tokens appear on **0.0%** of decisions against 20.7% on the coverage decks, and a
 * shielded Sentinel on **0.0%** against roughly 2%.
 *
 * `lockout` is the exception to all of the above and the only **asymmetric** source: an ordinary
 * coverage deck facing a purpose-built shielded-Sentinel wall. It exists because the lockout is a
 * strategy self-play never builds, so the population that could measure it had to be constructed. See
 * `lockoutDecks.ts` for what that costs, chiefly that an absolute win rate over it means nothing.
 *
 * `matchup` is the set `--matchups` plays: one deck per leader, on one base each (`matchupDecks.ts`),
 * fixed whatever the run seed, so it is the population for questions about leaders.
 *
 * `pool-built` measures the deck builder rather than an AI: from each of a run's sealed pools, a deck
 * built as a player would (`buildDeckFromPool`) on side A against the pool's random-leader deck on side
 * B ({@link randomLeaderDeck}), the lists staying with their sides as the seats swap. With identical
 * bots side A's rate is the built deck's. Its matched control is `pool-random`, the random-leader deck
 * on both sides of the same pools ({@link CONTROL_DECKS}).
 *
 * `mirror` stays the head-to-head's default so every historical result keeps its meaning.
 */
export type DeckSource = 'mirror' | 'coverage' | 'lockout' | 'matchup' | 'pool-built' | 'pool-random'

export const DECK_SOURCES: readonly DeckSource[] = ['mirror', 'coverage', 'lockout', 'matchup', 'pool-built', 'pool-random']

/**
 * The population a source's `--control` plays, where it is not the source itself. A deck comparison's
 * control changes the decks rather than the AI: the arm's side A deck replaced by side B's.
 */
export const CONTROL_DECKS: Partial<Record<DeckSource, DeckSource>> = { 'pool-built': 'pool-random' }

/** Sealed pools a `pool-built` or `pool-random` set opens, each one matchup. */
const POOLS = 64

/**
 * A pool's deck as it was built before the builder chose for itself, the deck `pool-built` is measured
 * against: a leader the pool opened, picked by the seed, filled with no turn-1 or removal preference and
 * no deliberate splash, on the kind of base (colour, rarity, size) that fills it with the fewest
 * off-aspect cards and never doubles the leader's aspect.
 */
export function randomLeaderDeck(pool: SwuCard[], cards: SwuCard[], seed: number): ParsedDeck {
  const leaders = [...new Set(pool.filter(c => c.Type === 'Leader'))]
  const leader = leaders[Math.floor(seededUnit(seed || 1) * leaders.length) % leaders.length]
  const available = new Map<string, number>()
  for (const c of pool) available.set(cardId(c), (available.get(cardId(c)) ?? 0) + 1)
  const bases = cards.filter(c => c.Type === 'Base' && (!isRareBase(c) || available.has(cardId(c))))
  const own = bases.filter(b => !(b.Aspects ?? []).some(a => (leader.Aspects ?? []).includes(a)))
  const kinds = new Map((own.length > 0 ? own : bases).map(b => [`${(b.Aspects ?? []).join(',')}|${isRareBase(b)}|${minimumDeckSize(cardId(b))}`, b]))
  const known = [...new Map([...pool, ...bases].map(c => [cardId(c), c])).values()]
  const built = [...kinds.values()].map(base => generateDeck({ leader, base, pool: known, seed, available }))
  const rank = (b: (typeof built)[number]) => (minimumDeckSize(b.deck.base) - b.report.size) * 1000 + b.report.offAspect
  return settleBase(built.reduce((best, b) => (rank(b) < rank(best) ? b : best)).deck, known, seed)
}

/** The pools of a `pool-built` or `pool-random` set: `POOLS` of them, each seeded by the run's seed and its place. */
function poolDecks(seed: number): { built: ParsedDeck; random: ParsedDeck }[] {
  return Array.from({ length: POOLS }, (_, i) => {
    const poolSeed = (Math.imul(seed, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0 || 1
    const pool = openPool(SET, poolSeed)
    return { built: buildDeckFromPool(pool, SET, poolSeed).deck, random: randomLeaderDeck(pool, SET, poolSeed) }
  })
}

/**
 * The matchups a run plays: the list each seat is dealt.
 *
 * For `mirror` and `coverage` both seats play the SAME list, so deck strength cancels by construction
 * and a win-rate difference is down to the AI. `lockout` deliberately breaks that, which is why the
 * pairing is returned rather than a single list: a set where both sides hold the wall cannot show a
 * bot finding its way through one.
 */
export interface DeckMatchup {
  /** The `player` seat's list. Under `lockout` this is the seat facing the wall. */
  player: ParsedDeck
  /** The `opponent` seat's list. Under `lockout` this is the wall. */
  opponent: ParsedDeck
  /**
   * The lists belong to sides rather than seats: `player` is side A's and `opponent` side B's, whichever
   * seat each side takes. For a comparison of decks, where the seat a deck sits in is to be balanced
   * like any other seat.
   */
  sided?: boolean
}

/** The decks a run will play, and the card database behind them. */
export function benchDeckSet(source: DeckSource, seed: number): { decks: DeckMatchup[]; cardDb: CardDb } {
  const cardDb = buildCardDb(SET)
  const mirrored = (list: ParsedDeck[]): DeckMatchup[] => list.map(d => ({ player: d, opponent: d }))
  if (source === 'mirror') return { decks: mirrored([buildBenchDeck(SET)]), cardDb }
  if (source === 'coverage') return { decks: mirrored(buildCoverageDecks(SET, seed).decks), cardDb }
  if (source === 'matchup') return { decks: mirrored(buildMatchupDecks(SET, 1).map(d => d.deck)), cardDb }
  if (source === 'pool-built') return { decks: poolDecks(seed).map(p => ({ player: p.built, opponent: p.random, sided: true })), cardDb }
  if (source === 'pool-random') return { decks: mirrored(poolDecks(seed).map(p => p.random)), cardDb }
  // The wall sits on `opponent` so the seat facing it is `player`, which is the seat the decision
  // diagnostic's own duration instrument samples. Lining those up means the deck set and the
  // measurement are talking about the same seat rather than nearly the same seat.
  return { decks: buildLockoutDecks(SET, seed).map(p => ({ player: p.facing, opponent: p.wall })), cardDb }
}
