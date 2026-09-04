import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import { resolveAi } from '../ai/registry'
import { lastSearchTrace, clearSearchTrace } from '../ai/search'
import { COMMIT_ID } from '../buildIdentity'
import { collectCorpus } from './cost'

/**
 * Whether the node rail is firing, and on what it is spending the budget (#447).
 *
 * ## Why this is an instrument and not an inference
 *
 * A stopwatch gets this wrong. Over one identical corpus, raising `nodes` from 10,000 to 200,000
 * takes the same configuration from 55 ms a decision to 550 ms at width 4 depth 3, and from 15.6 ms
 * to 151.8 ms at depth 1 where the beam expands nothing at all. Since `nodes` feeds nothing but the
 * budget, that reads as proof the search is being cut short on nearly every decision.
 *
 * It is not. Measured over 200 real decisions, the rail fires on **4.0%** of them for `beam` and
 * **8.5%** for the shipped `beam-reply`. The tenfold cost is a heavy tail: a handful of positions
 * with an enormous choice-chain fan-out expand to fill whatever budget is offered and drag the mean
 * with them.
 *
 * ## The split is the actionable half
 *
 * Driving owed choice chains and expanding the beam draw on ONE pool, and the chain wins it. Across a
 * twentyfold rise in budget the beam's own spend barely moves (128, 130, 135 nodes) while the chain's
 * goes 510, 2108, 6885, so **raising the rail buys cost and no lookahead**. On the decisions that do
 * exhaust, choice resolution has taken 80% to 98% of the pool and the search is starved precisely
 * where the position is complicated; whatever candidates are left are then scored with a bare
 * `resolve`, half-resolved, which is the defect quiescence exists to prevent.
 *
 * So a high `chainShare` means the two consumers want separating, not that the rail wants raising.
 *
 * ## Reading it
 *
 * The corpus is the one `--cost` uses, driven by `greedy`, so a configuration is measured on
 * positions it did not choose for itself. Use at least ~200 states: it is filled game by game, so a
 * small corpus is nothing but openings, where few units are in play, the budget is never troubled and
 * every cell reports 0% exhaustion.
 */

export interface BudgetConfig {
  states: number
  seed: number
  ais: string[]
}

export interface BudgetRow {
  ai: string
  decisions: number
  /** Share of decisions where the budget ran out, so the move played is a truncated search's answer. */
  exhaustedRate: number
  avgSpend: number
  avgChain: number
  avgBeam: number
  /** `avgChain / avgSpend`: how much of the pool went on resolving choices rather than searching. */
  chainShare: number
}

export interface BudgetReport {
  commitId: string
  states: number
  rows: BudgetRow[]
  /** AIs that run no beam search, so there is nothing to report rather than a healthy-looking zero. */
  skipped: string[]
}

export function runBudget(config: BudgetConfig): BudgetReport {
  const { states: corpus } = collectCorpus(config.states, config.seed)
  const rows: BudgetRow[] = []
  const skipped: string[] = []

  for (const name of config.ais) {
    const ai = resolveAi(name)
    let decisions = 0
    let exhausted = 0
    let spend = 0
    let chain = 0
    let beam = 0

    for (const state of corpus) {
      // Cleared first, so a missing trace afterwards means "this AI runs no beam search" rather than
      // "it ran one and the previous AI's numbers are still sitting there".
      clearSearchTrace()
      ai(state)
      const trace = lastSearchTrace()
      if (trace === null) continue
      decisions++
      if (trace.exhausted) exhausted++
      spend += trace.nodes - trace.left
      chain += trace.chain
      beam += trace.beam
    }

    if (decisions === 0) {
      skipped.push(name)
      continue
    }
    rows.push({
      ai: name,
      decisions,
      exhaustedRate: exhausted / decisions,
      avgSpend: spend / decisions,
      avgChain: chain / decisions,
      avgBeam: beam / decisions,
      chainShare: spend === 0 ? 0 : chain / spend,
    })
  }

  return { commitId: COMMIT_ID, states: corpus.length, rows, skipped }
}
