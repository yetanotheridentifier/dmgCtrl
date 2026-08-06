import { describe, it, expect } from 'vitest'
import { makeBeamAi, lastSearchTrace, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { greedyAi, beamAi } from '../ai/greedyAi'
import { evaluate } from '../ai/evaluate'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Opponent reply (#425): score the board **after their best answer**, not after our own move.
 *
 * Every AI in the series so far stops at its own move, so it walks into lines that are good for
 * exactly one action: an attack the opponent wins on the crack-back, a unit committed into a board
 * that answers it, a leader deployed into a punish.
 *
 * This is the counterweight to #410, which is optimistic by construction: the beam maximises over
 * leaves, so it prefers the branch most dependent on the opponent doing nothing.
 */

const cards = {
  ...CARDS,
  // Both are Sentinels, which is what makes this position test the reply rather than base weighting.
  // Without one, the opponent's best answer is almost always "hit the base", because base damage is
  // worth 4 a point and swamps everything a unit trade can express.
  SPIKE: card({ id: 'SPIKE', type: 'unit', arena: 'ground', cost: 2, power: 9, hp: 2, keywords: [{ name: 'Sentinel' }] }),
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 2, power: 5, hp: 9, keywords: [{ name: 'Sentinel' }] }),
  PUNISHER: card({ id: 'PUNISHER', type: 'unit', arena: 'ground', cost: 3, power: 4, hp: 12 }),
}

/**
 * The scripted position, and the argument for the ticket.
 *
 * Two units in hand and exactly enough resources for one. SPIKE is worth marginally more on the
 * board (9 power against 5, so 24 points against 23), so **one ply plays SPIKE**. But SPIKE has 2 HP
 * and the opponent has a ready 4-power attacker, so it dies to the first answer, while WALL survives
 * and trades favourably.
 *
 * The Sentinels matter: they force the opponent's reply onto the unit we just played instead of our
 * base, which is the only way to isolate reply-blindness from base weighting.
 */
function crackBack(): GameState {
  return state({
    cards,
    players: {
      player: player({ hand: ['SPIKE', 'WALL'], resources: ready(2), units: [] }),
      opponent: player({ units: [unit('p', 'PUNISHER')] }),
    },
  })
}

/**
 * A position with real branching on both sides: several of our actions, and several answers to each.
 * Cost is a property of boards like this, so a claim about pruning has to be made on one.
 *
 * Kept as small as still branches. The tests below run an EXHAUSTIVE control, which has to search
 * everything the cut skips, so this fixture sets the cost of the slowest tests in the file.
 */
function branching(): GameState {
  return state({
    cards,
    players: {
      player: player({
        hand: ['SPIKE', 'WALL'],
        resources: ready(4),
        units: [unit('a1', 'SPIKE'), unit('a2', 'PUNISHER')],
      }),
      opponent: player({
        hand: ['WALL'],
        resources: ready(4),
        units: [unit('d1', 'PUNISHER'), unit('d2', 'SPIKE')],
      }),
    },
  })
}

const twoPly = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, depth: 1, reply: 'pessimistic' })

describe('reply-blindness, and the fix', () => {
  /** The control. Without it this file proves nothing: if one ply already played WALL there would be
   *  no gap to close. */
  it('one ply plays the unit that dies to the first answer', () => {
    const s = crackBack()
    expect(greedyAi(s)).toMatchObject({ type: 'playUnit', handIndex: 0 }) // SPIKE
  })

  it('the reply policy plays the one that survives it', () => {
    const s = crackBack()
    expect(twoPly(s)).toMatchObject({ type: 'playUnit', handIndex: 1 }) // WALL
  })
})

describe('the reply policy leaves everything else alone', () => {
  /**
   * The safety property. `reply: 'null'` must reproduce the shipped beam move for move, or an A/B
   * between them measures two different bots rather than one feature.
   */
  it('is exactly the shipped beam under the null policy', () => {
    const nullPolicy = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, reply: 'null' })
    for (const s of [crackBack(), { ...crackBack(), round: 5 }]) {
      expect(nullPolicy(s)).toEqual(beamAi(s))
    }
  })

  it('is deterministic', () => {
    const s = crackBack()
    expect(twoPly(s)).toEqual(twoPly(s))
  })

  it('does not touch the state it was given', () => {
    const s = crackBack()
    const before = JSON.stringify(s)
    twoPly(s)
    expect(JSON.stringify(s)).toBe(before)
  })

  /** With no reply available there is nothing to be pessimistic about, so it must agree with one ply
   *  rather than inventing a difference. */
  it('agrees with one ply when the opponent has no answer', () => {
    const s = state({
      cards,
      players: {
        player: player({ hand: ['SPIKE', 'WALL'], resources: ready(2) }),
        opponent: player({ units: [] }),
      },
    })
    expect(twoPly(s)).toEqual(greedyAi(s))
  })
})

describe('alpha-beta', () => {
  /**
   * **The property that makes it the right way to bound this search.** Alpha-beta never changes the
   * answer, only the work: once a candidate's reply is already worse than the best root found so far,
   * that candidate cannot win and the remaining replies need not be examined.
   *
   * The ticket originally suggested the cheaper-looking alternative, expanding replies only for the
   * top-scoring handful of candidates. That is the mistake #410 already paid two points for: trimming
   * by pre-expansion score prunes the moves whose value only appears AFTER the reply, which is the
   * entire reason for looking at replies.
   *
   * It also means a measurement taken before this optimisation stays valid afterwards, which is why
   * the A/B could be launched without waiting for it.
   */
  it('changes the work, never the answer', () => {
    const positions = [crackBack(), { ...crackBack(), round: 5 }, { ...crackBack(), rngSeed: 991 }]
    for (const policy of ['pessimistic', 'selfish'] as const) {
      const pruned = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, depth: 1, reply: policy })
      const exhaustive = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, depth: 1, reply: policy, alphaBeta: false })
      for (const s of positions) {
        expect(pruned(s), `${policy} disagreed with the exhaustive search`).toEqual(exhaustive(s))
      }
    }
  })

  /**
   * The cut extends to the DEEPEST level of the beam, and to nowhere in between.
   *
   * At an interior node a branch's value is the max over everything below it, so a poor reply there
   * bounds nothing and pruning on it would change the answer. The last level is different: those
   * boards feed `valueAt` and the winner check and are never continued from, so the frontier built
   * out of them is discarded unused. That makes them ordinary leaves, where alpha is a real bound.
   *
   * It is worth the care because that level holds most of the nodes: it is the only honest lever on
   * the cost of the deeper cells #447 sweeps, and #425's warning against the alternative (trimming
   * candidates by pre-expansion score) still stands, since that prunes the moves whose value only
   * appears after the reply.
   */
  it('cuts at the deepest level too, and still never changes the answer', () => {
    // `branching` carries the weight: on a position with one opponent unit the cut hardly fires, so
    // agreement there would be agreement about doing nothing. It is also the expensive one, since the
    // exhaustive control has to search what the cut is skipping, so it runs at depth 2 only. Depth 3
    // is covered on the cheap positions, and on `branching` by the saving test below.
    const cheap = [crackBack(), { ...crackBack(), round: 5 }]
    const busy = [branching(), { ...branching(), rngSeed: 991 }]
    for (const policy of ['pessimistic', 'selfish'] as const) {
      for (const depth of [2, 3]) {
        // Width 2 keeps the control affordable. The cut is applied per node over the opponent's
        // replies, so it is exercised the same at any width; what width changes is how long the
        // search WITHOUT it takes.
        const limits = { ...DEFAULT_BEAM_LIMITS, width: 2, depth, reply: policy, nodes: 1_000_000 }
        const pruned = makeBeamAi(evaluate, limits)
        const exhaustive = makeBeamAi(evaluate, { ...limits, alphaBeta: false })
        for (const s of depth === 2 ? [...cheap, ...busy] : cheap) {
          expect(pruned(s), `${policy} at depth ${depth} disagreed with the exhaustive search`)
            .toEqual(exhaustive(s))
        }
      }
    }
  })

  /**
   * And it has to actually save something, or it is a claim rather than an optimisation.
   *
   * `crackBack` is too small to show it: the opponent has one unit, so there are barely any replies
   * to skip. The saving is a property of a branching position, which is also the only kind where the
   * cost of a deep configuration matters.
   */
  it('spends fewer nodes for that same answer', () => {
    const limits = { ...DEFAULT_BEAM_LIMITS, width: 2, depth: 3, reply: 'pessimistic' as const, nodes: 1_000_000 }
    const s = branching()

    const pruned = makeBeamAi(evaluate, limits)
    const move = pruned(s)
    const prunedSpend = lastSearchTrace()!.nodes - lastSearchTrace()!.left

    const exhaustive = makeBeamAi(evaluate, { ...limits, alphaBeta: false })
    expect(exhaustive(s)).toEqual(move)
    const exhaustiveSpend = lastSearchTrace()!.nodes - lastSearchTrace()!.left

    expect(prunedSpend).toBeLessThan(exhaustiveSpend)
  })
})

describe('the two opponent models', () => {
  /**
   * `min(evaluate(s, me))` is pure pessimism: they do the most inconvenient thing we can see, whether
   * or not they would want to. `argmax(evaluate(s, foe))` models them as a player with their own read
   * of the race, which is weaker as a guarantee and more realistic.
   *
   * They are not the same, because role-adjusted weights are not zero-sum: an aggressor and a
   * defender price the same board differently by design. Which is better is measured, not argued, so
   * both are buildable.
   */
  it('offers both, and they are both usable', () => {
    const selfish = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, depth: 1, reply: 'selfish' })
    const s = crackBack()
    expect(selfish(s)).not.toBeNull()
    expect(twoPly(s)).not.toBeNull()
  })
})
