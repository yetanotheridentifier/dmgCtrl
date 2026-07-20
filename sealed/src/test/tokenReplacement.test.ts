import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { createTokenUnits } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * Token-creation replacement (Moff Jerjerrod): "if you would create N tokens, you may defeat
 * this unit to create 2N instead". Implemented as the equivalent **N, then optionally N more** so no
 * mid-effect interrupt is needed — see `createTokenUnits`.
 */
const F = {
  ...CARDS,
  ASH_094: card({ id: 'ASH_094', type: 'unit', arena: 'ground', power: 1, hp: 3 }), // Moff Jerjerrod
  ASH_111: card({ id: 'ASH_111', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 3 }), // Children of the Watch (creates 2)
}
const mandos = (s: GameState) => s.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN).length
const board = (units: ReturnType<typeof unit>[] = [], over: Parameters<typeof player>[0] = {}) =>
  state({ cards: F, players: { player: player({ units, ...over }), opponent: player() } })

describe('Moff Jerjerrod (094) — may double a batch of created tokens', () => {
  it('offers the doubling after a batch, and accepting defeats him for N more', () => {
    const s = createTokenUnits(board([unit('j', 'ASH_094', { arena: 'ground' })]), 'player', TOKEN_MANDALORIAN, 2)
    expect(mandos(s)).toBe(2) // the batch is made first
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayDoubleTokens', count: 2 })

    const done = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id })
    expect(mandos(done)).toBe(4) // 2 + 2 = "twice that number"
    expect(done.players.player.units.some(u => u.instanceId === 'j')).toBe(false) // Jerjerrod defeated
  })

  it('declining keeps him and leaves the batch at N', () => {
    const s = createTokenUnits(board([unit('j', 'ASH_094', { arena: 'ground' })]), 'player', TOKEN_MANDALORIAN, 2)
    const done = resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id })
    expect(mandos(done)).toBe(2)
    expect(done.players.player.units.some(u => u.instanceId === 'j')).toBe(true)
  })

  it('no offer at all when he is not in play', () => {
    const s = createTokenUnits(board(), 'player', TOKEN_MANDALORIAN, 2)
    expect(mandos(s)).toBe(2)
    expect(s.pendingChoices ?? []).toHaveLength(0)
  })

  it('doubles a real card’s batch — Children of the Watch (2 → 4)', () => {
    const s = board([unit('j', 'ASH_094', { arena: 'ground' })], { hand: ['ASH_111'], resources: ready(10) })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    expect(mandos(played)).toBe(2)
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayDoubleTokens', count: 2 })
    expect(mandos(resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id }))).toBe(4)
  })
})
