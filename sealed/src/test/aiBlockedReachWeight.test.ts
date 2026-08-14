import { describe, it, expect } from 'vitest'
import { makeBeamAi, lastSearchTrace, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { makeEvaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Which weights actually escape the lockout (#499).
 *
 * Gating the term to shielded blockers took the weight-12 A/B from 25.0% to 48.8%, level with a
 * matched control. But **12 is still off the scale**: every other weight in the model is 1 to 7, so 12
 * is triple the value of a whole unit, and with `blockedReachCap: 10` the term reaches 120 points on a
 * board where a unit is worth 4. A term that only works at a weight like that is fragile whatever a
 * screen says, because it wins its arguments by shouting.
 *
 * So: does any **in-scale** weight still do the job? This is the cheapest remaining question about the
 * whole approach, and it decides between a shippable candidate and a dead end, before three hours of
 * bench time rather than after.
 *
 * Escaping needs two things, and both are checked per weight. The term must make the position a
 * **tie** (passing wins outright at weight 0, 52 to 43), and the second opinion must then resolve that
 * tie toward acting. A weight that creates the tie but loses the tie-break is not an escape.
 */

const cards = {
  ...CARDS,
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 5, keywords: [{ name: 'Sentinel' }] }),
  CHUMP: card({ id: 'CHUMP', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 5, power: 5, hp: 6 }),
}

/** The reported defect: a shielded Sentinel shuts the lane and the bot sits behind it. */
const lockout = (): GameState => state({
  cards,
  players: {
    player: player({ units: [unit('chump', 'CHUMP'), unit('big', 'BIG')] }),
    opponent: player({
      base: { cardId: 'TST_B', damage: 12 },
      units: [unit('wall', 'WALL', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })],
    }),
  },
})

const shipped = { ...DEFAULT_BEAM_LIMITS, reply: 'pessimistic' as const, nodes: 200_000 }

/** Does this weight escape the lockout, and did it need a tie-break to do it? */
function attempt(blockedReach: number): { tied: number; escapes: boolean } {
  const weights = makeEvaluate({ ...DEFAULT_WEIGHTS, blockedReach })
  const ai = makeBeamAi(weights, { ...shipped, tieBreak: { reply: 'null' } })
  const move = ai(lockout())
  return {
    tied: lastSearchTrace()!.tiedCandidates,
    escapes: move?.type === 'attack' && move.attackerId === 'chump',
  }
}

describe('the weight needed to escape the lockout', () => {
  /**
   * The scale the weight has to live on, asserted rather than remembered.
   *
   * **Expressed relative to a unit, not as an absolute.** Every price was doubled as a pure
   * reparameterisation, so the raw numbers this file used to assert (and the "12 is triple a unit"
   * finding behind it) are in the old units. Stated as a multiple of `unit` it survives any future
   * rescaling, which is the point: what made 12 wrong was never the digit, it was being three times a
   * whole body on a board where a body is the biggest thing you can win or lose.
   *
   * `saturation` is excluded because it is not a price at all: it is a pool size, measured in
   * resources rather than score points, and it did not scale with the rest.
   */
  it('is judged against a model where no price exceeds a unit', () => {
    const prices = [
      DEFAULT_WEIGHTS.base, DEFAULT_WEIGHTS.unit, DEFAULT_WEIGHTS.power, DEFAULT_WEIGHTS.hp,
      DEFAULT_WEIGHTS.card, DEFAULT_WEIGHTS.resource,
    ]
    expect(Math.max(...prices)).toBeLessThanOrEqual(DEFAULT_WEIGHTS.unit)
  })

  /** Off, the bot passes. That is the defect, and the baseline every weight below is measured against. */
  it('does not escape at weight zero', () => {
    expect(attempt(0).escapes).toBe(false)
  })

  /**
   * **Weight 1 is enough, and 12 was never required.** Swept 1 to 16: every one of them escapes, and
   * all produce the identical two-way tie. 12 was simply the first value tried, and it was then
   * written up as "the weight that solves the lockout" without a sweep behind it.
   */
  it('escapes at any weight from 1 upward, including in-scale ones', () => {
    for (const w of [1, 2, 3, 4, 6, 12, 16]) {
      const { tied, escapes } = attempt(w)
      expect(tied, `weight ${w} must make it a tie`).toBe(2)
      expect(escapes, `weight ${w} must escape`).toBe(true)
    }
  })

  /**
   * **Why more weight buys nothing: the term removes an option rather than outweighing one.**
   *
   * At weight 0 the passing line's best reachable board scores 52 against the acting line's 43. Price
   * a blocked lane at all and that 52 board stops being the passing line's best, so the beam's max
   * over reachable boards falls back to a 43 board that line could already reach. The two are then
   * exactly level, and every larger weight lands on the same pair of numbers.
   *
   * This is the whole case for a small weight. The term does not have to be big enough to beat
   * anything, so it need not be big at all, and a weight of 1 sits at the bottom of the model's scale
   * instead of triple a whole unit.
   *
   * The scores below are **104 and 86 where the write-ups say 52 and 43**, because every price was
   * later doubled as a pure reparameterisation. Same boards, same ordering, same conclusion, twice the
   * units. Halve them to read them against the recorded numbers.
   */
  it('saturates immediately, so the values are identical at 1 and at 12', () => {
    const top = (blockedReach: number): number[] => {
      makeBeamAi(makeEvaluate({ ...DEFAULT_WEIGHTS, blockedReach }), shipped)(lockout())
      return [...lastSearchTrace()!.candidates].sort((a, b) => b - a).slice(0, 2)
    }
    expect(top(0), 'passing wins outright before the term is priced').toEqual([104, 86])
    expect(top(1), 'and is level with acting once it is').toEqual([86, 86])
    expect(top(12), 'twelve times the weight lands in exactly the same place').toEqual(top(1))
  })

  /**
   * **The term alone is not the fix at any weight.** It only creates the tie; the seeded pick then
   * still lands on passing. Both halves are needed, which is why neither measured as a fix alone.
   */
  it('needs the second opinion to convert the tie, at every weight', () => {
    for (const w of [1, 12]) {
      const ai = makeBeamAi(makeEvaluate({ ...DEFAULT_WEIGHTS, blockedReach: w }), shipped)
      const move = ai(lockout())
      expect(lastSearchTrace()!.tiedCandidates, `weight ${w} ties`).toBe(2)
      expect(move?.type, `weight ${w} still passes without a tie-break`).not.toBe('attack')
    }
  })
})
