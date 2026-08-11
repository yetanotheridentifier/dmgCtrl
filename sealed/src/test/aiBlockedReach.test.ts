import { describe, it, expect } from 'vitest'
import { reachSteady, blockedReach } from '../ai/race'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Reach denied by a blocker (#499).
 *
 * `reachSteady` already returns 0 for a Sentinel-locked attacker, because a locked unit must hit the
 * wall and contributes no base damage. What it cannot say is **how much** is being denied, and that
 * difference is the whole value of removing the blocker.
 *
 * Diagnosed rather than guessed: the principal-variation readout showed the acting line and the
 * passing line peaking at the **same level**, both with the Sentinel dead. The tie has to be broken
 * at that level, and the two boards differ only in whether the lane is open. Nothing in the
 * evaluation reads that today.
 *
 * This is the quantity. Pricing it, and conditioning it on role so a bot that can win the race does
 * not stop to grind, is a separate concern.
 */

const cards = {
  ...CARDS,
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 5, keywords: [{ name: 'Sentinel' }] }),
  GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground', cost: 2, power: 4, hp: 4 }),
  FLYER: card({ id: 'FLYER', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 3 }),
  SABO: card({ id: 'SABO', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 3, keywords: [{ name: 'Saboteur' }] }),
}

const shielded = (id: string, cardId: string): ReturnType<typeof unit> =>
  unit(id, cardId, { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })

/**
 * The standard blocker, **shielded**, because the quantity is gated to blockers the evaluation cannot
 * otherwise see. An unshielded Sentinel is answerable by attacking it, and the material terms already
 * price that; pricing it here as well put the term on 24.2% of decisions and measured 25.0%.
 */
const wall = (id = 'w'): ReturnType<typeof unit> => shielded(id, 'WALL')

function board(mine: ReturnType<typeof unit>[], theirs: ReturnType<typeof unit>[]): GameState {
  return state({
    cards,
    players: { player: player({ units: mine }), opponent: player({ units: theirs }) },
  })
}

describe('blockedReach', () => {
  it('is zero when nothing is in the way', () => {
    const s = board([unit('u1', 'GRUNT')], [])
    expect(reachSteady(s, 'player')).toBe(4)
    expect(blockedReach(s, 'player')).toBe(0)
  })

  /** The case the whole ticket is about: a Sentinel denies every point our attacker had. */
  it('is the reach a Sentinel denies', () => {
    const s = board([unit('u1', 'GRUNT')], [wall()])
    expect(reachSteady(s, 'player'), 'locked, so no base damage lands').toBe(0)
    expect(blockedReach(s, 'player'), 'and 4 points of it are being denied').toBe(4)
  })

  it('sums across every attacker the blocker locks', () => {
    const s = board([unit('u1', 'GRUNT'), unit('u2', 'GRUNT')], [wall()])
    expect(blockedReach(s, 'player')).toBe(8)
  })

  /**
   * **Per arena.** A ground Sentinel shuts ground and leaves space alone, so a space attacker's reach
   * is not denied and must not be counted. Measuring this board-wide is the error that put the
   * lockout rate at 0.3% when the real figure was five times that.
   */
  it('ignores attackers the blocker cannot reach', () => {
    // `unit()` reads the arena from the shared CARDS table, not from this file's `cards`, so a
    // locally defined space card silently lands in ground unless the arena is given explicitly.
    const s = board([unit('u1', 'GRUNT'), unit('f1', 'FLYER', { arena: 'space' })], [wall()])
    expect(blockedReach(s, 'player'), 'only the ground attacker is denied').toBe(4)
  })

  /** Saboteur ignores Sentinel, so nothing of its reach is being denied. */
  it('does not count an attacker that can walk past the blocker', () => {
    const s = board([unit('s1', 'SABO')], [wall()])
    expect(reachSteady(s, 'player')).toBe(3)
    expect(blockedReach(s, 'player')).toBe(0)
  })

  /**
   * **The Shield is the gate, which is the reverse of what this test used to assert.**
   *
   * It originally held that a Shield does not change the quantity, on the reasoning that the reach
   * denied is the same either way and the Shield only affects how long the denial lasts. True as
   * arithmetic, and wrong as a term: pricing every Sentinel put it on 24.2% of decisions against a
   * 2.1% lockout and measured 25.0% against the shipped bot.
   *
   * An unshielded Sentinel is answerable, so the material terms already cover it. Only the shielded
   * one is invisible, and only it is priced.
   */
  it('prices a shielded blocker and ignores one that can be killed', () => {
    const plain = board([unit('u1', 'GRUNT')], [unit('w', 'WALL')])
    const withShield = board([unit('u1', 'GRUNT')], [shielded('w', 'WALL')])
    expect(blockedReach(plain, 'player')).toBe(0)
    expect(blockedReach(withShield, 'player')).toBe(4)
  })

  /** Removing the blocker is what the bot has to be able to see paying off. */
  it('falls to zero once the blocker is gone', () => {
    const blocked = board([unit('u1', 'GRUNT')], [wall()])
    const clear = board([unit('u1', 'GRUNT')], [])
    expect(blockedReach(blocked, 'player')).toBeGreaterThan(0)
    expect(blockedReach(clear, 'player')).toBe(0)
  })

  /** Exhausted units still count: the denial is about the steady rate, matching `reachSteady`. */
  it('counts an exhausted attacker, like the steady reach does', () => {
    const s = board([unit('u1', 'GRUNT', { exhausted: true })], [wall()])
    expect(blockedReach(s, 'player')).toBe(4)
  })
})
