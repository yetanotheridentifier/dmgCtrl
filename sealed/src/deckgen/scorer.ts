import type { SwuCard } from '../data/cards'
import { cardValueAt } from '../ai/cardValue'
import { normaliseCard } from '../engine/cardDb'
import { isTurnOnePlay, removalWeight } from './cardRoles'
import { BOMB_COST_MIN, CHEAP_COST_MAX, deckShape, TURN_ONE_PLAYS, unpaidAspects } from './rules'

/**
 * How a pool deck's builder judges what it is choosing between: which leader and base pairing a pool
 * supports best, and how much a card is worth to a deck at the cost it would be played for.
 *
 * One small seam on purpose. The builder (`buildDeckFromPool`) takes a {@link DeckScorer} and only ever
 * compares its numbers, so a learned scorer can replace {@link heuristicScorer} without touching it.
 * The facts the builder hands over are a {@link PairingSummary} and a card with its cost as played.
 */

/** What a pool offers one leader and base, the facts the pairing score reads. */
export interface PairingSummary {
  leader: SwuCard
  base: SwuCard
  /** Turn-1 plays the pool holds for the pairing, copies counted, at the cost as played (`isTurnOnePlay`). */
  turnOnePlays: number
  /** Legendary and Rare copies the pairing can play without a penalty. */
  rares: number
  /** Removal copies the pairing can play without a penalty, exhaust counting for less (`removalWeight`). */
  removal: number
  /** How far the pairing's penalty-free cards fall short of the curve guidelines and of the deck size. */
  curveMiss: number
}

export interface DeckScorer {
  /** A pairing's score. The builder takes the highest; equal scores are broken by the seed. */
  pairing(p: PairingSummary): number
  /** A card's worth to a deck when played for `playedCost`. Only compared between cards. */
  card(card: SwuCard, playedCost: number): number
}

/**
 * Leaders exempt from the turn-1 veto, by name so every printing is covered: each makes a turn-1 play
 * of its own, so a pool short of cheap units does not leave the deck with nothing to do on turn 1.
 *
 * - **Tarfful**: his Action creates a Beast token, from the first turn, on no condition.
 */
export const TURN_ONE_EXEMPT: ReadonlySet<string> = new Set(['Tarfful'])

const isDeckCard = (c: SwuCard): boolean => c.Type === 'Unit' || c.Type === 'Event' || c.Type === 'Upgrade'
const isUnit = (c: SwuCard): boolean => c.Type === 'Unit'
const cost = (c: SwuCard): number => Number(c.Cost ?? 0)

export function summarisePairing(leader: SwuCard, base: SwuCard, pool: SwuCard[]): PairingSummary {
  const deckCards = pool.filter(isDeckCard)
  const free = deckCards.filter(c => unpaidAspects(c, leader, base).length === 0)
  const shape = deckShape(base, leader)
  const cheap = free.filter(c => isUnit(c) && cost(c) <= CHEAP_COST_MAX).length
  const bomb = free.filter(c => isUnit(c) && cost(c) >= BOMB_COST_MIN).length
  return {
    leader,
    base,
    turnOnePlays: deckCards.filter(c => isTurnOnePlay(c, leader, base)).length,
    rares: free.filter(c => c.Rarity === 'Rare' || c.Rarity === 'Legendary').length,
    removal: free.reduce((n, c) => n + removalWeight(c), 0),
    curveMiss: Math.max(0, shape.cheapUnits.min - cheap) + Math.max(0, shape.bombUnits.min - bomb) + Math.max(0, shape.size - free.length),
  }
}

/**
 * Scales that keep the pairing score's criteria strictly in order: a pool's removal never reaches a
 * thousand, nor its curve shortfall a thousand, so no amount of a later criterion outweighs one step of
 * an earlier one.
 */
const RARE_STEP = 1e6
const REMOVAL_STEP = 1e3
const VETOED = -1e12
const TURN_ONE_STEP = 1e9

/**
 * The heuristic scorer, the builder's default.
 *
 * **Pairing**: a pairing short of {@link TURN_ONE_PLAYS}'s minimum is vetoed unless its leader is
 * exempt, and a vetoed one ranks by its turn-1 plays alone, so a pool with no viable pairing takes the
 * one closest to it. Otherwise the most Legendary and Rare cards to play, then the most removal, then
 * the smallest curve shortfall. Turn-1 plays above the veto are left to the fill, as a guideline.
 *
 * **Card**: `cardValue` at the cost as played, per resource paid. `cardValue` rises with cost, reading
 * the cost as the designed measure of a card's strength; dividing by what is paid is what makes the
 * aspect penalty count against a splash rather than for it.
 */
export const heuristicScorer: DeckScorer = {
  pairing(p) {
    const vetoed = p.turnOnePlays < TURN_ONE_PLAYS.min && !TURN_ONE_EXEMPT.has(p.leader.Name)
    if (vetoed) return VETOED + p.turnOnePlays * TURN_ONE_STEP
    return p.rares * RARE_STEP + p.removal * REMOVAL_STEP - p.curveMiss
  },
  card(card, playedCost) {
    return cardValueAt(normaliseCard(card), playedCost) / Math.max(1, playedCost)
  },
}
