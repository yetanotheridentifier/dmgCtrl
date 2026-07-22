import ashSet from '../test/fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import type { CardDb } from '../engine/types'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { buildCardDb } from '../engine/cardDb'
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
