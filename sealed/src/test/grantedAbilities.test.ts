import { describe, it, expect, afterEach } from 'vitest'
import { registerCard, unregisterAbility } from '../engine/abilities'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { effectiveHp } from '../engine/stats'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import { addLastingEffect } from '../engine/types'
import type { GameState } from '../engine/types'

/**
 * A granted ability block reaches its unit by three routes: an attached upgrade (`abilityCardIds`), an
 * aura in play (`grantsAbilities`) and a lasting effect (`LastingEffect.abilityCardIds`). Triggered
 * abilities have always been collected from all three. An "Action:" ability must be too: a unit that
 * gains one from an aura (Satine Kryze) or for a phase has to be offered it as a move.
 */

const GRANTER = 'TST_GRANTER'
const GRANTED_ACTION = 'TST_GRANTED_ACTION'
const cards = {
  ...CARDS,
  [GRANTER]: card({ id: GRANTER, type: 'unit', arena: 'ground' }),
  TST_OTHER: card({ id: 'TST_OTHER', type: 'unit', arena: 'ground', hp: 4 }),
}
const board = (over: Partial<GameState> = {}) => state({
  cards,
  players: {
    player: player({ units: [unit('g', GRANTER), unit('o', 'TST_OTHER')] }),
    opponent: player({ units: [unit('e', 'TST_OTHER')] }),
  },
  ...over,
})
const actionMoves = (s: GameState) => legalMoves(s).filter(m => m.type === 'useAbility')

afterEach(() => {
  unregisterAbility(GRANTER)
  unregisterAbility(GRANTED_ACTION)
})

describe('granted Action abilities', () => {
  it('offers an Action a unit gains from an aura, and runs it for that unit', () => {
    registerCard(GRANTED_ACTION, { actionAbilities: [{ description: 'exhaust: +1 damage on itself', exhaustCost: true, effect: (s, ctx) => ({ ...s, players: { ...s.players, [ctx.owner]: { ...s.players[ctx.owner], units: s.players[ctx.owner].units.map(x => (x.instanceId === ctx.sourceInstanceId ? { ...x, damage: x.damage + 1 } : x)) } } }) }] })
    registerCard(GRANTER, { grantsAbilities: (_s, source, target, friendly) => (friendly && target.instanceId !== source.instanceId ? [GRANTED_ACTION] : []) })
    const s = board()
    expect(actionMoves(s)).toEqual([{ type: 'useAbility', instanceId: 'o', cardId: GRANTED_ACTION, index: 0 }])
    const used = resolve(s, actionMoves(s)[0])
    expect(used.players.player.units.find(x => x.instanceId === 'o')).toMatchObject({ exhausted: true, damage: 1 })
  })

  it('stops offering it once the aura\'s source has left play', () => {
    registerCard(GRANTED_ACTION, { actionAbilities: [{ description: 'noop', effect: s => s }] })
    registerCard(GRANTER, { grantsAbilities: () => [GRANTED_ACTION] })
    const s = board()
    const gone = { ...s, players: { ...s.players, player: { ...s.players.player, units: s.players.player.units.filter(x => x.instanceId !== 'g') } } }
    expect(actionMoves(gone)).toEqual([])
  })

  it('offers an Action a unit gains for the phase from a lasting effect', () => {
    registerCard(GRANTED_ACTION, { actionAbilities: [{ description: 'noop', effect: s => s }] })
    const s = addLastingEffect(board(), { targetInstanceId: 'o', abilityCardIds: [GRANTED_ACTION] })
    expect(actionMoves(s)).toEqual([{ type: 'useAbility', instanceId: 'o', cardId: GRANTED_ACTION, index: 0 }])
  })
})

describe('a printed HP set for the phase', () => {
  it('replaces the unit\'s printed HP while the lasting effect lasts', () => {
    const s = addLastingEffect(board(), { targetInstanceId: 'e', printedHp: 1 })
    expect(effectiveHp(s, s.players.opponent.units[0])).toBe(1)
  })
})
