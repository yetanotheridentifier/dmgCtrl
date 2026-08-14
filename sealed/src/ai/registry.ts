import type { Ai } from './types'
import { randomAi } from './randomAi'
import {
  greedyAi, greedyBaselineAi, greedyFlatAi, beamAi, beamReplyAi, beamReplySharedAi, beamReplyUnredactedAi,
  beamHorizonAi, lethalBeamAi,
  makeBeamGreedy, makeLethalBeam, BEAM_REPLY_LIMITS, BEAM_REPLY_SHARED_LIMITS,
} from './greedyAi'
import { DEFAULT_BEAM_LIMITS, TIE_DECISION_KINDS, type BeamLimits } from './search'
import { DEFAULT_LETHAL_LIMITS } from './lethal'
import { DEFAULT_WEIGHTS, type EvalWeights } from './evaluate'

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
   * The beam with the opponent's minimising reply at every level: width 4, depth 3, `pessimistic`.
   * **The deployed model.**
   *
   * Beats plain `beam` by **17 points** (67.4% over three seeds and 2580 games) at 142.6 ms a
   * decision. The two ingredients compose far better than either alone: depth without a reply is
   * worth +10 against `greedy`, and depth ON TOP of a reply is worth +12.9 against `beam`. With a
   * reply at every level the search is proper minimax, so depth compounds instead of building lines
   * that only work if the opponent cooperates.
   */
  'beam-reply': beamReplyAi,
  /**
   * `beam-reply` with the per-chain allowance removed: one shared pool, as before #488. The control
   * for that change and nothing else, in the same spirit as `greedy-flat`.
   *
   * Without the cap, chain resolution takes 71.5% of the budget and the lookahead gets 376 nodes; with
   * it, 59.2% and 493. Exhaustion falls from 8.5% to 6.0% of decisions and the move changes on 2.0%.
   */
  'beam-reply-shared': beamReplySharedAi,
  /**
   * `beam-reply` still reading its own regroup draws: the pre-#516 behaviour, and the control for that
   * fix. A search that crossed the real regroup scored a hand holding cards nobody had drawn.
   *
   * Here so "is the fix also no worse" can be asked at all, since redaction is otherwise unconditional
   * and self-play against the shipped bot would measure nothing.
   */
  'beam-reply-unredacted': beamReplyUnredactedAi,
  /**
   * `beam-reply` allowed to play on into the opening of the next round, instead of stopping when the
   * action phase ends. The arm for #516 and, so far, nothing more than that.
   *
   * **Unmeasured, and not a candidate.** It is here so it can be A/B-ed against `beam-reply` on the
   * same seeds with `--control`, since both arms already search a redacted regroup and the horizon is
   * therefore the only difference between them.
   */
  'beam-horizon': beamHorizonAi,
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
 * `reply:POLICY`, `reply:POLICY:WIDTHxDEPTH` or `reply:POLICY:WIDTHxDEPTH:NODES`, for the
 * opponent-reply policies (#425).
 *
 * `reply:pessimistic` on its own is **two-ply**: one of our moves, their best answer, then score.
 * That is #425 standalone, and the form the A/B against `beam` uses. Adding a width and depth
 * combines it with the own-turn beam, which is #447's question.
 *
 * The node budget matters more here than on a `beam:` cell, not less. A reply expands every legal
 * answer at every level, so it draws on the shared rail far faster, and until this field existed
 * every reply configuration was pinned at the 10,000-node default. Lifting the rail off one cell
 * changes its cost tenfold, so that default was the binding constraint on the deployed model rather
 * than the width and depth its name advertises.
 */
const REPLY_SPEC = /^reply:(pessimistic|selfish)(?::(\d+)x(\d+)(?::(\d+))?)?$/

/**
 * `beam-lethal:WIDTHxBEAMDEPTH:SOLVERDEPTH`, so a run can address the beam and the lethal override
 * independently. They are swept separately on purpose: the beam pays its cost on every decision while
 * the gated solver pays only where lethal is arithmetically possible, so the right depth for one is
 * not the right depth for the other.
 */
const LETHAL_BEAM_SPEC = /^beam-lethal:(\d+)x(\d+):(\d+)$/

/**
 * `NAME+WEIGHT=VALUE`, so a single evaluation weight can be swept against the deployed search.
 *
 * A new weight ships at zero and is then swept upward, which needs two AIs differing in that weight
 * and nothing else. The existing tuner cannot supply them: `tune.ts` builds candidates with
 * `makeTunedGreedy`, the **one-ply** factory, so it would size a weight for a bot we stopped
 * shipping. That is the same flaw `--terms` and `--decisions` both carried, and #487 exists to fix
 * it properly; this is the narrow version that unblocks a single-weight A/B today.
 *
 * `beam-reply+shield=4` against plain `beam-reply` is exactly one difference, and `--shard` can run
 * it. Negatives are allowed: a term can be worth measuring in either direction.
 */
const WEIGHT_OVERRIDE = /^(.+)\+([A-Za-z][A-Za-z0-9]*)=(-?\d+(?:\.\d+)?)$/

/**
 * `NAME/tie=FIELD:VALUE[,FIELD:VALUE...]`, naming the second opinion consulted when candidates tie
 * for the lead (#499).
 *
 * `key:value` pairs rather than a positional form, because a tie-break is a `Partial` of the search
 * limits and usually sets one field. A positional grammar would need a slot per field and a
 * convention meaning "leave this one alone".
 *
 * Addressable because it has to be measurable: ties for the lead are 32.0% of decisions, so `--cost`
 * has a real question to answer, and `--shard` needs to A/B `beam-reply/tie=reply:null` against plain
 * `beam-reply` as exactly one difference.
 */
const TIE_BREAK_SPEC = /^(.+)\/tie=(.*)$/

/** The fields a second opinion may set, and how to read each one. Anything else is a typo. */
const TIE_BREAK_FIELDS = ['reply', 'width', 'depth', 'nodes', 'kinds'] as const

/**
 * The tie-break a name asks for, or `null` if it asks for none.
 *
 * Exported so the grammar is directly assertable, for the same reason `beamLimitsFor` is: a spec that
 * silently parses to nothing would run the shipped bot under a tie-break's name and report "no
 * difference", which is the most expensive way this can fail.
 */
export function tieBreakFor(name: string): Partial<BeamLimits> | null {
  const m = TIE_BREAK_SPEC.exec(name)
  if (!m) return null
  const spec = m[2]
  if (spec.trim() === '') throw new Error(`Empty tie-break in "${name}". Try /tie=reply:null`)

  const tieBreak: Partial<BeamLimits> = {}
  for (const part of spec.split(',')) {
    const [key, ...rest] = part.split(':')
    const value = rest.join(':')
    // `find` rather than `includes`, so the result carries the literal union and the numeric branch
    // below indexes `BeamLimits` by a known key instead of by an arbitrary string.
    const field = TIE_BREAK_FIELDS.find(f => f === key)
    if (field === undefined) {
      throw new Error(`Unknown tie-break field "${key}" in "${name}". Valid: ${TIE_BREAK_FIELDS.join(', ')}`)
    }
    if (field === 'reply') {
      if (value !== 'null' && value !== 'pessimistic' && value !== 'selfish') {
        throw new Error(`Unknown tie-break reply policy "${value}" in "${name}". Valid: null, pessimistic, selfish`)
      }
      tieBreak.reply = value
    } else if (field === 'kinds') {
      // Pipe-separated, since the comma already separates fields. Validated against the search's own
      // vocabulary rather than a restatement of it: a kind the search never produces would silence
      // the arm while the name still reads as configured.
      const named = value.split('|').filter(k => k !== '')
      if (named.length === 0) {
        throw new Error(`Empty tie-break kinds in "${name}". Valid: ${TIE_DECISION_KINDS.join(', ')}`)
      }
      for (const k of named) {
        if (!TIE_DECISION_KINDS.some(valid => valid === k)) {
          throw new Error(`Unknown decision kind "${k}" in "${name}". Valid: ${TIE_DECISION_KINDS.join(', ')}`)
        }
      }
      tieBreak.tieKinds = named
    } else {
      const n = Number(value)
      // A non-numeric value parses to NaN, which would sail through a `< 1` check and reach the search
      // as a silently broken limit.
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`Tie-break "${field}" in "${name}" needs a whole number of at least 1, got "${value}"`)
      }
      tieBreak[field] = n
    }
  }
  return tieBreak
}

/**
 * The limits behind a **registered** beam name, so a suffix can rebuild that bot rather than an
 * approximation of it.
 *
 * Reads the same constants the AIs are built from, never a restatement of them. The weight-override
 * path previously resolved every registry name to the shipped pessimistic configuration, which made
 * `beam+shield=4` a pessimistic bot wearing an optimistic name: an A/B against `beam` would have
 * measured the reply policy alongside the weight.
 */
export function namedLimitsFor(name: string): BeamLimits | null {
  const named: Record<string, BeamLimits> = {
    beam: DEFAULT_BEAM_LIMITS,
    'beam-reply': BEAM_REPLY_LIMITS,
    'beam-reply-shared': BEAM_REPLY_SHARED_LIMITS,
  }
  return named[name] ?? null
}

/** Split `NAME+WEIGHT=VALUE` into the AI name and the override, validating the key exists. */
function splitWeightOverride(name: string): { base: string; overrides?: Partial<EvalWeights> } {
  const m = WEIGHT_OVERRIDE.exec(name)
  if (!m) return { base: name }
  const [, base, key, raw] = m
  // Checked against the real weight set rather than a hardcoded list, so a typo fails loudly instead
  // of being silently dropped and measured as "no difference".
  if (!(key in DEFAULT_WEIGHTS)) {
    throw new Error(`Unknown weight "${key}" in "${name}". Valid: ${Object.keys(DEFAULT_WEIGHTS).join(', ')}`)
  }
  return { base, overrides: { [key]: Number(raw) } as Partial<EvalWeights> }
}

/**
 * The limits a `beam:` or `reply:` cell names, or `null` if the name is neither.
 *
 * **Spreads `DEFAULT_BEAM_LIMITS` first, and that is the point.** Building the limits field by field
 * meant every new `BeamLimits` field silently defaulted to `undefined` for spec cells while the
 * shipped bot got it. `chainNodes` (#488) did exactly that: `reply:pessimistic:8x3` differed from
 * `beam-reply` in width AND the per-chain allowance, so a width A/B between them would have measured
 * two changes and attributed both to width.
 *
 * Exported so the grammar is directly assertable. A sweep's baseline cell has to BE the shipped
 * configuration, and inferring that through a decision trace is a weaker check than reading it.
 */
export function beamLimitsFor(name: string): BeamLimits | null {
  const { base } = splitWeightOverride(name)
  name = base
  const reply = REPLY_SPEC.exec(name)
  if (reply) {
    const policy = reply[1] as 'pessimistic' | 'selfish'
    // Depth 1 is two-ply: our move, their answer, score. Width is irrelevant there (the beam's trim
    // is never reached), which is why the bare form takes neither.
    const width = reply[2] === undefined ? DEFAULT_BEAM_LIMITS.width : Number(reply[2])
    const depth = reply[3] === undefined ? 1 : Number(reply[3])
    const nodes = reply[4] === undefined ? DEFAULT_BEAM_LIMITS.nodes : Number(reply[4])
    if (width < 1 || depth < 1 || nodes < 1) {
      throw new Error(`Reply AI "${name}" needs width, depth and nodes of at least 1`)
    }
    return { ...DEFAULT_BEAM_LIMITS, width, depth, nodes, reply: policy }
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
    return { ...DEFAULT_BEAM_LIMITS, width, depth, nodes }
  }

  return null
}

/** Look up an AI by name, failing loudly (and helpfully) on a typo rather than silently. */
export function resolveAi(name: string): Ai {
  const ai = AIS[name]
  if (ai) return ai

  // `/tie=...` is stripped first so it composes with every other suffix and spec: the remainder is an
  // ordinary name, and the tie-break is folded into whatever limits that name resolves to.
  const tieBreak = tieBreakFor(name)
  if (tieBreak) {
    const base = TIE_BREAK_SPEC.exec(name)![1]
    const weighted = splitWeightOverride(base)
    const limits = beamLimitsFor(weighted.base) ?? namedLimitsFor(weighted.base)
    if (limits === null) throw new Error(`Cannot add a tie-break to "${weighted.base}"`)
    return makeBeamGreedy({ ...DEFAULT_WEIGHTS, ...weighted.overrides }, { ...limits, tieBreak })
  }

  // `NAME+WEIGHT=VALUE` rebuilds the named bot with one weight changed. Handled before the specs so
  // the suffix composes with all of them, and separately from the registry lookup because a named
  // entry is a prebuilt singleton that cannot carry different weights.
  const weighted = splitWeightOverride(name)
  if (weighted.overrides) {
    const weights = { ...DEFAULT_WEIGHTS, ...weighted.overrides }
    // The name's OWN limits, not the shipped ones. Falling back to a pessimistic default made
    // `beam+shield=4` an optimistic name on a pessimistic bot, so an A/B against `beam` would have
    // measured the reply policy as well as the weight.
    const limits = beamLimitsFor(weighted.base) ?? namedLimitsFor(weighted.base)
    if (limits === null) throw new Error(`Cannot override a weight on "${weighted.base}"`)
    return makeBeamGreedy(weights, limits)
  }

  const lethalSpec = LETHAL_BEAM_SPEC.exec(name)
  if (lethalSpec) {
    const [width, beamDepth, solverDepth] = lethalSpec.slice(1, 4).map(Number)
    if (width < 1 || beamDepth < 1 || solverDepth < 1) {
      throw new Error(`Lethal beam "${name}" needs width and both depths of at least 1`)
    }
    return makeLethalBeam(
      DEFAULT_WEIGHTS,
      { ...DEFAULT_BEAM_LIMITS, width, depth: beamDepth },
      // Scaled with depth, so the rail does not silently become the real depth. A flat budget made
      // the solver look four times cheaper than it is, and the #410 screen call depth 4 worse than 3.
      { depth: solverDepth, nodes: Math.max(DEFAULT_LETHAL_LIMITS.nodes, solverDepth * 4000) },
    )
  }

  const limits = beamLimitsFor(name)
  if (limits) return makeBeamGreedy(DEFAULT_WEIGHTS, limits)

  throw new Error(
    `Unknown AI "${name}". Available: ${aiNames().join(', ')}, ` +
    'or beam:WIDTHxDEPTH[:NODES], or reply:POLICY[:WIDTHxDEPTH[:NODES]]. ' +
    'Suffixes: +WEIGHT=VALUE, /tie=FIELD:VALUE[,FIELD:VALUE]',
  )
}
