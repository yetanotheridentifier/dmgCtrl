import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToUnit } from '../engine/combat'
import { dealDamageToBase } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * "Damage dealt by friendly Underworld cards is unpreventable" (Gorian Shard's Corsair):
 * it ignores Shield tokens and base-damage prevention (At Attin Safety Droid).
 */
const F = {
  ...CARDS,
  ASH_196: card({ id: 'ASH_196', type: 'unit', arena: 'space', cost: 6, power: 6, hp: 5, traits: ['Underworld'] }), // Gorian Shard's Corsair
  ASH_070: card({ id: 'ASH_070', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 5 }), // At Attin Safety Droid — caps base damage at 4
  UW: card({ id: 'UW', type: 'unit', arena: 'space', cost: 3, power: 3, hp: 5, traits: ['Underworld'] }),
  PLAIN: card({ id: 'PLAIN', type: 'unit', arena: 'space', cost: 3, power: 3, hp: 5 }),
  BIG: card({ id: 'BIG', type: 'unit', arena: 'space', cost: 5, power: 7, hp: 9 }),
  SHIELDED: card({ id: 'SHIELDED', type: 'unit', arena: 'space', cost: 3, power: 1, hp: 9 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const shielded = (id: string, cardId: string) => unit(id, cardId, { arena: 'space', upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })

describe("Gorian Shard's Corsair (196) — friendly Underworld damage is unpreventable", () => {
  const board = (attackerCard: string, withCorsair = true) => state({
    cards: F,
    players: {
      player: rich({
        units: [
          ...(withCorsair ? [unit('gs', 'ASH_196', { arena: 'space' })] : []),
          unit('a', attackerCard, { arena: 'space' }),
        ],
      }),
      opponent: player({ units: [shielded('d', 'SHIELDED')] }),
    },
  })

  it('combat damage from a friendly Underworld unit burns through a Shield', () => {
    const done = resolve(board('UW'), { type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'd' } })
    expect(U(done, 'd').damage).toBe(3) // shield ignored
    expect(U(done, 'd').upgrades.filter(u => u.cardId === TOKEN_SHIELD)).toHaveLength(1) // and not even spent
  })

  it('a non-Underworld friendly unit is still shielded against', () => {
    const done = resolve(board('PLAIN'), { type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'd' } })
    expect(U(done, 'd').damage).toBe(0)
    expect(U(done, 'd').upgrades.filter(u => u.cardId === TOKEN_SHIELD)).toHaveLength(0) // shield consumed
  })

  it('does nothing without the Corsair in play', () => {
    const done = resolve(board('UW', false), { type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'd' } })
    expect(U(done, 'd').damage).toBe(0)
  })

  it('its own ability damage is unpreventable too', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_196'] }),
        opponent: player({ units: [shielded('d', 'SHIELDED')] }),
      },
    })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    const c = played.pendingChoices!.find(x => x.kind === 'mayDamage')!
    const done = resolve(played, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'd' })
    expect(U(done, 'd').damage).toBe(2)
  })

  it('bypasses base-damage prevention', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ units: [unit('gs', 'ASH_196', { arena: 'space' }), unit('a', 'UW', { arena: 'space' })] }),
        opponent: player({ units: [unit('att', 'ASH_070')] }),
      },
    })
    // At Attin caps an instance at 4; unpreventable Underworld damage ignores the cap.
    const capped = dealDamageToBase(s, 'opponent', 9)
    expect(capped.players.opponent.base.damage).toBe(4) // no source → prevented as usual

    const uncapped = dealDamageToBase(s, 'opponent', 9, { cardId: 'UW', controller: 'player' })
    expect(uncapped.players.opponent.base.damage).toBe(9)
  })

  it("does not make the OPPONENT's Underworld damage unpreventable", () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ units: [unit('gs', 'ASH_196', { arena: 'space' }), shielded('mine', 'SHIELDED')] }),
        opponent: player({ units: [unit('e', 'UW', { arena: 'space' })] }),
      },
    })
    const done = dealDamageToUnit(s, 'mine', 3, { cardId: 'UW', controller: 'opponent' })
    expect(U(done, 'mine').damage).toBe(0) // the enemy's Underworld card is still preventable
  })
})
