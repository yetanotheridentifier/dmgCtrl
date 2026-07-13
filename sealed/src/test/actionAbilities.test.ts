import { describe, it, expect, afterEach } from 'vitest'
import { registerCard, unregisterAbility } from '../engine/abilities'
import { drawCards } from '../engine/effects'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'

afterEach(() => {
  for (const id of ['TST_ACT']) unregisterAbility(id)
})

/** Activated "Action:" abilities (#343) — the infrastructure Improvised Identity uses. */
describe('action abilities (#343)', () => {
  function withActionCard(oncePerRound = true) {
    registerCard('TST_ACT', { actionAbilities: [{ description: 'Draw a card.', oncePerRound, effect: (s, ctx) => drawCards(s, ctx.owner, 1) }] })
    return state({
      cards: { ...CARDS, TST_ACT: card({ id: 'TST_ACT', type: 'unit', arena: 'ground' }) },
      players: { player: player({ deck: ['A', 'B'], hand: [], units: [unit('u1', 'TST_ACT')] }), opponent: player() },
    })
  }

  it('offers useAbility for a unit with an action ability', () => {
    const s = withActionCard()
    expect(legalMoves(s)).toContainEqual({ type: 'useAbility', instanceId: 'u1', cardId: 'TST_ACT', index: 0 })
  })

  it('using the ability runs its effect, marks it used, and passes the turn', () => {
    const next = resolve(withActionCard(), { type: 'useAbility', instanceId: 'u1', cardId: 'TST_ACT', index: 0 })
    expect(next.players.player.hand).toEqual(['A']) // drew a card
    expect(next.players.player.units[0].usedAbilities).toContain('TST_ACT#0')
    expect(next.activePlayer).toBe('opponent')
  })

  it('does not offer a once-per-round ability again after it is used', () => {
    const used = resolve(withActionCard(), { type: 'useAbility', instanceId: 'u1', cardId: 'TST_ACT', index: 0 })
    // Back to the same player's view: the ability is spent this round.
    const asPlayer = { ...used, activePlayer: 'player' as const }
    expect(legalMoves(asPlayer).some(a => a.type === 'useAbility')).toBe(false)
  })

  it('clears once-per-round usage at the start of the next round', () => {
    const s = state({
      cards: { ...CARDS, TST_ACT: card({ id: 'TST_ACT', type: 'unit', arena: 'ground' }) },
      phase: 'regroup',
      initiative: 'player',
      activePlayer: 'player',
      regroupResourced: { player: false, opponent: false },
      players: { player: player({ units: [unit('u1', 'TST_ACT', { usedAbilities: ['TST_ACT#0'] })] }), opponent: player() },
    })
    registerCard('TST_ACT', { actionAbilities: [{ description: 'Draw a card.', oncePerRound: true, effect: s => s }] })
    const nextRound = resolve(resolve(s, { type: 'skipResource' }), { type: 'skipResource' })
    expect(nextRound.players.player.units[0].usedAbilities ?? []).not.toContain('TST_ACT#0')
  })
})
