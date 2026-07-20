import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectivePower } from '../engine/stats'
import { unitHasKeyword } from '../engine/keywords'
import { dealDamageToUnit } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/** Unique/complex units whose behaviour the existing hooks already covered — registration only (#357). */
const F = {
  ...CARDS,
  ASH_144: card({ id: 'ASH_144', type: 'unit', arena: 'space', power: 2, hp: 3 }), // Vane's Snub Fighter
  ASH_041: card({ id: 'ASH_041', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 3 }), // Outcast
  ASH_102: card({ id: 'ASH_102', type: 'unit', arena: 'space', power: 4, hp: 6, keywords: [{ name: 'Restore', value: 2 }] }), // Ravager
  ASH_079: card({ id: 'ASH_079', type: 'unit', arena: 'ground', cost: 4, power: 4, hp: 4 }), // Koska Reeves (Sentinel stripped — conditional)
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 5 }),
  SPC: card({ id: 'SPC', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 6 }),
  FRAGILE: card({ id: 'FRAGILE', type: 'unit', arena: 'ground', power: 1, hp: 1 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!
const advs = (u: { upgrades: { cardId: string }[] }) => u.upgrades.filter(a => a.cardId === TOKEN_ADVANTAGE).length
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })

describe("Vane's Snub Fighter (144) — Advantage when a friendly attack hits a base (#357)", () => {
  it('gains a token when a friendly unit damages a base, but not when it attacks a unit', () => {
    const s = state({ cards: F, players: { player: rich({ units: [unit('v', 'ASH_144', { arena: 'space' }), unit('a', 'GRD', { arena: 'ground' })] }), opponent: player({ units: [unit('e', 'GRD', { arena: 'ground' })] }) } })
    const hitBase = resolve(s, { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(advs(U(hitBase, 'v'))).toBe(1)
    const hitUnit = resolve(s, { type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'e' } })
    expect(advs(U(hitUnit, 'v'))).toBe(0) // no base damage → no token
  })
})

describe('Outcast (041) — +1/+0 to friendly units entering play, including itself (#357)', () => {
  it('buffs itself on entry', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_041'] }), opponent: player() } })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    const o = played.players.player.units.find(u => u.cardId === 'ASH_041')!
    expect(effectivePower(played, o)).toBe(2 + 1)
  })

  it('buffs a later friendly unit entering play', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['GRD'], units: [unit('o', 'ASH_041', { arena: 'ground' })] }), opponent: player() } })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    const g = played.players.player.units.find(u => u.cardId === 'GRD')!
    expect(effectivePower(played, g)).toBe(2 + 1)
  })
})

describe('Ravager (102) — an entering unit may deal its power to a unit in the same arena (#357)', () => {
  it('offers the damage, sized to the entering unit’s power, in that arena only', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['SPC'], units: [unit('r', 'ASH_102', { arena: 'space' })] }), opponent: player({ units: [unit('es', 'SPC', { arena: 'space' }), unit('eg', 'GRD', { arena: 'ground' })] }) } })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayDamage', amount: 2, optional: true })
    const done = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, targetInstanceId: 'es' })
    expect(U(done, 'es').damage).toBe(2)
    expect(U(done, 'eg').damage).toBe(0) // the ground unit was never a target
  })
})

describe('Koska Reeves (079) — conditional Sentinel + token on a friendly death (#357)', () => {
  it('gains Sentinel only while a friendly token unit is in play', () => {
    const without = state({ cards: F, players: { player: player({ units: [unit('k', 'ASH_079', { arena: 'ground' })] }), opponent: player() } })
    expect(unitHasKeyword(without, U(without, 'k'), 'Sentinel')).toBe(false)
    const withToken = state({ cards: F, players: { player: player({ units: [unit('k', 'ASH_079', { arena: 'ground' }), unit('t', TOKEN_MANDALORIAN, { arena: 'ground' })] }), opponent: player() } })
    expect(unitHasKeyword(withToken, U(withToken, 'k'), 'Sentinel')).toBe(true)
  })

  it('creates a Mandalorian token only if a friendly unit died this phase', () => {
    const quiet = state({ cards: F, players: { player: rich({ hand: ['ASH_079'] }), opponent: player() } })
    expect(resolve(quiet, { type: 'playCard', handIndex: 0 }).players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(0)

    const afterDeath = dealDamageToUnit(
      state({ cards: F, players: { player: rich({ hand: ['ASH_079'], units: [unit('f', 'FRAGILE', { arena: 'ground' })] }), opponent: player() } }),
      'f', 1,
    )
    const played = resolve(afterDeath, { type: 'playCard', handIndex: 0 })
    expect(played.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(1)
  })
})
