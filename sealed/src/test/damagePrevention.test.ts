import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToBase } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * Base-damage prevention. All base damage now funnels through `dealDamageToBase`, so a
 * prevention effect applies wherever the damage came from — a combat attack, Overwhelm spill, or a
 * card effect. At Attin Safety Droid caps any single instance at 4.
 */
const F = {
  ...CARDS,
  ASH_070: card({ id: 'ASH_070', type: 'unit', arena: 'ground', power: 1, hp: 4 }), // At Attin Safety Droid
  BIGHITTER: card({ id: 'BIGHITTER', type: 'unit', arena: 'ground', power: 9, hp: 5 }),
  OVERWHELMER: card({ id: 'OVERWHELMER', type: 'unit', arena: 'ground', power: 9, hp: 5, keywords: [{ name: 'Overwhelm' }] }),
  CHUMP: card({ id: 'CHUMP', type: 'unit', arena: 'ground', power: 0, hp: 1 }),
}
/** Player attacks; `defenders` belong to the opponent (whose base is being hit). */
const board = (attacker: string, defenders: ReturnType<typeof unit>[]) => state({
  cards: F,
  players: {
    player: player({ units: [unit('a', attacker, { arena: 'ground' })] }),
    opponent: player({ units: defenders }),
  },
})
const oppBase = (s: GameState) => s.players.opponent.base.damage

describe('At Attin Safety Droid (070) — caps base damage at 4', () => {
  it('caps a big combat hit on its controller’s base', () => {
    const guarded = resolve(board('BIGHITTER', [unit('d', 'ASH_070', { arena: 'ground' })]), { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(oppBase(guarded)).toBe(4) // 9 → 4

    const unguarded = resolve(board('BIGHITTER', []), { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(oppBase(unguarded)).toBe(9) // control: no cap without the droid
  })

  it('leaves a hit of 4 or less untouched', () => {
    const s = board('CHUMP', [unit('d', 'ASH_070', { arena: 'ground' })])
    expect(oppBase(dealDamageToBase(s, 'opponent', 3))).toBe(3)
  })

  it('caps Overwhelm spill onto the base', () => {
    // OVERWHELMER (9 power) vs a 1-HP chump → 8 excess, capped to 4.
    const s = board('OVERWHELMER', [unit('c', 'CHUMP', { arena: 'ground' }), unit('d', 'ASH_070', { arena: 'ground' })])
    const done = resolve(s, { type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'c' } })
    expect(oppBase(done)).toBe(4)
  })

  it('caps ability damage too, and only protects its own controller’s base', () => {
    const s = board('CHUMP', [unit('d', 'ASH_070', { arena: 'ground' })])
    expect(oppBase(dealDamageToBase(s, 'opponent', 10))).toBe(4)
    // The player's own base is unguarded — the droid belongs to the opponent.
    expect(dealDamageToBase(s, 'player', 10).players.player.base.damage).toBe(10)
  })
})
