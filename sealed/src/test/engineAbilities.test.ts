import { describe, it, expect, afterEach } from 'vitest'
import { registerAbility, unregisterAbility, getAbilities, runTrigger } from '../engine/abilities'
import type { GameState } from '../engine/types'
import { resolve } from '../engine/resolve'
import { player, state, ready } from './helpers/engineFixtures'

afterEach(() => {
  unregisterAbility('TST_U1')
  unregisterAbility('TST_U3')
})

describe('ability registry', () => {
  it('returns an empty list for unregistered cards (vanilla behaviour)', () => {
    expect(getAbilities('TST_U1')).toEqual([])
  })

  it('registers and retrieves ability definitions by card id', () => {
    registerAbility('TST_U1', {
      trigger: 'whenPlayed',
      description: 'Deal 1 damage to the enemy base.',
      effect: s => s,
    })
    expect(getAbilities('TST_U1')).toHaveLength(1)
    expect(getAbilities('TST_U1')[0].trigger).toBe('whenPlayed')
  })

  it('unregister removes the card entry', () => {
    registerAbility('TST_U1', { trigger: 'whenPlayed', description: 'x', effect: s => s })
    unregisterAbility('TST_U1')
    expect(getAbilities('TST_U1')).toEqual([])
  })
})

describe('runTrigger', () => {
  it('returns the same state reference when nothing is registered', () => {
    const s = state()
    expect(runTrigger(s, 'whenPlayed', { owner: 'player', cardId: 'TST_U1' })).toBe(s)
  })

  it('applies the matching effect with its context', () => {
    registerAbility('TST_U1', {
      trigger: 'whenPlayed',
      description: 'Deal 2 damage to the enemy base.',
      effect: (s, ctx) => {
        const enemy = ctx.owner === 'player' ? 'opponent' : 'player'
        const base = s.players[enemy].base
        return {
          ...s,
          players: { ...s.players, [enemy]: { ...s.players[enemy], base: { ...base, damage: base.damage + 2 } } },
        }
      },
    })
    const next = runTrigger(state(), 'whenPlayed', { owner: 'player', cardId: 'TST_U1' })
    expect(next.players.opponent.base.damage).toBe(2)
  })

  it('does not fire effects registered for other trigger points', () => {
    registerAbility('TST_U1', { trigger: 'whenDefeated', description: 'x', effect: () => { throw new Error('should not run') } })
    const s = state()
    expect(runTrigger(s, 'whenPlayed', { owner: 'player', cardId: 'TST_U1' })).toBe(s)
  })
})

describe('resolve integration — whenPlayed fires on playCard', () => {
  function playableState(): GameState {
    return state({
      players: {
        player: player({ hand: ['TST_U1'], resources: ready(4) }),
        opponent: player(),
      },
    })
  }

  it('fires the whenPlayed ability after the unit enters play', () => {
    registerAbility('TST_U1', {
      trigger: 'whenPlayed',
      description: 'Deal 3 damage to the enemy base.',
      effect: (s, ctx) => {
        const enemy = ctx.owner === 'player' ? 'opponent' : 'player'
        const base = s.players[enemy].base
        return {
          ...s,
          players: { ...s.players, [enemy]: { ...s.players[enemy], base: { ...base, damage: base.damage + 3 } } },
        }
      },
    })

    const next = resolve(playableState(), { type: 'playCard', handIndex: 0 })

    expect(next.players.opponent.base.damage).toBe(3)
    expect(next.players.player.units).toHaveLength(1) // unit still entered play
  })

  it('passes the new unit instance id in the trigger context', () => {
    let seenInstanceId: string | undefined
    registerAbility('TST_U1', {
      trigger: 'whenPlayed',
      description: 'observe',
      effect: (s, ctx) => {
        seenInstanceId = ctx.sourceInstanceId
        return s
      },
    })

    const next = resolve(playableState(), { type: 'playCard', handIndex: 0 })

    expect(seenInstanceId).toBe(next.players.player.units[0].instanceId)
  })

  it('checks the win condition after whenPlayed damage', () => {
    registerAbility('TST_U1', {
      trigger: 'whenPlayed',
      description: 'Deal 30 damage to the enemy base.',
      effect: (s, ctx) => {
        const enemy = ctx.owner === 'player' ? 'opponent' : 'player'
        const base = s.players[enemy].base
        return {
          ...s,
          players: { ...s.players, [enemy]: { ...s.players[enemy], base: { ...base, damage: base.damage + 30 } } },
        }
      },
    })

    const next = resolve(playableState(), { type: 'playCard', handIndex: 0 })

    expect(next.winner).toBe('player')
  })

  it('leaves unregistered cards exactly as before (vanilla)', () => {
    const next = resolve(playableState(), { type: 'playCard', handIndex: 0 })
    expect(next.players.opponent.base.damage).toBe(0)
    expect(next.players.player.units).toHaveLength(1)
  })
})
