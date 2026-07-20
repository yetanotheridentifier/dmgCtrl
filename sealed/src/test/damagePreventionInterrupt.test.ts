import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToUnit } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * The Mandalorian: "If damage would be dealt to another friendly unit, you may defeat a
 * Shield token on this unit. If you do, prevent that damage." The one ability in the set that
 * interrupts damage mid-resolution — combat damage via a pre-damage attack stage, ability damage
 * by deferring the application into the choice.
 */
const F = {
  ...CARDS,
  ASH_062: card({ id: 'ASH_062', type: 'unit', arena: 'ground', cost: 4, power: 5, hp: 4, keywords: [{ name: 'Shielded' }] }), // The Mandalorian
  ASH_196: card({ id: 'ASH_196', type: 'unit', arena: 'ground', cost: 6, power: 6, hp: 5, traits: ['Underworld'] }), // Gorian Shard's Corsair
  ASH_118: card({ id: 'ASH_118', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 4 }), // 8D8
  UW: card({ id: 'UW', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 5, traits: ['Underworld'] }),
  ALLY: card({ id: 'ALLY', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  ENEMY: card({ id: 'ENEMY', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 6 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const shields = (u: { upgrades: { cardId: string }[] }) => u.upgrades.filter(a => a.cardId === TOKEN_SHIELD).length
const withShield = (id: string, cardId: string) => unit(id, cardId, { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })
const find = (s: GameState, kind: string) => s.pendingChoices?.find(c => c.kind === kind)

describe('The Mandalorian (062) — preventing COMBAT damage to another friendly unit', () => {
  // The opponent attacks ALLY; the player's Mandalorian may spend its shield to save it.
  const underAttack = () => state({
    cards: F,
    activePlayer: 'opponent',
    players: {
      player: rich({ units: [withShield('mando', 'ASH_062'), unit('ally', 'ALLY')] }),
      opponent: player({ units: [unit('e', 'ENEMY')] }),
    },
  })

  it('offers the trade before damage lands, and prevents it when taken', () => {
    const attacked = resolve(underAttack(), { type: 'attack', attackerId: 'e', target: { kind: 'unit', instanceId: 'ally' } })
    const offer = find(attacked, 'mayPreventDamage')
    expect(offer).toMatchObject({ kind: 'mayPreventDamage', preventerId: 'mando', targetId: 'ally', amount: 3 })
    expect(attacked.activePlayer).toBe('player') // the defender's controller decides

    const prevented = resolve(attacked, { type: 'acceptChoice', choiceId: offer!.id })
    expect(U(prevented, 'ally').damage).toBe(0) // damage prevented
    expect(shields(U(prevented, 'mando'))).toBe(0) // shield spent
    expect(U(prevented, 'e').damage).toBe(2) // the counter-attack still happened
  })

  it('lets the damage through when declined, keeping the shield', () => {
    const attacked = resolve(underAttack(), { type: 'attack', attackerId: 'e', target: { kind: 'unit', instanceId: 'ally' } })
    const declined = resolve(attacked, { type: 'skipTrigger', choiceId: find(attacked, 'mayPreventDamage')!.id })
    expect(U(declined, 'ally').damage).toBe(3)
    expect(shields(U(declined, 'mando'))).toBe(1)
  })

  it('does not offer for damage to itself — only "another friendly unit"', () => {
    const s = state({
      cards: F,
      activePlayer: 'opponent',
      players: {
        player: rich({ units: [withShield('mando', 'ASH_062')] }),
        opponent: player({ units: [unit('e', 'ENEMY')] }),
      },
    })
    const attacked = resolve(s, { type: 'attack', attackerId: 'e', target: { kind: 'unit', instanceId: 'mando' } })
    expect(find(attacked, 'mayPreventDamage')).toBeUndefined()
    expect(shields(U(attacked, 'mando'))).toBe(0) // its own shield soaked the hit as normal
  })

  it('does not offer without a Shield to spend', () => {
    const s = state({
      cards: F,
      activePlayer: 'opponent',
      players: {
        player: rich({ units: [unit('mando', 'ASH_062'), unit('ally', 'ALLY')] }), // no shield
        opponent: player({ units: [unit('e', 'ENEMY')] }),
      },
    })
    const attacked = resolve(s, { type: 'attack', attackerId: 'e', target: { kind: 'unit', instanceId: 'ally' } })
    expect(find(attacked, 'mayPreventDamage')).toBeUndefined()
    expect(U(attacked, 'ally').damage).toBe(3)
  })

  it('cannot prevent unpreventable damage (Gorian Shard)', () => {
    const s = state({
      cards: F,
      activePlayer: 'opponent',
      players: {
        player: rich({ units: [withShield('mando', 'ASH_062'), unit('ally', 'ALLY')] }),
        opponent: player({ units: [unit('gs', 'ASH_196'), unit('e', 'UW')] }),
      },
    })
    const attacked = resolve(s, { type: 'attack', attackerId: 'e', target: { kind: 'unit', instanceId: 'ally' } })
    expect(find(attacked, 'mayPreventDamage')).toBeUndefined()
    expect(U(attacked, 'ally').damage).toBe(3)
    expect(shields(U(attacked, 'mando'))).toBe(1) // untouched
  })
})

describe('The Mandalorian (062) — preventing ABILITY damage', () => {
  it('offers the trade for a ping at another friendly unit, and prevents it', () => {
    const s = state({
      cards: F,
      players: { player: rich({ units: [withShield('mando', 'ASH_062'), unit('ally', 'ALLY')] }), opponent: player() },
    })
    const pinged = dealDamageToUnit(s, 'ally', 2)
    expect(U(pinged, 'ally').damage).toBe(0) // deferred, not yet applied
    const offer = find(pinged, 'mayPreventDamage')!
    expect(offer).toMatchObject({ preventerId: 'mando', targetId: 'ally', amount: 2 })

    const prevented = resolve(pinged, { type: 'acceptChoice', choiceId: offer.id })
    expect(U(prevented, 'ally').damage).toBe(0)
    expect(shields(U(prevented, 'mando'))).toBe(0)
  })

  it('applies the deferred damage when declined', () => {
    const s = state({
      cards: F,
      players: { player: rich({ units: [withShield('mando', 'ASH_062'), unit('ally', 'ALLY')] }), opponent: player() },
    })
    const pinged = dealDamageToUnit(s, 'ally', 2)
    const declined = resolve(pinged, { type: 'skipTrigger', choiceId: find(pinged, 'mayPreventDamage')!.id })
    expect(U(declined, 'ally').damage).toBe(2)
    expect(shields(U(declined, 'mando'))).toBe(1)
  })

  it('suppresses an "if you do" follow-up when the damage is prevented', () => {
    // 8D8: "Deal 1 damage to another friendly unit. If you do, search the top 5 for a unit."
    const s = state({
      cards: F,
      players: {
        player: rich({ units: [unit('d', 'ASH_118'), withShield('mando', 'ASH_062'), unit('ally', 'ALLY')], deck: ['ALLY', 'ALLY'] }),
        opponent: player(),
      },
    })
    const used = resolve(s, { type: 'useAbility', instanceId: 'd', cardId: 'ASH_118', index: 0 })
    const dmg = find(used, 'mayDamage')!
    const chosen = resolve(used, { type: 'acceptChoice', choiceId: dmg.id, targetInstanceId: 'ally' })

    const offer = find(chosen, 'mayPreventDamage')!
    const prevented = resolve(chosen, { type: 'acceptChoice', choiceId: offer.id })
    expect(U(prevented, 'ally').damage).toBe(0)
    expect(find(prevented, 'searchDraw')).toBeUndefined() // no damage dealt → no search

    const declined = resolve(chosen, { type: 'skipTrigger', choiceId: offer.id })
    expect(U(declined, 'ally').damage).toBe(1)
    expect(find(declined, 'searchDraw')).toBeDefined() // damage dealt → the search happens
  })
})
