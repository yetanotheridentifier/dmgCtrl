import { describe, it, expect } from 'vitest'
import { canFinishNow } from '../ai/race'
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
