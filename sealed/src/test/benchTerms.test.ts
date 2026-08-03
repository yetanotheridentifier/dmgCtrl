import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'
import { buildCardDb } from '../engine/cardDb'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { initGame } from '../engine/initGame'
import { resolve } from '../engine/resolve'
import { seededShuffle, nextSeed } from '../engine/rng'
import { setupAi } from '../ai/setupAi'
import { greedyAi } from '../ai/greedyAi'
import { publicBreakdown, makePublicScore, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { DEFAULT_HAND_WEIGHTS } from '../ai/handValue'
import { role } from '../ai/race'
import { runTerms, stepFor } from '../bench/terms'
import { SCALAR_KEYS } from '../bench/tune'
import '../engine/cardDefinitions'

/**
 * Term sensitivity (#430): which evaluation weights can actually change a decision.
 *
 * A one-ply evaluation only ever compares candidates from ONE position, so a term equal across those
 * candidates adds the same constant to every score and cancels exactly, whatever its weight. The
 * diagnostic reports two things per weight: whether its quantity **varies** across candidates at all,
 * and whether nudging it is **pivotal**, i.e. changes the move the bot picks.
 *
 * The pair matters more than either half. A 400,000-game sweep found nothing even for `base` and
 * `unit`, which vary at nearly every decision: the argmax was robust, not the terms flat. "Varies but
 * never pivotal" is that null result, visible in minutes.
 */

const POOL = ashSet as unknown as SwuCard[]

/** Real positions to check the decomposition against. Fixtures would only prove it on the shapes I
 *  thought to write; these are the boards the AI actually scores. */
function corpus(limit: number): GameState[] {
  const { decks } = buildCoverageDecks(POOL, 42)
  const cardDb = buildCardDb(POOL)
  const states: GameState[] = []
  let seed = 42

  for (const deck of decks.slice(0, 4)) {
    if (states.length >= limit) break
    seed = nextSeed(seed)
    let s = seed
    let state = initGame(deck, deck, cardDb, {
      firstPlayer: 'player',
      shuffle: <T>(arr: T[]): T[] => { s = nextSeed(s); return seededShuffle(arr, s) },
      rngSeed: seed,
    })
    while (state.winner === null && states.length < limit) {
      const action = setupAi(state) ?? greedyAi(state)
      if (!action) break
      states.push(state)
      state = resolve(state, action)
    }
  }
  return states
}

describe('the term decomposition', () => {
  const states = corpus(400)

  /**
   * **The load-bearing test.** `publicBreakdown` is a second reading of the same arithmetic as
   * `makePublicScore`, kept separate so the hot path allocates nothing per score. Two implementations
   * drift, so this pins them together over real boards: if the identity ever breaks, the diagnostic
   * is reporting on an evaluation the bot does not use.
   */
  it('sums to exactly the score the AI actually uses', () => {
    const score = makePublicScore(DEFAULT_WEIGHTS)
    expect(states.length).toBeGreaterThan(100)
    for (const state of states) {
      // A decided game short-circuits to +/-WIN before any term is computed, so there is nothing to
      // decompose and the breakdown does not claim to cover it.
      if (state.winner !== null) continue
      for (const me of ['player', 'opponent'] as const) {
        const asRole = role(state, me)
        const terms = publicBreakdown(state, me, DEFAULT_WEIGHTS, asRole)
        const summed = Object.values(terms).reduce((n, t) => n + t.weight * t.quantity, 0)
        expect(summed).toBe(score(state, me, asRole))
      }
    }
  })

  /**
   * `saturation` is a knee that splits the pool into `full` and `surplus`, and `roleShift` bends
   * `base`, `unit` and `initiative`. Neither is a coefficient, so neither has a quantity whose
   * variance could be taken. They are measurable only by perturbation, which is why the report has a
   * Pivotal column at all rather than just a variance one.
   */
  it('covers every linear coefficient, and only those', () => {
    const state = corpus(1)[0]
    const terms = publicBreakdown(state, 'player', DEFAULT_WEIGHTS, 'neutral')
    expect(Object.keys(terms).sort()).toEqual([
      'base', 'card', 'claimCost', 'hp', 'initiative', 'lethalExposure',
      'power', 'readyUnit', 'resource', 'resourceSurplus', 'unit',
    ])
    expect(Object.keys(terms)).not.toContain('saturation')
    expect(Object.keys(terms)).not.toContain('roleShift')
  })

  /** The role bends weights, and the breakdown must report the bent ones or the sum would not hold. */
  it('reports the role-adjusted weight, not the shipped one', () => {
    const state = corpus(1)[0]
    const asAggressor = publicBreakdown(state, 'player', DEFAULT_WEIGHTS, 'aggressor')
    const asDefender = publicBreakdown(state, 'player', DEFAULT_WEIGHTS, 'defender')
    expect(asAggressor.base.weight).toBe(DEFAULT_WEIGHTS.base + DEFAULT_WEIGHTS.roleShift)
    expect(asDefender.base.weight).toBe(DEFAULT_WEIGHTS.base - DEFAULT_WEIGHTS.roleShift)
    // Same board, so the quantities are untouched: only the price changed.
    expect(asAggressor.base.quantity).toBe(asDefender.base.quantity)
  })
})

describe('the perturbation step', () => {
  /**
   * "Never pivotal" is meaningless without knowing how hard we pushed. A flat step of 1 would have
   * nudged `lethalExposure` by 4% of its value and called it inert, so the step is a quarter of the
   * shipped weight, floored at the resolution the score can actually see.
   */
  it('scales with the weight, so a big weight gets a real nudge', () => {
    expect(stepFor('lethalExposure')).toBe(6) // 24 / 4
    expect(stepFor('saturation')).toBe(2) // 7 / 4, rounded
    expect(stepFor('base')).toBe(1) // 4 / 4
  })

  /** `publicScore` is integer-valued, so a sub-integer nudge to an integer weight could never move
   *  anything. The fractional hand weights are the exception and must not be rounded to death. */
  it('keeps a minimum of 1 for integer weights and stays fractional for hand.hold', () => {
    expect(stepFor('readyUnit')).toBe(1) // would round to 0
    expect(stepFor('hand.hold')).toBeCloseTo(DEFAULT_HAND_WEIGHTS.hold / 4)
    expect(stepFor('hand.hold')).toBeLessThan(1)
  })

  /** One list, shared with the tuner rather than copied, so a new weight is both sweepable and
   *  measurable the day it exists. The tuner learned this the hard way: a hardcoded list meant an
   *  overnight sweep rejected every job and measured nothing. */
  it('covers every weight the model ships', () => {
    for (const key of Object.keys(DEFAULT_WEIGHTS)) {
      if (key === 'hand') continue
      expect(SCALAR_KEYS, key).toContain(key)
    }
    for (const key of Object.keys(DEFAULT_HAND_WEIGHTS)) {
      expect(SCALAR_KEYS, key).toContain(`hand.${key}`)
    }
  })
})

describe('runTerms', () => {
  // Two decks keeps this quick: each decision is re-scored once per weight per direction.
  const report = runTerms({ gamesPerDeck: 1, seed: 4242, decks: 2 })

  it('observes real decisions and reports one row per weight', () => {
    expect(report.games).toBeGreaterThan(0)
    expect(report.decisions).toBeGreaterThan(50)
    expect(report.stats.map(s => s.weight).sort()).toEqual([...SCALAR_KEYS].sort())
  })

  it('reports the step it used alongside every result', () => {
    for (const s of report.stats) expect(s.step, s.weight).toBe(stepFor(s.weight))
  })

  it('cannot report more affected decisions than it saw', () => {
    for (const s of report.stats) {
      expect(s.varies, s.weight).toBeLessThanOrEqual(report.decisions)
      expect(s.pivotal, s.weight).toBeLessThanOrEqual(report.decisions)
      expect(s.loadBearing, s.weight).toBeLessThanOrEqual(report.decisions)
    }
  })

  /**
   * **Why there are three columns rather than two.** `hand.hold` has the widest-varying quantity in
   * the model and is never pivotal, because the hand term is squashed into `[0, 1)` as a tie-break
   * and rescaling it is close to a monotone transform of its own ordering. On the pivotal column
   * alone it looks deletable, and deleting it would remove the fix for the regroup blind spot where
   * 100% of resource picks were coin flips. Switching it off shows the truth.
   */
  it('finds hand.hold load-bearing even though nudging it never changes a decision', () => {
    const hold = report.stats.find(s => s.weight === 'hand.hold')!
    expect(hold.varies, 'the quantity moves constantly').toBeGreaterThan(report.decisions / 4)
    expect(hold.pivotal, 'but rescaling it preserves the ordering it imposes').toBe(0)
    expect(hold.loadBearing, 'while removing it changes real decisions').toBeGreaterThan(0)
  })

  /** The converse guard: a weight that is genuinely absent must be flat in every column, or the
   *  ablation is picking up noise from somewhere other than the weight. */
  it('finds saturation inert under ablation too, not just under a nudge', () => {
    const saturation = report.stats.find(s => s.weight === 'saturation')!
    expect(saturation.pivotal).toBe(0)
    expect(saturation.loadBearing).toBe(0)
  })

  /**
   * Agreement with what is already known, from the ticket. `saturation` is algebraically absent while
   * `resourceSurplus === resource`: `resourceValue` collapses to `resource * pool` and the knee
   * cancels. A report that found it pivotal would be measuring something other than the shipped
   * evaluation.
   */
  it('finds saturation inert, because the flat pool makes it algebraically absent', () => {
    expect(DEFAULT_WEIGHTS.resourceSurplus, 'precondition: the pool ships flat').toBe(DEFAULT_WEIGHTS.resource)
    const saturation = report.stats.find(s => s.weight === 'saturation')!
    expect(saturation.pivotal).toBe(0)
  })

  /**
   * Matches the sweep that tried 0, 3 and 6 and changed no decision at all, and explains WHY: the
   * flag is a property of the whole hand, so every candidate reads the same value. This one is
   * measured rather than assumed, since `hand.canAct` does price a quantity.
   */
  it('finds hand.canAct inert, and can show that its quantity is what is flat', () => {
    const canAct = report.stats.find(s => s.weight === 'hand.canAct')!
    expect(canAct.hasQuantity).toBe(true)
    expect(canAct.pivotal).toBe(0)
    // Not literally never varying: the flag moves in the few decisions where a candidate spends the
    // last castable card, which is exactly the exception the mechanism predicts. Asserted against a
    // live term rather than a fixed rate, so the claim survives a different sample size.
    const power = report.stats.find(s => s.weight === 'power')!
    expect(canAct.varies).toBeLessThan(power.varies / 5)
  })

  /** The other direction: a report that called the dominant board terms flat would be broken. They
   *  are not asserted at a fixed rate, because that is a property of the deck pool rather than of the
   *  instrument; what must hold is that they are live and the known-inert ones are not. */
  it('finds the board terms varying, unlike the inert ones', () => {
    for (const key of ['base', 'unit', 'power', 'hp'] as const) {
      const stat = report.stats.find(s => s.weight === key)!
      expect(stat.varies / report.decisions, key).toBeGreaterThan(0.3)
      expect(stat.pivotal, key).toBeGreaterThan(0)
    }
  })

  /**
   * `saturation` and `roleShift` price no quantity, so a bare 0 in the varies column would read as a
   * finding when nothing was measured. That is not hypothetical: `roleShift` reported 0% varying
   * while being pivotal in 8% of decisions, which is the opposite of the truth.
   */
  it('marks the weights that price no quantity, rather than reporting them as flat', () => {
    for (const key of ['saturation', 'roleShift'] as const) {
      expect(report.stats.find(s => s.weight === key)!.hasQuantity, key).toBe(false)
    }
    for (const key of ['base', 'unit', 'hand.canAct', 'hand.hold'] as const) {
      expect(report.stats.find(s => s.weight === key)!.hasQuantity, key).toBe(true)
    }
  })

  /** Role awareness demonstrably changes decisions, so a diagnostic that could not see it would be
   *  missing the one weight with no quantity but real influence. */
  it('still finds roleShift pivotal, despite it pricing nothing', () => {
    expect(report.stats.find(s => s.weight === 'roleShift')!.pivotal).toBeGreaterThan(0)
  })

  /** Spread explains magnitude: a term that varies by 1 point is not the same finding as one that
   *  varies by 40, and only the second is worth tuning. */
  it('reports the spread of a term that varies, and none for one that does not', () => {
    const unit = report.stats.find(s => s.weight === 'unit')!
    expect(unit.spread).toBeGreaterThan(0)
    const saturation = report.stats.find(s => s.weight === 'saturation')!
    expect(saturation.spread).toBe(0)
  })

  /** "Inert at regroup but live during attacks" is the point of the breakout, so the parts have to
   *  account for the whole rather than being a different slice of the run. */
  it('breaks down by decision context, summing to the total', () => {
    for (const s of report.stats) {
      expect(s.byKind.map(k => k.kind), s.weight).toEqual(['action phase', 'regroup', 'answering a choice'])
      const seen = s.byKind.reduce((n, k) => n + k.decisions, 0)
      expect(seen, s.weight).toBe(report.decisions)
      expect(s.byKind.reduce((n, k) => n + k.varies, 0), s.weight).toBe(s.varies)
      expect(s.byKind.reduce((n, k) => n + k.pivotal, 0), s.weight).toBe(s.pivotal)
      expect(s.byKind.reduce((n, k) => n + k.loadBearing, 0), s.weight).toBe(s.loadBearing)
    }
  })

  it('is deterministic for a given seed', () => {
    const again = runTerms({ gamesPerDeck: 1, seed: 4242, decks: 2 })
    expect(again.stats).toEqual(report.stats)
  }, 240_000)
})
