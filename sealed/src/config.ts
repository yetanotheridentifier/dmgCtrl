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
 * `beam`: one-ply greedy plus own-turn lookahead at width 4, depth 3. It beats plain `greedy`
 * **60.0%** over three seeds and 2580 games.
 *
 * It costs ~85 ms a decision against greedy's ~2.5 ms, and that is affordable because Sealed is a
 * desktop browser app (see architecture.md). Under 100 ms reads as instant on the main thread, so no
 * Web Worker is needed to ship it.
 */
export const OPPONENT_AI = 'beam'

/** The resolved opponent AI. Throws at load if `OPPONENT_AI` is not a registered name (fail fast). */
export const opponentAi: Ai = resolveAi(OPPONENT_AI)
