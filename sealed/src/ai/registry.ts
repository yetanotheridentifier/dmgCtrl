import type { Ai } from './types'
import { randomAi } from './randomAi'
import { greedyAi, greedyBaselineAi, greedyFlatAi, beamAi, lethalBeamAi, makeBeamGreedy, makeLethalBeam } from './greedyAi'
import { DEFAULT_BEAM_LIMITS } from './search'
import { DEFAULT_LETHAL_LIMITS } from './lethal'
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
  /**
   * The beam with a lethal override in front of it, gated to the rounds where lethal is possible.
   * Outside that slice it is exactly `beam`, which is what makes an A/B between them one feature.
   *
   * **Measured and NOT shipped.** 50.1%, 51.4% and 50.8% against plain `beam` over three seeds and
   * 2580 games: +0.8 points, the same sign on every seed, and not distinguishable from neutral (the
   * combined interval is about +/-1.9). Separating it from zero would need roughly 10,000 games.
   *
   * It stays registered because it is the only way to re-measure it, and because `findLethal` is
   * needed by #446 regardless. Do not read its presence here as a candidate: `OPPONENT_AI` decides
   * what ships, and it is `greedy`.
   */
  'beam-lethal': lethalBeamAi,
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

/**
 * `beam-lethal:WIDTHxBEAMDEPTH:SOLVERDEPTH`, so a run can address the beam and the lethal override
 * independently. They are swept separately on purpose: the beam pays its cost on every decision while
 * the gated solver pays only where lethal is arithmetically possible, so the right depth for one is
 * not the right depth for the other.
 */
const LETHAL_BEAM_SPEC = /^beam-lethal:(\d+)x(\d+):(\d+)$/

/** Look up an AI by name, failing loudly (and helpfully) on a typo rather than silently. */
export function resolveAi(name: string): Ai {
  const ai = AIS[name]
  if (ai) return ai

  const lethalSpec = LETHAL_BEAM_SPEC.exec(name)
  if (lethalSpec) {
    const [width, beamDepth, solverDepth] = lethalSpec.slice(1, 4).map(Number)
    if (width < 1 || beamDepth < 1 || solverDepth < 1) {
      throw new Error(`Lethal beam "${name}" needs width and both depths of at least 1`)
    }
    return makeLethalBeam(
      DEFAULT_WEIGHTS,
      { width, depth: beamDepth, nodes: DEFAULT_BEAM_LIMITS.nodes },
      // Scaled with depth, so the rail does not silently become the real depth. A flat budget made
      // the solver look four times cheaper than it is, and the #410 screen call depth 4 worse than 3.
      { depth: solverDepth, nodes: Math.max(DEFAULT_LETHAL_LIMITS.nodes, solverDepth * 4000) },
    )
  }

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
