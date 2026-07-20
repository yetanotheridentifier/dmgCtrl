import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectiveCost } from '../engine/legalMoves'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * Once-per-phase cost reductions — provided by a unit *in play* to other cards its controller
 * plays (`costDiscount` / `waivesAspectPenalty`), gated on "the first … you play each phase" via the
 * per-phase `played` record.
 */
const F = {
  ...CARDS,
  ASH_075: card({ id: 'ASH_075', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 3, traits: ['Droid'] }), // Pit Droid Team
  ASH_212: card({ id: 'ASH_212', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, keywords: [{ name: 'Shielded' }] }), // Peli Motto
  HOST: card({ id: 'HOST', type: 'unit', arena: 'ground', power: 2, hp: 5 }),
  // A 3-cost upgrade with an aspect the player's leader/base do NOT provide → +2 aspect penalty.
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 3, power: 1, hp: 1, aspects: ['Cunning'] }),
  PLAIN_UPG: card({ id: 'PLAIN_UPG', type: 'upgrade', cost: 3, power: 1, hp: 1 }),
}
const board = (over: Parameters<typeof player>[0] = {}) => state({
  cards: F,
  players: {
    player: player({ resources: ready(20), units: [unit('pit', 'ASH_075', { arena: 'ground' }), unit('h', 'HOST', { arena: 'ground' })], ...over }),
    opponent: player({ units: [unit('e', 'HOST', { arena: 'ground' })] }),
  },
})
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!

describe('Pit Droid Team (075) — first upgrade each phase costs 1 less', () => {
  it('discounts an upgrade played on another friendly unit', () => {
    const s = board()
    expect(effectiveCost(s, 'player', F.PLAIN_UPG, U(s, 'h'))).toBe(2) // 3 - 1
  })

  it('does not discount an upgrade played on itself, or on an enemy unit', () => {
    const s = board()
    expect(effectiveCost(s, 'player', F.PLAIN_UPG, U(s, 'pit'))).toBe(3) // "another" excludes itself
    expect(effectiveCost(s, 'player', F.PLAIN_UPG, U(s, 'e'))).toBe(3) // friendly only
  })

  it('does not discount units — only upgrades', () => {
    const s = board()
    expect(effectiveCost(s, 'player', F.HOST)).toBe(F.HOST.cost)
  })

  it('applies to the FIRST upgrade only — the second is full price', () => {
    const s = board({ hand: ['PLAIN_UPG', 'PLAIN_UPG'] })
    expect(effectiveCost(s, 'player', F.PLAIN_UPG, U(s, 'h'))).toBe(2)
    const afterFirst = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'h' })
    expect(effectiveCost(afterFirst, 'player', F.PLAIN_UPG, U(afterFirst, 'h'))).toBe(3) // discount spent
  })
})

describe('Peli Motto (212) — first non-unit card each phase ignores aspect penalties', () => {
  const peliBoard = (over: Parameters<typeof player>[0] = {}) => state({
    cards: F,
    players: {
      player: player({ resources: ready(20), units: [unit('p', 'ASH_212', { arena: 'ground' }), unit('h', 'HOST', { arena: 'ground' })], ...over }),
      opponent: player(),
    },
  })

  it('waives the aspect penalty on the first non-unit card', () => {
    const s = peliBoard()
    expect(effectiveCost(s, 'player', F.UPG, U(s, 'h'))).toBe(3) // 3 + 0 penalty (waived)
  })

  it('the penalty applies again to the second non-unit card', () => {
    const s = peliBoard({ hand: ['UPG', 'UPG'] })
    expect(effectiveCost(s, 'player', F.UPG, U(s, 'h'))).toBe(3)
    const afterFirst = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'h' })
    expect(effectiveCost(afterFirst, 'player', F.UPG, U(afterFirst, 'h'))).toBe(5) // 3 + 2 aspect penalty
  })

  it('does not waive the penalty for unit cards', () => {
    const s = peliBoard()
    const aspectUnit = card({ id: 'AU', type: 'unit', arena: 'ground', cost: 2, aspects: ['Cunning'] })
    expect(effectiveCost(state({ ...s, cards: { ...F, AU: aspectUnit } }), 'player', aspectUnit)).toBeGreaterThan(2)
  })
})
