import type { GameState } from '../engine/types'
import type { Action } from '../engine/actions'
import type { Ai } from './types'
import { lossIsCertain } from './race'
import { setupAi } from './setupAi'

/**
 * When a bot offers to concede (#537): on its own action-phase turn, when its loss is certain
 * (`lossIsCertain`), and once a game, since a player who declined wants to play it out and the end is
 * an action or two away anyway.
 *
 * A driver's policy rather than an AI's move: the app's turn driver asks the player, and the bench's
 * `playGame` accepts on the other bot's behalf. Kept out of every AI so no search can weigh giving up.
 */
export function concessionOffer(state: GameState): Action | null {
  const seat = state.activePlayer
  if ((state.concessionDeclined ?? []).includes(seat)) return null
  return lossIsCertain(state, seat) ? { type: 'offerConcession' } : null
}

/**
 * The one step a driver takes for a bot, shared by the app's turn loop and the bench's `playGame` so
 * the two cannot drift: offer to concede a certain loss, else the setup heuristic (random mulligans
 * and resourcing are game-ruining), else the AI's own move.
 */
export function driverAction(state: GameState, ai: Ai, opts: { concede?: boolean } = {}): Action | null {
  return ((opts.concede ?? true) ? concessionOffer(state) : null) ?? setupAi(state) ?? ai(state)
}
