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
export const OPPONENT_AI = 'greedy'

/** The resolved opponent AI. Throws at load if `OPPONENT_AI` is not a registered name (fail fast). */
export const opponentAi: Ai = resolveAi(OPPONENT_AI)
