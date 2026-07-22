import { describe, it, expect } from 'vitest'
import { evaluate } from '../ai/evaluate'
import { state, player, unit } from './helpers/engineFixtures'

/**
 * The board evaluation the greedy AI maximises (#391). Higher is better for `me`. It is the seam the
 * later tickets grow (#392 trades, #395 role, #396 tokens); these tests pin the invariants it must
 * always hold: winning beats losing, your own board and card advantage help, damage to the enemy
 * base helps and damage to yours hurts, and the whole thing is zero-sum from the two seats' views.
 */
describe('evaluate', () => {
  it('scores a win far above a loss', () => {
    const won = state({ winner: 'player' })
    expect(evaluate(won, 'player')).toBeGreaterThan(0)
    expect(evaluate(won, 'opponent')).toBeLessThan(0)
    // A win dwarfs any material term: a lone unit cannot outweigh it.
    const material = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    expect(evaluate(won, 'player')).toBeGreaterThan(evaluate(material, 'player'))
  })

  it('is zero-sum: the two seats see equal and opposite scores', () => {
    const s = state({
      players: {
        player: player({ units: [unit('u1', 'TST_U1')], hand: ['TST_U1'], base: { cardId: 'TST_B', damage: 3 } }),
        opponent: player({ units: [unit('e1', 'TST_U2')], base: { cardId: 'TST_B', damage: 1 } }),
      },
    })
    expect(evaluate(s, 'player')).toBe(-evaluate(s, 'opponent'))
  })

  it('values having a board over not having one', () => {
    const withUnit = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    expect(evaluate(withUnit, 'player')).toBeGreaterThan(0)
  })

  it('rewards damage on the enemy base and punishes damage on your own', () => {
    const level = state()
    const hitEnemy = state({ players: { player: player(), opponent: player({ base: { cardId: 'TST_B', damage: 5 } }) } })
    const hitSelf = state({ players: { player: player({ base: { cardId: 'TST_B', damage: 5 } }), opponent: player() } })
    expect(evaluate(hitEnemy, 'player')).toBeGreaterThan(evaluate(level, 'player'))
    expect(evaluate(hitSelf, 'player')).toBeLessThan(evaluate(level, 'player'))
  })

  it('counts card advantage', () => {
    const ahead = state({ players: { player: player({ hand: ['TST_U1', 'TST_U1'] }), opponent: player({ hand: [] }) } })
    expect(evaluate(ahead, 'player')).toBeGreaterThan(0)
  })
})
