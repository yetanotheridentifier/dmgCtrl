import { describe, it, expect } from 'vitest'
import { legalMoves, effectiveCost } from '../engine/legalMoves'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PlayerState } from '../engine/types'

function card(partial: Partial<EngineCard> & { id: string }): EngineCard {
  return {
    name: partial.id,
    type: 'unit',
    cost: 0,
    power: 1,
    hp: 1,
    aspects: [],
    traits: [],
    keywords: [],
    unique: false,
    ...partial,
  }
}

const CARDS = {
  TST_L: card({ id: 'TST_L', type: 'leader', cost: 5, aspects: ['Command', 'Heroism'] }),
  TST_B: card({ id: 'TST_B', type: 'base', hp: 30, aspects: ['Vigilance'] }),
  TST_U1: card({ id: 'TST_U1', type: 'unit', arena: 'ground', cost: 2, aspects: ['Command'] }),
  TST_U2: card({ id: 'TST_U2', type: 'unit', arena: 'space', cost: 2, aspects: ['Heroism'] }),
  TST_U3: card({ id: 'TST_U3', type: 'unit', arena: 'ground', cost: 2, aspects: ['Aggression'] }),
  TST_U4: card({ id: 'TST_U4', type: 'unit', arena: 'ground', cost: 2, aspects: ['Command', 'Command'] }),
  TST_E1: card({ id: 'TST_E1', type: 'event', cost: 1, aspects: ['Command'] }),
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    leader: { cardId: 'TST_L', deployed: false, epicActionUsed: false, exhausted: false },
    base: { cardId: 'TST_B', damage: 0 },
    hand: [],
    deck: ['TST_U1', 'TST_U1', 'TST_U1'],
    discard: [],
    resources: [],
    units: [],
    ...overrides,
  }
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    cards: CARDS,
    players: { player: player(), opponent: player() },
    initiative: 'player',
    initiativeTakenBy: null,
    activePlayer: 'player',
    phase: 'action',
    round: 2,
    consecutivePasses: 0,
    regroupResourced: { player: false, opponent: false },
    instanceCounter: 10,
    rngSeed: 42,
    setupStage: 'resource',
    winner: null,
    ...overrides,
  }
}

function ready(n: number) {
  return Array.from({ length: n }, (_, i) => ({ cardId: `R${i}`, exhausted: false }))
}

function types(actions: Action[]): string[] {
  return actions.map(a => a.type)
}

describe('effectiveCost (aspect penalty, CR 8.1)', () => {
  it('charges printed cost when all icons are provided by leader/base', () => {
    expect(effectiveCost(state(), 'player', CARDS.TST_U1)).toBe(2)
  })

  it('adds 2 per icon not provided', () => {
    expect(effectiveCost(state(), 'player', CARDS.TST_U3)).toBe(4)
  })

  it('matches icons as a multiset — a doubled icon needs two provided copies', () => {
    // Leader provides one Command; base provides Vigilance. TST_U4 needs Command ×2 → one unmatched.
    expect(effectiveCost(state(), 'player', CARDS.TST_U4)).toBe(4)
  })

  it('charges no penalty for neutral cards', () => {
    expect(effectiveCost(state(), 'player', card({ id: 'X', cost: 3, aspects: [] }))).toBe(3)
  })
})

describe('legalMoves — action phase', () => {
  it('returns no moves when the game is over', () => {
    expect(legalMoves(state({ winner: 'player' }))).toEqual([])
  })

  it('always offers pass', () => {
    expect(types(legalMoves(state()))).toContain('pass')
  })

  it('offers takeInitiative only while available', () => {
    expect(types(legalMoves(state()))).toContain('takeInitiative')
    expect(types(legalMoves(state({ initiativeTakenBy: 'opponent' })))).not.toContain('takeInitiative')
  })

  it('offers playCard for affordable units in hand', () => {
    const s = state({
      players: {
        player: player({ hand: ['TST_U1'], resources: ready(2) }),
        opponent: player(),
      },
    })
    expect(legalMoves(s)).toContainEqual({ type: 'playCard', handIndex: 0 })
  })

  it('does not offer playCard when the effective cost is unaffordable', () => {
    const offAspect = state({
      players: {
        player: player({ hand: ['TST_U3'], resources: ready(2) }), // effective 4, only 2 ready
        opponent: player(),
      },
    })
    expect(types(legalMoves(offAspect))).not.toContain('playCard')
  })

  it('counts only ready resources towards affordability', () => {
    const s = state({
      players: {
        player: player({
          hand: ['TST_U1'],
          resources: [...ready(1), { cardId: 'RX', exhausted: true }],
        }),
        opponent: player(),
      },
    })
    expect(types(legalMoves(s))).not.toContain('playCard')
  })

  it('does not offer playCard for events or upgrades (MVP: units only)', () => {
    const s = state({
      players: {
        player: player({ hand: ['TST_E1'], resources: ready(5) }),
        opponent: player(),
      },
    })
    expect(types(legalMoves(s))).not.toContain('playCard')
  })

  it('offers attacks for ready units but not exhausted ones', () => {
    const s = state({
      players: {
        player: player({
          units: [
            { instanceId: 'u1', cardId: 'TST_U1', arena: 'ground', damage: 0, exhausted: false, isLeader: false, upgrades: [] },
            { instanceId: 'u2', cardId: 'TST_U1', arena: 'ground', damage: 0, exhausted: true, isLeader: false, upgrades: [] },
          ],
        }),
        opponent: player(),
      },
    })
    const attacks = legalMoves(s).filter(a => a.type === 'attack')
    expect(attacks).toHaveLength(1)
    expect(attacks[0]).toEqual({ type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
  })

  it('offers attack targets: enemy units in the same arena plus the base', () => {
    const s = state({
      players: {
        player: player({
          units: [{ instanceId: 'u1', cardId: 'TST_U1', arena: 'ground', damage: 0, exhausted: false, isLeader: false, upgrades: [] }],
        }),
        opponent: player({
          units: [
            { instanceId: 'e1', cardId: 'TST_U1', arena: 'ground', damage: 0, exhausted: false, isLeader: false, upgrades: [] },
            { instanceId: 'e2', cardId: 'TST_U2', arena: 'space', damage: 0, exhausted: false, isLeader: false, upgrades: [] },
          ],
        }),
      },
    })
    const attacks = legalMoves(s).filter(a => a.type === 'attack')
    expect(attacks).toContainEqual({ type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(attacks).toContainEqual({ type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
    expect(attacks).not.toContainEqual({ type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e2' } })
  })

  it('offers deployLeader when controlled resources reach the leader cost (control, not spend — CR 2.6.1)', () => {
    const mixed = [...ready(3), { cardId: 'RA', exhausted: true }, { cardId: 'RB', exhausted: true }]
    const s = state({
      players: {
        player: player({ resources: mixed }), // 5 controlled, only 3 ready
        opponent: player(),
      },
    })
    expect(types(legalMoves(s))).toContain('deployLeader')
  })

  it('does not offer deployLeader below the resource threshold or when already deployed', () => {
    expect(types(legalMoves(state({
      players: { player: player({ resources: ready(4) }), opponent: player() },
    })))).not.toContain('deployLeader')

    expect(types(legalMoves(state({
      players: {
        player: player({
          resources: ready(5),
          leader: { cardId: 'TST_L', deployed: true, epicActionUsed: true, exhausted: false },
        }),
        opponent: player(),
      },
    })))).not.toContain('deployLeader')
  })

  it('does not offer deployLeader again after the epic action was used', () => {
    const s = state({
      players: {
        player: player({
          resources: ready(5),
          leader: { cardId: 'TST_L', deployed: false, epicActionUsed: true, exhausted: false },
        }),
        opponent: player(),
      },
    })
    expect(types(legalMoves(s))).not.toContain('deployLeader')
  })
})

describe('legalMoves — regroup phase', () => {
  it('offers resourceCard per hand card plus skipResource before the player has chosen', () => {
    const s = state({
      phase: 'regroup',
      players: { player: player({ hand: ['TST_U1', 'TST_E1'] }), opponent: player() },
    })
    const moves = legalMoves(s)
    expect(moves).toContainEqual({ type: 'resourceCard', handIndex: 0 })
    expect(moves).toContainEqual({ type: 'resourceCard', handIndex: 1 })
    expect(moves).toContainEqual({ type: 'skipResource' })
    expect(types(moves)).not.toContain('pass')
  })

  it('offers only skipResource with an empty hand', () => {
    const s = state({ phase: 'regroup' })
    expect(legalMoves(s)).toEqual([{ type: 'skipResource' }])
  })

  it('returns no moves once the active player has made their regroup choice', () => {
    const s = state({ phase: 'regroup', regroupResourced: { player: true, opponent: false } })
    expect(legalMoves(s)).toEqual([])
  })
})
