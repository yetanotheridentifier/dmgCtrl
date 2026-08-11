import { describe, it, expect } from 'vitest'
import { makePublicScore, publicBreakdown, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Pricing Advantage as the one-off it is (#497).
 *
 * Advantage is not invisible: it is a 1/0 token, so it already feeds `power`. What the model gets
 * wrong is that **printed power is a recurring stream and a token is a single payment**. A unit with
 * 3 power delivers 3 damage every time it attacks; a token on it delivers 1 damage once, and then it
 * is gone. Pricing both at `w.power` over-values the token by roughly the number of attacks the unit
 * still has in it.
 *
 * Measured over 3,982 decisions: a token is in play on **20.7%** of them, 76% are eventually spent
 * (80% of those attacking), and **23.5% die with their unit having delivered nothing**.
 *
 * ## Why the default is `power` and not zero
 *
 * The project convention is that a new weight ships at zero and is swept upward. That is wrong here:
 * zero would assert a token is worthless, which is a large change, not a neutral one. `advantage`
 * ships **equal to `power`**, which reproduces today's behaviour exactly, and the sweep runs
 * downward from there.
 */

const cards = {
  ...CARDS,
  BODY: card({ id: 'BODY', type: 'unit', arena: 'ground', cost: 2, power: 3, hp: 4 }),
  BIGGER: card({ id: 'BIGGER', type: 'unit', arena: 'ground', cost: 2, power: 5, hp: 4 }),
}

const adv = (n: number) =>
  Array.from({ length: n }, () => ({ cardId: TOKEN_ADVANTAGE, owner: 'player' as const }))

/** One of our units, optionally carrying `n` Advantage tokens. */
const board = (cardId: string, n = 0): GameState => state({
  cards,
  players: {
    player: player({ units: [unit('u', cardId, { arena: 'ground', upgrades: adv(n) })] }),
    opponent: player(),
  },
})

const scoreAt = (advantage: number, s: GameState): number =>
  makePublicScore({ ...DEFAULT_WEIGHTS, advantage, roleShift: 0 })(s, 'player', 'neutral')

describe('the Advantage weight', () => {
  /** Ships reproducing today's behaviour exactly, so nothing moves until it is swept. */
  it('defaults to the power weight, which is a no-op', () => {
    expect(DEFAULT_WEIGHTS.advantage).toBe(DEFAULT_WEIGHTS.power)
  })

  /**
   * **The no-op asserted rather than screened.**
   *
   * `beam-reply+advantage=2` measured 46.3% over 80 games against plain `beam-reply`, which looks
   * alarming for a configuration that should be identical. It is not evidence of anything: identical
   * bots land anywhere in 46-50% at that sample size (a `beam-reply` self-play control read 50.0% on
   * one seed set and 48.8% on another). A win rate cannot confirm a no-op.
   *
   * This can. The correction is `(w.advantage - w.power) * tokens`, so at the default it contributes
   * exactly zero on every board, carriers included, and that is checkable directly.
   */
  it('contributes exactly nothing at the shipped weights', () => {
    const w = { ...DEFAULT_WEIGHTS, roleShift: 0 }
    const plain = makePublicScore(w)
    for (const n of [0, 1, 3, 5]) {
      const s = board('BODY', n)
      const terms = publicBreakdown(s, 'player', w, 'neutral')
      expect(terms.advantage.weight, 'the correction is zero-rated when the weights agree').toBe(0)
      // And the score matches one computed with the tokens priced purely through `power`.
      expect(plain(s, 'player', 'neutral'))
        .toBe(makePublicScore({ ...w, advantage: w.power })(s, 'player', 'neutral'))
    }
  })

  /**
   * **The whole point.** Two tokens must be worth less than two points of printed power once the
   * weight is discounted, and exactly the same when it is not.
   */
  it('prices a token below printed power once discounted', () => {
    const carrier = board('BODY', 2)
    const printed = board('BIGGER')       // 5 power, no tokens
    const withTokens = board('BODY', 2)   // 3 power + 2 tokens = 5 effective

    expect(scoreAt(DEFAULT_WEIGHTS.power, withTokens), 'undiscounted, the two are interchangeable')
      .toBe(scoreAt(DEFAULT_WEIGHTS.power, printed))
    expect(scoreAt(1, carrier), 'discounted, the tokens are worth less')
      .toBeLessThan(scoreAt(DEFAULT_WEIGHTS.power, carrier))
  })

  /** Printed power must not move when the token weight does, or the discount is repricing the board. */
  it('leaves a unit carrying no tokens untouched', () => {
    const plain = board('BIGGER')
    expect(scoreAt(0, plain)).toBe(scoreAt(DEFAULT_WEIGHTS.power, plain))
  })

  /** At zero a token contributes nothing, which is the far end of the sweep. */
  it('can price a token at nothing', () => {
    const carrier = board('BODY', 3)
    const bare = board('BODY')
    expect(scoreAt(0, carrier)).toBe(scoreAt(0, bare))
  })

  /**
   * The breakdown identity is load-bearing for `--terms`: if it stops summing to the score, the
   * sensitivity diagnostic reports on an evaluation the bot does not use.
   */
  it('appears in the breakdown, which still sums to the score', () => {
    for (const advantage of [0, 1, DEFAULT_WEIGHTS.power]) {
      const w = { ...DEFAULT_WEIGHTS, advantage, roleShift: 0 }
      const s = board('BODY', 2)
      const terms = publicBreakdown(s, 'player', w, 'neutral')
      const summed = Object.values(terms).reduce((n, t) => n + t.weight * t.quantity, 0)
      expect(summed).toBeCloseTo(makePublicScore(w)(s, 'player', 'neutral'), 6)
    }
  })

  /** Counted per token, so a stack of five is priced as five one-offs rather than a flat bonus. */
  it('scales with the size of the stack', () => {
    const one = scoreAt(0, board('BODY', 1))
    const five = scoreAt(0, board('BODY', 5))
    expect(one).toBe(five) // at zero, both contribute nothing
    const d1 = scoreAt(DEFAULT_WEIGHTS.power, board('BODY', 1)) - scoreAt(0, board('BODY', 1))
    const d5 = scoreAt(DEFAULT_WEIGHTS.power, board('BODY', 5)) - scoreAt(0, board('BODY', 5))
    expect(d5).toBeCloseTo(d1 * 5, 6)
  })
})
