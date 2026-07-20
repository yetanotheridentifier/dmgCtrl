import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectivePower } from '../engine/stats'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * Combat-timing and combat-entry modifiers (#357): dealing damage before the defender
 * (Carson Teva) and a bonus that only applies to an Ambush attack (Heroic Purrgil).
 */
const F = {
  ...CARDS,
  ASH_202: card({ id: 'ASH_202', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 4, keywords: [{ name: 'Support' }] }), // Carson Teva
  ASH_207: card({ id: 'ASH_207', type: 'unit', arena: 'space', cost: 5, power: 3, hp: 6, keywords: [{ name: 'Ambush' }] }), // Heroic Purrgil
  GLASS: card({ id: 'GLASS', type: 'unit', arena: 'ground', power: 4, hp: 1 }), // dies to any hit, would counter for 4
  TOUGH: card({ id: 'TOUGH', type: 'unit', arena: 'ground', power: 3, hp: 9 }),
  SPC: card({ id: 'SPC', type: 'unit', arena: 'space', power: 2, hp: 9 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })

describe('Carson Teva (202) — deals combat damage before the defender (#357)', () => {
  it('takes no counter damage when its damage defeats the defender', () => {
    const s = state({ cards: F, players: { player: rich({ units: [unit('c', 'ASH_202')] }), opponent: player({ units: [unit('g', 'GLASS')] }) } })
    const done = resolve(s, { type: 'attack', attackerId: 'c', target: { kind: 'unit', instanceId: 'g' } })
    expect(U(done, 'g')).toBeUndefined() // GLASS (1 hp) defeated by Carson's 1 power
    expect(U(done, 'c').damage).toBe(0) // ... so its 4 power never strikes back
  })

  it('still takes counter damage when the defender survives', () => {
    const s = state({ cards: F, players: { player: rich({ units: [unit('c', 'ASH_202')] }), opponent: player({ units: [unit('t', 'TOUGH')] }) } })
    const done = resolve(s, { type: 'attack', attackerId: 'c', target: { kind: 'unit', instanceId: 't' } })
    expect(U(done, 't').damage).toBe(1)
    expect(U(done, 'c').damage).toBe(3) // TOUGH survived and hit back
  })

  it('a normal attacker still trades simultaneously', () => {
    const s = state({ cards: F, players: { player: rich({ units: [unit('n', 'TOUGH')] }), opponent: player({ units: [unit('g', 'GLASS')] }) } })
    const done = resolve(s, { type: 'attack', attackerId: 'n', target: { kind: 'unit', instanceId: 'g' } })
    expect(U(done, 'g')).toBeUndefined()
    expect(U(done, 'n').damage).toBe(4) // simultaneous damage — the dying unit still hits back
  })
})

describe('Heroic Purrgil (207) — +2/+0 while attacking using Ambush (#357)', () => {
  it('gets the bonus on its Ambush attack, but not on a later normal attack', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_207'] }), opponent: player({ units: [unit('e', 'SPC', { arena: 'space' })] }) } })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    const ambush = played.pendingChoices?.[0]
    expect(ambush).toMatchObject({ kind: 'ambush' })
    const purrgil = played.players.player.units.find(u => u.cardId === 'ASH_207')!
    expect(effectivePower(played, purrgil)).toBe(3) // no bonus at rest

    const attacked = resolve(played, { type: 'attack', attackerId: purrgil.instanceId, target: { kind: 'unit', instanceId: 'e' } })
    expect(U(attacked, 'e').damage).toBe(3 + 2) // Ambush attack → +2

    // A plain attack by the same unit gets no bonus.
    const ready2 = state({
      cards: F,
      players: { player: rich({ units: [unit('p', 'ASH_207', { arena: 'space' })] }), opponent: player({ units: [unit('e', 'SPC', { arena: 'space' })] }) },
    })
    const plain = resolve(ready2, { type: 'attack', attackerId: 'p', target: { kind: 'unit', instanceId: 'e' } })
    expect(U(plain, 'e').damage).toBe(3)
  })
})
