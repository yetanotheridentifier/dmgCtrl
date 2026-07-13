import { describe, it, expect } from 'vitest'
import { searchCount } from '../engine/effects'
import '../engine/cardDefinitions' // registers ASH_084's searchModifier
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'

/** Deck-search sizing + Arcana Star Map's ×2 modifier (#343). */
describe('searchCount (#343)', () => {
  it('is the base count with no modifier', () => {
    const s = state({ players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    expect(searchCount(s, s.players.player.units[0], 3)).toBe(3)
  })

  it('Arcana Star Map (ASH_084) doubles the searching unit’s count', () => {
    const s = state({
      cards: { ...CARDS, ASH_084: card({ id: 'ASH_084', type: 'upgrade', power: 0, hp: 0 }) },
      players: { player: player({ units: [unit('u1', 'TST_U1', { upgrades: [{ cardId: 'ASH_084', owner: 'player' }] })] }), opponent: player() },
    })
    expect(searchCount(s, s.players.player.units[0], 3)).toBe(6)
  })
})
