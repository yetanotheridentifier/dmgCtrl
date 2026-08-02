import { describe, it, expect } from 'vitest'
import { canFinishNow, canFinishThisAction } from '../ai/race'
import { classifyExposure } from '../bench/decisions'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import '../engine/cardDefinitions'

/**
 * "Is a lethal line available right now" (#432), expressed against the race model rather than as a
 * second damage calculation.
 *
 * This is an **approximation on purpose**, and it is the sizing instrument, not the solver. It reads
 * damage that can already connect with a base, so it under-counts a line that needs a card played
 * first and over-counts nothing: Sentinel, Saboteur, arena and Hidden all resolve through the rules'
 * own targeting. #433 replaces it with a real one-turn search; until then it answers "how often can
 * this ever fire" for the price of a comparison.
 */
describe('canFinishNow', () => {
  const cards = {
    ...CARDS,
    BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 2, power: 8, hp: 5 }),
    SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 1 }),
    WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 2, power: 0, hp: 6, keywords: [{ name: 'Sentinel' }] }),
    TINY_BASE: card({ id: 'TINY_BASE', type: 'base', hp: 8 }),
  }

  const board = (mine: string[], theirs: string[], baseDamage = 0, exhausted = false) => state({
    cards,
    players: {
      player: player({ units: mine.map((c, i) => unit(`u${i}`, c, { exhausted })) }),
      opponent: player({
        base: { cardId: 'TINY_BASE', damage: baseDamage },
        units: theirs.map((c, i) => unit(`e${i}`, c)),
      }),
    },
  })

  it('is true when ready damage already covers the enemy base', () => {
    // 8 power against an 8 HP base with nothing in the way.
    expect(canFinishNow(board(['BIG'], []), 'player')).toBe(true)
  })

  it('is false when the damage falls short', () => {
    expect(canFinishNow(board(['SMALL'], []), 'player')).toBe(false)
  })

  it('counts damage already dealt to the base', () => {
    // 1 power is lethal once the base is down to its last point.
    expect(canFinishNow(board(['SMALL'], [], 7), 'player')).toBe(true)
  })

  /** Exhausted units cannot swing, so their damage is not available THIS round. */
  it('ignores units that cannot attack yet', () => {
    expect(canFinishNow(board(['BIG'], [], 0, true), 'player')).toBe(false)
  })

  /**
   * The reason this is worth expressing against the race model rather than summing power: a Sentinel
   * forces the attack onto itself, so the damage never reaches the base.
   */
  it('respects a Sentinel standing in the way', () => {
    expect(canFinishNow(board(['BIG'], ['WALL']), 'player')).toBe(false)
  })

  it('reads each seat independently', () => {
    const s = board(['SMALL'], ['BIG'])
    expect(canFinishNow(s, 'player')).toBe(false)
    // The opponent's 8 power against the player's default 30 HP base is not lethal either.
    expect(canFinishNow(s, 'opponent')).toBe(false)
  })
})

/**
 * The stricter reading, and the one that matches what the AI can actually do.
 *
 * Players alternate actions, so an aggregate reach of 8 spread over two units is not a kill: it is
 * two attacks with an opponent action in between, and they get to answer. `canFinishNow` sums ready
 * units and therefore **over-counts** exactly this case; `canFinishThisAction` asks whether one unit
 * can do it alone, which is the only thing one ply can guarantee.
 */
describe('canFinishThisAction', () => {
  const cards = {
    ...CARDS,
    BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 2, power: 8, hp: 5 }),
    HALF: card({ id: 'HALF', type: 'unit', arena: 'ground', cost: 2, power: 4, hp: 4 }),
    TINY_BASE: card({ id: 'TINY_BASE', type: 'base', hp: 8 }),
  }
  const board = (mine: string[]) => state({
    cards,
    players: {
      player: player({ units: mine.map((c, i) => unit(`u${i}`, c)) }),
      opponent: player({ base: { cardId: 'TINY_BASE', damage: 0 } }),
    },
  })

  it('is true when one unit can finish it alone', () => {
    expect(canFinishThisAction(board(['BIG']), 'player')).toBe(true)
  })

  /** The whole point: two halves add up on paper, but not within one action. */
  it('is false when the damage only adds up across several attacks', () => {
    const s = board(['HALF', 'HALF'])
    expect(canFinishNow(s, 'player'), 'the aggregate measure says yes').toBe(true)
    expect(canFinishThisAction(s, 'player'), 'the honest one says no').toBe(false)
  })

  it('is false with nothing on board', () => {
    expect(canFinishThisAction(board([]), 'player')).toBe(false)
  })
})

/**
 * The counterfactual that sizes a tap-out risk gate (#432 measurement 2, option D).
 *
 * "The opponent could finish" is not the same as "the bot blundered": many such positions are
 * already lost, and a gate cannot save a game that is over. What a gate could actually recover is
 * the narrower case where the bot walked into lethal **and a legal move existed that would not
 * have**.
 *
 * This needs no oracle, which is the point. It also splits the question the belief model is really
 * being asked: exposure the bot could have seen on the public board is a SEARCH failure that #425
 * fixes with no hidden information at all, and only what remains can justify sampling their hand.
 */
describe('classifyExposure', () => {
  it('is safe when the chosen move leaves no lethal', () => {
    expect(classifyExposure(false, true)).toBe('safe')
    expect(classifyExposure(false, false)).toBe('safe')
  })

  it('is avoidable when it walked into lethal but another move would not have', () => {
    expect(classifyExposure(true, true)).toBe('avoidable')
  })

  /** Every move loses: nothing for a risk gate to recover, so it must not be counted as headroom. */
  it('is unavoidable when every legal move leaves them lethal', () => {
    expect(classifyExposure(true, false)).toBe('unavoidable')
  })
})
