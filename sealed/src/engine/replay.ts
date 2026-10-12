import type { StateWithoutCards } from '../data/replayData'
import type { Action } from './actions'
import { resolve } from './resolve'
import type { CardDb, GameState, PlayerId } from './types'

/**
 * Replaying replay data: a starting position and its moves, re-resolved to the same game.
 *
 * The one implementation, for everything that reads the shape `data/replayData.ts` describes: the
 * test harness that replays a filed report (`test/helpers/replayReport.ts`) and the transformation
 * of exported games into training rows (`bench/trainingRows.ts`). Each brings its own card data,
 * since the data travels without it.
 */

/** A starting position and every move made from it. `cards` is stripped when the data is written. */
export interface ReplayData {
  initialState: StateWithoutCards & { cards?: CardDb }
  moves: { by: PlayerId; action: Action }[]
}

/** Every card id a starting position refers to. */
function referencedIds(state: ReplayData['initialState']): string[] {
  const ids = new Set<string>()
  for (const side of ['player', 'opponent'] as PlayerId[]) {
    const p = state.players[side]
    ids.add(p.leader.cardId)
    ids.add(p.base.cardId)
    for (const id of [...p.hand, ...p.deck, ...p.discard]) ids.add(id)
    for (const u of p.units) ids.add(u.cardId)
  }
  return [...ids]
}

/**
 * The starting position with the card database it was written without.
 *
 * Throws naming the missing ids rather than failing later in an unrelated place. `hint` is the
 * caller's own account of where its cards come from and what to do about a gap.
 */
export function withCardDb(data: ReplayData, cards: CardDb, hint = ''): GameState {
  const missing = referencedIds(data.initialState).filter(id => !cards[id])
  if (missing.length > 0) throw new Error(`no card data for ${missing.join(', ')}.${hint ? ` ${hint}` : ''}`)
  return { ...data.initialState, cards } as GameState
}

/** Actions to apply just before move `i`, as a function of the live board. */
export type ReplayInserts = Record<number, (s: GameState) => Action[]>

/**
 * Every state in order from `start`: index 0 is the starting position, index n is the state after
 * move n-1. With `inserts`, each inserted action adds its own state too, so the indices no longer
 * line up with move numbers.
 */
export function replayStates(start: GameState, moves: ReplayData['moves'], inserts: ReplayInserts = {}): GameState[] {
  const states = [start]
  moves.forEach((move, i) => {
    for (const action of inserts[i]?.(states[states.length - 1]) ?? []) states.push(resolve(states[states.length - 1], action))
    states.push(resolve(states[states.length - 1], move.action))
  })
  return states
}
