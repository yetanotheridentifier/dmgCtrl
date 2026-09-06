import ashSet from '../test/fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import type { CardDb } from '../engine/types'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { buildCardDb } from '../engine/cardDb'
import { buildCoverageDecks } from './coverageDecks'
import { buildLockoutDecks } from './lockoutDecks'
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
 * `mirror` stays the default so every historical result keeps its meaning.
 */
export type DeckSource = 'mirror' | 'coverage' | 'lockout'

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
}

/** The decks a run will play, and the card database behind them. */
export function benchDeckSet(source: DeckSource, seed: number): { decks: DeckMatchup[]; cardDb: CardDb } {
  const cardDb = buildCardDb(SET)
  const mirrored = (list: ParsedDeck[]): DeckMatchup[] => list.map(d => ({ player: d, opponent: d }))
  if (source === 'mirror') return { decks: mirrored([buildBenchDeck(SET)]), cardDb }
  if (source === 'coverage') return { decks: mirrored(buildCoverageDecks(SET, seed).decks), cardDb }
  // The wall sits on `opponent` so the seat facing it is `player`, which is the seat the decision
  // diagnostic's own duration instrument samples. Lining those up means the deck set and the
  // measurement are talking about the same seat rather than nearly the same seat.
  return { decks: buildLockoutDecks(SET, seed).map(p => ({ player: p.facing, opponent: p.wall })), cardDb }
}
