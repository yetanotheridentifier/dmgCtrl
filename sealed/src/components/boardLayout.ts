import type { GameState, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'
import { hasKeyword } from '../engine/keywords'

/** Why your leader can't deploy, when deploying is not among your legal moves: the leader menu's reason. */
export function deployBlocker(state: GameState): string {
  const p = state.players.player
  if (p.leader.epicActionUsed) return 'Already deployed this game'
  if (state.winner !== null || state.activePlayer !== 'player' || state.phase !== 'action') return 'Only on your action'
  const cost = state.cards[p.leader.cardId]?.cost ?? 0
  if (p.resources.length < cost) return `Needs ${cost} resources; you have ${p.resources.length}`
  return 'Not available now'
}

/** The unit an action is taken with and what it is aimed at, for ringing them on the board. */
export function actionFocus(action: Action): { actorId?: string; targetId?: string; targetBase?: boolean } {
  if (action.type === 'attack') {
    return action.target.kind === 'base' ? { actorId: action.attackerId, targetBase: true } : { actorId: action.attackerId, targetId: action.target.instanceId }
  }
  if ('targetInstanceId' in action && typeof action.targetInstanceId === 'string') return { targetId: action.targetInstanceId }
  return {}
}

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

/**
 * The game screen is one layout at two scales: a phone on its side, and the desktop, where the same
 * layout is grown. Every size the layout draws at is here, so the two read side by side.
 *
 * - `pad` and `gap`: the screen's padding, and the gap between the controls column and the board.
 * - `column`: the controls column's width.
 * - `unit`: a unit's square slot and its card's short edge, four to a row, and five once crowded;
 *   `unitStat` the diameter of its power and HP.
 * - `centre`: the centre strip's width, and `centreCard` the short edge of a leader or base in it.
 * - `arenaGap`: the gap between the two sides' halves of an arena.
 * - `handCard`, `handRow`, `handWidth`: a hand card's short edge, the hand row's height, and the
 *   width the row may fill before a long hand fans.
 */
export const BOARD_SCALE = {
  phone: {
    pad: 8, gap: 10, column: 196,
    unit: { normal: { slot: 56, card: 40 }, crowded: { slot: 45, card: 32 } }, unitStat: 14,
    centre: 84, centreCard: 50, arenaGap: 18,
    handCard: 60, handRow: 88, handWidth: 600,
  },
  desktop: {
    pad: 16, gap: 16, column: 300,
    unit: { normal: { slot: 84, card: 60 }, crowded: { slot: 68, card: 48 } }, unitStat: 20,
    centre: 125, centreCard: 84, arenaGap: 22,
    handCard: 90, handRow: 132, handWidth: 900,
  },
} as const

export type BoardScale = keyof typeof BOARD_SCALE

/** Where the board starts: past the screen's padding, the controls column and the gap beside it. */
export function boardLeft(scale: BoardScale): number {
  const { pad, column, gap } = BOARD_SCALE[scale]
  return pad + column + gap
}

const HAND_GAP_PX = 6

/**
 * How far each hand card overlaps the one before it: none while the hand fits its row, then just
 * enough to fit it, so a long hand fans rather than running off the screen.
 */
export function handOverlap(count: number, scale: BoardScale = 'phone'): number {
  const { handCard, handWidth } = BOARD_SCALE[scale]
  const width = count * handCard + (count - 1) * HAND_GAP_PX
  if (count < 2 || width <= handWidth) return 0
  return Math.ceil((width - handWidth) / (count - 1))
}
