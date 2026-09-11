import { describe, it, expect } from 'vitest'
import { makePublicScore, publicBreakdown, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * How the evaluation prices a unit that cannot act.
 *
 * A unit enters play **exhausted** when played (CR 1.7.2b), a leader enters play **ready** when
 * deployed (CR 3.3.4), and a unit can only attack while ready. Everything readies during the regroup
 * phase, so exhaustion is temporary and its cost is bounded by how much of the round is left.
 *
 * **The shipped search never crosses the round boundary** (`maxCrossings` defaults to 0), so within
 * everything it can see, an exhausted unit's power can never be used. The search cannot correct for
 * that, because the readying happens past a horizon it never reaches.
 *
 * Readiness is nonetheless not unpriced: `readyUnit` is a **flat** per-ready-unit term. What this
 * file pins is the shape of that pricing, because the shape is the open question. A flat term says a
 * ready 2-power unit and a ready 9-power unit are worth the same premium over their exhausted
 * selves, which is the claim worth checking rather than assuming.
 *
 * These are **characterisation** tests. They assert what the evaluation does today, so that any
 * change to the shape fails here and has to be deliberate.
 */

const cards = {
  ...CARDS,
  SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 1, power: 2, hp: 4 }),
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 6, power: 9, hp: 4 }),
}

/** One unit of ours, ready or exhausted. Same body either way, so only the state differs. */
const board = (cardId: string, exhausted: boolean): GameState => state({
  cards,
  players: {
    player: player({ units: [unit('u', cardId, { arena: 'ground', exhausted })] }),
    opponent: player(),
  },
})

/** `roleShift: 0` so the role weights cannot move the comparison underneath the readiness one. */
const score = (s: GameState): number =>
  makePublicScore({ ...DEFAULT_WEIGHTS, roleShift: 0 })(s, 'player', 'neutral')

/** What readiness is worth on a body of this size: the same board, ready minus exhausted. */
const readyPremium = (cardId: string): number => score(board(cardId, false)) - score(board(cardId, true))

describe('the value of being ready', () => {
  it('is worth something, or the distinction is not priced at all', () => {
    expect(readyPremium('SMALL')).toBeGreaterThan(0)
  })

  /**
   * **The property candidate #584 would change.** Power is charged per point regardless of whether
   * the unit can act, so the whole premium comes from the flat `readyUnit` term and a 9-power body
   * holding a threat is worth exactly as much more, for being ready, as a 2-power one.
   *
   * If a `powerReady` rate is ever introduced, this is the test that should fail: the premium would
   * then scale with the power being held.
   */
  it('does not scale with the power the unit is holding', () => {
    expect(readyPremium('BIG')).toBe(readyPremium('SMALL'))
    expect(readyPremium('SMALL')).toBe(DEFAULT_WEIGHTS.readyUnit)
  })

  /**
   * The consequence, stated as a board comparison rather than a weight identity: an exhausted 9-power
   * unit outscores a ready 2-power one, because nine points of unusable power beat two usable ones
   * plus the flat readiness bonus.
   *
   * That is not obviously wrong, since the exhausted body still blocks, still has HP, and readies next
   * regroup. It is recorded because it is the trade the candidate is really about.
   */
  it('leaves a large exhausted body ahead of a small ready one', () => {
    expect(score(board('BIG', true))).toBeGreaterThan(score(board('SMALL', false)))
  })
})

/**
 * `powerReady`: charging power on a unit that can act at a different rate from power on one that
 * cannot.
 *
 * **Ships equal to `power`, not at zero.** The project convention is that a new weight ships at zero
 * and is swept upward, and that is wrong here for the same reason it was wrong for `advantage`: zero
 * would assert that a ready unit's power is worthless, which is an enormous change rather than a
 * neutral one. Equal to `power` reproduces today's behaviour exactly and the sweep runs upward.
 *
 * Written as a **correction on top of the existing power sum**, following `advantageCorrection`, so
 * it is provably a no-op at the shipped weights rather than screened for one. A win rate cannot
 * confirm a no-op; arithmetic can.
 */
const scoreWith = (overrides: Partial<typeof DEFAULT_WEIGHTS>, s: GameState): number =>
  makePublicScore({ ...DEFAULT_WEIGHTS, roleShift: 0, ...overrides })(s, 'player', 'neutral')

const premiumWith = (overrides: Partial<typeof DEFAULT_WEIGHTS>, cardId: string): number =>
  scoreWith(overrides, board(cardId, false)) - scoreWith(overrides, board(cardId, true))

describe('the powerReady weight', () => {
  it('defaults to the power weight, which is a no-op', () => {
    expect(DEFAULT_WEIGHTS.powerReady).toBe(DEFAULT_WEIGHTS.power)
  })

  /** The no-op asserted directly: at the shipped rate the correction is zero on every board. */
  it('contributes exactly nothing at the shipped weights', () => {
    for (const cardId of ['SMALL', 'BIG']) {
      for (const exhausted of [false, true]) {
        const s = board(cardId, exhausted)
        expect(scoreWith({ powerReady: DEFAULT_WEIGHTS.power }, s)).toBe(scoreWith({}, s))
      }
    }
  })

  /**
   * The property the whole candidate exists for: once the rate diverges, the premium for being ready
   * scales with the power the unit is holding, instead of being a flat per-body bonus.
   *
   * At one point above `power`, a 9-power body earns 9 extra and a 2-power body earns 2, so the gap
   * between them is exactly 7.
   */
  it('makes the ready premium scale with the power held', () => {
    const up = { powerReady: DEFAULT_WEIGHTS.power + 1 }
    expect(premiumWith(up, 'BIG') - premiumWith(up, 'SMALL')).toBe(9 - 2)
    expect(premiumWith(up, 'BIG')).toBe(DEFAULT_WEIGHTS.readyUnit + 9)
  })

  /** It must not touch a unit that cannot act, or the two rates are not separable at all. */
  it('leaves an exhausted body untouched', () => {
    const tired = board('BIG', true)
    expect(scoreWith({ powerReady: DEFAULT_WEIGHTS.power + 5 }, tired)).toBe(scoreWith({}, tired))
  })

  /** Raising it can only help a ready body, never hurt it. */
  it('is monotone in the rate for a ready body', () => {
    const ready = board('BIG', false)
    expect(scoreWith({ powerReady: DEFAULT_WEIGHTS.power + 1 }, ready))
      .toBeGreaterThan(scoreWith({}, ready))
  })

  /** Visible to the diagnostics, or `--terms` cannot size it and the sweep has nothing to read. */
  it('appears in the breakdown, which still sums to the score', () => {
    const w = { ...DEFAULT_WEIGHTS, roleShift: 0, powerReady: DEFAULT_WEIGHTS.power + 2 }
    const s = board('BIG', false)
    const terms = publicBreakdown(s, 'player', w, 'neutral')
    expect(terms).toHaveProperty('powerReady')
    const summed = Object.values(terms).reduce((n, t) => n + t.weight * t.quantity, 0)
    expect(summed).toBeCloseTo(makePublicScore(w)(s, 'player', 'neutral'), 6)
  })
})
