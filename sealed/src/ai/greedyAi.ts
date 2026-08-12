import type { Action } from '../engine/actions'
import type { GameState } from '../engine/types'
import type { Ai } from './types'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { seededUnit } from '../engine/rng'
import { evaluate, makeEvaluate, DEFAULT_WEIGHTS, type Evaluator, type EvalWeights } from './evaluate'
import { evaluateBaseline } from './evaluateBaseline'
import { makeQuiescent, makeBeamAi, DEFAULT_BEAM_LIMITS, type BeamLimits } from './search'
import {
  findLethal, shouldSearchLethal, DEFAULT_LETHAL_LIMITS, DEFAULT_LETHAL_GATE,
  type LethalLimits, type LethalGate,
} from './lethal'
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

/**
 * Own-turn self-lookahead (#410) on the shipped evaluation: the same weights and the same quiescent
 * chain handling as `greedy`, differing only in expanding our own follow-up actions.
 *
 * Built here rather than in `search.ts` so there is still one construction site per bot, and so an
 * A/B against `greedy` isolates the beam and nothing else.
 */
export function makeBeamGreedy(weights: EvalWeights, limits?: BeamLimits): Ai {
  return makeBeamAi(makeEvaluate(weights), limits)
}

export const beamAi = makeBeamGreedy(DEFAULT_WEIGHTS)

/**
 * The shipped model: the beam with the opponent's minimising reply at every level (#425).
 *
 * Same weights, same width and depth as `beam`, differing only in what the opponent is assumed to do
 * between our actions. That is the whole change, and it is worth **17 points**.
 */
/**
 * `tieBreak` is measured, not assumed. When the pessimistic search rates several candidates equal,
 * the optimistic model is asked which has the better upside, and that is worth **+2.35 points**
 * (t = 4.94 on 11 df, p < 0.001, 11 of 12 shards positive, 2,040 games against a control on the same
 * seeds) for **+2.1%** per decision.
 *
 * Two earlier runs read +5.0 and +4.9 on smaller samples; those are overestimates regressing toward
 * +2.35 as the sample grew, so quote the largest run.
 *
 * **Only against a matched control.** Identical bots measure 48.6% and 48.7% on two independent seed
 * blocks, so read against a theoretical 50% the same run reads +1.1 and non-significant. Consulting an
 * optimistic model *only between candidates the pessimistic search has already declared equal* is
 * evidently not the same as playing optimistically, which loses 17 points.
 *
 * Unrestricted: restricting it to answer, play and resource measured indistinguishable (+4.25 against
 * +4.9), so the simpler form ships.
 */
export const BEAM_REPLY_LIMITS: BeamLimits = {
  ...DEFAULT_BEAM_LIMITS, reply: 'pessimistic', tieBreak: { reply: 'null' },
}

export const beamReplyAi = makeBeamGreedy(DEFAULT_WEIGHTS, BEAM_REPLY_LIMITS)

/**
 * The shipped model with the per-chain allowance removed, so #488 can be measured on its own.
 *
 * The same role `greedy-flat` plays for quiescence: a control that tracks every other change to the
 * evaluation and the search, differing in exactly one thing. A frozen snapshot would drift and then
 * measure two differences at once.
 *
 * `chainNodes: undefined` is the pre-#488 behaviour: one shared pool, from which chain resolution
 * takes 71.5% to 98% and the lookahead gets what is left.
 */
export const BEAM_REPLY_SHARED_LIMITS: BeamLimits = { ...BEAM_REPLY_LIMITS, chainNodes: undefined }

export const beamReplySharedAi = makeBeamGreedy(DEFAULT_WEIGHTS, BEAM_REPLY_SHARED_LIMITS)

/**
 * The beam with a lethal override in front of it (#433).
 *
 * The beam finds most wins already: measured over 36,384 decisions it misses a line in 0.31% of
 * decisions at matched depth, rising to 1.15% when the solver is allowed depth 6. So this is a narrow
 * override, and its safety property is that **outside that slice it is exactly the beam**. A bot that
 * played differently in ordinary positions could not be A/B-ed as one feature.
 *
 * The gate is not an optimisation, it is part of the design. The solver costs 200 to 350 ms a call
 * once its budget stops binding, which is several times a whole beam decision, so running it
 * everywhere would cost more than simply deepening the beam. Gated to the rounds where lethal is
 * arithmetically possible, it pays only where it can win.
 */
export function makeLethalBeam(
  weights: EvalWeights,
  beamLimits: BeamLimits = DEFAULT_BEAM_LIMITS,
  lethalLimits: LethalLimits = DEFAULT_LETHAL_LIMITS,
  gate: LethalGate = DEFAULT_LETHAL_GATE,
): Ai {
  const beam = makeBeamAi(makeEvaluate(weights), beamLimits)
  return (state: GameState): Action | null => {
    const me = state.activePlayer
    if (shouldSearchLethal(state, me, gate)) {
      const kill = findLethal(state, me, lethalLimits)
      if (kill !== null) return kill
    }
    return beam(state)
  }
}

export const lethalBeamAi = makeLethalBeam(DEFAULT_WEIGHTS)
