import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { captureUnit } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/** Cards #466 registers directly against `captureUnit` (first wave: a single guardian, one chosen
 *  target, no rescue/discard action and no multi-target budget — those are split to a follow-up
 *  ticket). Each test checks the registration wires the right filter and guardian, not the primitive
 *  itself (covered in full by `capture.test.ts`). */
const F = {
  ...CARDS,
  SHD_120: card({ id: 'SHD_120', name: 'Discerning Veteran', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 3 }),
  TWI_115: card({ id: 'TWI_115', name: 'Osi Sobeck', type: 'unit', arena: 'ground', cost: 5, power: 4, hp: 5, keywords: [{ name: 'Exploit', value: 3 }] }),
  SEC_253: card({ id: 'SEC_253', name: 'Covert Operative', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }),
  SEC_056: card({ id: 'SEC_056', name: 'Escape Pod', type: 'unit', arena: 'space', cost: 2, power: 1, hp: 3 }),
  SHD_251: card({ id: 'SHD_251', name: "The Mandalorian's Rifle", type: 'upgrade', cost: 2 }),
  SHD_124: card({ id: 'SHD_124', name: 'Legal Authority', type: 'upgrade', cost: 2 }),
  SEC_256: card({ id: 'SEC_256', name: 'Moral Authority', type: 'upgrade', cost: 2 }),
  SHD_170: card({ id: 'SHD_170', name: 'IG-11', type: 'unit', arena: 'ground', cost: 4, power: 3, hp: 4 }),
  SEC_209: card({ id: 'SEC_209', name: 'The Mandalorian', subtitle: 'Cleaning Up Nevarro', type: 'unit', arena: 'ground', cost: 8, power: 6, hp: 8 }),
  SHD_180: card({ id: 'SHD_180', name: 'Detention Block Rescue', type: 'event', cost: 2 }),
  MANDO: card({ id: 'MANDO', name: 'The Mandalorian', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 3 }),
  RIG: card({ id: 'RIG', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 2, traits: ['Vehicle'] }),
  UNQ: card({ id: 'UNQ', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, unique: true }),
  LDR: card({ id: 'LDR', type: 'unit', arena: 'ground', cost: 5, power: 4, hp: 6 }),
  TOUGH: card({ id: 'TOUGH', type: 'unit', arena: 'ground', cost: 5, power: 1, hp: 10 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const choice = (s: GameState) => s.pendingChoices![0]
const accept = (s: GameState, targetInstanceId?: string) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, targetInstanceId })
// `selectUnitThen` (and its siblings) are one variant of the PendingChoice union; every card here
// pushes exactly that shape, so a single cast keeps the assertions below readable.
const targets = (s: GameState): string[] => (choice(s) as unknown as { targets: string[] }).targets
const optional = (s: GameState): boolean | undefined => (choice(s) as unknown as { optional?: boolean }).optional

describe('SHD_120 Discerning Veteran — captures an enemy non-leader ground unit', () => {
  it('offers only enemy non-leader ground units, and captures the chosen one', () => {
    const s = state({ cards: F, players: {
      player: rich({ hand: ['SHD_120'] }),
      opponent: rich({ units: [unit('space', 'SEC_056', { arena: 'space' }), unit('groundling', 'TWI_115')] }), // one space, one ground
    } })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(targets(played)).toEqual(['groundling'])
    const done = accept(played, 'groundling')
    expect(U(done, 'groundling')).toBeUndefined()
  })
})

describe('TWI_115 Osi Sobeck — captures an enemy non-leader ground unit costing no more than what was paid', () => {
  it('offers targets within the paid budget (a full-cost play pays 5)', () => {
    const s = state({ cards: F, players: {
      player: rich({ hand: ['TWI_115'] }),
      opponent: rich({ units: [unit('cheap', 'SEC_253'), unit('pricey', 'SHD_170')] }), // cost 2 vs cost 4
    } })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(new Set(targets(played))).toEqual(new Set(['cheap', 'pricey']))
  })
})

describe('SEC_253 Covert Operative — captures an enemy non-leader unit costing 2 or less', () => {
  it('filters by cost, not by arena', () => {
    const s = state({ cards: F, players: {
      player: rich({ hand: ['SEC_253'] }),
      opponent: rich({ units: [unit('cheap', 'SEC_056'), unit('pricey', 'SHD_170')] }), // cost 2 vs cost 4
    } })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(targets(played)).toEqual(['cheap'])
  })
})

describe('SEC_056 Escape Pod — may capture a friendly non-Vehicle, non-leader unit', () => {
  it('offers only friendly units, excludes Vehicles and itself, and is optional', () => {
    const s = state({ cards: F, players: {
      player: rich({ hand: ['SEC_056'], units: [unit('rig', 'RIG'), unit('ok', 'SEC_253')] }),
      opponent: rich(),
    } })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(targets(played)).toEqual(['ok'])
    expect(optional(played)).toBe(true)
  })

  it('does nothing when declined', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['SEC_056'], units: [unit('ok', 'SEC_253')] }), opponent: rich() } })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    const declined = resolve(played, { type: 'skipTrigger', choiceId: choice(played).id })
    expect(U(declined, 'ok')).toBeDefined()
  })
})

describe('SHD_251 The Mandalorian\'s Rifle — attached Mandalorian captures an exhausted enemy non-leader unit', () => {
  it('only offers exhausted enemies, when the host is named The Mandalorian', () => {
    const s = state({ cards: F, players: {
      player: rich({ hand: ['SHD_251'], units: [unit('host', 'MANDO')] }),
      opponent: rich({ units: [unit('readyUnit', 'SEC_253'), unit('spent', 'SEC_056', { exhausted: true })] }),
    } })
    const played = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'host' })
    expect(targets(played)).toEqual(['spent'])
    const done = accept(played, 'spent')
    expect(U(done, 'host')?.captured).toEqual([{ cardId: 'SEC_056', owner: 'opponent' }])
  })

  it('does not offer a capture when attached to a unit other than The Mandalorian', () => {
    const s = state({ cards: F, players: {
      player: rich({ hand: ['SHD_251'], units: [unit('host', 'SEC_253')] }),
      opponent: rich({ units: [unit('spent', 'SEC_056', { exhausted: true })] }),
    } })
    const played = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'host' })
    expect(played.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('SHD_124 Legal Authority — attached unit captures an enemy non-leader unit with less power', () => {
  it('offers only weaker enemy units', () => {
    const s = state({ cards: F, players: {
      player: rich({ hand: ['SHD_124'], units: [unit('host', 'SHD_170')] }), // power 3
      opponent: rich({ units: [unit('weak', 'SEC_253'), unit('strong', 'LDR')] }), // power 2 vs power 4
    } })
    const played = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'host' })
    expect(targets(played)).toEqual(['weak'])
  })
})

describe('SEC_256 Moral Authority — attach to a friendly Unique unit; captures a weaker-HP enemy', () => {
  it('offers only enemy units with less remaining HP than the host', () => {
    const s = state({ cards: F, players: {
      player: rich({ hand: ['SEC_256'], units: [unit('host', 'UNQ')] }), // hp 2
      opponent: rich({ units: [unit('weaker', 'SEC_253', { damage: 1 }), unit('tougher', 'LDR')] }), // remaining 1 vs 6
    } })
    const played = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'host' })
    expect(targets(played)).toEqual(['weaker'])
  })
})

describe('SHD_170 IG-11 — captured instead defeats him and hits every enemy ground unit for 3', () => {
  it('runs the replacement instead of being captured', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('cap', 'TOUGH')] }),
      opponent: rich({ units: [unit('ig', 'SHD_170')] }),
    } })
    const next = captureUnit(s, 'cap', 'ig')
    expect(U(next, 'ig')).toBeUndefined() // defeated, not captured
    expect(next.players.opponent.discard).toContain('SHD_170')
    expect(U(next, 'cap')?.captured ?? []).toHaveLength(0) // never captured
    expect(U(next, 'cap')?.damage).toBe(3) // the capturing side's own ground unit hit too
  })

  it('may still deal 3 to a damaged ground unit on attack', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('ig', 'SHD_170')] }),
      opponent: rich({ units: [unit('e', 'SEC_253', { damage: 1 })] }),
    } })
    const attacked = resolve(s, { type: 'attack', attackerId: 'ig', target: { kind: 'unit', instanceId: 'e' } })
    expect(attacked.pendingChoices?.length ?? 0).toBeGreaterThan(0)
    expect(optional(attacked)).toBe(true)
  })
})

describe('SEC_209 The Mandalorian — after an attack that defeats a unit, may capture a different enemy unit', () => {
  it('offers a capture only once the attack defeats its defender', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('mando', 'SEC_209')] }),
      opponent: rich({ units: [unit('victim', 'SEC_253'), unit('other', 'SEC_056', { arena: 'ground' })] }),
    } })
    const attacked = resolve(s, { type: 'attack', attackerId: 'mando', target: { kind: 'unit', instanceId: 'victim' } })
    expect(U(attacked, 'victim')).toBeUndefined() // defeated by combat damage
    expect(targets(attacked)).toEqual(['other']) // the survivor, not the already-defeated one
    const done = accept(attacked, 'other')
    expect(U(done, 'other')).toBeUndefined()
    expect(U(done, 'mando')?.captured).toEqual([{ cardId: 'SEC_056', owner: 'opponent' }])
  })
})

describe('SHD_180 Detention Block Rescue — 3 damage, or 6 if the target is guarding a captured card', () => {
  it('deals 3 to an ordinary unit', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['SHD_180'] }), opponent: rich({ units: [unit('e', 'TOUGH')] }) } })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const done = accept(played, 'e')
    expect(U(done, 'e')?.damage).toBe(3)
  })

  it('deals 6 when the chosen unit is guarding a captured card', () => {
    const s = state({ cards: F, players: {
      player: rich({ hand: ['SHD_180'] }),
      opponent: rich({ units: [unit('guard', 'TOUGH', { captured: [{ cardId: 'SEC_253', owner: 'opponent' }] })] }),
    } })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const done = accept(played, 'guard')
    expect(U(done, 'guard')?.damage).toBe(6)
  })
})
