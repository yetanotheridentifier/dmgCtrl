import { describe, it, expect } from 'vitest'
import { runBudget } from '../bench/budget'
import '../engine/cardDefinitions'

/**
 * How often the node rail actually fires, and on what (#447).
 *
 * This mode exists because a stopwatch gave the wrong answer. Raising `nodes` from 10,000 to 200,000
 * makes the same configuration cost ten times as much, at depth 3 and at depth 1 alike, and since
 * `nodes` feeds nothing but the budget, that looked like proof the search was being cut short on
 * essentially every decision. It is not. Measured over 200 real decisions the rail fires on **4.0%**
 * of them for `beam` and **8.5%** for the shipped `beam-reply`.
 *
 * The tenfold cost is a heavy tail: a few positions with an enormous choice-chain fan-out expand to
 * fill whatever budget is offered, and drag the average with them. **It buys no lookahead** either.
 * Across a twentyfold budget rise the beam's own spend goes 128, 130, 135, while the chain's goes
 * 510, 2108, 6885.
 *
 * That is the finding worth having, and only the split shows it: the two consumers share one pool, so
 * on the decisions that do exhaust, choice resolution has taken 80% to 98% of the budget and the
 * lookahead is starved exactly where the position is complicated. Whatever is left over scores its
 * remaining candidates with a bare `resolve`, half-resolved, which is the defect quiescence exists to
 * prevent.
 */
describe('runBudget', () => {
  // A budget too small to finish against the shipped one. Deliberately extreme: the point of the
  // assertion is that exhaustion is detected and ordered, not that a particular cell exhausts.
  const report = runBudget({ states: 20, seed: 4242, ais: ['beam:4x3:200', 'beam:4x3:10000'] })

  it('reports a row per AI asked for', () => {
    expect(report.rows.map(r => r.ai)).toEqual(['beam:4x3:200', 'beam:4x3:10000'])
    expect(report.states).toBe(20)
  })

  /** The property the sweep leans on: a cell that cannot finish is visibly distinguished from one
   *  that can, rather than both reporting a plausible-looking number. */
  it('separates a budget that cannot finish from one that can', () => {
    const tight = report.rows.find(r => r.ai === 'beam:4x3:200')!
    const ample = report.rows.find(r => r.ai === 'beam:4x3:10000')!
    expect(tight.exhaustedRate).toBeGreaterThan(0)
    expect(tight.exhaustedRate).toBeGreaterThan(ample.exhaustedRate)
  })

  /** And a truncated search really is doing less work, not just reporting a flag. */
  it('shows the truncated cell spending less than the one it starves', () => {
    const tight = report.rows.find(r => r.ai === 'beam:4x3:200')!
    const ample = report.rows.find(r => r.ai === 'beam:4x3:10000')!
    expect(tight.avgSpend).toBeLessThan(ample.avgSpend)
  })

  /** A truncated search cannot have spent less than its budget, and an untruncated one cannot have
   *  spent more: the two counters have to be readable as a share of a real spend. */
  it('accounts for the spend it reports', () => {
    for (const row of report.rows) {
      expect(row.avgChain + row.avgBeam).toBeCloseTo(row.avgSpend, 5)
      expect(row.avgSpend).toBeGreaterThan(0)
    }
  })

  /** Which half of the pool is being drained decides whether raising the rail is the fix at all. */
  it('splits the spend between chain resolution and beam expansion', () => {
    for (const row of report.rows) {
      expect(row.avgChain).toBeGreaterThanOrEqual(0)
      expect(row.avgBeam).toBeGreaterThan(0)
      expect(row.chainShare).toBeCloseTo(row.avgChain / row.avgSpend, 5)
    }
  })

  it('stamps the commit so a reading can be tied to an engine', () => {
    expect(report.commitId).toBeTruthy()
  })

  /** A one-ply AI runs no search of this kind, so it must report nothing rather than a misleading
   *  zero-exhaustion row that looks like a healthy budget. */
  it('skips AIs that do not run a beam search', () => {
    const plain = runBudget({ states: 10, seed: 4242, ais: ['greedy'] })
    expect(plain.rows).toEqual([])
    expect(plain.skipped).toEqual(['greedy'])
  })
})
