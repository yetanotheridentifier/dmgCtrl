import { describe, it, expect } from 'vitest'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { isLeaderUnit, unitHasTrait } from '../engine/keywords'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'

/** The Darksaber (ASH_135, #343): unique+nonVehicle attach; grants Mandalorian + leader-unit
 *  status; provides its aspect icons while its controller pays costs. */
const DARK = { cardId: 'ASH_135', owner: 'player' as const }

function withDarksaber(hostCard: Partial<Parameters<typeof card>[0]> & { id: string }, extra = {}) {
  return state({
    cards: { ...CARDS, ASH_135: card({ id: 'ASH_135', type: 'upgrade', cost: 4, power: 0, hp: 0 }), [hostCard.id]: card(hostCard), ...extra },
    players: { player: player({ units: [unit('u1', hostCard.id, { upgrades: [DARK] })] }), opponent: player() },
  })
}

describe('The Darksaber (ASH_135)', () => {
  it('attaches only to a unique, non-Vehicle unit', () => {
    const s = state({
      cards: {
        ...CARDS,
        ASH_135: card({ id: 'ASH_135', type: 'upgrade', cost: 0 }),
        UQ: card({ id: 'UQ', type: 'unit', arena: 'ground', unique: true }),
        VEH: card({ id: 'VEH', type: 'unit', arena: 'ground', unique: true, traits: ['Vehicle'] }),
        COMMON: card({ id: 'COMMON', type: 'unit', arena: 'ground', unique: false }),
      },
      players: { player: player({ hand: ['ASH_135'], resources: ready(2), units: [unit('u1', 'UQ'), unit('u2', 'VEH'), unit('u3', 'COMMON')] }), opponent: player() },
    })
    expect(legalMoves(s).filter(a => a.type === 'playUpgrade').map(a => a.targetInstanceId)).toEqual(['u1'])
  })

  it('grants the Mandalorian trait (so The Way of the Mand’alor costs 1 less on it)', () => {
    const s = withDarksaber({ id: 'UQ', type: 'unit', arena: 'ground', unique: true }, { ASH_263: card({ id: 'ASH_263', type: 'upgrade', cost: 2 }) })
    const host = s.players.player.units[0]
    expect(unitHasTrait(s, host, 'Mandalorian')).toBe(true)
    expect(effectiveCost(s, 'player', s.cards['ASH_263'], host)).toBe(1) // 2 − 1 (now Mandalorian)
  })

  it('makes the attached unit a leader unit', () => {
    const s = withDarksaber({ id: 'UQ', type: 'unit', arena: 'ground', unique: true })
    expect(isLeaderUnit(s, s.players.player.units[0])).toBe(true)
  })

  it('provides its aspect icons while its controller pays costs', () => {
    // Host has the Aggression aspect (not on the leader/base), so an Aggression card avoids the penalty.
    const s = withDarksaber(
      { id: 'AGG', type: 'unit', arena: 'ground', unique: true, aspects: ['Aggression'] },
      { TARGET: card({ id: 'TARGET', type: 'unit', arena: 'ground', cost: 3, aspects: ['Aggression'] }) },
    )
    expect(effectiveCost(s, 'player', s.cards['TARGET'])).toBe(3) // Darksaber host provides Aggression → no penalty

    // Without the Darksaber's provision the same card carries the +2 aspect penalty.
    const plain = state({
      cards: { ...CARDS, TARGET: card({ id: 'TARGET', type: 'unit', arena: 'ground', cost: 3, aspects: ['Aggression'] }) },
      players: { player: player(), opponent: player() },
    })
    expect(effectiveCost(plain, 'player', plain.cards['TARGET'])).toBe(5)
  })
})
