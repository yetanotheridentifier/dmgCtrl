import type { Action } from '../engine/actions'
import type { GameState, PlayerId } from '../engine/types'
import { effectiveCost } from '../engine/legalMoves'

/**
 * Setup-phase heuristic (early slice of , prompted by playtesting):
 * random setup decisions are catastrophically bad, so even the rung-0 opponent
 * uses these. The general in-game AI remains whatever rung is wired in.
 *
 * - Mulligan: keep only if the hand holds a TURN-1 PLAY — a unit whose
 *   effective cost (aspect penalty included) is ≤ 2, playable off the two
 *   starting resources. Otherwise redraw.
 * - Resourcing: keep the 4 cards that best fill the early curve — ideally
 *   distinct units playable on turns 1/2/3 (costs ≤2, ≤3, ≤4) — and resource
 *   the pair contributing least, preferring to bank expensive cards.
 */
export function setupAi(state: GameState): Action | null {
  if (state.phase !== 'setup') return null
  const playerId = state.activePlayer

  if (state.setupStage === 'mulligan') {
    return hasTurnOnePlay(state, playerId) ? { type: 'keepHand' } : { type: 'mulligan' }
  }
  return bestResourcePick(state, playerId)
}

function unitCosts(state: GameState, playerId: PlayerId, cardIds: string[]): number[] {
  return cardIds
    .map(id => state.cards[id])
    .filter(card => card !== undefined && card.type === 'unit')
    .map(card => effectiveCost(state, playerId, card))
}

function hasTurnOnePlay(state: GameState, playerId: PlayerId): boolean {
  return unitCosts(state, playerId, state.players[playerId].hand).some(cost => cost <= 2)
}

/**
 * Curve quality of a kept hand: greedily assign the cheapest distinct units to
 * turns 1–3 (playable with 2, 3, 4 resources). Weighted so a turn-1 play
 * always dominates, then turn 2, then turn 3.
 */
function curveScore(state: GameState, playerId: PlayerId, kept: string[]): number {
  const costs = unitCosts(state, playerId, kept).sort((a, b) => a - b)
  let score = 0
  const thresholds = [2, 3, 4]
  let i = 0
  for (const [slot, limit] of thresholds.entries()) {
    if (i < costs.length && costs[i] <= limit) {
      score += [100, 50, 25][slot]
      i++
    }
  }
  return score
}

/**
 * Picks happen one card at a time. To stay pair-optimal, evaluate the full
 * set of cards still to be banked: with 2 picks left, score every pair and
 * take that pair's first card; with 1 left, score every single.
 */
function bestResourcePick(state: GameState, playerId: PlayerId): Action | null {
  const hand = state.players[playerId].hand
  const picksLeft = 2 - state.players[playerId].resources.length
  if (picksLeft <= 0 || hand.length === 0) return null

  const subsets: number[][] = []
  if (picksLeft >= 2) {
    for (let a = 0; a < hand.length; a++) {
      for (let b = a + 1; b < hand.length; b++) subsets.push([a, b])
    }
  } else {
    for (let a = 0; a < hand.length; a++) subsets.push([a])
  }

  let best: number[] = subsets[0]
  let bestScore = -Infinity
  for (const subset of subsets) {
    const kept = hand.filter((_, i) => !subset.includes(i))
    const resourced = subset.map(i => hand[i])
    // Tiebreak: bank the most expensive cards (keeps cheap playables in hand).
    const resourcedCost = unitCosts(state, playerId, resourced).reduce((n, c) => n + c, 0)
    const score = curveScore(state, playerId, kept) * 1000 + resourcedCost
    if (score > bestScore) {
      bestScore = score
      best = subset
    }
  }
  return { type: 'setupResource', handIndex: best[0] }
}
