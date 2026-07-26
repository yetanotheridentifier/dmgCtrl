import type { GameState, PlayerId } from '../engine/types'
import { effectiveCost } from '../engine/legalMoves'
import { cardValue } from './cardValue'

/**
 * What a HAND is worth to the player holding it (#393).
 *
 * PRIVATE information. Hand contents are hidden, so this is only ever applied to the seat being
 * scored: `evaluate` adds it for `me` and never for the opponent. That is why the evaluation's
 * zero-sum invariant now covers the public terms only.
 *
 * Three requirements have to fall out of one model, and the first and third pull against each other:
 *   1. early, banking a card you cannot cast for 3+ turns is right;
 *   2. late, expensive cards are the ones worth keeping and cheap ones are nearly dead;
 *   3. a Sealed bomb is worth holding until castable, PROVIDED that does not cost you a turn.
 * Card quality resolves 1 against 3: bank the expensive filler, hold the expensive bomb.
 */

export interface HandWeights {
  /**
   * Flat bonus for holding at least one card you can actually cast: the "don't sacrifice a turn"
   * guard behind requirement 3.
   *
   * FLAT is the whole point, and it was measured, not assumed. Scaling this by the castable card's
   * own value (the obvious first attempt) cost 9.5 points of win rate in a 1720-game A/B, because a
   * big card's hand value and its board value are the same order of magnitude: giving up ~28 of
   * "best castable" to gain ~28 of board made the bot refuse to play its own bombs. A flat bonus
   * costs the same whether the card is a 1/1 or a 9/9, so converting a card into a body is always
   * clearly positive, while giving one away for a resource still trips the guard.
   *
   * Bounded on both sides by arithmetic, not taste (see `handValue.test.ts`):
   *   upper: must stay below what the board pays for the CHEAPEST body, or developing the last
   *          castable card looks worse than sitting on it;
   *   lower: must exceed the discounted hold value of the biggest bomb in the pool, or the model
   *          banks its last play to keep something it cannot cast.
   */
  canAct: number
  /** Per point of held value across the whole hand, discounted by how soon it can be cast. */
  hold: number
}

export const DEFAULT_HAND_WEIGHTS: HandWeights = {
  canAct: 3,
  hold: 0.12,
}

/**
 * How much of a card's value survives the wait to cast it, given a pool of `pool` resources.
 *
 * Never reaches zero: a bomb you cannot cast for three turns is still the reason you keep it, which
 * is the whole of requirement 3. The floor is what lets a high-quality card outrank cheap filler
 * while still being outranked by anything castable now.
 */
export function reach(cost: number, pool: number): number {
  if (cost <= pool) return 1
  if (cost === pool + 1) return 0.75
  if (cost === pool + 2) return 0.5
  return 0.3
}

/**
 * The resource pool a hand is measured against: TOTAL resources, not ready ones.
 *
 * Every resource readies at regroup, so total is the right forward-looking number for the decision
 * this exists to fix. It is mildly optimistic mid-action-phase, where some are already spent, but
 * that bias is identical across every move being compared at one ply.
 */
function pool(state: GameState, me: PlayerId): number {
  return state.players[me].resources.length
}

/** What `me`'s hand is worth to them. */
export function handValue(state: GameState, me: PlayerId, w: HandWeights): number {
  const p = state.players[me]
  const r = pool(state, me)
  let held = 0
  let canAct = false

  for (const id of p.hand) {
    const card = state.cards[id]
    if (!card) continue
    const cost = effectiveCost(state, me, card)
    held += cardValue(state, me, card) * reach(cost, r)
    if (cost <= r) canAct = true
  }

  return (canAct ? w.canAct : 0) + w.hold * held
}
