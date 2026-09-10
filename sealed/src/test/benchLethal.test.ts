import { describe, it, expect } from 'vitest'
import { runLethal, GATE_VARIANTS, type LethalReport, type GateRow } from '../bench/lethal'
import { DEFAULT_LETHAL_GATE } from '../ai/lethal'
import '../engine/cardDefinitions'

/** The row for the gate the bot actually runs. Always first, so a reader meets the baseline first. */
const shippedGate = (report: LethalReport): GateRow => report.gates[0]

/**
 * Sizing #433: is the lethal solver worth wiring into the bot, or is it a correct primitive that
 * serves #446 and nothing else?
 *
 * The question is NOT "how often does lethal exist". Two cheaper things already answer most of that:
 * `canFinishNow` settles attacks-only lethal in closed form, and the shipped beam finds any win
 * inside its own depth. What the solver can add is the residue: lines needing the hand, the leader,
 * or a Sentinel cleared, that the beam's score-ordered trimming prunes.
 *
 * So the number that decides the ticket is **how often the solver finds a win the beam misses**.
 * Everything else in the report exists to stop that number being misread.
 */
describe('runLethal', () => {
  // One game per deck over a few decks: enough to exercise every counter without a long test.
  const report = runLethal({ gamesPerDeck: 1, seed: 4242, decks: 2 })

  it('observes real decisions', () => {
    expect(report.games).toBeGreaterThan(0)
    expect(report.decisions).toBeGreaterThan(50)
  })

  /** Every decision falls in exactly one bucket, or the rates are measured against the wrong base. */
  it('classifies every decision exactly once', () => {
    const { decisions, lethal } = report
    expect(lethal.none + lethal.attacksOnly + lethal.searchOnly).toBe(decisions)
  })

  /**
   * The containment that makes the headline honest: a win the beam already sees is not headroom.
   * Anything counted as missed must be a case where the solver said yes and the beam said no.
   */
  it('counts a beam miss only where the solver found a win and the beam did not', () => {
    expect(report.lethal.beamMissed).toBeLessThanOrEqual(report.lethal.attacksOnly + report.lethal.searchOnly)
    expect(report.lethal.beamSaw).toBeLessThanOrEqual(report.lethal.attacksOnly + report.lethal.searchOnly)
    expect(report.lethal.beamSaw + report.lethal.beamMissed).toBe(report.lethal.attacksOnly + report.lethal.searchOnly)
  })

  /**
   * Lethal is arithmetic before it is measurement: bases are ~30 HP, so nothing approaches lethal in
   * the opening rounds. A report showing early lethal would be measuring something other than it
   * claims.
   */
  it('breaks down by round, summing to the total', () => {
    const summed = report.byRound.reduce((n, r) => n + r.decisions, 0)
    expect(summed).toBe(report.decisions)
    const early = report.byRound.filter(r => r.round <= 3).reduce((n, r) => n + r.lethal, 0)
    expect(early, 'a 30 HP base cannot be finished in the first rounds').toBe(0)
  })

  /** #446 will call this repeatedly, so its cost is part of the decision, not an afterthought. */
  it('reports the per-call cost of the solver', () => {
    expect(report.msPerCall).toBeGreaterThan(0)
  })

  /**
   * Pruning is the risk in the whole ticket, and the fixtures it was validated against are vanilla
   * boards. Real positions carry abilities, triggers and owed choices, which is where a damage
   * relevance filter is most likely to be wrong.
   *
   * **The two directions are not equally serious, so they are counted separately.** A total was the
   * first version of this and it hid exactly that distinction: three disagreements appeared once the
   * sample widened beyond this test's two decks, and the count alone could not say whether the
   * pruning had lost a line or the solver had simply out-searched a depth-matched oracle.
   */
  it('never misses a line the exhaustive oracle finds', () => {
    expect(report.oracle.checked).toBeGreaterThan(0)
    expect(report.oracle.solverMissed, 'pruning lost a line the oracle found').toBe(0)
  })

  /**
   * The benign direction, and it is expected rather than tolerated: answering an owed choice costs
   * the solver budget but not depth, since it finishes the action that raised it, while the oracle
   * spends depth on every move alike. In a choice-heavy position the solver therefore searches
   * further on the same nominal budget.
   */
  it('accounts for every disagreement in one direction or the other', () => {
    const { checked, solverMissed, solverExtra } = report.oracle
    expect(solverMissed + solverExtra).toBeLessThanOrEqual(checked)
    expect(report.oracle.disagreedWithChoicePending).toBeLessThanOrEqual(solverMissed + solverExtra)
  })

  /**
   * Depth is swept because the shipped beam runs at 3 while the solver defaulted to 4, so part of
   * "the beam missed it" was never cleverness, just one extra action of lookahead. The report has to
   * say which depth produced it or the number cannot be compared with anything.
   */
  it('records the solver depth and budget it ran at', () => {
    expect(report.solverDepth).toBeGreaterThan(0)
    expect(report.solverNodes).toBeGreaterThan(0)
  })

  /**
   * More depth cannot find less lethal, provided the node budget is not what is binding. That proviso
   * is the point: if a deeper run reports FEWER lethal positions, the budget bound the search rather
   * than the depth, and the whole sweep would be measuring the rail again (as the #410 screen did).
   */
  it('finds at least as much lethal at greater depth', () => {
    // The proviso has to be ENFORCED, not just stated. Both arms ran on the default 4000-node rail,
    // which depth 2 never exhausts and depth 4 routinely does, so the assertion held only while the
    // corpus happened to stay clear of it. It stopped holding the moment the bot generating the corpus
    // changed, and the failure said "depth found less" when the truth was "the rail bound the deeper
    // search". A budget neither depth can exhaust makes depth the only difference between the arms.
    //
    // **It takes 50x the default to stop binding**, not a little headroom: at 40,000 the deeper search
    // still reports less, and only 200,000 makes depth 4 monotone over depth 2 here.
    const solverNodes = 200_000
    const shallow = runLethal({ gamesPerDeck: 1, seed: 4242, decks: 2, solverDepth: 2, solverNodes, oracleSamples: 0 })
    const deep = runLethal({ gamesPerDeck: 1, seed: 4242, decks: 2, solverDepth: 4, solverNodes, oracleSamples: 0 })
    const found = (r: typeof shallow): number => r.lethal.attacksOnly + r.lethal.searchOnly
    expect(found(deep)).toBeGreaterThanOrEqual(found(shallow))
  }, 240_000)

  /**
   * The gate exists to avoid spending 39 ms a call, or 798 ms once the node budget is raised far
   * enough to stop binding, where lethal cannot pay. So it has to actually skip something or it is
   * pure overhead.
   */
  it('skips a meaningful share of decisions', () => {
    expect(shippedGate(report).skipped).toBeGreaterThan(report.decisions / 4)
  })

  /**
   * **The gate's safety property.** Skipping a position that HAS lethal is fine when the beam finds
   * the win anyway, which is exactly what `skipWhenSingleAction` relies on: WIN dominates every other
   * score, so the driver is proven to take it. What must never happen is skipping a win the beam
   * would also miss, because that is the feature silently disabling itself.
   *
   * Counting bare "skipped with lethal" would fail this test for the intended behaviour, which is why
   * the metric is the narrower one.
   */
  it('never skips a win the beam would also miss', () => {
    expect(shippedGate(report).skippedCostingAWin, 'the gate threw away a winnable position').toBe(0)
  })

  /**
   * Several gates scored in ONE run.
   *
   * The solver already runs ungated, so an extra gate costs a predicate evaluation rather than
   * another search: scoring six variants together is within noise of scoring one, where six separate
   * runs would be six times a 48-minute corpus. The gate question is a comparison by nature, and a
   * variant read from a different run than its baseline is not one.
   */
  describe('the gate variants', () => {
    it('scores the shipped gate first, so the baseline leads', () => {
      expect(shippedGate(report).gate).toEqual(DEFAULT_LETHAL_GATE)
    })

    it('scores every variant in GATE_VARIANTS', () => {
      expect(report.gates).toHaveLength(GATE_VARIANTS.length)
      expect(report.gates.map(g => g.label)).toEqual(GATE_VARIANTS.map(v => v.label))
    })

    /** A table nobody can read row by row is not a table. */
    it('labels every variant distinctly', () => {
      expect(new Set(GATE_VARIANTS.map(v => v.label)).size).toBe(GATE_VARIANTS.length)
    })

    /** Each count is a subset of the one above it, or the safety number is measured against the
     *  wrong base and a real loss can hide inside a bigger number. */
    it('nests each count inside the one above', () => {
      for (const row of report.gates) {
        expect(row.skipped, row.label).toBeLessThanOrEqual(report.decisions)
        expect(row.skippedWithLethal, row.label).toBeLessThanOrEqual(row.skipped)
        expect(row.skippedCostingAWin, row.label).toBeLessThanOrEqual(row.skippedWithLethal)
      }
    })

    /**
     * The variants are scored on ONE corpus, so a stricter gate must skip a superset of a looser
     * one. Raising the minimum round only ever adds rounds to the skipped set, so if this ever fails
     * the variants were not scored on the same decisions and no row can be compared with any other.
     */
    it('skips a superset as the minimum round rises', () => {
      const byRound = (min: number): GateRow | undefined =>
        report.gates.find(g => g.gate.minRound === min
          && g.gate.powerBound === DEFAULT_LETHAL_GATE.powerBound
          && g.gate.skipWhenSingleAction === DEFAULT_LETHAL_GATE.skipWhenSingleAction)
      const at4 = byRound(4)
      const at5 = byRound(5)
      const at6 = byRound(6)
      expect(at4, 'the shipped minimum round must be scored').toBeDefined()
      expect(at5!.skipped).toBeGreaterThanOrEqual(at4!.skipped)
      expect(at6!.skipped).toBeGreaterThanOrEqual(at5!.skipped)
    })

    /**
     * **Calls saved is not time saved.** A gate that skips a great many cheap decisions can look
     * dramatic and save little, and every "skipped" figure above is a decision count. `nodeShare` is
     * the solver work surviving the gate as a fraction of the ungated total, which is the quantity a
     * cost decision actually rests on.
     */
    it('reports the surviving work as a share, not just the calls', () => {
      for (const row of report.gates) {
        expect(row.nodeShare, row.label).toBeGreaterThanOrEqual(0)
        expect(row.nodeShare, row.label).toBeLessThanOrEqual(1)
        expect(row.msShare, row.label).toBeGreaterThanOrEqual(0)
        expect(row.msShare, row.label).toBeLessThanOrEqual(1)
      }
    })

    /** A gate that skips a superset must leave no more work behind than the one it contains. */
    it('leaves less work behind as the minimum round rises', () => {
      const share = (min: number): number => report.gates.find(g => g.gate.minRound === min
        && g.gate.readySlack === undefined
        && g.gate.powerBound === DEFAULT_LETHAL_GATE.powerBound
        && g.gate.skipWhenSingleAction === DEFAULT_LETHAL_GATE.skipWhenSingleAction)!.nodeShare
      expect(share(5)).toBeLessThanOrEqual(share(4))
      expect(share(6)).toBeLessThanOrEqual(share(5))
    })

    /** More slack admits more, so more work survives. The sweep is unreadable if this ever inverts. */
    it('leaves more work behind as the slack rises', () => {
      const slacks = report.gates
        .filter(g => g.gate.readySlack !== undefined)
        .sort((a, b) => a.gate.readySlack! - b.gate.readySlack!)
      expect(slacks.length).toBeGreaterThan(1)
      for (let i = 1; i < slacks.length; i++) {
        expect(slacks[i].nodeShare, slacks[i].label).toBeGreaterThanOrEqual(slacks[i - 1].nodeShare)
      }
    })

    /**
     * The control that prices the gate we already have. Turning `skipWhenSingleAction` off can only
     * shrink the skipped set, and if it shrinks it to nothing at the shipped minimum round then the
     * round check is doing all the work and the single-action check is free to reconsider.
     */
    it('scores an arm with the single-action check off', () => {
      const off = report.gates.find(g => !g.gate.skipWhenSingleAction)
      expect(off, 'nothing prices skipWhenSingleAction').toBeDefined()
      expect(off!.skipped).toBeLessThanOrEqual(shippedGate(report).skipped)
    })
  })

  it('is deterministic for a given seed', () => {
    const again = runLethal({ gamesPerDeck: 1, seed: 4242, decks: 2 })
    expect(again.lethal).toEqual(report.lethal)
    expect(again.oracle).toEqual(report.oracle)
  }, 240_000)
})
