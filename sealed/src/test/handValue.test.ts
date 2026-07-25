import { describe, it, expect } from 'vitest'
import { handValue, reach, DEFAULT_HAND_WEIGHTS } from '../ai/handValue'
import { cardValue } from '../ai/cardValue'
import { resolve } from '../engine/resolve'
import { greedyAi } from '../ai/greedyAi'
import '../engine/cardDefinitions'
import { state, player, card, ready, CARDS } from './helpers/engineFixtures'
import ashSet from './fixtures/ashSet.json'
import { buildCardDb } from '../engine/cardDb'
import type { SwuCard } from '../data/cards'
import type { EngineCard, GameState, PlayerId } from '../engine/types'

/**
 * What a HAND is worth (#393): the piece the greedy evaluation was missing entirely, which is why
 * all 1417 regroup resource picks in a 132-game sweep were decided by a coin flip.
 *
 * Three things have to come out of one model, and the first and third pull against each other:
 *   1. early, banking a card you cannot cast for 3+ turns is right;
 *   2. late, expensive cards are the ones worth keeping and cheap ones are nearly dead;
 *   3. a Sealed bomb is worth holding until castable, PROVIDED that does not cost you a turn.
 * Card quality is what resolves 1 against 3: bank the expensive filler, hold the expensive bomb.
 */
const C = {
  ...CARDS,
  // Same cost and stats; only quality differs.
  FILLER_7: card({ id: 'FILLER_7', type: 'unit', arena: 'ground', cost: 7, power: 6, hp: 6, aspects: ['Command'], rarity: 'Common' }),
  BOMB_7: card({ id: 'BOMB_7', type: 'unit', arena: 'ground', cost: 7, power: 6, hp: 6, aspects: ['Command'], rarity: 'Legendary', unique: true, keywords: [{ name: 'Sentinel' }, { name: 'Overwhelm' }] }),
  CHEAP_2: card({ id: 'CHEAP_2', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, aspects: ['Command'], rarity: 'Common' }),
  MID_4: card({ id: 'MID_4', type: 'unit', arena: 'ground', cost: 4, power: 3, hp: 4, aspects: ['Command'], rarity: 'Uncommon' }),
}

const board = (hand: string[], resourceCount: number): GameState => state({
  phase: 'regroup',
  activePlayer: 'player',
  cards: C,
  players: {
    player: player({ hand, resources: ready(resourceCount) }),
    opponent: player(),
  },
})

/** The card the model would rather give up: the one whose removal leaves the best hand. */
function bestBank(s: GameState, me: PlayerId): string {
  const hand = s.players[me].hand
  let best = hand[0]
  let bestScore = -Infinity
  for (const [i, id] of hand.entries()) {
    const without: GameState = {
      ...s,
      players: { ...s.players, [me]: { ...s.players[me], hand: hand.filter((_, j) => j !== i), resources: ready(s.players[me].resources.length + 1) } },
    }
    const score = handValue(without, me, DEFAULT_HAND_WEIGHTS)
    if (score > bestScore) {
      bestScore = score
      best = id
    }
  }
  return best
}

describe('reach', () => {
  it('is monotone decreasing in cost for a fixed pool', () => {
    const pool = 4
    const values = [1, 2, 3, 4, 5, 6, 7, 9].map(k => reach(k, pool))
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThanOrEqual(values[i - 1])
  })

  it('is full value for anything already castable, and never zero for anything', () => {
    expect(reach(1, 5)).toBe(1)
    expect(reach(5, 5)).toBe(1)
    expect(reach(12, 1)).toBeGreaterThan(0) // a bomb keeps a real fraction of its worth
  })
})

describe('which card to bank', () => {
  it('early: banks the expensive filler rather than a cheap playable', () => {
    expect(bestBank(board(['CHEAP_2', 'MID_4', 'FILLER_7'], 2), 'player')).toBe('FILLER_7')
  })

  it('late: banks the cheap card, because everything is castable and cheap is nearly dead', () => {
    expect(bestBank(board(['CHEAP_2', 'MID_4', 'FILLER_7'], 8), 'player')).toBe('CHEAP_2')
  })

  /** The bomb rule: same cost, same stats, different quality, opposite decisions. */
  it('holds a bomb it cannot yet cast, but banks same-cost filler', () => {
    expect(bestBank(board(['CHEAP_2', 'BOMB_7', 'FILLER_7'], 2), 'player')).toBe('FILLER_7')
  })

  /**
   * "Provided this doesn't mean sacrificing turns." With only a playable and a bomb, the bomb goes:
   * keeping it would leave nothing to do next round.
   */
  it('banks even a bomb rather than leaving itself no play', () => {
    expect(bestBank(board(['CHEAP_2', 'BOMB_7'], 2), 'player')).toBe('BOMB_7')
  })
})

describe('weight orderings that are correctness constraints, not tuning knobs', () => {
  const db = buildCardDb(ashSet as unknown as SwuCard[])
  const pool = state({ cards: db, players: { player: player(), opponent: player() } })
  const values = Object.values(db)
    .filter((c: EngineCard) => c.type === 'unit' || c.type === 'event' || c.type === 'upgrade')
    .map((c: EngineCard) => cardValue(pool, 'player', c))
  const richest = Math.max(...values)
  const poorest = Math.min(...values.filter(v => v > 0))

  /**
   * LOWER bound. Keeping a castable card must beat holding the biggest bomb in the pool that you
   * cannot cast, or the model banks its last play. Measured against the REAL pool so it cannot rot
   * as cards are added.
   */
  it('canAct outweighs the discounted hold value of the best uncastable card', () => {
    const keepPlay = DEFAULT_HAND_WEIGHTS.canAct + DEFAULT_HAND_WEIGHTS.hold * poorest
    const keepBomb = DEFAULT_HAND_WEIGHTS.hold * reach(99, 0) * richest
    expect(keepPlay).toBeGreaterThan(keepBomb)
  })

  /**
   * UPPER bound, and the one that actually bit. Playing a card converts hand value into board
   * value, and that must stay a net gain or the bot sits on its hand: an earlier version scaled
   * this bonus by the castable card's value and lost 9.5 points of win rate, because a bomb's hand
   * value and board value are the same size so it refused to play its own bombs.
   *
   * The binding case is the CHEAPEST body, which pays the least board value for the same flat
   * bonus: a 1-cost 1/1 is worth unit(4) + power(2) + hp(1) = 7, less the public `card` weight of 2.
   */
  it('developing the last castable card still beats holding it, even for the cheapest body', () => {
    const pool1 = state({ cards: C, players: { player: player(), opponent: player() } })
    const runt = card({ id: 'RUNT', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, aspects: ['Command'], rarity: 'Common' })
    const lost = DEFAULT_HAND_WEIGHTS.canAct + DEFAULT_HAND_WEIGHTS.hold * cardValue(pool1, 'player', runt)
    expect(lost).toBeLessThan(7 - 2)
  })
})

describe('the greedy AI actually uses it', () => {
  it('no longer picks its regroup card at random', () => {
    const s = board(['CHEAP_2', 'MID_4', 'FILLER_7'], 2)
    const move = greedyAi(s)
    expect(move?.type).toBe('resourceCard')
    const banked = s.players.player.hand[move?.type === 'resourceCard' ? move.handIndex : 0]
    expect(banked).toBe('FILLER_7')
  })

  it('keeps the decision stable across seeds, which a coin flip could not', () => {
    const seeds = [1, 7, 99, 12345]
    const banked = seeds.map(rngSeed => {
      const s = { ...board(['CHEAP_2', 'MID_4', 'FILLER_7'], 2), rngSeed }
      const move = greedyAi(s)
      return move?.type === 'resourceCard' ? s.players.player.hand[move.handIndex] : null
    })
    expect(new Set(banked).size, 'the same position must give the same answer under any seed').toBe(1)
  })

  it('still develops rather than hoarding', () => {
    const s = state({
      phase: 'action',
      activePlayer: 'player',
      cards: C,
      players: { player: player({ hand: ['CHEAP_2', 'BOMB_7'], resources: ready(3) }), opponent: player() },
    })
    expect(greedyAi(s)?.type).toBe('playUnit')
  })
})

describe('handValue is private to the seat being scored', () => {
  it('an enemy hand full of bombs does not change our own hand value', () => {
    const weak = board(['CHEAP_2'], 3)
    const theirsLoaded: GameState = {
      ...weak,
      players: { ...weak.players, opponent: player({ hand: ['BOMB_7', 'BOMB_7', 'BOMB_7'], resources: ready(8) }) },
    }
    expect(handValue(theirsLoaded, 'player', DEFAULT_HAND_WEIGHTS)).toBe(handValue(weak, 'player', DEFAULT_HAND_WEIGHTS))
  })
})

/** Resourcing is the whole point, so prove it survives a real regroup rather than a hand-built state. */
describe('end to end through resolve', () => {
  it('banks the filler and keeps the bomb across a real regroup', () => {
    const s = board(['CHEAP_2', 'BOMB_7', 'FILLER_7'], 2)
    const move = greedyAi(s)!
    const after = resolve(s, move)
    expect(after.players.player.hand).toContain('BOMB_7')
    expect(after.players.player.hand).not.toContain('FILLER_7')
  })
})
