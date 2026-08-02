import { describe, it, expect } from 'vitest'
import { runDecisions, classifyResolution } from '../bench/decisions'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import { state } from './helpers/engineFixtures'
import type { PendingChoice } from '../engine/types'
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
      'answering a choice',
    ])
  })

  /**
   * Answering a pending choice is its own decision kind and was going unmeasured, which left the
   * optional-abilities work with no way to size itself. It is the one kind where the candidates are
   * not actions the player chose to have: the card handed them a menu.
   */
  it('measures how well the evaluation separates the answers to a choice', () => {
    const answering = report.stats.find(s => s.label === 'answering a choice')!
    expect(answering.offered, 'choices with more than one answer are common').toBeGreaterThan(0)
    expect(answering.avgCandidates).toBeGreaterThan(1)
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

  /**
   * Sizes the search work before any of it is built. Greedy scores the state a candidate move
   * produces, but some moves do not finish resolving: they leave a choice owed, either by the
   * opponent (an attack suspending on "may prevent damage") or by the mover itself (a when-played
   * effect whose target has not been picked). Either way the score is read off a half-resolved
   * board.
   *
   * The two counts point at different fixes, so they are reported separately: an opponent-owed
   * answer wants pessimistic resolution, a self-owed one wants the mover's own sequence expanded.
   */
  it('counts candidate moves that leave a choice owed, split by who owes it', () => {
    const s = report.suspended
    expect(s.positions, 'decisions observed').toBeGreaterThan(0)
    expect(s.candidates).toBeGreaterThanOrEqual(s.positions)

    // Each split is a subset of the whole, at both candidate and position granularity.
    expect(s.opponentAnswers + s.selfAnswers).toBeLessThanOrEqual(s.candidates)
    expect(s.positionsWithOpponentAnswer).toBeLessThanOrEqual(s.positions)
    expect(s.positionsWithSelfAnswer).toBeLessThanOrEqual(s.positions)
    expect(s.chosenOpponentAnswer).toBeLessThanOrEqual(s.positionsWithOpponentAnswer)
    expect(s.chosenSelfAnswer).toBeLessThanOrEqual(s.positionsWithSelfAnswer)

    // A when-played effect that asks the mover something is common enough that zero would mean the
    // instrument is broken rather than that the game lacks them.
    expect(s.selfAnswers, 'self-owed answers are everywhere in this card pool').toBeGreaterThan(0)

    // Naming the kinds is what turns a rate into a decision: one card driving it all is a very
    // different ticket from a broad spread, and on our own side a chain we can finish on the spot
    // is a different fix from an `ambush` that opens a whole second action.
    for (const ks of [s.opponentChoiceKinds, s.selfChoiceKinds]) {
      expect(ks.every(k => k.count > 0)).toBe(true)
      expect([...ks].sort((a, b) => b.count - a.count)).toEqual(ks)
    }
    expect(s.selfChoiceKinds.reduce((n, k) => n + k.count, 0)).toBe(s.selfAnswers)
    expect(s.opponentChoiceKinds.reduce((n, k) => n + k.count, 0)).toBe(s.opponentAnswers)
  })

  // Two full passes of the diagnostic, and quiescent scoring made each one about 2.5x dearer, so the
  // budget is generous: this guards determinism, and a slow machine failing it teaches nothing.
  it('is deterministic for a given seed', () => {
    expect(runDecisions({ gamesPerDeck: 1, seed: 4242 })).toEqual(report)
  }, 120_000)
})

/**
 * The classifier the counts above are built from, tested directly so the rates cannot quietly drift
 * on a mis-read of who owes what. `activePlayer` is not enough on its own: the engine hands the turn
 * to the opponent when it raises a choice they control, so a state with them to move may be an
 * unfinished action rather than a completed one.
 */
describe('classifyResolution', () => {
  const choice = (controller: 'player' | 'opponent'): PendingChoice =>
    ({ kind: 'selectUnitToDefeat', id: 'c', controller, targets: ['u1'] })

  it('calls a fully resolved state complete', () => {
    expect(classifyResolution(state({ activePlayer: 'opponent' }), 'player')).toEqual({ kind: 'complete' })
  })

  it('reports a choice the mover still owes', () => {
    const s = state({ pendingChoices: [choice('player')] })
    expect(classifyResolution(s, 'player')).toEqual({ kind: 'self', choiceKind: 'selectUnitToDefeat' })
  })

  it('reports a choice handed to the opponent mid-action', () => {
    // The engine flips activePlayer to them so they can answer, then hands control back.
    const s = state({ activePlayer: 'opponent', pendingChoices: [choice('opponent')] })
    expect(classifyResolution(s, 'player')).toEqual({ kind: 'opponent', choiceKind: 'selectUnitToDefeat' })
  })

  /** A finished game is scored terminally, so an unanswered choice on it is not a half-resolution. */
  it('calls a won game complete even with a choice left pending', () => {
    const s = state({ winner: 'player', pendingChoices: [choice('opponent')] })
    expect(classifyResolution(s, 'player')).toEqual({ kind: 'complete' })
  })

  /** Both owed: the opponent's is the one that blocks, so it wins the classification. */
  it('prefers the opponent when both owe an answer', () => {
    const s = state({ activePlayer: 'opponent', pendingChoices: [choice('player'), choice('opponent')] })
    expect(classifyResolution(s, 'player')).toMatchObject({ kind: 'opponent' })
  })
})
