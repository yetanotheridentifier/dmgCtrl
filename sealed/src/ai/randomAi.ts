import type { Action } from '../engine/actions'
import type { GameState } from '../engine/types'
import { legalMoves } from '../engine/legalMoves'

/**
 * Rung 0 opponent: uniformly random legal move. Exists to prove the
 * engine loop end-to-end and to be beaten. Smarter opponents (heuristics,
 * MCTS, LLM evaluation) would sit above this on the same interface.
 */
export function randomAi(state: GameState, rng: () => number): Action | null {
  const moves = legalMoves(state)
  if (moves.length === 0) return null
  return moves[Math.floor(rng() * moves.length)]
}
