import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import type { GameState, PlayerId } from '../engine/types'
import { hasPendingChoices } from '../engine/types'
import { buildCardDb } from '../engine/cardDb'
import { initGame } from '../engine/initGame'
import { DEFAULT_STEP_CEILING } from './selfPlay'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { seededShuffle, nextSeed } from '../engine/rng'
import { setupAi } from '../ai/setupAi'
import { evaluate } from '../ai/evaluate'
import { beamAi } from '../ai/greedyAi'
import { beamReachesWin, DEFAULT_BEAM_LIMITS } from '../ai/search'
import {
  probeLethal, attacksToFinish, shouldSearchLethal, hasLethal,
  DEFAULT_LETHAL_LIMITS, DEFAULT_LETHAL_GATE, type LethalGate,
} from '../ai/lethal'
import { COMMIT_ID } from '../buildIdentity'
import { buildCoverageDecks } from './coverageDecks'
import { firstPlayerFor } from './seating'

/**
 * Sizing the lethal solver (#433): is it worth wiring into the bot?
 *
 * The question is **not** how often lethal exists. Two cheaper things already answer most of that:
 * `attacksToFinish` settles attacks-only lethal in closed form, and the shipped beam finds any win
 * inside its own depth. What the solver can add is the residue, and only that residue is headroom:
 *
 * | bucket | meaning |
 * | --- | --- |
 * | `none` | no lethal found |
 * | `attacksOnly` | the closed form already had it, so search added nothing |
 * | `searchOnly` | needed the hand, the leader, or a Sentinel cleared |
 * | `beamSaw` / `beamMissed` | of the lethal positions, whether the shipped bot already finds the win |
 *
 * **`beamMissed` is the number that decides the ticket.** A win the beam already plays is not
 * headroom, however impressive the solver looks finding it.
 *
 * The run also checks the solver against an exhaustive oracle on real positions, because pruning was
 * validated on vanilla fixtures and real boards carry the abilities, triggers and owed choices where
 * a damage-relevance filter is most likely to be wrong.
 */

const POOL = ashSet as unknown as SwuCard[]

export interface LethalConfig {
  gamesPerDeck: number
  seed: number
  decks?: number
  stepCeiling?: number
  /** How many positions to check against brute force. The oracle is exponential, so this is bounded
   *  and deliberately spread across the run rather than taken from one game. */
  oracleSamples?: number
  /** Check every Nth eligible decision. Smaller means more checks for the same run. */
  oracleStride?: number
  /** Action budget for the oracle comparison. Deliberately independent of `solverDepth`: it checks
   *  the PRUNING, and an oracle at depth 5 is exponentially out of reach. */
  oracleDepth?: number
  /**
   * How many of our actions the solver may use. Swept, because the shipped beam runs at depth 3 while
   * this defaulted to 4, so part of "the beam missed it" was an extra action of lookahead rather than
   * the solver being cleverer. Matching them isolates what the damage-relevance pruning actually buys.
   */
  solverDepth?: number
  /** Node budget for the solver. The CLI scales it with depth so the rail does not silently become
   *  the real depth, which is the mistake the #410 screen made, and `--solver-nodes` overrides that
   *  scaling because it is itself too low to size a solver with. */
  solverNodes?: number
}

export interface LethalCounts {
  none: number
  attacksOnly: number
  searchOnly: number
  beamSaw: number
  beamMissed: number
}

export interface RoundRow {
  round: number
  decisions: number
  lethal: number
  beamMissed: number
}

/**
 * How the pruned solver compares with an exhaustive search on real positions.
 *
 * **The two directions are not equally serious**, and counting only a total hid that: the first
 * version reported three disagreements across three seeds with no way to say whether the pruning had
 * lost lines or the solver had out-searched the oracle.
 */
export interface OracleCheck {
  checked: number
  /** Oracle found a line the solver did not. A real defect: pruning is supposed to drop actions that
   *  cannot contribute, not lines the same budget can reach. */
  solverMissed: number
  /** Solver found a line the depth-matched oracle did not. Expected rather than tolerated: answering
   *  an owed choice costs the solver budget but not depth, since it finishes the action that raised
   *  it, while the oracle spends depth on every move alike. */
  solverExtra: number
  /** Of the disagreements, how many were in positions with an owed choice. This is what tells the two
   *  explanations apart rather than leaving it to argument. */
  disagreedWithChoicePending: number
}

/**
 * What the gate costs and saves.
 *
 * Every gate is a way of NOT finding a line, so it is the same class of silent failure as pruning and
 * gets the same treatment: measured, not trusted.
 */
export interface GateCheck {
  /** Decisions the gate declines to search: the compute it saves. */
  skipped: number
  /** Of those, positions that had a lethal line. Not in itself a loss: `skipWhenSingleAction` skips
   *  obvious wins precisely because WIN dominates and the driver is proven to take them. */
  skippedWithLethal: number
  /** Of those, positions where the beam ALSO misses the win. This is the only real loss, and the
   *  number that has to stay at zero. */
  skippedCostingAWin: number
}

/** One gate's score, named so a table of them can be read row by row. */
export interface GateRow extends GateCheck {
  label: string
  gate: LethalGate
  /**
   * Solver work on the decisions this gate ADMITS, as a share of the ungated total.
   *
   * **Calls saved is not time saved**, and every other figure here is a decision count. A gate that
   * declines a great many cheap positions looks dramatic on `skipped` and saves little; this is what
   * a cost decision actually rests on. `1 - nodeShare` is the real saving.
   */
  nodeShare: number
  /** The same in wall clock, which includes per-node engine cost that `nodeShare` cannot see. */
  msShare: number
}

/**
 * The gates scored side by side, shipped one first.
 *
 * **Several gates, one run.** The solver runs ungated here, so an extra gate costs a predicate
 * evaluation rather than another search: scoring these six together is within noise of scoring one,
 * where six separate runs would each pay for the whole corpus. It also removes the failure mode that
 * matters most, a variant read against a baseline from a different run.
 *
 * Every gate is a way of NOT finding a line, so each row's `skippedCostingAWin` is the one to read
 * and it must be zero before a variant can be considered. `powerBound` is expected to fail exactly
 * that test: it bounds damage by POWER, and a burn event deals damage with none, so a hand holding
 * the finisher reads as a zero ceiling. That is the measurement this table exists to make rather
 * than argue.
 */
export const GATE_VARIANTS: { label: string, gate: LethalGate }[] = [
  { label: 'shipped: round 4+, skip single-action', gate: DEFAULT_LETHAL_GATE },
  { label: 'round 5+', gate: { ...DEFAULT_LETHAL_GATE, minRound: 5 } },
  { label: 'round 6+', gate: { ...DEFAULT_LETHAL_GATE, minRound: 6 } },
  { label: 'power bound on', gate: { ...DEFAULT_LETHAL_GATE, powerBound: true } },
  { label: 'power bound on, round 5+', gate: { ...DEFAULT_LETHAL_GATE, powerBound: true, minRound: 5 } },
  { label: 'single-action check off', gate: { ...DEFAULT_LETHAL_GATE, skipWhenSingleAction: false } },
  // The ready-damage slack, swept. Every other gate here is admissible and therefore saves little;
  // this one trades a measured loss for compute, so the sweep IS the design: read the largest slack
  // whose COST A WIN is still zero, and note that the whole headroom is ~25 positions, so a row
  // losing one or two is losing a real fraction of the feature rather than rounding.
  ...[0, 1, 2, 3, 5, 6, 7, 8, 10, 12].map(readySlack => ({
    label: `ready damage + ${readySlack}`,
    gate: { ...DEFAULT_LETHAL_GATE, readySlack },
  })),
]

/**
 * Where the solver's time actually goes.
 *
 * The cost is dominated by proving negatives, and the split below is what says by how much. A search
 * that finds a line returns on the spot; one that finds nothing must exhaust the tree or the budget.
 * If negatives cost orders more than positives, better pruning has somewhere to go; if they already
 * terminate cheaply, the budget is not what is expensive and pruning would buy nothing.
 */
export interface NodeCheck {
  meanNodes: number
  /** Mean over calls that found a line, and over calls that did not. */
  meanNodesFound: number
  meanNodesNotFound: number
  /** The largest single call, which is what a per-decision time limit has to survive. */
  maxNodes: number
  /** Calls that used the whole budget, so their verdict is "not found in budget". */
  exhausted: number
}

export interface LethalReport {
  commitId: string
  games: number
  /** Games opened by the `player` seat. Half of `games`, and the check that the corpus samples both
   *  openings rather than merely intending to. See `firstPlayerFor`. */
  gamesPlayerFirst: number
  decisions: number
  /** Every gate in `GATE_VARIANTS`, scored on this one corpus, shipped gate first. */
  gates: GateRow[]
  /** What the solver was allowed, so a rate can be compared with another run. */
  solverDepth: number
  solverNodes: number
  lethal: LethalCounts
  byRound: RoundRow[]
  oracle: OracleCheck
  /** Wall clock per `hasLethal` call. #446 calls it repeatedly, so this is part of the decision. */
  msPerCall: number
  /** What each call spent, split by whether it found anything. See `NodeCheck`. */
  nodes: NodeCheck
}

/**
 * Exhaustive, unpruned reference. Slow and obviously correct, which is the only combination worth
 * checking a pruned search against.
 *
 * Takes the same null move and the same action budget as the solver, so a disagreement isolates the
 * PRUNING rather than a difference of question.
 */
function bruteForceLethal(state: GameState, seat: PlayerId, actionsLeft: number): boolean {
  if (state.winner === seat) return true
  if (state.winner !== null || actionsLeft <= 0 || state.phase !== 'action') return false

  let ours = state
  if (ours.activePlayer !== seat) {
    ours = resolve(ours, { type: 'pass' })
    if (ours.winner !== null || ours.phase !== 'action' || ours.activePlayer !== seat) return false
  }

  for (const move of legalMoves(ours)) {
    if (move.type === 'pass') continue
    if (bruteForceLethal(resolve(ours, move), seat, actionsLeft - 1)) return true
  }
  return false
}

export function runLethal(config: LethalConfig): LethalReport {
  const all = buildCoverageDecks(POOL, config.seed).decks
  const decks = config.decks === undefined ? all : all.slice(0, config.decks)
  const cardDb = buildCardDb(POOL)
  const ceiling = config.stepCeiling ?? DEFAULT_STEP_CEILING
  const oracleSamples = config.oracleSamples ?? 60
  const oracleStride = config.oracleStride ?? 17
  const oracleDepth = config.oracleDepth ?? 3
  const solverDepth = config.solverDepth ?? DEFAULT_LETHAL_LIMITS.depth
  const solverNodes = config.solverNodes ?? DEFAULT_LETHAL_LIMITS.nodes
  const solverLimits = { depth: solverDepth, nodes: solverNodes }

  const lethal: LethalCounts = { none: 0, attacksOnly: 0, searchOnly: 0, beamSaw: 0, beamMissed: 0 }
  const rounds = new Map<number, RoundRow>()
  const oracle: OracleCheck = { checked: 0, solverMissed: 0, solverExtra: 0, disagreedWithChoicePending: 0 }
  const gates: GateRow[] = GATE_VARIANTS.map(v => ({
    ...v, skipped: 0, skippedWithLethal: 0, skippedCostingAWin: 0, nodeShare: 0, msShare: 0,
  }))
  // Accumulated raw, divided by the ungated totals at the end. Kept beside `gates` rather than on it
  // so a row never carries a running total that reads like a finished share.
  const admittedNodes = GATE_VARIANTS.map(() => 0)
  const admittedMs = GATE_VARIANTS.map(() => 0)
  let games = 0
  let gamesPlayerFirst = 0
  let decisions = 0
  let solverMs = 0
  let solverCalls = 0
  let nodesTotal = 0
  let nodesFound = 0
  let nodesNotFound = 0
  let callsFound = 0
  let maxNodes = 0
  let exhausted = 0

  decks.forEach((deck, d) => {
    for (let g = 0; g < config.gamesPerDeck; g++) {
      const seed = nextSeed(config.seed + d * 37 + g)
      const shuffleSeed = { v: seed }
      const shuffle = <T,>(arr: T[]): T[] => { shuffleSeed.v = nextSeed(shuffleSeed.v); return seededShuffle(arr, shuffleSeed.v) }
      // Indexed across the whole corpus, not within the deck: at one game per deck, which is this
      // mode's default, a within-deck alternation never fires and every game opens the same way.
      const firstPlayer = firstPlayerFor(d * config.gamesPerDeck + g)
      let s: GameState = initGame(deck, deck, cardDb, { firstPlayer, shuffle, rngSeed: seed })
      games++
      if (firstPlayer === 'player') gamesPlayerFirst++

      for (let i = 0; i < ceiling && s.winner === null; i++) {
        const moves = legalMoves(s)
        if (moves.length === 0) break

        // The setup heuristic drives the opening and never consults the search, so those positions
        // are not decisions any of this applies to.
        const forced = setupAi(s)
        if (forced) { s = resolve(s, forced); continue }

        const me: PlayerId = s.activePlayer
        decisions++
        const row = rounds.get(s.round) ?? { round: s.round, decisions: 0, lethal: 0, beamMissed: 0 }
        row.decisions++

        const start = performance.now()
        const probe = probeLethal(s, me, solverLimits)
        const solver = probe.won
        const callMs = performance.now() - start
        solverMs += callMs
        solverCalls++
        nodesTotal += probe.nodesUsed
        maxNodes = Math.max(maxNodes, probe.nodesUsed)
        if (probe.exhausted) exhausted++
        if (solver) { callsFound++; nodesFound += probe.nodesUsed } else { nodesNotFound += probe.nodesUsed }

        // One beam verdict per decision, shared by every gate row and by the classification below.
        // It is only meaningful where a line exists, and asking costs a real search, so a position
        // with no lethal never pays for it.
        const beamSees = solver && beamReachesWin(s, me, evaluate, DEFAULT_BEAM_LIMITS)

        // The solver above runs UNGATED, so the gates can be scored against the truth rather than
        // against their own admissions. A gate measured only on the positions it admits can never
        // look wrong.
        for (let v = 0; v < GATE_VARIANTS.length; v++) {
          if (shouldSearchLethal(s, me, GATE_VARIANTS[v].gate)) {
            // Admitted, so this call's cost is what the gate leaves behind.
            admittedNodes[v] += probe.nodesUsed
            admittedMs[v] += callMs
            continue
          }
          const g = gates[v]
          g.skipped++
          if (solver) {
            g.skippedWithLethal++
            if (!beamSees) g.skippedCostingAWin++
          }
        }

        if (!solver) {
          lethal.none++
        } else {
          row.lethal++
          // Closed form first: if the ready board alone covers the base within the same budget, the
          // search contributed nothing and this is not evidence for building anything.
          if (attacksToFinish(s, me) <= solverDepth) lethal.attacksOnly++
          else lethal.searchOnly++

          if (beamSees) {
            lethal.beamSaw++
          } else {
            lethal.beamMissed++
            row.beamMissed++
          }
        }

        // Spread the oracle across the run rather than clustering it in one game, and spend it where
        // correctness can actually be wrong: lethal is arithmetically impossible before round 4, so
        // checking those positions only confirms that two searches both return false.
        if (oracle.checked < oracleSamples && s.round >= 4 && decisions % oracleStride === 0) {
          oracle.checked++
          const truth = bruteForceLethal(s, me, oracleDepth)
          const pruned = hasLethal(s, me, { ...DEFAULT_LETHAL_LIMITS, depth: oracleDepth })
          if (truth !== pruned) {
            if (truth) oracle.solverMissed++
            else oracle.solverExtra++
            if (hasPendingChoices(s)) oracle.disagreedWithChoicePending++
          }
        }

        rounds.set(row.round, row)
        const action = beamAi(s)
        if (!action) break
        s = resolve(s, action)
      }
    }
  })

  return {
    commitId: COMMIT_ID,
    games,
    gamesPlayerFirst,
    decisions,
    solverDepth,
    solverNodes,
    gates: gates.map((g, v) => ({
      ...g,
      nodeShare: nodesTotal === 0 ? 0 : admittedNodes[v] / nodesTotal,
      msShare: solverMs === 0 ? 0 : admittedMs[v] / solverMs,
    })),
    lethal,
    byRound: [...rounds.values()].sort((a, b) => a.round - b.round),
    oracle,
    msPerCall: solverCalls === 0 ? 0 : solverMs / solverCalls,
    nodes: {
      meanNodes: solverCalls === 0 ? 0 : nodesTotal / solverCalls,
      meanNodesFound: callsFound === 0 ? 0 : nodesFound / callsFound,
      meanNodesNotFound: solverCalls === callsFound ? 0 : nodesNotFound / (solverCalls - callsFound),
      maxNodes,
      exhausted,
    },
  }
}
