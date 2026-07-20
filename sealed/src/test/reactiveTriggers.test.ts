import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToUnit } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * Reactive triggers (#357) — abilities that fire off *another* card's event:
 * `whenFriendlyUnitDefeated` (The Twins) and `whenEnemyAttacksBase` (Kachirho Militia).
 */
const F = {
  ...CARDS,
  ASH_127: card({ id: 'ASH_127', type: 'unit', arena: 'ground', power: 2, hp: 7, keywords: [{ name: 'Sentinel' }] }), // The Twins
  ASH_160: card({ id: 'ASH_160', type: 'unit', arena: 'ground', power: 4, hp: 6, keywords: [{ name: 'Hidden' }] }), // Kachirho Militia
  FODDER: card({ id: 'FODDER', type: 'unit', arena: 'ground', power: 1, hp: 1 }),
  GROUNDER: card({ id: 'GROUNDER', type: 'unit', arena: 'ground', power: 3, hp: 5 }),
  SPACER: card({ id: 'SPACER', type: 'unit', arena: 'space', power: 3, hp: 5 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!

describe('whenFriendlyUnitDefeated — The Twins (127) (#357)', () => {
  it('heals 1 from your base when another friendly unit is defeated', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('t', 'ASH_127', { arena: 'ground' }), unit('f', 'FODDER', { arena: 'ground' })], base: { cardId: 'TST_B', damage: 4 } }),
        opponent: player(),
      },
    })
    const done = dealDamageToUnit(s, 'f', 1) // FODDER (1 hp) dies
    expect(U(done, 'f')).toBeUndefined()
    expect(done.players.player.base.damage).toBe(3) // healed 1
  })

  it("does not fire for an enemy unit's defeat, nor for its own", () => {
    const enemyDies = state({
      cards: F,
      players: {
        player: player({ units: [unit('t', 'ASH_127', { arena: 'ground' })], base: { cardId: 'TST_B', damage: 4 } }),
        opponent: player({ units: [unit('e', 'FODDER', { arena: 'ground' })] }),
      },
    })
    expect(dealDamageToUnit(enemyDies, 'e', 1).players.player.base.damage).toBe(4) // enemy death → no heal

    const selfDies = state({
      cards: F,
      players: {
        player: player({ units: [unit('t', 'ASH_127', { arena: 'ground', damage: 6 })], base: { cardId: 'TST_B', damage: 4 } }),
        opponent: player(),
      },
    })
    expect(dealDamageToUnit(selfDies, 't', 1).players.player.base.damage).toBe(4) // "another" excludes itself
  })

  it('offers a Sentinel grant to another friendly unit on attack', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('t', 'ASH_127', { arena: 'ground' }), unit('f', 'GROUNDER', { arena: 'ground' })] }),
        opponent: player(),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 't', target: { kind: 'base' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayLastingBuff', keywords: [{ name: 'Sentinel' }] })
  })
})

describe('whenEnemyAttacksBase — Kachirho Militia (160) (#357)', () => {
  const board = (attackerCard: string, arena: 'ground' | 'space', militia: Parameters<typeof unit>[2] = {}) => state({
    cards: F,
    players: {
      player: player({ units: [unit('a', attackerCard, { arena })] }), // active attacker
      opponent: player({ units: [unit('k', 'ASH_160', { arena: 'ground', exhausted: true, ...militia })] }),
    },
  })

  it('readies itself when an enemy GROUND unit attacks your base', () => {
    const done = resolve(board('GROUNDER', 'ground'), { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(U(done, 'k').exhausted).toBe(false)
  })

  it('does not fire for a space attacker', () => {
    const done = resolve(board('SPACER', 'space'), { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(U(done, 'k').exhausted).toBe(true)
  })

  it('is once per round', () => {
    const first = resolve(board('GROUNDER', 'ground'), { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(U(first, 'k').exhausted).toBe(false)
    // Re-exhaust it and attack again in the same round → it stays exhausted.
    const reExhausted: GameState = {
      ...first,
      activePlayer: 'player',
      players: { ...first.players, opponent: { ...first.players.opponent, units: first.players.opponent.units.map(u => (u.instanceId === 'k' ? { ...u, exhausted: true } : u)) }, player: { ...first.players.player, units: first.players.player.units.map(u => ({ ...u, exhausted: false })) } },
    }
    const second = resolve(reExhausted, { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(U(second, 'k').exhausted).toBe(true) // already used this round
  })
})

describe('whenUpgradeAttached — Sabine Wren (208) (#357)', () => {
  const S = { ...F, ASH_208: card({ id: 'ASH_208', type: 'unit', arena: 'ground', cost: 5, power: 4, hp: 5, keywords: [{ name: 'Shielded' }] }), UPG: card({ id: 'UPG', type: 'upgrade', power: 1, hp: 1 }) }

  it('fires when she enters play with a Shield from Shielded', () => {
    const board = state({
      cards: S,
      players: {
        player: player({ hand: ['ASH_208'], resources: Array.from({ length: 10 }, () => ({ cardId: 'r', exhausted: false })), units: [unit('g', 'GROUNDER', { arena: 'ground' })] }),
        opponent: player(),
      },
    })
    const played = resolve(board, { type: 'playCard', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustUnit' })
  })

  it('fires when an upgrade card is played onto her', () => {
    const board = state({
      cards: S,
      players: {
        player: player({ hand: ['UPG'], resources: Array.from({ length: 10 }, () => ({ cardId: 'r', exhausted: false })), units: [unit('sw', 'ASH_208', { arena: 'ground' })] }),
        opponent: player(),
      },
    })
    const played = resolve(board, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'sw' })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustUnit' })
  })

  it('does not fire for an upgrade attached to a different unit', () => {
    const board = state({
      cards: S,
      players: {
        player: player({ hand: ['UPG'], resources: Array.from({ length: 10 }, () => ({ cardId: 'r', exhausted: false })), units: [unit('sw', 'ASH_208', { arena: 'ground' }), unit('g', 'GROUNDER', { arena: 'ground' })] }),
        opponent: player(),
      },
    })
    const played = resolve(board, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'g' })
    expect(played.pendingChoices ?? []).toHaveLength(0)
  })
})
