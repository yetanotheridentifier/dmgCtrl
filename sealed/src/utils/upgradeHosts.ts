import type { GameState } from '../engine/types'
import { baseHostOwner } from '../engine/types'

/**
 * The units (and bases) hosting a set of defeatable upgrades, each listed once in candidate order.
 *
 * Defeating an upgrade is a two-step pick (#368): step one highlights these hosts on the board, so
 * it is obvious where an upgrade sits and who controls it; step two shows just that host's
 * upgrades. Picking straight out of one flat overlay hid all three, and was unusable when two
 * units shared a name. A base hosting a Fortify upgrade appears as `baseHostId(owner)`.
 */
export function upgradeHostIds<T extends { unitId: string }>(candidates: readonly T[]): string[] {
  return [...new Set(candidates.map(c => c.unitId))]
}

/** An upgrade host for a prompt, from the human player's side: the unit's name, or whose base it is. */
export function upgradeHostName(state: GameState, hostId: string): string | undefined {
  const baseOwner = baseHostOwner(hostId)
  if (baseOwner) return baseOwner === 'player' ? 'your base' : "the opponent's base"
  const u = [...state.players.player.units, ...state.players.opponent.units].find(x => x.instanceId === hostId)
  return u ? state.cards[u.cardId]?.name ?? u.cardId : undefined
}
