import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { CARDS, player, state, unit, ready } from './helpers/engineFixtures'

describe('resolve — playUnit', () => {
  const base = () =>
    state({
      players: {
        player: player({ hand: ['TST_U1', 'TST_E1'], resources: ready(4) }),
        opponent: player(),
      },
    })

  it('puts the unit into its arena exhausted and removes it from hand', () => {
    const next = resolve(base(), { type: 'playUnit', handIndex: 0 })
    const p = next.players.player
    expect(p.hand).toEqual(['TST_E1'])
    expect(p.units).toHaveLength(1)
    expect(p.units[0]).toMatchObject({ cardId: 'TST_U1', arena: 'ground', exhausted: true, damage: 0, isLeader: false })
  })

  it('pays the effective cost by exhausting resources', () => {
    const next = resolve(base(), { type: 'playUnit', handIndex: 0 })
    expect(next.players.player.resources.filter(r => r.exhausted)).toHaveLength(2)
  })

  it('assigns a fresh instance id from the counter', () => {
    const s = base()
    const next = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(next.players.player.units[0].instanceId).toBe('u10')
    expect(next.instanceCounter).toBe(11)
  })

  it('passes the turn to the opponent and resets the pass chain', () => {
    const s = { ...base(), consecutivePasses: 1 }
    const next = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(next.activePlayer).toBe('opponent')
    expect(next.consecutivePasses).toBe(0)
  })

  it('does not mutate the input state', () => {
    const s = base()
    resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(s.players.player.hand).toHaveLength(2)
    expect(s.players.player.units).toHaveLength(0)
  })
})

describe('resolve — deployLeader', () => {
  const base = () =>
    state({
      players: {
        player: player({ resources: ready(5) }),
        opponent: player(),
      },
    })

  it('deploys the leader as a ready ground unit without spending resources', () => {
    const next = resolve(base(), { type: 'deployLeader' })
    const p = next.players.player
    expect(p.leader.deployed).toBe(true)
    expect(p.leader.epicActionUsed).toBe(true)
    expect(p.units).toHaveLength(1)
    expect(p.units[0]).toMatchObject({ cardId: 'TST_L', arena: 'ground', exhausted: false, isLeader: true })
    expect(p.resources.every(r => !r.exhausted)).toBe(true)
  })

  it('advances the turn', () => {
    expect(resolve(base(), { type: 'deployLeader' }).activePlayer).toBe('opponent')
  })
})

describe('resolve — pass and phase end', () => {
  it('a single pass hands the turn over', () => {
    const next = resolve(state(), { type: 'pass' })
    expect(next.activePlayer).toBe('opponent')
    expect(next.consecutivePasses).toBe(1)
    expect(next.phase).toBe('action')
  })

  it('two consecutive passes end the action phase into regroup', () => {
    const afterOne = resolve(state(), { type: 'pass' })
    const afterTwo = resolve(afterOne, { type: 'pass' })
    expect(afterTwo.phase).toBe('regroup')
  })

  it('entering regroup draws 2 cards per player and hands the choice to the initiative holder', () => {
    const s = state({
      initiative: 'opponent',
      activePlayer: 'opponent',
      players: {
        player: player({ deck: ['TST_U1', 'TST_U2', 'TST_U3'] }),
        opponent: player({ deck: ['TST_U4', 'TST_E1', 'TST_U1'] }),
      },
    })
    const afterOne = resolve(s, { type: 'pass' })
    const regroup = resolve(afterOne, { type: 'pass' })
    expect(regroup.phase).toBe('regroup')
    expect(regroup.players.player.hand).toEqual(['TST_U1', 'TST_U2'])
    expect(regroup.players.player.deck).toEqual(['TST_U3'])
    expect(regroup.players.opponent.hand).toEqual(['TST_U4', 'TST_E1'])
    expect(regroup.activePlayer).toBe('opponent')
    expect(regroup.regroupResourced).toEqual({ player: false, opponent: false })
  })

  it('an action between passes breaks the consecutive chain', () => {
    const s = state({
      players: {
        player: player(),
        opponent: player({ hand: ['TST_U2'], resources: ready(2) }),
      },
    })
    const afterPass = resolve(s, { type: 'pass' })
    const afterPlay = resolve(afterPass, { type: 'playUnit', handIndex: 0 })
    expect(afterPlay.consecutivePasses).toBe(0)
    expect(afterPlay.phase).toBe('action')
  })
})

describe('resolve — takeInitiative', () => {
  it('claims the initiative counter and hands the turn over', () => {
    const s = state({ initiative: 'opponent' })
    const next = resolve(s, { type: 'takeInitiative' })
    expect(next.initiative).toBe('player')
    expect(next.initiativeTakenBy).toBe('player')
    expect(next.activePlayer).toBe('opponent')
    expect(next.phase).toBe('action')
  })

  it('the taker auto-passes for the rest of the phase — turn bounces back to the opponent', () => {
    const s = state({
      players: {
        player: player(),
        opponent: player({ hand: ['TST_U2'], resources: ready(2) }),
      },
    })
    const taken = resolve(s, { type: 'takeInitiative' })
    expect(taken.activePlayer).toBe('opponent')
    const afterPlay = resolve(taken, { type: 'playUnit', handIndex: 0 })
    // player (the taker) auto-passed; turn returns to opponent
    expect(afterPlay.activePlayer).toBe('opponent')
    expect(afterPlay.phase).toBe('action')
  })

  it('opponent passing after the taker auto-pass ends the phase', () => {
    const taken = resolve(state(), { type: 'takeInitiative' })
    const done = resolve(taken, { type: 'pass' })
    expect(done.phase).toBe('regroup')
  })

  it('taking the initiative immediately after a pass ends the action phase', () => {
    const afterPass = resolve(state(), { type: 'pass' })
    expect(afterPass.activePlayer).toBe('opponent')
    const taken = resolve(afterPass, { type: 'takeInitiative' })
    expect(taken.phase).toBe('regroup')
    expect(taken.initiative).toBe('opponent')
    expect(taken.initiativeTakenBy).toBe('opponent')
  })
})

describe('resolve — attack', () => {
  it('unit vs unit deals simultaneous combat damage and exhausts the attacker', () => {
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U1')] }), // 3/4
        opponent: player({ units: [unit('d1', 'TST_U4')] }), // 1/9
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'd1' } })
    expect(next.players.player.units[0]).toMatchObject({ exhausted: true, damage: 1 })
    expect(next.players.opponent.units[0]).toMatchObject({ damage: 3 })
  })

  it('defeats a unit whose damage reaches its HP and discards it', () => {
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U1')] }), // 3/4
        opponent: player({ units: [unit('d1', 'TST_U2', { arena: 'ground' })] }), // 2/2
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'd1' } })
    expect(next.players.opponent.units).toHaveLength(0)
    expect(next.players.opponent.discard).toContain('TST_U2')
    expect(next.players.player.units).toHaveLength(1) // survived with 2 damage
    expect(next.players.player.units[0].damage).toBe(2)
  })

  it('both units can trade — attacker defeated by counter-damage', () => {
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U3')] }), // 5/1
        opponent: player({ units: [unit('d1', 'TST_U1')] }), // 3/4
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'd1' } })
    expect(next.players.player.units).toHaveLength(0)
    expect(next.players.player.discard).toContain('TST_U3')
    expect(next.players.opponent.units).toHaveLength(0)
    expect(next.players.opponent.discard).toContain('TST_U1')
  })

  it('attacking the base deals attacker power to it, with no counter-damage', () => {
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U1')] }),
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(next.players.opponent.base.damage).toBe(3)
    expect(next.players.player.units[0]).toMatchObject({ exhausted: true, damage: 0 })
    expect(next.winner).toBeNull()
  })

  it('lethal base damage wins the game for the attacker', () => {
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U1')] }),
        opponent: player({ base: { cardId: 'TST_B', damage: 28 } }),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(next.players.opponent.base.damage).toBe(31)
    expect(next.winner).toBe('player')
  })

  it('is a draw when both bases are defeated by the same action', () => {
    // The attacker's own base is already at lethal damage; the attack pushes the
    // defender's base to lethal too, so both are defeated at once → draw.
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U3')], base: { cardId: 'TST_B', damage: 30 } }), // 5 power; own base already lethal
        opponent: player({ base: { cardId: 'TST_B', damage: 29 } }), // +5 → 34 ≥ 30
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(next.winner).toBe('draw')
  })
})

describe('resolve — regroup choices', () => {
  const regroupState = () =>
    state({
      phase: 'regroup',
      activePlayer: 'player',
      players: {
        player: player({
          hand: ['TST_U1', 'TST_E1'],
          resources: [{ cardId: 'R0', exhausted: true }],
          units: [unit('a1', 'TST_U1', { exhausted: true, damage: 2 })],
        }),
        opponent: player({ hand: ['TST_U2'] }),
      },
    })

  it('resourceCard moves the card facedown-exhausted into resources and hands the choice over', () => {
    const next = resolve(regroupState(), { type: 'resourceCard', handIndex: 1 })
    const p = next.players.player
    expect(p.hand).toEqual(['TST_U1'])
    expect(p.resources).toHaveLength(2)
    expect(p.resources[1]).toEqual({ cardId: 'TST_E1', exhausted: true })
    expect(next.regroupResourced.player).toBe(true)
    expect(next.activePlayer).toBe('opponent')
    expect(next.phase).toBe('regroup')
  })

  it('after both players choose, everything readies and the next round begins', () => {
    const afterPlayer = resolve(regroupState(), { type: 'resourceCard', handIndex: 0 })
    const nextRound = resolve(afterPlayer, { type: 'skipResource' })

    expect(nextRound.phase).toBe('action')
    expect(nextRound.round).toBe(3)
    expect(nextRound.consecutivePasses).toBe(0)
    expect(nextRound.initiativeTakenBy).toBeNull()
    expect(nextRound.regroupResourced).toEqual({ player: false, opponent: false })
    // initiative holder starts the new round
    expect(nextRound.activePlayer).toBe('player')
    // all exhausted cards ready — including the just-resourced card and damaged unit
    const p = nextRound.players.player
    expect(p.resources.every(r => !r.exhausted)).toBe(true)
    expect(p.units[0].exhausted).toBe(false)
    expect(p.units[0].damage).toBe(2) // damage persists (CR 1.9.5)
  })

  it('empty-deck regroup draw deals 3 damage to the base per missed card', () => {
    const s = state({
      players: {
        player: player({ deck: ['TST_U1'] }), // draws 1 of 2 → 3 damage
        opponent: player({ deck: [] }), // draws 0 of 2 → 6 damage
      },
    })
    const afterOne = resolve(s, { type: 'pass' })
    const regroup = resolve(afterOne, { type: 'pass' })
    expect(regroup.players.player.base.damage).toBe(3)
    expect(regroup.players.player.hand).toEqual(['TST_U1'])
    expect(regroup.players.opponent.base.damage).toBe(6)
  })
})

describe('resolve — invariants', () => {
  it('throws for a phase-inappropriate action', () => {
    expect(() => resolve(state(), { type: 'skipResource' })).toThrow(/phase/i)
    expect(() => resolve(state({ phase: 'regroup' }), { type: 'pass' })).toThrow(/phase/i)
  })

  it('throws when attacking with a missing unit', () => {
    expect(() => resolve(state(), { type: 'attack', attackerId: 'ghost', target: { kind: 'base' } })).toThrow(/unit/i)
  })

  it('throws when the game is already over', () => {
    expect(() => resolve(state({ winner: 'player' }), { type: 'pass' })).toThrow(/over/i)
  })

  it('shares the card db by reference across states', () => {
    const s = state()
    const next = resolve(s, { type: 'pass' })
    expect(next.cards).toBe(CARDS)
    expect(next.cards).toBe(s.cards)
  })
})
