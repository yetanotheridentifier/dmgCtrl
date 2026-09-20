import type { PlayerState } from './types'

/**
 * Resource system. Pure PlayerState helpers — no mutation.
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

/**
 * Exhaust `cost` ready resources. Throws if unaffordable — callers guard via legal moves.
 *
 * **Which ones is not a player decision.** CR 1.7.4: a player may rearrange their resources at any
 * time up to the point a specific resource is chosen as part of an action, and may change which of
 * them are ready or exhausted so long as the ready and exhausted counts are unchanged. Only the
 * counts are game state, so a payment cannot strand a particular card by taking the wrong ones, and
 * there is nothing here to put to the player.
 *
 * The one place it bites is a card about to leave the zone by being played out of it: exhausting
 * that card costs its controller nothing, while exhausting any other one costs a ready resource.
 * `prefer` names those indices, and `payCost` takes them first. Everything else is array order.
 */
export function payCost(player: PlayerState, cost: number, prefer: number[] = []): PlayerState {
  if (cost === 0) return player
  if (!canAfford(player, cost)) {
    throw new Error(`Cannot afford cost ${cost} with ${readyResourceCount(player)} ready resources`)
  }
  const order = [...prefer, ...player.resources.map((_, i) => i).filter(i => !prefer.includes(i))]
  const exhausting = new Set<number>()
  for (const i of order) {
    if (exhausting.size === cost) break
    if (!player.resources[i]?.exhausted) exhausting.add(i)
  }
  return { ...player, resources: player.resources.map((r, i) => (exhausting.has(i) ? { ...r, exhausted: true } : r)) }
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
