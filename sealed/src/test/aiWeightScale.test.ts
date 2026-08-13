import { describe, it, expect } from 'vitest'
import { DEFAULT_WEIGHTS, PRICE_KEYS, scalePrices, makeEvaluate, makePublicScore } from '../ai/evaluate'
import { makeBeamGreedy, BEAM_REPLY_LIMITS } from '../ai/greedyAi'
import { resolveAi } from '../ai/registry'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { buildCardDb } from '../engine/cardDb'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { initGame } from '../engine/initGame'
import { seededShuffle, nextSeed } from '../engine/rng'
import { setupAi } from '../ai/setupAi'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * **The evaluation is scale-invariant, and that is what buys finer weights.**
 *
 * Every price is charged as `weight x quantity` and summed, so multiplying every price by the same
 * constant multiplies every score by it. Ordering is untouched, ties stay ties, and the bot plays
 * identically. Doubling therefore costs nothing and makes the old "1.5" expressible as 3, which is
 * exactly the range the last sweep said `roleShift`'s optimum sits in.
 *
 * Two weights are deliberately NOT prices and must not scale:
 *
 * - **`saturation`** is a pool SIZE, the point where "enough resources" begins. Doubling it would mean
 *   fourteen resources instead of seven, which is a real behaviour change.
 * - **`blockedReachCap`** caps a quantity, not a price.
 *
 * The private hand term is not scaled either. It is squashed into `[0, 1)` so it can only ever break
 * ties between equal public scores, and public scores stay integers however they are scaled, so the
 * bound survives untouched. Scaling it would be the one change that could break it.
 *
 * Arithmetic says all this. These tests are the evidence.
 */

function corpus(limit: number): GameState[] {
  const { decks } = buildCoverageDecks(ashSet as unknown as SwuCard[], 11)
  const cardDb = buildCardDb(ashSet as unknown as SwuCard[])
  const out: GameState[] = []
  let seed = 11
  for (const deck of decks.slice(0, 3)) {
    if (out.length >= limit) break
    seed = nextSeed(seed)
    let s = seed
    let g = initGame(deck, deck, cardDb, {
      firstPlayer: 'player',
      shuffle: <T,>(a: T[]): T[] => { s = nextSeed(s); return seededShuffle(a, s) },
      rngSeed: seed,
    })
    while (g.winner === null && out.length < limit) {
      const action = setupAi(g) ?? resolveAi('greedy')(g)
      if (!action) break
      if (legalMoves(g).length > 1) out.push(g)
      g = resolve(g, action)
    }
  }
  return out
}

const positions = corpus(40)

describe('scalePrices', () => {
  it('scales every price and nothing else', () => {
    const doubled = scalePrices(DEFAULT_WEIGHTS, 2)
    for (const key of PRICE_KEYS) expect(doubled[key], key).toBe(DEFAULT_WEIGHTS[key] * 2)
    // The two structural numbers, and the private half, are untouched.
    expect(doubled.saturation).toBe(DEFAULT_WEIGHTS.saturation)
    expect(doubled.blockedReachCap).toBe(DEFAULT_WEIGHTS.blockedReachCap)
    expect(doubled.hand).toEqual(DEFAULT_WEIGHTS.hand)
  })

  /** A price left out of `PRICE_KEYS` would silently fail to scale, which would change behaviour on
   *  the very change that is supposed to change nothing. */
  it('covers every weight that is a price', () => {
    const structural = ['saturation', 'blockedReachCap', 'hand']
    const all = Object.keys(DEFAULT_WEIGHTS).filter(k => !structural.includes(k))
    expect([...PRICE_KEYS].sort()).toEqual(all.sort())
  })
})

describe('scaling the prices changes nothing', () => {
  it('multiplies the public score by exactly the factor', () => {
    const base = makePublicScore(DEFAULT_WEIGHTS)
    const doubled = makePublicScore(scalePrices(DEFAULT_WEIGHTS, 2))
    expect(positions.length).toBeGreaterThan(20)
    for (const s of positions) {
      expect(doubled(s, 'player')).toBe(base(s, 'player') * 2)
    }
  })

  /** Public scores stay whole numbers, which is what keeps the hand term a tie-break rather than a
   *  vote. An unbounded hand term measured 40.5%. */
  it('keeps the public score integer-valued', () => {
    const doubled = makePublicScore(scalePrices(DEFAULT_WEIGHTS, 2))
    for (const s of positions) expect(Number.isInteger(doubled(s, 'player')), 'integer').toBe(true)
  })

  /**
   * **The evidence that matters: the bot plays the same moves.** Scoring identically is arithmetic;
   * choosing identically through a depth-3 search with an opponent reply, a tie-break and a private
   * hand term riding on top is the thing actually being claimed.
   */
  it('picks the identical move at every position, through the full shipped search', () => {
    const shipped = makeBeamGreedy(DEFAULT_WEIGHTS, BEAM_REPLY_LIMITS)
    const doubled = makeBeamGreedy(scalePrices(DEFAULT_WEIGHTS, 2), BEAM_REPLY_LIMITS)
    for (const s of positions) expect(doubled(s)).toEqual(shipped(s))
  }, 180_000)

  /** And halving, so the property is scale-invariance rather than a lucky factor. Every shipped price
   *  is even, so halving stays integral. */
  it('picks the identical move when halved as well', () => {
    const shipped = makeEvaluate(DEFAULT_WEIGHTS)
    const halved = makeEvaluate(scalePrices(DEFAULT_WEIGHTS, 0.5))
    for (const s of positions) {
      // Compared as an ordering over the same candidates, which is all a score is used for.
      const moves = legalMoves(s)
      const rank = (e: typeof shipped) => moves.map(m => e(resolve(s, m), 'player'))
        .map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, i]) => i)
      expect(rank(halved)).toEqual(rank(shipped))
    }
  }, 180_000)
})
