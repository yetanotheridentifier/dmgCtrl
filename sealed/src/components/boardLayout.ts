import type { GameState, UnitState } from '../engine/types'
import { hasKeyword } from '../engine/keywords'

/**
 * Order units so Sentinels sit closest to the battlefront. Units grow *back*
 * from the battlefront: the player's lanes are top-anchored (front row at the
 * top), so Sentinels come first; the opponent's are bottom-anchored (front row
 * at the bottom), so Sentinels come last. Non-Sentinel order is preserved.
 */
export function orderUnits(state: GameState, units: UnitState[], anchor: 'top' | 'bottom'): UnitState[] {
  const sentinels = units.filter(u => hasKeyword(state, u.cardId, 'Sentinel'))
  const others = units.filter(u => !hasKeyword(state, u.cardId, 'Sentinel'))
  return anchor === 'top' ? [...sentinels, ...others] : [...others, ...sentinels]
}
