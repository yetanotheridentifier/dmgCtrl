import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import '../engine/cardDefinitions' // side-effect: registers every implemented card
import { state, player, card, CARDS, unit, ready } from './helpers/engineFixtures'

/**
 * The ambush choice ("when you play this unit, it may attack") must not offer an attack once its
 * unit is exhausted. Every other granted-attack choice already guards this (`mayAttack`,
 * `mayAttackAnyUnit`, `support`); ambush did not, so if the unit was exhausted before the choice was
 * answered (e.g. it attacked via another grant first) `legalMoves` offered an illegal attack and
 * `attack()` threw "unit is exhausted". Found by the AI bench (#390).
 */
describe('ambush does not offer an attack for an exhausted unit', () => {
  const board = () => state({
    phase: 'action',
    activePlayer: 'player',
    cards: { ...CARDS, ATT: card({ id: 'ATT', name: 'Ambusher', type: 'unit', power: 3, hp: 3 }), DEF: card({ id: 'DEF', name: 'Defender', type: 'unit', power: 1, hp: 9 }) },
    players: {
      player: player({ deck: ['D1'], resources: ready(5), units: [unit('u1', 'ATT', { exhausted: true })] }),
      opponent: player({ deck: ['D1'], units: [unit('e1', 'DEF')] }),
    },
    pendingChoices: [{ kind: 'ambush', id: 'amb', controller: 'player', unitId: 'u1' }],
  })

  it('offers only the decline, no attack, when the ambush unit is exhausted', () => {
    const moves = legalMoves(board())
    expect(moves.some(m => m.type === 'attack')).toBe(false)
    expect(moves.some(m => m.type === 'skipTrigger')).toBe(true)
  })

  it('never offers a move that throws when resolved', () => {
    const s = board()
    for (const move of legalMoves(s)) {
      expect(() => resolve(s, move), JSON.stringify(move)).not.toThrow()
    }
  })

  it('still offers the attack when the unit IS ready', () => {
    const s = board()
    const ready1 = { ...s, players: { ...s.players, player: { ...s.players.player, units: [unit('u1', 'ATT', { exhausted: false })] } } }
    expect(legalMoves(ready1).some(m => m.type === 'attack')).toBe(true)
  })
})
