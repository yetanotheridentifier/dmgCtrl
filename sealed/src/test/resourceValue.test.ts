import { describe, it, expect } from 'vitest'
import { publicScore, resourceValue, cardsValue, makePublicScore, makeEvaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { makeGreedyAi, greedyAi } from '../ai/greedyAi'
import { makeQuiescent } from '../ai/search'
import '../engine/cardDefinitions'
import { state, player, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * The resource pool's value, and the concavity experiment that did not pay off (#393 iteration 2).
 *
 * The bot banks a card at EVERY regroup, because banking is a flat public +1 (`resource` 3 minus
 * `card` 2) however many resources it already holds. Late on that looks wrong: you draw 2 at regroup
 * either way, so banking is "+1 resource against +1 card retained", and once the pool casts what you
 * hold the card should be the better half.
 *
 * The mechanism below implements exactly that and works. It also **lost**, monotonically in how much
 * concavity was applied (see the note on `resourceValue`), so the shipped weights are flat and these
 * tests exercise the mechanism with explicit weights instead. Kept so the question can be re-asked
 * after #395 rather than re-derived from scratch.
 */
const L = {
  ...CARDS,
  CHEAP_LEADER: card({ id: 'CHEAP_LEADER', type: 'leader', cost: 5, power: 4, hp: 7, aspects: ['Command', 'Heroism'] }),
  BIG_LEADER: card({ id: 'BIG_LEADER', type: 'leader', cost: 10, power: 6, hp: 9, aspects: ['Command', 'Heroism'] }),
  PLAYABLE: card({ id: 'PLAYABLE', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, aspects: ['Command'], rarity: 'Common' }),
}

/** The concave setting that was measured: cheap surplus, knee at 7. */
const CONCAVE = { ...DEFAULT_WEIGHTS, resourceSurplus: 1, saturation: 7 }
const concaveAi = makeGreedyAi(makeEvaluate(CONCAVE))

/** A regroup with `resourceCount` banked already and one card in hand to bank or keep. */
function regroup(resourceCount: number, leaderCardId = 'CHEAP_LEADER', deployed = false): GameState {
  return state({
    phase: 'regroup',
    activePlayer: 'player',
    cards: L,
    players: {
      player: player({
        leader: { cardId: leaderCardId, deployed, epicActionUsed: deployed, exhausted: false },
        hand: ['PLAYABLE'],
        resources: ready(resourceCount),
      }),
      opponent: player({ leader: { cardId: leaderCardId, deployed: false, epicActionUsed: false, exhausted: false } }),
    },
  })
}

const poolOf = (s: GameState, r: number): GameState =>
  ({ ...s, players: { ...s.players, player: { ...s.players.player, resources: ready(r) } } })

const handOf = (s: GameState, cards: number): GameState =>
  ({ ...s, players: { ...s.players, player: { ...s.players.player, hand: Array.from({ length: cards }, () => 'PLAYABLE') } } })

describe('resourceValue', () => {
  it('is non-decreasing in the pool size: your own resources are never a liability', () => {
    const s = regroup(0)
    for (const w of [DEFAULT_WEIGHTS, CONCAVE]) {
      const values = Array.from({ length: 14 }, (_, r) => resourceValue(poolOf(s, r), 'player', w))
      for (let i = 1; i < values.length; i++) expect(values[i], `pool ${i}`).toBeGreaterThanOrEqual(values[i - 1])
    }
  })

  it('pays full price below the knee and the surplus rate above it', () => {
    const s = regroup(0)
    const at = (r: number) => resourceValue(poolOf(s, r), 'player', CONCAVE)
    const knee = CONCAVE.saturation
    expect(at(knee) - at(knee - 1)).toBe(CONCAVE.resource)
    expect(at(knee + 1) - at(knee)).toBe(CONCAVE.resourceSurplus)
  })

  /**
   * "Always resource until you can deploy your leader." The gate is public and is a resource COUNT:
   * `legalMoves.ts` deploys on CONTROLLING resources equal to the leader's cost (CR 2.6.1).
   */
  it('raises the knee to the leader’s cost while the leader is undeployed', () => {
    const above = CONCAVE.saturation + 2
    const big = resourceValue(regroup(above, 'BIG_LEADER'), 'player', CONCAVE)
    const cheap = resourceValue(regroup(above, 'CHEAP_LEADER'), 'player', CONCAVE)
    expect(big, 'a 10-cost leader still needs the resources').toBeGreaterThan(cheap)
  })

  it('drops the knee back once the leader has deployed', () => {
    const above = CONCAVE.saturation + 2
    const undeployed = resourceValue(regroup(above, 'BIG_LEADER', false), 'player', CONCAVE)
    const deployed = resourceValue(regroup(above, 'BIG_LEADER', true), 'player', CONCAVE)
    expect(deployed).toBeLessThan(undeployed)
  })
})

describe('whether to bank at all, under concave weights', () => {
  const banks = (s: GameState): boolean => concaveAi(s)?.type === 'resourceCard'

  it('banks while below the knee', () => {
    expect(banks(regroup(2))).toBe(true)
    expect(banks(regroup(CONCAVE.saturation - 1))).toBe(true)
  })

  it('stops banking once the pool is saturated', () => {
    expect(banks(regroup(CONCAVE.saturation + 2))).toBe(false)
  })

  it('keeps banking past saturation while an expensive leader is still undeployed', () => {
    const pool = CONCAVE.saturation + 2
    expect(banks(regroup(pool, 'BIG_LEADER')), '10-cost leader not yet deployable').toBe(true)
    expect(banks(regroup(pool, 'CHEAP_LEADER')), '5-cost leader, gate long since met').toBe(false)
  })
})

/**
 * What actually ships. The behaviour above is deliberately NOT deployed: it measured 49.7% +/- 1.9%
 * over 5040 games against a flat pool, and worse the more concavity was applied. Anyone changing
 * this should read the note on `resourceValue` first and re-measure rather than assume.
 */
describe('the shipped weights keep the pool flat', () => {
  it('surplus equals the full rate, so the knee is inert', () => {
    expect(DEFAULT_WEIGHTS.resourceSurplus).toBe(DEFAULT_WEIGHTS.resource)
  })

  it('so the AI still banks a card at every regroup, deep pool or not', () => {
    expect(greedyAi(regroup(2))?.type).toBe('resourceCard')
    expect(greedyAi(regroup(DEFAULT_WEIGHTS.saturation + 3))?.type).toBe('resourceCard')
  })
})

/**
 * The sharpest constraint in the whole weight set, and the only one that is a cliff rather than a
 * curve.
 *
 * Banking at regroup swaps a card for a resource, so the sign of that decision is `resource - card`
 * and nothing else. A 5x5 grid over both weights (840 games a cell) depends on the DIFFERENCE alone,
 * never on either magnitude:
 *
 * | difference | win rate | behaviour |
 * | --- | --- | --- |
 * | >= 1 | ~50% | banks, and `resource=6,card=0` is no better than `resource=3,card=2` |
 * | 0 | 15.8% | banking is an exact tie, so a coin flip decides it (three cells: 15.7, 16.0, 15.8) |
 * | <= -1 | 1.8% | never banks, never builds a pool (two cells: 1.9, 1.7) |
 *
 * Losing 98% of games is not a tuning regression, so this is asserted rather than left to a comment.
 * Either weight may be re-tuned freely as long as the gap holds.
 */
describe('the banking decision: resource must outvalue a card', () => {
  it('keeps a strictly positive gap between a resource and a card', () => {
    expect(DEFAULT_WEIGHTS.resource).toBeGreaterThan(DEFAULT_WEIGHTS.card)
  })

  it('and the AI banks, which is what that gap buys', () => {
    expect(greedyAi(regroup(4))?.type).toBe('resourceCard')
  })

  it('closing the gap stops it banking, which is the 15.8% failure', () => {
    const tied = { ...DEFAULT_WEIGHTS, card: DEFAULT_WEIGHTS.resource }
    expect(makeGreedyAi(makeQuiescent(makeEvaluate(tied)))(regroup(4))?.type).not.toBe('resourceCard')
  })
})

/**
 * The concavity, moved off the pool and onto the hand (#519).
 *
 * Three experiments put a knee on the RESOURCE pool and each lost, monotonically in how much
 * concavity was applied. The premise was never wrong: the bot really does leave 1 to 2 resources
 * unspent per round late on. The quantity was.
 *
 * The regroup pick is not a choice between two cards. It is the **minimum of the whole hand**, and the
 * expected minimum of six sits well below the expected minimum of two, so the real cost of banking
 * falls as the hand grows. That is an order statistic rather than a taste curve, which is what the
 * pool knee never had behind it. Measured over 1630 regroup decisions on the shipped bot, hand size
 * runs 2 to 8 with 72% of decisions at 4 or 5.
 *
 * Charged as a BONUS on the cards below the knee rather than as a discount on the ones above it. The
 * two are the same curve, and only the bonus form leaves `card` itself alone: the shipped gap
 * `resource > card` is the sharpest constraint in the weight set, and closing it is the measured 1.8%
 * catastrophe. Here the gap is untouched and the bonus reverses the decision locally, which is exactly
 * the scope the behaviour wants.
 */
const SCARCE = { ...DEFAULT_WEIGHTS, cardScarcity: 3, handKnee: 3 }

describe('the hand is priced concavely: the marginal card is dearer when you hold few', () => {
  // Pool 8, i.e. past the knee: below it the bonus is switched off entirely and every marginal card
  // is worth the flat rate. That conjunction is the rule, and `the pool predicate` below pins it.
  const marginals = (w: typeof DEFAULT_WEIGHTS, sizes: number[]): number[] =>
    sizes.map(h => cardsValue(handOf(regroup(8), h + 1), 'player', w) - cardsValue(handOf(regroup(8), h), 'player', w))

  it('ships at zero, so the term is a provable no-op until it is swept', () => {
    expect(DEFAULT_WEIGHTS.cardScarcity).toBe(0)
    expect(DEFAULT_WEIGHTS.deployUrgency).toBe(0)
  })

  it('prices every card alike while the bonus is zero', () => {
    expect(new Set(marginals(DEFAULT_WEIGHTS, [1, 2, 3, 4, 5, 6]))).toEqual(new Set([DEFAULT_WEIGHTS.card]))
  })

  it('pays the bonus on cards at or below the knee, and the base rate above it', () => {
    // Marginal for the card that takes the hand from h to h+1, so the knee is crossed at h = knee.
    expect(marginals(SCARCE, [0, 1, 2])).toEqual([7, 7, 7])
    expect(marginals(SCARCE, [3, 4, 5])).toEqual([4, 4, 4])
  })

  it('is non-decreasing in hand size: your own cards are never a liability', () => {
    for (const w of [DEFAULT_WEIGHTS, SCARCE]) {
      const values = Array.from({ length: 10 }, (_, h) => cardsValue(handOf(regroup(8), h), 'player', w))
      for (let i = 1; i < values.length; i++) expect(values[i], `hand ${i}`).toBeGreaterThanOrEqual(values[i - 1])
    }
  })
})

/**
 * The behaviour the term exists to produce, and the failure mode it must not reach.
 *
 * Losing 98% of games is what "never banks" measures, so the early-game guard is asserted as hard as
 * the new behaviour is. A bot that declines a resource in round 2 is the catastrophe whatever its skip
 * rate averages to.
 */
describe('banking, once the marginal card is priced by scarcity', () => {
  const banks = (s: GameState, w = SCARCE): boolean => makeGreedyAi(makeEvaluate(w))(s)?.type === 'resourceCard'

  it('still banks from a full hand, which is the early game', () => {
    expect(banks(handOf(regroup(2), 5)), 'five cards, two resources').toBe(true)
    expect(banks(handOf(regroup(4), 4)), 'four cards, one above the knee').toBe(true)
  })

  it('declines once the hand is small AND the pool is saturated', () => {
    expect(banks(handOf(regroup(8), 3)), 'three cards, pool past the knee').toBe(false)
    expect(banks(handOf(regroup(8), 2))).toBe(false)
  })

  /**
   * **The conjunction, and the half a scripted position caught missing.**
   *
   * Charged on hand size alone the bonus fired at a pool of 2 holding three uncastable cards, which is
   * precisely when a resource is worth most: below the knee it still buys reach. A small hand is not a
   * reason to decline; a small hand over a pool that has run out of things to buy is.
   */
  it('banks from a small hand while the pool is still short of the knee', () => {
    expect(banks(handOf(regroup(2), 3)), 'three cards, pool of two').toBe(true)
    expect(banks(handOf(regroup(DEFAULT_WEIGHTS.saturation - 1), 2)), 'one short of the knee').toBe(true)
  })

  /**
   * The public half decides this, so the squashed hand term cannot reach it either way: the gap is
   * +2 banking and -1 declining, and the private half spans strictly less than 1.
   */
  it('is decided publicly, whatever the hand is worth', () => {
    const s = handOf(regroup(8), 2)
    expect(publicScore(s, 'player')).toBe(Math.round(publicScore(s, 'player')))
  })
})

/**
 * "Keep resourcing until you can deploy your leader" comes out of the knee for free.
 *
 * The threshold `cardScarcity` fires behind is the SAME one that splits the pool, and that one already
 * rises to an undeployed leader's printed cost (CR 2.6.1: the gate is a resource COUNT, controlled
 * rather than spent). So below it the pool is not saturated, the bonus cannot fire, and the bot keeps
 * banking. No second weight is needed to say it.
 *
 * That is a finding rather than a design: `deployUrgency` was built as a separate guard rail and
 * measured worth +3.2 points against the ungated driver. Under the conjunction the knee does the same
 * job, which is what these tests check, and whether the weight still earns its place is then an
 * open question for measurement rather than an assumption in either direction.
 */
describe('the leader-deploy gate falls out of the knee', () => {
  const banks = (s: GameState, w = SCARCE): boolean => makeGreedyAi(makeEvaluate(w))(s)?.type === 'resourceCard'

  it('keeps banking below the leader’s cost, from a hand the scarcity bonus would otherwise protect', () => {
    // Pool 8 is past the shipped knee of 7, so a DEPLOYED leader here would decline. The 10-cost
    // leader raises the threshold above the pool, and that alone restores banking.
    expect(banks(handOf(regroup(8, 'BIG_LEADER'), 2)), '10-cost leader, pool of 8').toBe(true)
    expect(banks(handOf(regroup(8, 'BIG_LEADER', true), 2)), 'same board, leader deployed').toBe(false)
  })

  it('declines once the pool reaches the leader’s cost', () => {
    expect(banks(handOf(regroup(10, 'BIG_LEADER'), 2)), 'pool now reaches the 10-cost leader').toBe(false)
  })

  it('uses the shipped knee once the leader is cheap enough not to bind', () => {
    expect(banks(handOf(regroup(8, 'CHEAP_LEADER'), 2)), '5-cost leader, knee stays at 7').toBe(false)
  })

  /** With the knee doing the work, the separate weight changes none of these decisions. */
  it('reaches the same decisions with deployUrgency off as on', () => {
    const off = { ...SCARCE, deployUrgency: 0 }
    const on = { ...SCARCE, deployUrgency: 2 }
    for (const board of [
      handOf(regroup(8, 'BIG_LEADER'), 2),
      handOf(regroup(10, 'BIG_LEADER'), 2),
      handOf(regroup(8, 'CHEAP_LEADER'), 2),
      handOf(regroup(2), 3),
    ]) {
      expect(banks(board, off), 'deployUrgency is not what decides these').toBe(banks(board, on))
    }
  })
})

/**
 * The guarantee iteration 1 rests on. `publicScore` must stay integer-valued, or the hand term stops
 * being a tie-break and starts voting, which measured at 40-50% win rate. A fractional weight would
 * break that silently, with no test failing anywhere near the cause.
 */
describe('public weights stay integers, so the hand term stays a tie-break', () => {
  it('every public weight is an integer', () => {
    for (const [name, value] of Object.entries(DEFAULT_WEIGHTS)) {
      if (name === 'hand') continue // the private half, deliberately fractional
      expect(Number.isInteger(value), `${name} = ${String(value)}`).toBe(true)
    }
  })

  it('publicScore is integer-valued on a real position', () => {
    const s = regroup(5)
    expect(Number.isInteger(publicScore(s, 'player'))).toBe(true)
    expect(Number.isInteger(publicScore(s, 'opponent'))).toBe(true)
  })

  /** Zero-sum survives concavity because each side is measured against its OWN leader. */
  it('stays zero-sum even under concave weights and mismatched leaders', () => {
    const s = state({
      cards: L,
      players: {
        player: player({ leader: { cardId: 'BIG_LEADER', deployed: false, epicActionUsed: false, exhausted: false }, resources: ready(9) }),
        opponent: player({ leader: { cardId: 'CHEAP_LEADER', deployed: false, epicActionUsed: false, exhausted: false }, resources: ready(3) }),
      },
    })
    expect(publicScore(s, 'player') + publicScore(s, 'opponent')).toBe(0)
    // The concave term is antisymmetric too, because each side reads its OWN leader's cost.
    const mine = resourceValue(s, 'player', CONCAVE)
    const theirs = resourceValue(s, 'opponent', CONCAVE)
    expect(mine - theirs).toBe(-(theirs - mine))
  })

  /**
   * The same discipline for the two new terms (#519). Each side is measured against its own hand and
   * its own leader, so the public half stays zero-sum however far apart the two positions are. A term
   * that read the pair jointly would put a private quantity in the shared half by the back door.
   */
  it('stays zero-sum with the scarcity bonus and the deploy gate on', () => {
    const w = { ...DEFAULT_WEIGHTS, cardScarcity: 3, handKnee: 3, deployUrgency: 2 }
    const s = handOf(
      state({
        cards: L,
        players: {
          player: player({ leader: { cardId: 'BIG_LEADER', deployed: false, epicActionUsed: false, exhausted: false }, resources: ready(9) }),
          opponent: player({
            leader: { cardId: 'CHEAP_LEADER', deployed: false, epicActionUsed: false, exhausted: false },
            resources: ready(3),
            hand: ['PLAYABLE', 'PLAYABLE', 'PLAYABLE', 'PLAYABLE', 'PLAYABLE'],
          }),
        },
      }),
      2,
    )
    expect(makePublicScore(w)(s, 'player') + makePublicScore(w)(s, 'opponent')).toBe(0)
    expect(cardsValue(s, 'player', w)).not.toBe(cardsValue(s, 'opponent', w))
  })
})
