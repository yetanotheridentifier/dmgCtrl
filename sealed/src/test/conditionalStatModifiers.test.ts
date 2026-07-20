import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectivePower } from '../engine/stats'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * Conditional stat modifiers (#357): combat-role ("+X while defending" / "while attacking a damaged
 * unit") and static counts ("+X per <thing>"). The combat-role fields (`defending`, `defenderDamaged`)
 * are set by `completeAttack`; tested both directly through `effectivePower(ctx)` and through real combat.
 */
const F = {
  ...CARDS,
  ASH_073: card({ id: 'ASH_073', type: 'unit', arena: 'ground', power: 0, hp: 3, keywords: [{ name: 'Sentinel' }] }), // Palace Chef Droid
  ASH_241: card({ id: 'ASH_241', type: 'unit', arena: 'space', power: 3, hp: 2, keywords: [{ name: 'Support' }, { name: 'Overwhelm' }] }), // Marrok's Fiend Fighter
  ASH_206: card({ id: 'ASH_206', type: 'unit', arena: 'ground', power: 3, hp: 5, keywords: [{ name: 'Ambush' }] }), // Kelleran Beq
  ASH_197: card({ id: 'ASH_197', type: 'unit', arena: 'space', power: 5, hp: 12 }), // Executor
  ASH_226: card({ id: 'ASH_226', type: 'unit', arena: 'ground', cost: 7, power: 9, hp: 7 }), // Qi'ra
  ZEROPOW: card({ id: 'ZEROPOW', type: 'unit', arena: 'ground', power: 0, hp: 3 }),
  ZEROPOWSP: card({ id: 'ZEROPOWSP', type: 'unit', arena: 'space', power: 0, hp: 3 }),
  UPG: card({ id: 'UPG', type: 'upgrade', power: 0, hp: 0 }),
  ATTACKER: card({ id: 'ATTACKER', type: 'unit', arena: 'ground', power: 2, hp: 8 }),
  TANKSP: card({ id: 'TANKSP', type: 'unit', arena: 'space', power: 0, hp: 12 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!

describe('Conditional stat modifiers — combat role (#357)', () => {
  it('Palace Chef Droid (073): +2/+0 while defending (direct + combat counter)', () => {
    const s = state({ cards: F, players: { player: player({ units: [unit('p', 'ASH_073', { arena: 'ground' })] }), opponent: player() } })
    expect(effectivePower(s, U(s, 'p'))).toBe(0) // resting
    expect(effectivePower(s, U(s, 'p'), { defending: true })).toBe(2)
    // In combat: an attacker takes the +2 counter.
    const board = state({ cards: F, players: { player: player({ units: [unit('a', 'ATTACKER', { arena: 'ground' })] }), opponent: player({ units: [unit('p', 'ASH_073', { arena: 'ground' })] }) } })
    const done = resolve(board, { type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'p' } })
    expect(U(done, 'a').damage).toBe(2) // Palace Chef counters for 0 + 2 while defending
  })

  it("Marrok's Fiend Fighter (241): +2/+0 while attacking a damaged unit", () => {
    const s = state({ cards: F, players: { player: player({ units: [unit('m', 'ASH_241', { arena: 'space' })] }), opponent: player() } })
    expect(effectivePower(s, U(s, 'm'), { attacking: true, defenderDamaged: true })).toBe(5)
    expect(effectivePower(s, U(s, 'm'), { attacking: true, defenderDamaged: false })).toBe(3)
    // In combat vs a damaged defender → 5 damage; vs an undamaged one → 3.
    const vsDamaged = state({ cards: F, players: { player: player({ units: [unit('m', 'ASH_241', { arena: 'space' })] }), opponent: player({ units: [unit('d', 'TANKSP', { arena: 'space', damage: 1 })] }) } })
    expect(U(resolve(vsDamaged, { type: 'attack', attackerId: 'm', target: { kind: 'unit', instanceId: 'd' } }), 'd').damage).toBe(1 + 5)
    const vsFresh = state({ cards: F, players: { player: player({ units: [unit('m', 'ASH_241', { arena: 'space' })] }), opponent: player({ units: [unit('d', 'TANKSP', { arena: 'space' })] }) } })
    expect(U(resolve(vsFresh, { type: 'attack', attackerId: 'm', target: { kind: 'unit', instanceId: 'd' } }), 'd').damage).toBe(3)
  })
})

describe('Conditional stat modifiers — static counts (#357)', () => {
  it('Executor (197): +1/+0 per upgrade on other friendly units; When Played buffs each other friendly', () => {
    const s = state({ cards: F, players: { player: player({ units: [unit('e', 'ASH_197', { arena: 'space' }), unit('f', 'ZEROPOWSP', { arena: 'space', upgrades: [{ cardId: 'UPG', owner: 'player' }, { cardId: 'UPG', owner: 'player' }] })] }), opponent: player() } })
    expect(effectivePower(s, U(s, 'e'))).toBe(5 + 2) // 2 upgrades on the other friendly

    // When Played: an Advantage token to each other friendly unit.
    const board = state({ cards: F, players: { player: player({ hand: ['ASH_197'], resources: Array.from({ length: 10 }, () => ({ cardId: 'r', exhausted: false })), units: [unit('f', 'ZEROPOWSP', { arena: 'space' })] }), opponent: player() } })
    const played = resolve(board, { type: 'playCard', handIndex: 0 })
    expect(U(played, 'f').upgrades.filter(u => u.cardId === TOKEN_ADVANTAGE)).toHaveLength(1)
  })

  it('Kelleran Beq (206): +1/+0 per other unit (either side) with 0 power', () => {
    const s = state({ cards: F, players: { player: player({ units: [unit('k', 'ASH_206', { arena: 'ground' }), unit('z1', 'ZEROPOW', { arena: 'ground' })] }), opponent: player({ units: [unit('z2', 'ZEROPOW', { arena: 'ground' }), unit('big', 'ATTACKER', { arena: 'ground' })] }) } })
    expect(effectivePower(s, U(s, 'k'))).toBe(3 + 2) // two 0-power units (z1, z2); ATTACKER (power 2) doesn't count
  })

  it("Qi'ra (226): -1/-0 per card in your hand", () => {
    const s = state({ cards: F, players: { player: player({ units: [unit('q', 'ASH_226', { arena: 'ground' })], hand: ['ZEROPOW', 'ZEROPOW', 'ZEROPOW'] }), opponent: player() } })
    expect(effectivePower(s, U(s, 'q'))).toBe(9 - 3)
  })

  it("Qi'ra (226): When Played may discard a card to deal 3 damage to a unit", () => {
    const board = state({ cards: F, players: { player: player({ hand: ['ASH_226', 'ZEROPOW'], resources: Array.from({ length: 10 }, () => ({ cardId: 'r', exhausted: false })) }), opponent: player({ units: [unit('e', 'ATTACKER', { arena: 'ground' })] }) } })
    const played = resolve(board, { type: 'playCard', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'selectDiscard', optional: true })
    const discarded = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, handIndex: 0 })
    expect(discarded.pendingChoices?.[0]).toMatchObject({ kind: 'mayDamage', amount: 3, optional: false })
    const done = resolve(discarded, { type: 'acceptChoice', choiceId: discarded.pendingChoices![0].id, targetInstanceId: 'e' })
    expect(U(done, 'e').damage).toBe(3)
  })
})
