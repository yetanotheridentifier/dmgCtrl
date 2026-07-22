import type { GameState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * An AI opponent: a pure function from the current game state to the move it wants to make, or
 * `null` when it has no legal move. Pure by design (#366) so replays, saved records and bug-report
 * fixtures reproduce exactly. Every rung, `randomAi`, the greedy scorer to come, an MCTS or LLM
 * later, wears this one shape, which is what lets them be swapped by name through the registry.
 */
export type Ai = (state: GameState) => Action | null
