import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { registerCard } from '../engine/abilities'
import { hasForceToken, createForceToken, defeatForceToken } from '../engine/effects'
import { state, player, unit, ready, card, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice } from '../engine/types'
import type { Action } from '../engine/actions'

const F: Record<string, EngineCard> = {
  ...CARDS,
  TST_FORCE_MAYPAY: card({ id: 'TST_FORCE_MAYPAY', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  TST_FORCE_ACTION: card({ id: 'TST_FORCE_ACTION', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  TST_FORCE_LEADER: card({ id: 'TST_FORCE_LEADER', type: 'leader', cost: 5, power: 4, hp: 7 }),
}

/**
 * The Force token (LOF's set mechanic, #462; CR 8.37): unlike Credit, a player holds AT MOST ONE.
 * "The Force is with you" creates it (a no-op while already held); "Use the Force" is always an
 * OPTIONAL defeat of it (CR 8.37.4), even where a card's own printed text omits "may", and is never
 * offered without one held. Two cost surfaces extend existing machinery: `mayPayThen.useForce` (a
 * card's own optional "you may use the Force. If you do, <effect>") and `useForceCost` on an
 * `ActionAbilityDef`/`LeaderActionAbilityDef` ("Action [Exhaust, use the Force]:").
 */

describe('Force token primitives', () => {
  it('creates the token, read by hasForceToken', () => {
    const s = createForceToken(state({ players: { player: player(), opponent: player() } }), 'player')
    expect(hasForceToken(s, 'player')).toBe(true)
    expect(hasForceToken(s, 'opponent')).toBe(false)
  })

  it('is a no-op while already held (capped at one, unlike Credit\'s count)', () => {
    const held = createForceToken(state({ players: { player: player(), opponent: player() } }), 'player')
    const again = createForceToken(held, 'player')
    expect(again).toBe(held)
  })

  it('records tokensCreated', () => {
    const s = createForceToken(state({ players: { player: player(), opponent: player() } }), 'player')
    expect(s.phaseEvents?.tokensCreated).toContain('player')
  })

  it('defeats the held token', () => {
    const held = createForceToken(state({ players: { player: player(), opponent: player() } }), 'player')
    expect(hasForceToken(defeatForceToken(held, 'player'), 'player')).toBe(false)
  })

  it('defeating with none held is a no-op, not a crash', () => {
    const s = state({ players: { player: player(), opponent: player() } })
    expect(defeatForceToken(s, 'player')).toBe(s)
  })
})

describe('mayPayThen.useForce: a card\'s own optional "use the Force" cost', () => {
  registerCard('TST_FORCE_MAYPAY', {
    abilities: [{
      trigger: 'whenPlayed',
      description: 'You may use the Force. If you do, draw a card (test).',
      effect: (s, ctx) => (hasForceToken(s, ctx.owner)
        ? { ...s, pendingChoices: [...(s.pendingChoices ?? []), { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, useForce: true, text: 'draw a card', then: { owner: ctx.owner, cardId: ctx.cardId, sourceInstanceId: ctx.sourceInstanceId } }] }
        : s),
    }],
    ifYouDo: (s, ctx) => ({ ...s, players: { ...s.players, [ctx.owner]: { ...s.players[ctx.owner], hand: [...s.players[ctx.owner].hand, 'DRAWN'] } } }),
  })

  const board = (held: boolean): GameState => {
    let s = state({
      cards: F,
      players: {
        player: player({ resources: ready(4), hand: ['TST_FORCE_MAYPAY'] }),
        opponent: player(),
      },
    })
    if (held) s = createForceToken(s, 'player')
    return s
  }

  const choice = (s: GameState): PendingChoice => {
    const c = s.pendingChoices?.[0]
    if (!c) throw new Error('no pending choice')
    return c
  }

  it('is never offered without a held token: playing the card raises no choice at all', () => {
    const s = resolve(board(false), { type: 'playUnit', handIndex: 0 })
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })

  it('raises the choice only while the token is held', () => {
    const s = resolve(board(true), { type: 'playUnit', handIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', useForce: true })
  })

  it('accepting is always offered as a legal move (never mandatory), and it defeats the token and runs the effect', () => {
    const s = resolve(board(true), { type: 'playUnit', handIndex: 0 })
    const moves = legalMoves(s).filter(m => m.type === 'acceptChoice' || m.type === 'skipTrigger') as Action[]
    expect(moves).toContainEqual({ type: 'acceptChoice', choiceId: choice(s).id })
    expect(moves).toContainEqual({ type: 'skipTrigger', choiceId: choice(s).id })
    const accepted = resolve(s, { type: 'acceptChoice', choiceId: choice(s).id })
    expect(hasForceToken(accepted, 'player')).toBe(false)
    expect(accepted.players.player.hand).toContain('DRAWN')
  })

  it('skipping leaves the token held and runs nothing', () => {
    const s = resolve(board(true), { type: 'playUnit', handIndex: 0 })
    const skipped = resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
    expect(hasForceToken(skipped, 'player')).toBe(true)
    expect(skipped.players.player.hand).not.toContain('DRAWN')
  })
})

describe('useForceCost: a mandatory "Action [Exhaust, use the Force]:" cost', () => {
  registerCard('TST_FORCE_ACTION', {
    actionAbilities: [{
      description: 'Draw a card (test).',
      exhaustCost: true,
      useForceCost: true,
      effect: (s, ctx) => ({ ...s, players: { ...s.players, [ctx.owner]: { ...s.players[ctx.owner], hand: [...s.players[ctx.owner].hand, 'DRAWN'] } } }),
    }],
  })

  const board = (held: boolean): GameState => {
    let s = state({
      cards: F,
      players: {
        player: player({ resources: ready(4), units: [unit('u1', 'TST_FORCE_ACTION')] }),
        opponent: player(),
      },
    })
    if (held) s = createForceToken(s, 'player')
    return s
  }

  it('is not a legal move without a held token', () => {
    const s = board(false)
    expect(legalMoves(s)).not.toContainEqual({ type: 'useAbility', instanceId: 'u1', cardId: 'TST_FORCE_ACTION', index: 0 })
  })

  it('is legal while the token is held, and using it defeats the token and exhausts the unit', () => {
    const s = board(true)
    expect(legalMoves(s)).toContainEqual({ type: 'useAbility', instanceId: 'u1', cardId: 'TST_FORCE_ACTION', index: 0 })
    const after = resolve(s, { type: 'useAbility', instanceId: 'u1', cardId: 'TST_FORCE_ACTION', index: 0 })
    expect(hasForceToken(after, 'player')).toBe(false)
    expect(after.players.player.units[0].exhausted).toBe(true)
    expect(after.players.player.hand).toContain('DRAWN')
  })

  it('is not offered again the same turn once the token is spent', () => {
    let s = board(true)
    s = resolve(s, { type: 'useAbility', instanceId: 'u1', cardId: 'TST_FORCE_ACTION', index: 0 })
    // Ready the unit back up (as if a new phase) but the token stays spent.
    s = { ...s, players: { ...s.players, player: { ...s.players.player, units: [{ ...s.players.player.units[0], exhausted: false }] } } }
    expect(legalMoves(s)).not.toContainEqual({ type: 'useAbility', instanceId: 'u1', cardId: 'TST_FORCE_ACTION', index: 0 })
  })
})

describe('useForceCost on a leader action ability', () => {
  registerCard('TST_FORCE_LEADER', {
    leaderAbilities: {
      actions: [{
        description: 'Draw a card (test).',
        useForceCost: true,
        effect: (s, ctx) => ({ ...s, players: { ...s.players, [ctx.owner]: { ...s.players[ctx.owner], hand: [...s.players[ctx.owner].hand, 'DRAWN'] } } }),
      }],
    },
  })

  const board = (held: boolean): GameState => {
    let s = state({
      cards: F,
      players: {
        player: player({ leader: { cardId: 'TST_FORCE_LEADER', deployed: false, epicActionUsed: false, exhausted: false }, resources: ready(4) }),
        opponent: player(),
      },
    })
    if (held) s = createForceToken(s, 'player')
    return s
  }

  it('is not a legal move without a held token', () => {
    expect(legalMoves(board(false))).not.toContainEqual({ type: 'useLeaderAbility', index: 0 })
  })

  it('is legal while held, and using it defeats the token', () => {
    const s = board(true)
    expect(legalMoves(s)).toContainEqual({ type: 'useLeaderAbility', index: 0 })
    const after = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(hasForceToken(after, 'player')).toBe(false)
    expect(after.players.player.hand).toContain('DRAWN')
  })
})
