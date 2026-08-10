import { describe, it, expect } from 'vitest'
import { makePublicScore, publicBreakdown, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Pricing the reach a blocker denies (#499).
 *
 * The quantity is measured by `blockedReach`; this is what it is worth. Two properties matter beyond
 * the arithmetic, and both come from how the game is actually played:
 *
 * **Race first, control second.** Spending actions grinding down a Sentinel while the other lane
 * could win the race is a losing habit. So the term is bent by role: heavy for the **defender**, who
 * cannot win the race and must remove the blocker, near zero for the **aggressor**, who should race.
 * `roleShift` already bends `base`, `unit` and `initiative` this way.
 *
 * **Bounded.** A canny opponent blocks a lane, holds a second Sentinel back, and drops it once the
 * tempo has been spent clearing the first. If removing a blocker is worth more than a couple of
 * actions, the bot walks straight into that.
 */

const cards = {
  ...CARDS,
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 5, keywords: [{ name: 'Sentinel' }] }),
  GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground', cost: 2, power: 4, hp: 4 }),
}

const blocked = (): GameState => state({
  cards,
  players: {
    player: player({ units: [unit('u1', 'GRUNT')] }),
    opponent: player({ units: [unit('w', 'WALL')] }),
  },
})

const clear = (): GameState => state({
  cards,
  players: {
    player: player({ units: [unit('u1', 'GRUNT')] }),
    opponent: player({ units: [unit('w2', 'GRUNT')] }),
  },
})

describe('the blocked-reach term', () => {
  /** Ships off, per the rule that a new weight is defaulted to zero and swept upward. */
  it('defaults to zero, so nothing changes until it is measured', () => {
    expect(DEFAULT_WEIGHTS.blockedReach).toBe(0)
  })

  it('costs us nothing when no lane is shut', () => {
    const w = makePublicScore({ ...DEFAULT_WEIGHTS, blockedReach: 2, roleShift: 0 })
    const terms = publicBreakdown(clear(), 'player', { ...DEFAULT_WEIGHTS, blockedReach: 2, roleShift: 0 }, 'neutral')
    expect(terms.blockedReach.quantity).toBe(0)
    expect(w(clear(), 'player')).toBe(makePublicScore({ ...DEFAULT_WEIGHTS, roleShift: 0 })(clear(), 'player'))
  })

  /** The point of the whole ticket: a shut lane must read as worse than an open one. */
  it('penalises a lane that is shut', () => {
    const weights = { ...DEFAULT_WEIGHTS, blockedReach: 2, roleShift: 0 }
    const off = makePublicScore({ ...weights, blockedReach: 0 })
    const on = makePublicScore(weights)
    expect(on(blocked(), 'player')).toBeLessThan(off(blocked(), 'player'))
  })

  /**
   * Symmetric, like every other board term, so the public half stays zero-sum: a lane we shut on them
   * is worth what a lane they shut on us costs.
   */
  it('reads the same board oppositely from the two seats', () => {
    const w = makePublicScore({ ...DEFAULT_WEIGHTS, blockedReach: 2, roleShift: 0 })
    const s = blocked()
    expect(w(s, 'player')).toBe(-w(s, 'opponent'))
  })

  /** Race first: the aggressor should not stop to grind a blocker down. */
  it('matters far less to a seat that can win the race', () => {
    const weights = { ...DEFAULT_WEIGHTS, blockedReach: 4 }
    const score = makePublicScore(weights)
    const asDefender = score(blocked(), 'player', 'defender')
    const asAggressor = score(blocked(), 'player', 'aggressor')
    const penalty = (v: number): number => makePublicScore({ ...weights, blockedReach: 0 })(blocked(), 'player', 'defender') - v
    expect(penalty(asDefender)).toBeGreaterThan(penalty(asAggressor))
  })

  /**
   * Bounded, so clearing a blocker never justifies more than a couple of actions. A strong unit is
   * worth roughly 20 here, so the cap is set below the cost of trading two bodies for the wall.
   */
  it('is capped however much reach is denied', () => {
    const many = state({
      cards,
      players: {
        player: player({ units: Array.from({ length: 6 }, (_, i) => unit(`u${i}`, 'GRUNT')) }),
        opponent: player({ units: [unit('w', 'WALL')] }),
      },
    })
    const weights = { ...DEFAULT_WEIGHTS, blockedReach: 4, roleShift: 0 }
    const terms = publicBreakdown(many, 'player', weights, 'neutral')
    // Six 4-power attackers is 24 points of denied reach; the term must not price all of it.
    expect(terms.blockedReach.quantity).toBeLessThan(24)
  })

  /** `publicBreakdown` must keep summing exactly to the score, or the sensitivity diagnostic lies. */
  it('appears in the breakdown, which still sums to the score', () => {
    const w = { ...DEFAULT_WEIGHTS, blockedReach: 2, roleShift: 0 }
    const terms = publicBreakdown(blocked(), 'player', w, 'neutral')
    const summed = Object.values(terms).reduce((n, t) => n + t.weight * t.quantity, 0)
    expect(summed).toBeCloseTo(makePublicScore(w)(blocked(), 'player', 'neutral'), 6)
  })
})
