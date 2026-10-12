import type { GameState } from '../engine/types'

/**
 * Replay data: a starting position plus every move, which re-resolve to the exact same game
 * because the AI draws from `state.rngSeed`. It travels without the card database, which is most
 * of a state's bytes, identical from game to game, and rebuilt by whoever reads it (`buildCardDb`
 * over the cards the position names).
 *
 * This is the one place that strips it. The bug report, the bench's failure fixtures and the game
 * export all write the same shape, and a reader of any of them is a reader of all three.
 */
export type StateWithoutCards = Omit<GameState, 'cards'>

/**
 * The state with its card database left out: every other key, in the state's own order. The key
 * is absent rather than undefined, so the result serialises and compares as a state that never
 * had one. The state passed in is not changed.
 */
export function withoutCards(state: GameState): StateWithoutCards {
  const { cards, ...rest } = state
  void cards
  return rest
}
