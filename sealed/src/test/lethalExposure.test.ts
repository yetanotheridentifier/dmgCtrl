import { describe, it, expect } from 'vitest'
import { greedyAi } from '../ai/greedyAi'
import { publicScore, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Lethal exposure (#443): prefer a move that does not leave the opponent able to kill us with a
 * single attack.
 *
 * Measured over 1260 games before building it: 2.5% of decisions handed the opponent a one-action
 * kill, and **82% of those were unavoidable** (every legal move led there). The 408 avoidable ones
 * carried a 22.1 point loss-rate penalty, 68.9% against a 46.8% baseline.
 *
 * The term is symmetric, integer and public, which is what keeps it from disturbing anything: the
 * zero-sum property of `publicScore` survives, and the private hand term stays bounded below public
 * resolution.
 */

const cards = {
  ...CARDS,
  KILLER: card({ id: 'KILLER', type: 'unit', arena: 'ground', cost: 2, power: 8, hp: 4 }),
  // A 0/1 Sentinel: nearly worthless as a body, decisive as an answer.
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 2, power: 0, hp: 1, keywords: [{ name: 'Sentinel' }] }),
  BIGUNIT: card({ id: 'BIGUNIT', type: 'unit', arena: 'ground', cost: 2, power: 5, hp: 5 }),
  CHUMP: card({ id: 'CHUMP', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  FRAIL_BASE: card({ id: 'FRAIL_BASE', type: 'base', hp: 8 }),
}

describe('the exposure term itself', () => {
  /**
   * What one seat gains the other loses. Scored at a fixed role for both seats, because role
   * awareness deliberately breaks zero-sum when the two seats read the race differently, and that
   * would mask whether THIS term is symmetric.
   */
  it('is zero-sum: what one seat gains the other loses', () => {
    const s = state({
      cards,
      players: {
        player: player({ base: { cardId: 'FRAIL_BASE', damage: 0 }, units: [unit('u0', 'CHUMP')] }),
        opponent: player({ units: [unit('e0', 'KILLER')] }),
      },
    })
    expect(publicScore(s, 'player', 'neutral') + publicScore(s, 'opponent', 'neutral')).toBe(0)
  })

  it('scores being exposed worse than not being exposed', () => {
    const exposed = state({
      cards,
      players: {
        player: player({ base: { cardId: 'FRAIL_BASE', damage: 0 } }),
        opponent: player({ units: [unit('e0', 'KILLER')] }),
      },
    })
    // The same board with our base out of one-shot range.
    const safe = state({
      cards,
      players: {
        player: player(), // default 30 HP base
        opponent: player({ units: [unit('e0', 'KILLER')] }),
      },
    })
    expect(publicScore(exposed, 'player')).toBeLessThan(publicScore(safe, 'player'))
  })

  /** The hand term is squashed into `[0, 1)`, so a fractional weight here would let it start voting. */
  it('keeps the weight an integer, so the hand term stays a tie-break', () => {
    expect(Number.isInteger(DEFAULT_WEIGHTS.lethalExposure)).toBe(true)
  })
})

describe('what the AI does with it', () => {
  /**
   * "Rewards the answer": playing the Sentinel makes their kill impossible, and the term makes that
   * worth more than the fatter body.
   *
   * The material gap is deliberate. WALL is a 0/1 (worth about 5 on the board terms) against
   * BIGUNIT's 5/5 (about 19), so before this term the bot always took the big one. Exposure has to
   * be worth more than that 14 point gap to change the pick.
   */
  it('plays the blocker over the bigger body when that is what stops the kill', () => {
    const s: GameState = state({
      cards,
      players: {
        player: player({
          base: { cardId: 'FRAIL_BASE', damage: 0 },
          hand: ['WALL', 'BIGUNIT'],
          resources: ready(4),
        }),
        opponent: player({ units: [unit('e0', 'KILLER')] }),
      },
    })
    expect(greedyAi(s)).toMatchObject({ type: 'playUnit', handIndex: 0 })
  })

  /**
   * The same instinct on the attack side: removing the threat beats hitting a healthy base, even
   * though the base damage scores higher on its own.
   */
  it('kills the unit that has lethal rather than swinging at a healthy base', () => {
    const s: GameState = state({
      cards,
      players: {
        player: player({
          base: { cardId: 'FRAIL_BASE', damage: 0 },
          resources: ready(3),
          units: [unit('u0', 'BIGUNIT')],
        }),
        opponent: player({ units: [unit('e0', 'KILLER')] }),
      },
    })
    expect(greedyAi(s)).toMatchObject({ type: 'attack', target: { kind: 'unit', instanceId: 'e0' } })
  })

  /**
   * The self-limiting property, and the reason this needed no special-casing: where every move is
   * exposed the penalty is identical across candidates, so it cancels and the ranking is unchanged.
   */
  it('does not distort the choice when every move leaves us exposed', () => {
    const doomed = (): GameState => state({
      cards,
      players: {
        // No blocker to keep back: whatever we do, KILLER connects.
        player: player({ base: { cardId: 'FRAIL_BASE', damage: 0 }, resources: ready(3), units: [] }),
        opponent: player({ units: [unit('e0', 'KILLER')] }),
      },
    })
    const s = doomed()
    // Every candidate carries the same penalty, so the term contributes nothing to the ordering and
    // the AI still finds a move rather than freezing.
    expect(greedyAi(s)).not.toBeNull()
  })
})
