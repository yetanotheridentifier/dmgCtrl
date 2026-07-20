import { describe, it, expect, afterEach } from 'vitest'
import { registerCard, unregisterAbility } from '../engine/abilities'
import { dealDamageToUnit } from '../engine/combat'
import { resolve } from '../engine/resolve'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'

afterEach(() => {
  for (const id of ['TST_DEATH_UNIT', 'TST_DEATH_UP', 'TST_FRAGILE', 'TST_AEND']) unregisterAbility(id)
})

/** CR 7.6 / 1258: a defeated attacker's "When Attack Ends" abilities still trigger. */
describe('When Attack Ends after the attacker is defeated', () => {
  it("fires the attacker's onAttackEnd even when combat damage defeats it", () => {
    registerCard('TST_AEND', {
      abilities: [{ trigger: 'onAttackEnd', description: 'Deal 3 to enemy base', effect: (s, ctx) => {
        const enemy = ctx.owner === 'player' ? 'opponent' : 'player'
        const b = s.players[enemy].base
        return { ...s, players: { ...s.players, [enemy]: { ...s.players[enemy], base: { ...b, damage: b.damage + 3 } } } }
      } }],
    })
    const s = state({
      cards: { ...CARDS, TST_AEND: card({ id: 'TST_AEND', type: 'unit', arena: 'ground', power: 2, hp: 1 }) },
      players: {
        player: player({ units: [unit('u1', 'TST_AEND')] }),
        opponent: player({ units: [unit('e1', 'TST_U3')] }), // power 5 → kills u1 on the counter
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.players.player.units.find(u => u.instanceId === 'u1')).toBeUndefined() // attacker defeated
    expect(next.players.opponent.base.damage).toBe(3) // When Attack Ends still fired
  })
})

/**
 * Combat infrastructure: the `whenDefeated` trigger and the
 * `dealDamageToUnit` primitive that abilities use to deal damage outside the
 * normal attack flow. Tested with synthetic cards so the wiring is card-text
 * independent.
 */
describe('whenDefeated trigger', () => {
  it("fires a defeated unit's own whenDefeated ability", () => {
    // A "death rattle" that deals 5 to the enemy base when this unit is defeated.
    registerCard('TST_DEATH_UNIT', {
      abilities: [{ trigger: 'whenDefeated', description: 'Deal 5 to enemy base', effect: (s, ctx) => {
        const enemy = ctx.owner === 'player' ? 'opponent' : 'player'
        const b = s.players[enemy].base
        return { ...s, players: { ...s.players, [enemy]: { ...s.players[enemy], base: { ...b, damage: b.damage + 5 } } } }
      } }],
    })
    const s = state({
      cards: { ...CARDS, TST_DEATH_UNIT: card({ id: 'TST_DEATH_UNIT', type: 'unit', arena: 'ground', power: 1, hp: 1 }) },
      players: {
        player: player({ units: [unit('u1', 'TST_DEATH_UNIT')] }),
        opponent: player({ units: [unit('e1', 'TST_U3')] }), // TST_U3 power 5 → kills u1
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.players.player.units.find(u => u.instanceId === 'u1')).toBeUndefined() // defeated
    expect(next.players.opponent.base.damage).toBe(5) // its whenDefeated fired
  })

  it("fires a defeated unit's attached upgrade's whenDefeated ability", () => {
    registerCard('TST_DEATH_UP', {
      abilities: [{ trigger: 'whenDefeated', description: 'Deal 3 to enemy base', effect: (s, ctx) => {
        const enemy = ctx.owner === 'player' ? 'opponent' : 'player'
        const b = s.players[enemy].base
        return { ...s, players: { ...s.players, [enemy]: { ...s.players[enemy], base: { ...b, damage: b.damage + 3 } } } }
      } }],
    })
    const s = state({
      cards: { ...CARDS, TST_DEATH_UP: card({ id: 'TST_DEATH_UP', type: 'upgrade', power: 0, hp: 0 }) },
      players: {
        player: player({ units: [unit('u1', 'TST_U3', { upgrades: [{ cardId: 'TST_DEATH_UP', owner: 'player' }] })] }), // hp 1
        opponent: player({ units: [unit('e1', 'TST_U3')] }), // power 5 → kills u1
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.players.opponent.base.damage).toBe(3) // the upgrade's whenDefeated fired
  })
})

describe('dealDamageToUnit primitive', () => {
  it('adds damage to a unit without defeating it below its HP', () => {
    const s = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } }) // hp 4
    const next = dealDamageToUnit(s, 'u1', 2)
    expect(next.players.player.units[0].damage).toBe(2)
  })

  it('defeats a unit whose damage reaches its HP, routing it to discard', () => {
    const s = state({ players: { player: player({ units: [unit('u1', 'TST_U3')] }), opponent: player() } }) // hp 1
    const next = dealDamageToUnit(s, 'u1', 3)
    expect(next.players.player.units.find(u => u.instanceId === 'u1')).toBeUndefined()
    expect(next.players.player.discard).toContain('TST_U3')
  })

  it('fires whenDefeated when the primitive defeats the unit', () => {
    registerCard('TST_FRAGILE', {
      abilities: [{ trigger: 'whenDefeated', description: 'Deal 4 to enemy base', effect: (s, ctx) => {
        const enemy = ctx.owner === 'player' ? 'opponent' : 'player'
        const b = s.players[enemy].base
        return { ...s, players: { ...s.players, [enemy]: { ...s.players[enemy], base: { ...b, damage: b.damage + 4 } } } }
      } }],
    })
    const s = state({
      cards: { ...CARDS, TST_FRAGILE: card({ id: 'TST_FRAGILE', type: 'unit', arena: 'ground', power: 1, hp: 1 }) },
      players: { player: player({ units: [unit('u1', 'TST_FRAGILE')] }), opponent: player() },
    })
    const next = dealDamageToUnit(s, 'u1', 1)
    expect(next.players.opponent.base.damage).toBe(4)
  })

  it('respects a Shield token (prevents the damage instance, no defeat)', () => {
    const s = state({
      players: {
        player: player({ units: [unit('u1', 'TST_U3', { upgrades: [{ cardId: 'TOKEN_SHIELD', owner: 'player' }] })] }), // hp 1
        opponent: player(),
      },
    })
    const next = dealDamageToUnit(s, 'u1', 3)
    expect(next.players.player.units.find(u => u.instanceId === 'u1')).toBeDefined() // shield saved it
    expect(next.players.player.units[0].upgrades.some(a => a.cardId === 'TOKEN_SHIELD')).toBe(false)
  })
})
