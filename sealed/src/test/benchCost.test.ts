import { describe, it, expect } from 'vitest'
import { runCost, collectCorpus } from '../bench/cost'
import '../engine/cardDefinitions'

/**
 * Per-decision cost (#425).
 *
 * This exists because the same throwaway timing script has been written three times and cost has
 * been misreported twice, both times from a bench wall clock: **12x when it was 34x**, and
 * **42 ms when it was 200 ms**. A game's wall clock includes the opponent's cheap decisions and
 * engine overhead, so it systematically understates how expensive a search actually is.
 *
 * The instrument's one job is to make the comparison fair: **every AI is timed over the identical
 * corpus of real decision states**. Absolute milliseconds depend on the machine and on which
 * positions the corpus happens to hold, but the ratios do not, and the ratios are what decide whether
 * a configuration is affordable.
 */
describe('runCost', () => {
  // Small on purpose: the beam is ~34x greedy, so a handful of states is enough to order them.
  const report = runCost({ states: 25, seed: 4242, ais: ['greedy', 'beam'] })

  it('reports a row per AI asked for', () => {
    expect(report.rows.map(r => r.ai).sort()).toEqual(['beam', 'greedy'])
    expect(report.states).toBe(25)
  })

  it('measures something', () => {
    for (const row of report.rows) expect(row.msPerDecision, row.ai).toBeGreaterThan(0)
  })

  /**
   * The sanity check on the instrument itself. A deeper search cannot be cheaper than the one-ply
   * scorer it wraps, and the margin is large (~34x), so this holds even when the suite is competing
   * for CPU: load slows both sides and the ratio survives.
   */
  it('finds the deeper search more expensive than one ply', () => {
    const greedy = report.rows.find(r => r.ai === 'greedy')!
    const beam = report.rows.find(r => r.ai === 'beam')!
    expect(beam.msPerDecision).toBeGreaterThan(greedy.msPerDecision * 2)
  })

  /**
   * Ratios are the point, so they are computed rather than left for the reader to divide, and the
   * denominator is `greedy`: it is the reference every win rate is already quoted against, so
   * "31x greedy" composes with what the docs already say.
   *
   * The first version divided by the cheapest AI measured and reported the beam as **2203x random**,
   * which is arithmetically correct and answers no question anyone has.
   */
  it('expresses every cost relative to greedy, the reference results are quoted against', () => {
    expect(report.baseline).toBe('greedy')
    const base = report.rows.find(r => r.ai === 'greedy')!
    expect(base.relative).toBe(1)
    for (const row of report.rows) {
      expect(row.relative).toBeCloseTo(row.msPerDecision / base.msPerDecision, 5)
    }
  })

  /** With no `greedy` in the run there is still a sensible denominator rather than a crash. */
  it('falls back to the cheapest measured when greedy is not in the run', () => {
    const without = runCost({ states: 10, seed: 4242, ais: ['random', 'beam'] })
    expect(without.baseline).toBe('random')
    expect(without.rows.find(r => r.ai === 'random')!.relative).toBe(1)
  })

  it('stamps the commit so a cost can be tied to an engine', () => {
    expect(report.commitId).toBeTruthy()
  })
})

describe('the corpus', () => {
  /**
   * Every AI must see the SAME positions or the comparison measures the positions rather than the
   * AIs. It is therefore collected once, with one fixed driver, before any timing starts.
   */
  it('is identical for a given seed', () => {
    const a = collectCorpus(20, 7)
    const b = collectCorpus(20, 7)
    expect(a.length).toBe(b.length)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('differs by seed, so one lucky deck cannot define the cost', () => {
    expect(JSON.stringify(collectCorpus(20, 7))).not.toBe(JSON.stringify(collectCorpus(20, 99)))
  })

  /**
   * Setup decisions are made by `setupAi` and never consult the evaluation, so timing an AI on them
   * would dilute the number with positions it does not actually think about.
   */
  it('holds only positions an AI is asked to think about', () => {
    for (const state of collectCorpus(20, 7)) {
      expect(state.phase).not.toBe('setup')
      expect(state.winner).toBeNull()
    }
  })
})
