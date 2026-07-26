import { describe, it, expect } from 'vitest'
import { reachThisRound, reachSteady, clock, role } from '../ai/race'
import '../engine/cardDefinitions'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { GameState, UnitState } from '../engine/types'

/**
 * The race: who gets to lethal first (#395).
 *
 * The obvious role signal is board advantage, and it does not work. Measured over 132 games, the
 * side ahead on units/power/HP at round 3 went on to win **49.2%** of the time, which is no signal
 * at all. The reason is the point of this model: **board power is not damage that can reach a
 * base**. A control player who puts up a Sentinel adds no power and kills nothing, but lengthens the
 * opponent's clock immediately.
 *
 * So reach is computed through `enemyAttackTargets`, the same function the rules use to decide what
 * a unit may attack. Re-deriving Sentinel, Saboteur, arena and Hidden here would be the #417 mistake:
 * two spellings of one rule, drifting apart in silence.
 */
const R = {
  ...CARDS,
  BIG_BASE: card({ id: 'BIG_BASE', type: 'base', hp: 30 }),
  GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground', cost: 2, power: 3, hp: 3 }),
  FLYER: card({ id: 'FLYER', type: 'unit', arena: 'space', cost: 2, power: 3, hp: 3 }),
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 3, power: 1, hp: 6, keywords: [{ name: 'Sentinel' }] }),
  SABO: card({ id: 'SABO', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 3, keywords: [{ name: 'Saboteur' }] }),
  TRAMPLER: card({ id: 'TRAMPLER', type: 'unit', arena: 'ground', cost: 5, power: 8, hp: 5, keywords: [{ name: 'Overwhelm' }] }),
  MEDIC: card({ id: 'MEDIC', type: 'unit', arena: 'ground', cost: 3, power: 1, hp: 4, keywords: [{ name: 'Restore', value: 3 }] }),
}

/** Both bases at 30 HP unless a test says otherwise. */
function board(mine: UnitState[], theirs: UnitState[], over: Partial<GameState> = {}): GameState {
  return state({
    phase: 'action',
    activePlayer: 'player',
    cards: R,
    players: {
      player: player({ base: { cardId: 'BIG_BASE', damage: 0 }, units: mine }),
      opponent: player({ base: { cardId: 'BIG_BASE', damage: 0 }, units: theirs }),
    },
    ...over,
  })
}

describe('reach: damage that can actually connect with a base', () => {
  it('counts an unobstructed attacker at its effective power', () => {
    expect(reachSteady(board([unit('a', 'GRUNT')], []), 'player')).toBe(3)
  })

  /** The case that motivated the whole model. */
  it('is blocked to zero by an enemy Sentinel in the same arena', () => {
    expect(reachSteady(board([unit('a', 'GRUNT')], [unit('w', 'WALL')]), 'player')).toBe(0)
  })

  it('is not blocked for a Saboteur, which ignores Sentinel', () => {
    expect(reachSteady(board([unit('a', 'SABO')], [unit('w', 'WALL')]), 'player')).toBe(3)
  })

  // `unit()` resolves the arena from the shared CARDS map, so a fixture-local card needs it stated.
  it('is not blocked across arenas: a ground Sentinel does not stop a space attacker', () => {
    expect(reachSteady(board([unit('f', 'FLYER', { arena: 'space' })], [unit('w', 'WALL')]), 'player')).toBe(3)
  })

  /** Overwhelm tramples the excess through to the base, so a wall only absorbs its own HP. */
  it('lets Overwhelm through a Sentinel for the excess', () => {
    // 8 power into a 6 HP wall leaves 2 for the base.
    expect(reachSteady(board([unit('t', 'TRAMPLER')], [unit('w', 'WALL')]), 'player')).toBe(2)
  })

  it('ignores a unit that cannot attack bases at all', () => {
    const cards = { ...R, GROUNDED: card({ id: 'GROUNDED', type: 'unit', arena: 'ground', power: 5, hp: 5 }) }
    const s = board([unit('g', 'GROUNDED')], [], { cards })
    // No definition marks GROUNDED as base-barred, so it does reach; the guard is exercised by the
    // real cards that set `cannotAttackBases`. This pins the default.
    expect(reachSteady(s, 'player')).toBe(5)
  })

  it('reads each seat independently, not just the active player', () => {
    const s = board([unit('a', 'GRUNT')], [unit('b', 'GRUNT'), unit('c', 'GRUNT')])
    expect(reachSteady(s, 'player')).toBe(3)
    expect(reachSteady(s, 'opponent')).toBe(6)
  })
})

describe('reach this round versus steady state', () => {
  /** Everything readies at regroup, so an exhausted unit is a delay, not a loss. */
  it('excludes exhausted units this round but counts them in the steady rate', () => {
    const s = board([unit('a', 'GRUNT'), unit('b', 'GRUNT', { exhausted: true })], [])
    expect(reachThisRound(s, 'player')).toBe(3)
    expect(reachSteady(s, 'player')).toBe(6)
  })
})

describe('clock: rounds to finish the enemy base', () => {
  it('is one when this round already finishes it', () => {
    const s = board([unit('t', 'TRAMPLER')], [], {})
    const nearlyDead = {
      ...s,
      players: { ...s.players, opponent: { ...s.players.opponent, base: { cardId: 'BIG_BASE', damage: 25 } } },
    }
    expect(clock(nearlyDead, 'player')).toBe(1)
  })

  it('counts the rounds at the steady rate after this one', () => {
    // 30 HP, 3 damage a round: this round takes it to 27, then 9 more rounds.
    expect(clock(board([unit('a', 'GRUNT')], []), 'player')).toBe(10)
  })

  it('is infinite when nothing can reach the base', () => {
    expect(clock(board([unit('a', 'GRUNT')], [unit('w', 'WALL')]), 'player')).toBe(Infinity)
  })

  /** Restore heals their base each round, so it genuinely lengthens the attacker's clock. */
  it('is lengthened by enemy Restore', () => {
    const without = clock(board([unit('a', 'GRUNT'), unit('b', 'GRUNT')], []), 'player')
    const withHeal = clock(board([unit('a', 'GRUNT'), unit('b', 'GRUNT')], [unit('m', 'MEDIC')]), 'player')
    expect(withHeal).toBeGreaterThan(without)
  })
})

describe('role: who is the beatdown', () => {
  it('is the aggressor when your clock is shorter', () => {
    const s = board([unit('a', 'GRUNT'), unit('b', 'GRUNT')], [unit('c', 'GRUNT')])
    expect(role(s, 'player')).toBe('aggressor')
    expect(role(s, 'opponent')).toBe('defender')
  })

  it('is neutral when the clocks are level', () => {
    const s = board([unit('a', 'GRUNT')], [unit('b', 'GRUNT')])
    expect(role(s, 'player')).toBe('neutral')
    expect(role(s, 'opponent')).toBe('neutral')
  })

  /**
   * THE case board advantage gets wrong, and the reason this model exists. Adding a Sentinel adds
   * almost no board power and kills nothing, but it stops the opponent's clock dead.
   */
  it('flips on a Sentinel that changes no board power worth speaking of', () => {
    const racing = board([unit('a', 'GRUNT'), unit('b', 'GRUNT')], [unit('c', 'GRUNT')])
    expect(role(racing, 'player')).toBe('aggressor')

    const walled = board([unit('a', 'GRUNT'), unit('b', 'GRUNT')], [unit('c', 'GRUNT'), unit('w', 'WALL')])
    expect(role(walled, 'player'), 'a 1-power wall turns the aggressor into the defender').toBe('defender')
  })

  it('is a pure function of the live board, independent of round or history', () => {
    const early = board([unit('a', 'GRUNT'), unit('b', 'GRUNT')], [unit('c', 'GRUNT')], { round: 2 })
    const late = board([unit('a', 'GRUNT'), unit('b', 'GRUNT')], [unit('c', 'GRUNT')], { round: 9 })
    expect(role(early, 'player')).toBe(role(late, 'player'))
  })

  it('is complementary: both seats cannot be the aggressor', () => {
    const s = board([unit('a', 'TRAMPLER')], [unit('c', 'GRUNT')])
    const mine = role(s, 'player')
    const theirs = role(s, 'opponent')
    expect(mine === 'aggressor' && theirs === 'aggressor').toBe(false)
    expect(mine === 'defender' && theirs === 'defender').toBe(false)
  })
})
