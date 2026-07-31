import type { Action } from '../engine/actions'
import type { GameState } from '../engine/types'
import type { Ai } from './types'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { seededUnit } from '../engine/rng'
import { evaluate, makeEvaluate, DEFAULT_WEIGHTS, type Evaluator, type EvalWeights } from './evaluate'
import { evaluateBaseline } from './evaluateBaseline'
import { makeQuiescent } from './search'
import { role } from './race'

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
export function makeGreedyAi(evaluate: Evaluator): Ai {
  return (state: GameState): Action | null => {
    const moves = legalMoves(state)
    if (moves.length === 0) return null

    const me = state.activePlayer
    // The role is fixed ONCE, from the position being decided in, and every candidate is scored with
    // it (#395). Letting each candidate derive its own role compares scores computed with different
    // weight sets: 32.5% of decisions have candidates landing in different roles, and doing it that
    // way measured 44.2% down to 26.3% against a role-blind AI as the shift grew. Computing it once
    // is also far cheaper than once per candidate.
    const asRole = role(state, me)
    let best = -Infinity
    const bestMoves: Action[] = []
    for (const move of moves) {
      const score = evaluate(resolve(state, move), me, asRole)
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

/**
 * Build the shipped bot from a weight set: the evaluation, wrapped in quiescent scoring, driven by
 * one ply.
 *
 * The single construction site on purpose. The weight tuner builds its own AI from candidate weights,
 * so without this it drifts from the deployed one whenever the driver changes, and then spends a
 * night tuning weights for a bot nobody plays.
 */
export function makeTunedGreedy(weights: EvalWeights): Ai {
  return makeGreedyAi(makeQuiescent(makeEvaluate(weights)))
}

/** The live greedy AI: unit-count-centred evaluation (#392), scored only on finished actions (#400). */
export const greedyAi = makeTunedGreedy(DEFAULT_WEIGHTS)

/** Greedy with the identical evaluation but scoring half-resolved actions, so quiescence can be
 *  measured in isolation. Kept registered rather than built ad hoc for a run, because the comparison
 *  is re-run every time the evaluation changes underneath it. */
export const greedyFlatAi = makeGreedyAi(evaluate)

/** The frozen pre-#392 greedy, kept only as a fixed comparison point for the generalisation runs. */
export const greedyBaselineAi = makeGreedyAi(evaluateBaseline)
