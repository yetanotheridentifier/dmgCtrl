import { describe, it, expect } from 'vitest'
import { makePublicScore, initiativeValue, makeEvaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import type { GameState, PlayerId } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Conditional value for the initiative, when acting first next round is the difference (#446).
 *
 * ## Why a conditional term rather than a bigger weight
 *
 * Claiming the initiative makes you act first in the round **after** this one, and the search stops
 * dead at the round boundary, so its whole value is out of sight. That is why "take it" is the largest
 * tie in the model: **15.3%** of 2,164 offers over 44 games, roughly 7.5 coin flips a game.
 *
 * Raising the flat `initiative` weight is a measured dead end: 4 gives 46.8%, 6 gives 35.4%, 8 gives
 * 29.4%, monotonically worse, because the bot buys turn order by giving up whole turns. `claimCost: 0`
 * (always claim) measured 41.1%.
 *
 * The horizon term is the targeted version of the same idea. It pays only where acting first plausibly
 * decides the game, which is where the opponent's steady reach covers our remaining base, and is
 * **zero on 87% of offers**. Measured over the same run:
 *
 * | | of 2,164 claim offers |
 * | --- | --- |
 * | they finish next round, we do not (denial) | 10.4% |
 * | both finish next round (conversion) | 2.6% |
 * | union, the predicate below | 13.0% |
 *
 * ## And why the bot is believed to be blind to it
 *
 * The claim rate is flat across all four horizon buckets: 21.1% conversion, 15.1% denial, 9.5%
 * we-finish-only, 12.3% quiet control. A chi-square across them is ~5.9 on 3 df against a 7.8 critical
 * value, so the bot does not discriminate at all. That is the precondition for a rule to change
 * anything; it is **not** evidence that discriminating wins games, which only an A/B can say.
 *
 * Ships at zero, so the default configuration is unchanged and the term is swept from a no-op.
 */

const cards = {
  ...CARDS,
  HITTER: card({ id: 'HITTER', type: 'unit', arena: 'ground', cost: 2, power: 6, hp: 4 }),
}

/** `mine` and `theirs` are unit powers; the damage figures set how close each base is to dying. */
function board(
  mine: number[],
  theirs: number[],
  myDamage: number,
  theirDamage: number,
  initiative: PlayerId = 'player',
): GameState {
  return state({
    cards,
    initiative,
    players: {
      player: player({
        base: { cardId: 'TST_B', damage: myDamage },
        units: mine.map((_, i) => unit(`m${i}`, 'HITTER', { arena: 'ground' })),
      }),
      opponent: player({
        base: { cardId: 'TST_B', damage: theirDamage },
        units: theirs.map((_, i) => unit(`t${i}`, 'HITTER', { arena: 'ground' })),
      }),
    },
  })
}

const priced = (n: number) => ({ ...DEFAULT_WEIGHTS, initiativeHorizon: n })

/** Both horizon cases from both seats, plus a quiet board where the term must stay out of the way. */
const positions: GameState[] = [
  board([], [6, 6], 20, 0, 'player'),
  board([], [6, 6], 20, 0, 'opponent'),
  board([6, 6], [6, 6], 20, 20, 'player'),
  board([6, 6], [], 0, 20, 'opponent'),
  board([6], [6], 0, 0, 'player'),
]

describe('the initiative horizon term', () => {
  /** A new weight ships at zero, so the deployed bot is byte-identical until the sweep says otherwise. */
  it('is off by default', () => {
    expect(DEFAULT_WEIGHTS.initiativeHorizon).toBe(0)
  })

  it('changes nothing at zero, whatever the position', () => {
    // Two 6-power units against a base on 20 of 30: their 12 reach covers our 10 remaining.
    const threatened = board([], [6, 6], 20, 0)
    expect(initiativeValue(threatened, 'player', priced(0)))
      .toBe(initiativeValue(threatened, 'player', DEFAULT_WEIGHTS))
  })

  /**
   * **The denial case**: they finish next round and we do not, so holding the initiative is our one
   * chance to answer before it lands. This is the bucket the phase-0 run measured at 10.4%, four times
   * the conversion case the ticket is named after.
   */
  it('pays for holding the initiative when they are lethal next round', () => {
    const held = board([], [6, 6], 20, 0, 'player')
    expect(initiativeValue(held, 'player', priced(6)))
      .toBeGreaterThan(initiativeValue(held, 'player', priced(0)))
  })

  /** And it is a penalty when THEY hold it while we are the side threatening lethal: they answer first. */
  it('charges us when they hold it and we are the ones with the clock', () => {
    const theirs = board([6, 6], [], 0, 20, 'opponent')
    expect(initiativeValue(theirs, 'player', priced(6)))
      .toBeLessThan(initiativeValue(theirs, 'player', priced(0)))
  })

  /** Nobody within reach of a base next round: the term must stay silent rather than becoming a
   *  second flat initiative weight, which is the configuration measured monotonically harmful. */
  it('stays silent when neither side is lethal next round', () => {
    const quiet = board([6], [6], 0, 0)
    expect(initiativeValue(quiet, 'player', priced(6)))
      .toBe(initiativeValue(quiet, 'player', priced(0)))
  })

  /**
   * Already able to finish this round makes the whole question moot: we would simply win instead of
   * buying turn order. Excluded here for the same reason it was excluded from the measurement.
   */
  it('stays silent where we could just win this round', () => {
    // Our reach covers their base outright, and theirs covers ours: without the guard this would read
    // as the conversion case.
    const won = board([6, 6, 6, 6, 6], [6, 6], 20, 0)
    expect(initiativeValue(won, 'player', priced(6)))
      .toBe(initiativeValue(won, 'player', priced(0)))
  })

  /**
   * **The term must negate under a seat swap.** The search relies on it: a pessimistic reply minimises
   * our score by maximising theirs, and a term that does not invert makes those two different
   * objectives.
   *
   * The predicate is seat-relative on purpose (it asks whether the side **holding** the initiative is
   * the threatened one), which is what lets it negate cleanly. A naive version keyed on "the opponent
   * can finish me" would not, and would read as a bonus from both seats at once.
   */
  it('inverts exactly under a seat swap', () => {
    for (const s of positions) {
      expect(initiativeValue(s, 'player', priced(6)))
        .toBeCloseTo(-initiativeValue(s, 'opponent', priced(6)), 8)
    }
  })

  /**
   * And it must not widen the gap the public score already carries.
   *
   * `publicScore` is zero-sum only **while both seats read the same role**: role awareness (#395)
   * deliberately breaks it otherwise, since an aggressor and a defender are meant to price the same
   * board differently. On a lopsided board the two seats therefore disagree by a wide margin with this
   * term at zero, so a bare zero-sum assertion here would be testing #395, not #446.
   *
   * The property that belongs to this ticket is that the term changes **neither** side of that: the
   * residual is identical at 0 and at 6.
   */
  it('leaves the role-driven asymmetry exactly as it found it', () => {
    const off = makePublicScore(priced(0))
    const on = makePublicScore(priced(6))
    for (const s of positions) {
      expect(on(s, 'player') + on(s, 'opponent'))
        .toBeCloseTo(off(s, 'player') + off(s, 'opponent'), 8)
    }
  })

  /** With both seats reading the same role, the documented invariant holds with the term priced. */
  it('keeps the score zero-sum where the model promises to', () => {
    const evaluate = makeEvaluate(priced(6))
    for (const s of positions) {
      expect(evaluate(s, 'player', 'neutral')).toBeCloseTo(-evaluate(s, 'opponent', 'neutral'), 8)
    }
  })

  /** Scale sanity: this is a bonus on top of `initiative: 1`, so it must be readable against the rest
   *  of the model rather than swamping it. Every other weight in the model is 1 to 7, and a term at
   *  triple a unit's value is what made `blockedReach: 12` measure 25.0%. */
  it('is bounded by its weight, so it cannot dominate the board score', () => {
    const held = board([], [6, 6], 20, 0, 'player')
    const delta = initiativeValue(held, 'player', priced(6)) - initiativeValue(held, 'player', priced(0))
    expect(delta).toBeLessThanOrEqual(6)
    expect(delta).toBeGreaterThan(0)
  })
})
