import type { Ai } from './types'
import { randomAi } from './randomAi'
import { greedyAi, greedyBaselineAi } from './greedyAi'

/**
 * The named-AI registry: the single place that knows which opponents exist. The bench addresses
 * them by name, and later the app's opponent picker can too. Adding a rung (greedy #391, role-aware
 * #395, an MCTS or LLM later) is one line here, nothing else in the codebase needs to change.
 */
export const AIS: Record<string, Ai> = {
  random: randomAi,
  greedy: greedyAi,
  // Frozen pre-#392 greedy: a fixed reference for measuring the live greedy in the generalisation
  // diagnostic (a moving comparison needs a stationary baseline).
  'greedy-baseline': greedyBaselineAi,
}

/** The names the CLI and any picker can offer. */
export function aiNames(): string[] {
  return Object.keys(AIS)
}

/** Look up an AI by name, failing loudly (and helpfully) on a typo rather than silently. */
export function resolveAi(name: string): Ai {
  const ai = AIS[name]
  if (!ai) {
    throw new Error(`Unknown AI "${name}". Available: ${aiNames().join(', ')}`)
  }
  return ai
}
