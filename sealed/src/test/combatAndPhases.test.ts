import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { player, state, unit, ready } from './helpers/engineFixtures'

describe('T2.6 — win conditions', () => {
  it('lethal empty-deck damage during regroup ends the game immediately', () => {
    const s = state({
      players: {
        player: player({ deck: [], base: { cardId: 'TST_B', damage: 25 } }), // 25 + 6 ≥ 30
        opponent: player(),
      },
    })
    const regroup = resolve(resolve(s, { type: 'pass' }), { type: 'pass' })
    expect(regroup.winner).toBe('opponent')
    expect(legalMoves(regroup)).toEqual([])
  })

  it('no moves are offered once a winner is set', () => {
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U1')] }),
        opponent: player({ base: { cardId: 'TST_B', damage: 29 } }),
      },
    })
    const won = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(won.winner).toBe('player')
    expect(legalMoves(won)).toEqual([])
  })
})

describe('T3.2 — unit combat details', () => {
  it('an exhausted enemy unit is still a legal attack target and strikes back', () => {
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U1')] }), // 3/4
        opponent: player({ units: [unit('d1', 'TST_U1', { exhausted: true })] }),
      },
    })
    expect(legalMoves(s)).toContainEqual({
      type: 'attack',
      attackerId: 'a1',
      target: { kind: 'unit', instanceId: 'd1' },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'd1' } })
    // simultaneous combat damage applies both ways regardless of exhaustion
    expect(next.players.player.units[0].damage).toBe(3)
    expect(next.players.opponent.units[0].damage).toBe(3)
  })

  it('damage accumulates across attacks until HP is reached (CR 1.9.5)', () => {
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U2', { arena: 'space' }), unit('a2', 'TST_U2', { arena: 'space' })] }), // 2/2 each
        opponent: player({ units: [unit('d1', 'TST_U4', { arena: 'space' })] }), // 1/9
      },
    })
    const first = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'd1' } })
    expect(first.players.opponent.units[0].damage).toBe(2)
    const second = resolve(
      { ...first, activePlayer: 'player' },
      { type: 'attack', attackerId: 'a2', target: { kind: 'unit', instanceId: 'd1' } },
    )
    expect(second.players.opponent.units[0].damage).toBe(4)
  })

  it('space units fight in the space arena', () => {
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U2')] }),
        opponent: player({ units: [unit('d1', 'TST_U2')] }),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'd1' } })
    // 2/2 vs 2/2 → mutual destruction
    expect(next.players.player.units).toHaveLength(0)
    expect(next.players.opponent.units).toHaveLength(0)
  })
})

describe('T3.3 — base attacks', () => {
  it('space units can attack the base directly', () => {
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U2')] }), // space 2/2
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(next.players.opponent.base.damage).toBe(2)
  })
})

describe('T3.4 — leader lifecycle', () => {
  it('a deployed leader can attack in the same round (deploys ready)', () => {
    const s = state({
      players: { player: player({ resources: ready(5) }), opponent: player() },
    })
    const deployed = resolve(s, { type: 'deployLeader' })
    const backToPlayer = { ...deployed, activePlayer: 'player' as const }
    const leaderUnit = backToPlayer.players.player.units[0]
    expect(legalMoves(backToPlayer)).toContainEqual({
      type: 'attack',
      attackerId: leaderUnit.instanceId,
      target: { kind: 'base' },
    })
  })

  it('a defeated leader returns to the base zone exhausted and cannot redeploy', () => {
    const s = state({
      players: {
        player: player({ units: [unit('a1', 'TST_U3')] }), // 5/1 attacker
        opponent: player({
          leader: { cardId: 'TST_L', deployed: true, epicActionUsed: true, exhausted: false },
          units: [unit('L1', 'TST_L', { isLeader: true, damage: 3 })], // 4/7 leader with 3 damage
          resources: ready(6),
        }),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'L1' } })

    // Leader took 5 damage → 8 ≥ 7 HP → defeated
    expect(next.players.opponent.units).toHaveLength(0)
    expect(next.players.opponent.discard).not.toContain('TST_L') // not discarded
    expect(next.players.opponent.leader).toEqual({
      cardId: 'TST_L',
      deployed: false,
      epicActionUsed: true,
      exhausted: true,
    })

    // No redeploy offered despite ample resources
    const oppTurn = { ...next, activePlayer: 'opponent' as const }
    expect(legalMoves(oppTurn).map(a => a.type)).not.toContain('deployLeader')
  })
})

describe('T3.1/T3.5 — full round cycle', () => {
  it('plays a complete round: actions → regroup → next round with everything ready', () => {
    let s = state({
      round: 1,
      players: {
        player: player({ hand: ['TST_U1'], resources: ready(2), deck: ['TST_U2', 'TST_U3', 'TST_E1'] }),
        opponent: player({ deck: ['TST_U1', 'TST_U4'] }),
      },
    })

    s = resolve(s, { type: 'playCard', handIndex: 0 }) // player plays a unit (enters exhausted)
    s = resolve(s, { type: 'pass' }) // opponent passes
    s = resolve(s, { type: 'pass' }) // player passes → consecutive → regroup

    expect(s.phase).toBe('regroup')
    expect(s.players.player.hand).toEqual(['TST_U2', 'TST_U3']) // drew 2
    expect(s.activePlayer).toBe('player') // initiative holder chooses first

    s = resolve(s, { type: 'resourceCard', handIndex: 0 })
    s = resolve(s, { type: 'skipResource' })

    expect(s.phase).toBe('action')
    expect(s.round).toBe(2)
    const p = s.players.player
    expect(p.resources).toHaveLength(3)
    expect(p.resources.every(r => !r.exhausted)).toBe(true) // paid + new resource all readied
    expect(p.units[0].exhausted).toBe(false) // played unit readied for round 2
    expect(s.activePlayer).toBe('player')
  })

  it('initiative taken in round N makes that player first in round N+1', () => {
    let s = state({ initiative: 'player', activePlayer: 'player' })
    s = resolve(s, { type: 'pass' }) // player passes
    s = resolve(s, { type: 'takeInitiative' }) // opponent takes initiative → phase ends
    expect(s.phase).toBe('regroup')
    expect(s.initiative).toBe('opponent')
    expect(s.activePlayer).toBe('opponent') // regroup choice order follows initiative

    s = resolve(s, { type: 'skipResource' })
    s = resolve(s, { type: 'skipResource' })
    expect(s.round).toBe(3)
    expect(s.activePlayer).toBe('opponent') // new round starts with initiative holder
    expect(s.initiativeTakenBy).toBeNull() // available again
  })
})
