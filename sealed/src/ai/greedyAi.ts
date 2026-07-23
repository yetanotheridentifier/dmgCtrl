import type { Action } from '../engine/actions'
import type { GameState, PlayerId } from '../engine/types'
import type { Ai } from './types'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { seededUnit } from '../engine/rng'
import { evaluate } from './evaluate'
import { evaluateBaseline } from './evaluateBaseline'

/**
 * Rung-1 opponent: one-ply greedy. For each legal move, apply it and score the resulting board from
 * the perspective of the player to move; take the highest. Because `resolve` is pure and
 * `legalMoves` enumerates everything (including how choices are answered), this one loop covers
 * playing, attacking, resourcing, taking the initiative and answering triggers, with no per-card
 * rules. The scoring function is injectable so a frozen baseline can be measured against the live one
 * (see the registry's `greedy` vs `greedy-baseline`).
 *
 * Determinism is a hard requirement (#366): ties are broken from `state.rngSeed`, never `Math.random`,
 * so replays and saved records reproduce exactly. The scoring `resolve` calls advance the seed only
 * on their own discarded copies; the real seed advances once, when the chosen move is applied.
 */
export function makeGreedyAi(evaluate: (state: GameState, me: PlayerId) => number): Ai {
  return (state: GameState): Action | null => {
    const moves = legalMoves(state)
    if (moves.length === 0) return null

    const me = state.activePlayer
    let best = -Infinity
    const bestMoves: Action[] = []
    for (const move of moves) {
      const score = evaluate(resolve(state, move), me)
      if (score > best) {
        best = score
        bestMoves.length = 0
        bestMoves.push(move)
      } else if (score === best) {
        bestMoves.push(move)
      }
    }

    return bestMoves[Math.floor(seededUnit(state.rngSeed) * bestMoves.length)]
  }
}

/** The live greedy AI (unit-count-centred evaluation, #392). */
export const greedyAi = makeGreedyAi(evaluate)

/** The frozen pre-#392 greedy, kept only as a fixed comparison point for the generalisation runs. */
export const greedyBaselineAi = makeGreedyAi(evaluateBaseline)
