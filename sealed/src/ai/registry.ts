import type { Ai } from './types'
import { randomAi } from './randomAi'
import { greedyAi, greedyBaselineAi, greedyFlatAi, beamAi, makeBeamGreedy } from './greedyAi'
import { DEFAULT_BEAM_LIMITS } from './search'
import { DEFAULT_WEIGHTS } from './evaluate'

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
  // The live greedy minus quiescent scoring, so that one change can be measured on its own. Unlike
  // the baseline this tracks every other evaluation change, which is what makes it a control.
  'greedy-flat': greedyFlatAi,
  // The live greedy PLUS own-turn lookahead: same weights, same chain handling, so `beam` against
  // `greedy` isolates the search. Optimistic by construction (it assumes the opponent does nothing),
  // which is why it is measured alongside a pessimistic policy rather than on its own.
  beam: beamAi,
}

/** The names the CLI and any picker can offer. */
export function aiNames(): string[] {
  return Object.keys(AIS)
}

/**
 * `beam:WIDTHxDEPTH` or `beam:WIDTHxDEPTH:NODES`, so a sweep can address any cell without the
 * registry growing a line per cell. `beam` on its own is the shipped configuration.
 *
 * The optional node budget exists for one specific control: the budget is a safety rail, and a rail
 * that fires routinely has quietly become the real width and depth. Re-running a cell with it raised
 * tenfold shows whether the swept axes mean anything.
 */
const BEAM_SPEC = /^beam:(\d+)x(\d+)(?::(\d+))?$/

/** Look up an AI by name, failing loudly (and helpfully) on a typo rather than silently. */
export function resolveAi(name: string): Ai {
  const ai = AIS[name]
  if (ai) return ai

  const spec = BEAM_SPEC.exec(name)
  if (spec) {
    const width = Number(spec[1])
    const depth = Number(spec[2])
    const nodes = spec[3] === undefined ? DEFAULT_BEAM_LIMITS.nodes : Number(spec[3])
    // A zero width or depth would search nothing while still looking like a configured beam, which is
    // the kind of thing that silently costs a night of measurement.
    if (width < 1 || depth < 1 || nodes < 1) {
      throw new Error(`Beam "${name}" needs width, depth and nodes of at least 1`)
    }
    return makeBeamGreedy(DEFAULT_WEIGHTS, { width, depth, nodes })
  }

  throw new Error(`Unknown AI "${name}". Available: ${aiNames().join(', ')}, or beam:WIDTHxDEPTH[:NODES]`)
}
