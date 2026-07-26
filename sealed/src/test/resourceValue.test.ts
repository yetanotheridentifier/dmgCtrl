import { describe, it, expect } from 'vitest'
import { publicScore, resourceValue, makeEvaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { makeGreedyAi, greedyAi } from '../ai/greedyAi'
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
})
