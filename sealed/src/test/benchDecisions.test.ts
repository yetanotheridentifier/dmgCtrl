import { describe, it, expect } from 'vitest'
import { runDecisions } from '../bench/decisions'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import '../engine/cardDefinitions'

/**
 * Decision-quality diagnostics (#393). Win rate moves a point or two and says nothing about why;
 * what actually diagnosed #393 was counting how often the evaluation had NO opinion, every
 * candidate scoring the same so the seeded tie-break chose at random. That was 100% of regroup
 * resource picks, and it is the number a fix has to move.
 */
describe('runDecisions', () => {
  // One game per deck keeps this quick; the numbers are stable enough to assert on.
  const report = runDecisions({ gamesPerDeck: 1, seed: 4242 })

  it('reports the decisions the AI series cares about', () => {
    expect(report.stats.map(s => s.label)).toEqual([
      'regroup: which card',
      'initiative: take it',
      'which attack',
      'which card to play',
    ])
  })

  it('actually plays games and observes each decision', () => {
    expect(report.games).toBeGreaterThan(0)
    for (const s of report.stats) expect(s.offered, s.label).toBeGreaterThan(0)
  })

  /**
   * The regression this exists to prevent. Before #393 every one of these was a tie; if the hand
   * valuation is ever removed or neutralised, this fails loudly rather than showing up as a slow
   * drift in win rate.
   */
  it('shows the AI has an opinion about which card to bank', () => {
    const resourcing = report.stats.find(s => s.label === 'regroup: which card')!
    expect(resourcing.avgCandidates, 'several cards to choose between').toBeGreaterThan(2)
    expect(resourcing.tied / resourcing.offered).toBeLessThan(0.1)
  })

  // Plays the coverage deck set twice over, so well past vitest's 5s default.
  /**
   * The readout that let #393 iteration 2 be judged. Banking is a flat public +1 at every regroup,
   * so the shipped AI never skips: 0% is the correct current number, not a broken measurement. A
   * concave pool moved it to 12.5% (all at a pool of exactly the knee) and still lost, so the flat
   * weights stayed. This asserts the instrument reports the behaviour, whatever the weights say.
   */
  it('reports whether the AI banks or skips, and at what pool size', () => {
    const { banked, skipped, avgPoolWhenBanked } = report.resourcing
    expect(banked).toBeGreaterThan(0)
    expect(avgPoolWhenBanked).toBeGreaterThan(0)
    // Flat pool value (`resourceSurplus === resource`) means banking always wins by exactly +1, and
    // the private hand term is bounded below 1, so it can never flip that. Forced skips (an empty
    // hand leaves no other legal move) are excluded, or this would be a few percent of phantoms.
    expect(DEFAULT_WEIGHTS.resourceSurplus).toBe(DEFAULT_WEIGHTS.resource)
    expect(skipped, 'a flat pool never CHOOSES to decline a resource').toBe(0)
  })

  /**
   * #394's readout, and the guard against its two named failure modes. Never-claim and always-claim
   * are both wrong however good the win rate looks, so the raw counts are asserted rather than a
   * score. Claiming forfeits the rest of your round, so a low mean of forfeited ready units is the
   * sign the cost term is doing its job.
   */
  it('claims the initiative sometimes, but never always and never not at all', () => {
    const { offered, taken, cheapOffered, cheapTaken, avgForfeitedWhenClaimed } = report.initiative
    expect(offered).toBeGreaterThan(0)
    expect(taken, 'never-claim is a failure mode').toBeGreaterThan(0)
    expect(taken, 'always-claim is the other failure mode').toBeLessThan(offered)
    // The cheap window (opponent already passed) should be taken far more often than not.
    expect(cheapOffered).toBeGreaterThan(0)
    expect(cheapTaken / cheapOffered).toBeGreaterThan(0.5)
    // It should mostly claim when it had little left to do: pre-#394 this averaged 2.5.
    expect(avgForfeitedWhenClaimed).toBeLessThan(1)
  })

  it('is deterministic for a given seed', () => {
    expect(runDecisions({ gamesPerDeck: 1, seed: 4242 })).toEqual(report)
  }, 30_000)
})
