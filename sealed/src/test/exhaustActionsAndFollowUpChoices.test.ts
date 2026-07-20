import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { effectivePower, effectiveHp } from '../engine/stats'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * Units whose printed text needs an engine extension beyond the existing hooks:
 * a real "[Exhaust]" action cost, and choices that chain a follow-up choice on acceptance.
 */
const F = {
  ...CARDS,
  ASH_047: card({ id: 'ASH_047', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 4 }), // Gar Saxon
  ASH_155: card({ id: 'ASH_155', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 6 }), // Grogu
  ASH_171: card({ id: 'ASH_171', type: 'unit', arena: 'space', cost: 3, power: 3, hp: 2 }), // Pegasus Tri-Wing
  ASH_060: card({ id: 'ASH_060', type: 'unit', arena: 'ground', cost: 4, power: 2, hp: 6, keywords: [{ name: 'Grit' }] }), // Cobb Vanth
  ASH_118: card({ id: 'ASH_118', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 4, keywords: [{ name: 'Hidden' }] }), // 8D8
  ASH_109: card({ id: 'ASH_109', type: 'unit', arena: 'space', cost: 4, power: 2, hp: 6, keywords: [{ name: 'Sentinel' }] }), // T-6 Shuttle 1974
  ASH_245: card({ id: 'ASH_245', type: 'unit', arena: 'space', cost: 7, power: 5, hp: 8 }), // Eye of Sion
  ASH_123: card({ id: 'ASH_123', type: 'unit', arena: 'ground', cost: 4, power: 3, hp: 5 }), // Lang — existing [Exhaust] action
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 5 }),
  SPC: card({ id: 'SPC', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 6 }),
  BIG: card({ id: 'BIG', type: 'unit', arena: 'space', cost: 6, power: 4, hp: 4 }),
  HUGE: card({ id: 'HUGE', type: 'unit', arena: 'space', cost: 8, power: 9, hp: 9 }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  EVT: card({ id: 'EVT', type: 'event', cost: 1 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const choice = (s: GameState) => s.pendingChoices![0]
const shields = (u: { upgrades: { cardId: string }[] }) => u.upgrades.filter(a => a.cardId === TOKEN_SHIELD).length

describe('"Action [Exhaust]" is a real cost, not once-per-round', () => {
  // Lang: "Action [Exhaust]: This unit deals damage equal to his power to a ground unit."
  const langState = (exhausted: boolean) => state({
    cards: F,
    players: {
      player: rich({ units: [unit('l', 'ASH_123', { exhausted })] }),
      opponent: player({ units: [unit('e', 'GRD')] }),
    },
  })

  it('is unavailable while the unit is exhausted', () => {
    expect(legalMoves(langState(false)).some(m => m.type === 'useAbility')).toBe(true)
    expect(legalMoves(langState(true)).some(m => m.type === 'useAbility')).toBe(false)
  })

  it('exhausts the unit when used, so it cannot then attack', () => {
    const s = langState(false)
    const used = resolve(s, { type: 'useAbility', instanceId: 'l', cardId: 'ASH_123', index: 0 })
    expect(U(used, 'l').exhausted).toBe(true)
  })
})

describe('Pegasus Tri-Wing (171) — defeat a friendly upgrade to ready itself', () => {
  const played = () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_171'], units: [unit('g', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] }), opponent: player() } })
    return resolve(s, { type: 'playUnit', handIndex: 0 })
  }

  it('offers the friendly upgrade, and readies itself when one is defeated', () => {
    const p = played()
    expect(choice(p)).toMatchObject({ kind: 'selectUpgradeToDefeat', optional: true })
    const pegasus = p.players.player.units.find(u => u.cardId === 'ASH_171')!
    expect(pegasus.exhausted).toBe(true) // entered play exhausted
    const done = resolve(p, { type: 'acceptChoice', choiceId: choice(p).id, optionIndex: 0 })
    expect(U(done, 'g').upgrades).toHaveLength(0)
    expect(U(done, pegasus.instanceId).exhausted).toBe(false)
  })

  it('stays exhausted when the player declines', () => {
    const p = played()
    const pegasus = p.players.player.units.find(u => u.cardId === 'ASH_171')!
    const done = resolve(p, { type: 'skipTrigger', choiceId: choice(p).id })
    expect(U(done, pegasus.instanceId).exhausted).toBe(true)
  })
})

describe('Cobb Vanth (060) — self-damage to shield an entering unit', () => {
  it('offers the trade when another unit is played, and pays 2 to shield it', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['GRD'], units: [unit('c', 'ASH_060')] }), opponent: player() } })
    const p = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(choice(p)).toMatchObject({ kind: 'maySelfDamageShield', amount: 2 })
    const entered = p.players.player.units.find(u => u.cardId === 'GRD')!
    const done = resolve(p, { type: 'acceptChoice', choiceId: choice(p).id })
    expect(U(done, 'c').damage).toBe(2)
    expect(shields(U(done, entered.instanceId))).toBe(1)
  })

  it('declining costs nothing', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['GRD'], units: [unit('c', 'ASH_060')] }), opponent: player() } })
    const p = resolve(s, { type: 'playUnit', handIndex: 0 })
    const done = resolve(p, { type: 'skipTrigger', choiceId: choice(p).id })
    expect(U(done, 'c').damage).toBe(0)
    expect(shields(done.players.player.units.find(u => u.cardId === 'GRD')!)).toBe(0)
  })

  it('does not trigger on itself entering play', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_060'] }), opponent: player() } })
    const p = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(p.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Gar Saxon (047) — a Mandalorian token when an upgrade is played on him', () => {
  const withGar = () => state({ cards: F, players: { player: rich({ hand: ['UPG', 'UPG'], units: [unit('gar', 'ASH_047')] }), opponent: player() } })

  it('offers a token when an upgrade is played on him, once each round', () => {
    const p = resolve(withGar(), { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'gar' })
    expect(choice(p)).toMatchObject({ kind: 'mayCreateToken', token: TOKEN_MANDALORIAN })
    const made = resolve(p, { type: 'acceptChoice', choiceId: choice(p).id })
    expect(made.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(1)

    // Second upgrade the same round — the ability has been used. (The token choice ended the
    // player's turn, so hand the turn back before playing again.)
    const again = resolve({ ...made, activePlayer: 'player' }, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'gar' })
    expect(again.pendingChoices ?? []).toHaveLength(0)
  })

  it('does not trigger for an upgrade played on another unit', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['UPG'], units: [unit('gar', 'ASH_047'), unit('g', 'GRD')] }), opponent: player() } })
    const p = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'g' })
    expect(p.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Grogu (155) — attack with a unit when you take the initiative', () => {
  it('offers an attack with any ready friendly unit', () => {
    const s = state({
      cards: F,
      initiative: 'opponent',
      players: {
        player: rich({ units: [unit('grogu', 'ASH_155'), unit('a', 'GRD'), unit('tired', 'GRD', { exhausted: true })] }),
        opponent: player({ units: [unit('e', 'GRD')] }),
      },
    })
    const took = resolve(s, { type: 'takeInitiative' })
    expect(choice(took)).toMatchObject({ kind: 'mayAttackAnyUnit' })
    const attackers = new Set(legalMoves(took).filter(m => m.type === 'attack').map(m => m.attackerId))
    expect(attackers).toContain('a')
    expect(attackers).toContain('grogu')
    expect(attackers).not.toContain('tired') // exhausted units can't be the attacker
  })
})

describe('8D8 (118) — damage a friendly unit to search for a unit', () => {
  it('deals 1 to another friendly unit, then searches the top 5 for a unit', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ units: [unit('d', 'ASH_118'), unit('g', 'GRD')], deck: ['EVT', 'GRD', 'EVT', 'EVT', 'EVT', 'SPC'] }),
        opponent: player(),
      },
    })
    const used = resolve(s, { type: 'useAbility', instanceId: 'd', cardId: 'ASH_118', index: 0 })
    expect(choice(used)).toMatchObject({ kind: 'mayDamage', amount: 1, targets: ['g'] }) // "another friendly unit"

    const damaged = resolve(used, { type: 'acceptChoice', choiceId: choice(used).id, targetInstanceId: 'g' })
    expect(U(damaged, 'g').damage).toBe(1)
    const search = choice(damaged)
    // Only the unit within the top 5 is eligible (the 6th card, SPC, is out of reach).
    expect(search).toMatchObject({ kind: 'searchDraw', eligibleIndices: [1] })

    const drawn = resolve(damaged, { type: 'acceptChoice', choiceId: search.id, deckIndex: 1 })
    expect(drawn.players.player.hand).toContain('GRD')
  })
})

describe('T-6 Shuttle 1974 (109) — buff another unit, then attack with it', () => {
  it('gives +2/+2 for the phase and offers that unit an attack', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ units: [unit('t', 'ASH_109', { arena: 'space' }), unit('a', 'SPC', { arena: 'space' })] }),
        opponent: player({ units: [unit('e', 'SPC', { arena: 'space' })] }),
      },
    })
    const used = resolve(s, { type: 'useAbility', instanceId: 't', cardId: 'ASH_109', index: 0 })
    expect(choice(used)).toMatchObject({ kind: 'mayLastingBuff', power: 2, hp: 2 })

    const buffed = resolve(used, { type: 'acceptChoice', choiceId: choice(used).id, targetInstanceId: 'a' })
    expect(effectivePower(buffed, U(buffed, 'a'))).toBe(2 + 2)
    expect(effectiveHp(buffed, U(buffed, 'a'))).toBe(6 + 2)
    expect(choice(buffed)).toMatchObject({ kind: 'mayAttack', unitId: 'a' })

    const attacked = resolve(buffed, { type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'e' } })
    expect(U(attacked, 'e').damage).toBe(4)
  })
})

describe('Eye of Sion (245) — play a unit costing up to its power, ready', () => {
  it('reveals the top 8 and only offers units within its power', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ units: [unit('eye', 'ASH_245', { arena: 'space' })], deck: ['HUGE', 'BIG', 'EVT', 'GRD', 'SPC', 'SPC', 'SPC', 'SPC', 'GRD'] }),
        opponent: player(),
      },
    })
    const used = resolve(s, { type: 'useAbility', instanceId: 'eye', cardId: 'ASH_245', index: 0 })
    const c = choice(used)
    // Power 5: HUGE (8) and BIG (6) are too expensive, EVT isn't a unit; the 9th card is out of reach.
    expect(c).toMatchObject({ kind: 'searchPlayFree', entersReady: true, eligibleIndices: [3, 4, 5, 6, 7] })

    const before = used.players.player.resources.filter(r => r.exhausted).length
    const done = resolve(used, { type: 'acceptChoice', choiceId: c.id, deckIndex: 3 })
    const entered = done.players.player.units.find(u => u.cardId === 'GRD')!
    expect(entered.exhausted).toBe(false) // "It enters play ready."
    expect(done.players.player.resources.filter(r => r.exhausted).length).toBe(before) // free
    expect(done.pendingChoices ?? []).toHaveLength(0) // only one unit, then stop
  })
})
