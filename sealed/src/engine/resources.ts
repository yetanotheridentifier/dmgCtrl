import type { PlayerState } from './types'

/**
 * Resource system (T2.3). Pure PlayerState helpers — no mutation.
 * CR 1.7: costs are paid by exhausting ready resources; exhausted resources
 * cannot pay; resourced cards enter play facedown and exhausted (CR 1.7.7) —
 * the regroup ready-step then readies them.
 */

export function readyResourceCount(player: PlayerState): number {
  return player.resources.filter(r => !r.exhausted).length
}

export function canAfford(player: PlayerState, cost: number): boolean {
  return readyResourceCount(player) >= cost
}

/** Exhaust `cost` ready resources. Throws if unaffordable — callers guard via legal moves. */
export function payCost(player: PlayerState, cost: number): PlayerState {
  if (cost === 0) return player
  if (!canAfford(player, cost)) {
    throw new Error(`Cannot afford cost ${cost} with ${readyResourceCount(player)} ready resources`)
  }
  let remaining = cost
  const resources = player.resources.map(r => {
    if (remaining > 0 && !r.exhausted) {
      remaining--
      return { ...r, exhausted: true }
    }
    return r
  })
  return { ...player, resources }
}

/** Move a card from hand into the resource zone (facedown, exhausted). */
export function addResourceFromHand(player: PlayerState, handIndex: number): PlayerState {
  if (handIndex < 0 || handIndex >= player.hand.length) {
    throw new Error(`Invalid hand index ${handIndex} for hand of ${player.hand.length}`)
  }
  const cardId = player.hand[handIndex]
  return {
    ...player,
    hand: player.hand.filter((_, i) => i !== handIndex),
    resources: [...player.resources, { cardId, exhausted: true }],
  }
}

export function readyAllResources(player: PlayerState): PlayerState {
  return {
    ...player,
    resources: player.resources.map(r => (r.exhausted ? { ...r, exhausted: false } : r)),
  }
}
