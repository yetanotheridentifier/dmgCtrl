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

/** A hand card's short edge on a phone, and the width of the row under the board it shares. */
export const PHONE_HAND_CARD_PX = 60
const PHONE_HAND_ROW_PX = 600
const PHONE_HAND_GAP_PX = 6

/**
 * How far each hand card on a phone overlaps the one before it: none while the hand fits its row,
 * then just enough to fit it, so a long hand fans rather than running off the screen.
 */
export function phoneHandOverlap(count: number): number {
  const width = count * PHONE_HAND_CARD_PX + (count - 1) * PHONE_HAND_GAP_PX
  if (count < 2 || width <= PHONE_HAND_ROW_PX) return 0
  return Math.ceil((width - PHONE_HAND_ROW_PX) / (count - 1))
}
