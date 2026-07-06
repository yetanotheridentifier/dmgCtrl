import type { Action } from '../engine/actions'
import type { GameState } from '../engine/types'
import { legalMoves } from '../engine/legalMoves'

/**
 * Rung 0 opponent (T5.1): uniformly random legal move. Exists to prove the
 * engine loop end-to-end and to be beaten. Everything smarter (heuristics,
 * MCTS, LLM evaluation) is out of scope for this spike.
 */
export function randomAi(state: GameState, rng: () => number): Action | null {
  const moves = legalMoves(state)
  if (moves.length === 0) return null
  return moves[Math.floor(rng() * moves.length)]
}
