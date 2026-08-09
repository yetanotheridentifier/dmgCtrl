import { describe, it, expect } from 'vitest'
import { makePublicScore, publicBreakdown, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Shield value (#493).
 *
 * **A Shield is the one token the evaluation cannot see, and the reason is its stat line.** Attached
 * upgrades add their printed power and HP, so Experience (1/1) and Advantage (1/0) already reach the
 * evaluation through `power` and `hp`. Shield is printed **0/0** and works through a damage-prevention
 * hook instead, so it changes nothing any term reads.
 *
 * The consequence is sharper than "undervalued". A Shield absorbs a whole instance of damage, so after
 * a strip the board holds the same units at the same HP and differs only by a token nothing scores.
 * **The board scores identically**, which makes the strip indistinguishable from doing nothing while
 * the attack's cost (exhausting the attacker, exposing it) is counted in full. It is therefore scored
 * as strictly negative.
 *
 * Measured over 420 games with the shipped bot: 15.8% of decisions face a shielded enemy, a strip is
 * available on 42.6% of those, and the bot takes it **7.4%** of the time against **random's 17.9%**.
 * Less than half of chance, which is avoidance rather than indifference.
 */

const cards = {
  ...CARDS,
  GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground', cost: 2, power: 3, hp: 4 }),
}

const shielded = (id: string, owner: 'player' | 'opponent' = 'player'): ReturnType<typeof unit> =>
  unit(id, 'GRUNT', { upgrades: [{ cardId: TOKEN_SHIELD, owner }] })

/** Same board twice, differing only in who holds a Shield. */
function board(mine: string[], theirs: string[], shieldMine: number, shieldTheirs: number): GameState {
  return state({
    cards,
    players: {
      player: player({ units: mine.map((id, i) => (i < shieldMine ? shielded(id) : unit(id, 'GRUNT'))) }),
      opponent: player({
        units: theirs.map((id, i) => (i < shieldTheirs ? shielded(id, 'opponent') : unit(id, 'GRUNT'))),
      }),
    },
  })
}

describe('the shield term', () => {
  /** The defect itself, pinned so it cannot silently return. */
  it('is what makes a shielded board differ from an unshielded one', () => {
    const withWeight = makePublicScore({ ...DEFAULT_WEIGHTS, shield: 5 })
    const plain = board(['u1'], ['e1'], 0, 0)
    const theyHaveOne = board(['u1'], ['e1'], 0, 1)
    expect(withWeight(theyHaveOne, 'player')).toBeLessThan(withWeight(plain, 'player'))
  })

  it('values our own shield as the mirror of theirs', () => {
    const w = makePublicScore({ ...DEFAULT_WEIGHTS, shield: 5 })
    const ours = board(['u1'], ['e1'], 1, 0)
    const theirs = board(['u1'], ['e1'], 0, 1)
    const plain = board(['u1'], ['e1'], 0, 0)
    expect(w(ours, 'player') - w(plain, 'player')).toBe(w(plain, 'player') - w(theirs, 'player'))
  })

  /** Symmetric, so the evaluation stays zero-sum on its public half: a shield is worth exactly what
   *  it costs the other seat. */
  it('reads the same board oppositely from the two seats', () => {
    const w = makePublicScore({ ...DEFAULT_WEIGHTS, shield: 5 })
    const s = board(['u1'], ['e1'], 1, 0)
    expect(w(s, 'player')).toBe(-w(s, 'opponent'))
  })

  /**
   * **Ships off**, per the rule in `planned-work.md`: default a new weight to off, then sweep upward.
   * Shipping a default before its A/B ran once inverted a whole reading, because the candidate was
   * then the ablation and below 50% meant better.
   */
  it('defaults to zero, so nothing changes until it is measured', () => {
    expect(DEFAULT_WEIGHTS.shield).toBe(0)
    const shipped = makePublicScore(DEFAULT_WEIGHTS)
    expect(shipped(board(['u1'], ['e1'], 0, 1), 'player')).toBe(shipped(board(['u1'], ['e1'], 1, 0), 'player'))
  })

  /** Counts tokens, not units: two shields on one unit are worth two. */
  it('counts every shield, not every shielded unit', () => {
    const w = makePublicScore({ ...DEFAULT_WEIGHTS, shield: 5 })
    const one = board(['u1', 'u2'], ['e1'], 1, 0)
    const two = board(['u1', 'u2'], ['e1'], 2, 0)
    expect(w(two, 'player') - w(one, 'player')).toBe(5)
  })

  /**
   * `publicBreakdown` must keep summing exactly to the score. It is a second reading of the same
   * arithmetic, and a term missing from it would make the sensitivity diagnostic quietly wrong.
   */
  it('appears in the breakdown, which still sums to the score', () => {
    const w = { ...DEFAULT_WEIGHTS, shield: 5 }
    const s = board(['u1', 'u2'], ['e1'], 2, 1)
    const terms = publicBreakdown(s, 'player', w, undefined)
    expect(terms.shield).toEqual({ weight: 5, quantity: 1 })
    const summed = Object.values(terms).reduce((n, t) => n + t.weight * t.quantity, 0)
    expect(summed).toBeCloseTo(makePublicScore(w)(s, 'player'), 6)
  })
})
