import type { Action } from '../engine/actions'
import type { GameState } from '../engine/types'
import { legalMoves } from '../engine/legalMoves'
import { seededUnit } from '../engine/rng'

/**
 * Rung 0 opponent: uniformly random legal move. Exists to prove the
 * engine loop end-to-end and to be beaten. Smarter opponents (heuristics,
 * MCTS, LLM evaluation) would sit above this on the same interface.
 *
 * The pick is drawn from the state's own seed rather than an injected generator, making the
 * move a pure function of the state. Same position → same move, so undo can rewind into a
 * decision and a saved record replays exactly; a different line of play carries a different
 * seed, so the AI stays free to answer differently.
 */
export function randomAi(state: GameState): Action | null {
  const moves = legalMoves(state)
  if (moves.length === 0) return null
  return moves[Math.floor(seededUnit(state.rngSeed) * moves.length)]
}
