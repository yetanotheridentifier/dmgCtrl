import type { Ai } from './ai/types'
import { resolveAi } from './ai/registry'

/**
 * Deployment configuration for the sealed app.
 *
 * `OPPONENT_AI` is the AI model the build ships against. It is a **deployment** setting, not a user
 * choice: to release a new model, change this to another registered name (see `ai/registry.ts`) and
 * redeploy. Keeping it a single reviewed constant means every model change is a visible one-line diff
 * in a pull request, which is the gate for shipping a model only once we are happy with it. A
 * user-facing difficulty picker could sit on top of this later; for now it is fixed per deploy.
 */
/**
 * `beam-reply`: own-turn lookahead at width 4, depth 3, with the opponent's minimising reply at every
 * level. It beats plain `beam` **67.4%** over three seeds and 2580 games, and `beam` in turn beat
 * one-ply `greedy` 60.0%.
 *
 * It costs ~143 ms a decision against greedy's ~2 ms, which is affordable because Sealed is a desktop
 * browser app (see architecture.md). No Web Worker is needed at that budget.
 */
export const OPPONENT_AI = 'beam-reply'

/** The resolved opponent AI. Throws at load if `OPPONENT_AI` is not a registered name (fail fast). */
export const opponentAi: Ai = resolveAi(OPPONENT_AI)
