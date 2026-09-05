import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { player, state, unit, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * **A game with no clock**: deck-out damage fully cancelled by Restore.
 *
 * Found while diagnosing a bench game that ran 39 minutes without finishing. The step ceiling is the
 * harness's only guard (a wall-clock one is forbidden, see `selfPlay.ts`), and at 50,000 steps it
 * cannot bind in useful time, so a position with no clock costs an hour before anything notices.
 *
 * ## The two rules that meet
 *
 * **Deck-out is the game's backstop clock.** Once a deck is empty, each regroup draw that cannot be
 * made deals 3 damage to that player's own base, and a regroup draws 2, so an empty deck costs **6 a
 * round** against a 30 HP base. Every game should therefore end within about five rounds of the decks
 * running out, and that is the most common route to a draw.
 *
 * **Restore undoes it.** Restore N heals N from the attacking player's base **when that unit
 * attacks**, and the heal is clamped at zero rather than accumulating credit. It fires on any attack,
 * including one into a blocker that the attacker cannot get past.
 *
 * So a side fielding Restore totalling 6 across units that attack each round takes **zero net damage
 * from decking out**. If both sides can do that and neither can finish the other, the game has no
 * terminating condition at all.
 *
 * ## Why this is not a hypothetical
 *
 * The second half is exactly what the shielded-Sentinel lockout produces. A shut lane forces every
 * attacker onto the wall, so those attacks deal no base damage while still triggering Restore. A
 * lockout plus Restore on both sides is a stalemate engine, and the coverage decks contain fourteen
 * Restore units to build it from.
 */

const cards = {
  ...CARDS,
  // Restore 3 on each of two units is 6 a round, exactly cancelling an empty deck's 2 missed draws.
  MEDIC: card({
    id: 'MEDIC', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 5,
    keywords: [{ name: 'Restore', value: 3 }],
  }),
  // A wall to attack into, so the attacks that trigger Restore land no base damage.
  WALL: card({
    id: 'WALL', type: 'unit', arena: 'ground', cost: 3, power: 0, hp: 40,
    keywords: [{ name: 'Sentinel' }],
  }),
}

/** Both decks empty, both sides holding Restore 6 a round, and a wall each to swing into. */
function stalemate(damage = 12): GameState {
  const side = () => player({
    deck: [],
    hand: [],
    base: { cardId: 'TST_B', damage },
    units: [unit('m1', 'MEDIC'), unit('m2', 'MEDIC'), unit('w', 'WALL')],
  })
  return state({ cards, players: { player: side(), opponent: side() } })
}

/**
 * One action for whoever is to move: swing a ready medic into the enemy wall, or pass.
 *
 * **Players alternate single actions, not whole turns** (CR 1.5), so this drives the game the way it
 * is really played. Writing it as "one seat takes its whole turn" is what a first attempt did, and it
 * throws on an exhausted attacker rather than producing a wrong result, which is the good failure.
 */
function step(s: GameState): GameState {
  const moves = legalMoves(s)
  // Swing a medic into the wall whenever that is offered; otherwise take whatever the phase wants,
  // which is how the regroup's own decisions get answered without this test knowing their shape.
  const swing = moves.find(m => m.type === 'attack' && m.target.kind === 'unit')
  return resolve(s, swing ?? moves[0])
}

describe('deck-out as the game clock', () => {

  /** The clock itself, so the rest is read against a known rate. */
  it('costs a player 6 a round once their deck is empty', () => {
    const s = state({ players: { player: player({ deck: [] }), opponent: player({ deck: [] }) } })
    const after = resolve(resolve(s, { type: 'pass' }), { type: 'pass' })
    expect(after.players.player.base.damage).toBe(6)
    expect(after.players.opponent.base.damage).toBe(6)
  })

  /** And it does end games, which is what makes it the backstop. */
  it('kills a player whose base is already low', () => {
    const s = state({
      players: {
        player: player({ deck: [], base: { cardId: 'TST_B', damage: 25 } }),
        opponent: player({ deck: ['TST_U1', 'TST_U1'] }),
      },
    })
    expect(resolve(resolve(s, { type: 'pass' }), { type: 'pass' }).winner).toBe('opponent')
  })

  /**
   * **Restore fires on an attack into a blocker**, landing no base damage of its own. This is the
   * step that makes a shut lane a healing engine rather than merely a stalled one.
   */
  it('heals the attacker even when the attack cannot reach a base', () => {
    const s = stalemate(12)
    const after = resolve(s, {
      type: 'attack', attackerId: 'm1', target: { kind: 'unit', instanceId: 'w' },
    } as never)
    expect(after.players.player.base.damage, 'Restore 3 heals our own base').toBe(9)
    expect(after.players.opponent.base.damage, 'and their base is untouched').toBe(12)
  })

  /** Clamped at zero, so a healthy base banks no credit against later deck-out damage. */
  it('does not accumulate healing past zero', () => {
    const s = stalemate(1)
    const after = resolve(s, {
      type: 'attack', attackerId: 'm1', target: { kind: 'unit', instanceId: 'w' },
    } as never)
    expect(after.players.player.base.damage).toBe(0)
  })

  /**
   * **The defect: a position the game cannot end.**
   *
   * Six rounds of both sides swinging into a wall and passing. Both decks are empty throughout, so
   * each regroup deals 6 to each base, and each side's two Restore 3 units heal exactly 6 back. Net
   * zero, every round, forever.
   *
   * Six rounds is chosen against the clock this defeats: from 12 damage, an uncancelled deck-out
   * kills at 30 in three rounds, so a game still running at six has demonstrably broken the backstop.
   */
  it('never ends when both sides cancel the deck-out damage', () => {
    let s = stalemate(12)
    const startRound = s.round

    // Enough actions to carry six rounds at a handful of actions each. The step count is a bound on
    // the test, not on the game: that is the whole point of the assertion below it.
    for (let i = 0; i < 200 && s.winner === null; i++) s = step(s)

    expect(s.round, 'six rounds must actually have elapsed').toBeGreaterThan(startRound + 5)
    // Uncancelled, 6 a round from 12 kills this base during the third round. It is still untouched.
    expect(s.players.player.base.damage).toBeLessThanOrEqual(12)
    expect(s.players.opponent.base.damage).toBeLessThanOrEqual(12)
    expect(s.winner, 'the game has no terminating condition left').toBeNull()
  })
})
