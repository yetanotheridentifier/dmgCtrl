import { describe, it, expect } from 'vitest'
import { runLethal } from '../bench/lethal'
import '../engine/cardDefinitions'

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
    const shallow = runLethal({ gamesPerDeck: 1, seed: 4242, decks: 2, solverDepth: 2, oracleSamples: 0 })
    const deep = runLethal({ gamesPerDeck: 1, seed: 4242, decks: 2, solverDepth: 4, oracleSamples: 0 })
    const found = (r: typeof shallow): number => r.lethal.attacksOnly + r.lethal.searchOnly
    expect(found(deep)).toBeGreaterThanOrEqual(found(shallow))
  }, 240_000)

  /**
   * The gate exists to avoid spending 200 to 350 ms where lethal cannot pay, so it has to actually
   * skip something or it is pure overhead.
   */
  it('skips a meaningful share of decisions', () => {
    expect(report.gate.skipped).toBeGreaterThan(report.decisions / 4)
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
    expect(report.gate.skippedCostingAWin, 'the gate threw away a winnable position').toBe(0)
  })

  it('is deterministic for a given seed', () => {
    const again = runLethal({ gamesPerDeck: 1, seed: 4242, decks: 2 })
    expect(again.lethal).toEqual(report.lethal)
    expect(again.oracle).toEqual(report.oracle)
  }, 240_000)
})
