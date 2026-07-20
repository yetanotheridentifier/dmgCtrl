import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { effectivePower } from '../engine/stats'
import { describeAction } from '../utils/describeAction'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * Playing an event: pay its cost, put it in the discard, then resolve its effect. An event never
 * enters play, so it has no unit to hang choices off — the resolver gives each one a synthetic
 * source id instead.
 */
const F = {
  ...CARDS,
  ASH_140: card({ id: 'ASH_140', type: 'event', name: 'Stronger Together', cost: 4 }),
  ASH_185: card({ id: 'ASH_185', type: 'event', name: 'Intimidation', cost: 2 }),
  ASH_258: card({ id: 'ASH_258', type: 'event', name: 'Grassroots Resistance', cost: 4 }),
  ASH_136: card({ id: 'ASH_136', type: 'event', name: 'Display of Strength', cost: 2 }),
  ASH_212: card({ id: 'ASH_212', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 4 }), // Peli Motto
  PRICEY: card({ id: 'PRICEY', type: 'event', cost: 9 }),
  ASPECT_EV: card({ id: 'ASPECT_EV', type: 'event', cost: 1, aspects: ['Cunning'] }), // off-aspect → +2
  ASPECT_UP: card({ id: 'ASPECT_UP', type: 'upgrade', cost: 1, power: 1, hp: 1, aspects: ['Cunning'] }),
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  BRUTE: card({ id: 'BRUTE', type: 'unit', arena: 'ground', cost: 5, power: 4, hp: 6 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const readyCount = (s: GameState) => s.players.player.resources.filter(r => !r.exhausted).length

describe('playing an event — the shared mechanics', () => {
  it('pays the cost, discards the card, and resolves the effect', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_140'] }), opponent: player() } })
    expect(legalMoves(s).some(m => m.type === 'playEvent')).toBe(true)

    const before = readyCount(s)
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(readyCount(played)).toBe(before - 4) // cost paid
    expect(played.players.player.hand).toHaveLength(0)
    expect(played.players.player.discard).toContain('ASH_140') // in the discard, not in play
    expect(played.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(2)
  })

  it('is not offered when it cannot be paid for', () => {
    const s = state({ cards: F, players: { player: player({ resources: ready(3), hand: ['PRICEY'] }), opponent: player() } })
    expect(legalMoves(s).some(m => m.type === 'playEvent')).toBe(false)
  })

  it('applies the aspect penalty like any other card', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASPECT_EV'] }), opponent: player() } })
    const before = readyCount(s)
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(readyCount(played)).toBe(before - 3) // 1 printed + 2 off-aspect
  })

  it('names the card and its cost in the action description', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_140'] }), opponent: player() } })
    expect(describeAction(s, 'player', { type: 'playEvent', handIndex: 0 })).toMatch(/Stronger Together \(4\)/)
  })

  it('hands the turn over once the event resolves', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_140'] }), opponent: player() } })
    expect(resolve(s, { type: 'playEvent', handIndex: 0 }).activePlayer).toBe('opponent')
  })

  it('gives two events in one turn distinct choice ids', () => {
    // Both raise a selectDamageTarget; if they shared an id the second would clash with the first.
    const s = state({
      cards: F,
      players: { player: rich({ hand: ['ASH_258', 'ASH_258'] }), opponent: player({ units: [unit('e', 'GRD')] }) },
    })
    const first = resolve(s, { type: 'playEvent', handIndex: 0 })
    const firstId = first.pendingChoices![0].id
    const resolved = resolve(first, { type: 'acceptChoice', choiceId: firstId, targetInstanceId: 'e' })
    const second = resolve({ ...resolved, activePlayer: 'player' }, { type: 'playEvent', handIndex: 0 })
    expect(second.pendingChoices![0].id).not.toBe(firstId)
  })
})

describe('Peli Motto waives the aspect penalty of the first non-unit card each phase', () => {
  const withPeli = (hand: string[]) => state({
    cards: F,
    players: { player: rich({ hand, units: [unit('p', 'ASH_212')] }), opponent: player({ units: [unit('e', 'GRD')] }) },
  })

  it('waives it for an event', () => {
    const s = withPeli(['ASPECT_EV'])
    const before = readyCount(s)
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(readyCount(played)).toBe(before - 1) // penalty waived
  })

  it('only waives the first — an upgrade played first consumes it', () => {
    const s = withPeli(['ASPECT_UP', 'ASPECT_EV'])
    const upgraded = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'p' })
    const before = readyCount(upgraded)
    const played = resolve({ ...upgraded, activePlayer: 'player' }, { type: 'playEvent', handIndex: 0 })
    expect(readyCount(played)).toBe(before - 3) // 1 + 2 penalty, no waiver left
  })

  it('and an event played first consumes it for a later upgrade', () => {
    const s = withPeli(['ASPECT_EV', 'ASPECT_UP'])
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const before = readyCount(played)
    const upgraded = resolve({ ...played, activePlayer: 'player' }, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'p' })
    expect(readyCount(upgraded)).toBe(before - 3)
  })
})

describe('the first four events', () => {
  it('Stronger Together (140): creates 2 Mandalorian tokens', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_140'] }), opponent: player() } })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(played.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(2)
  })

  it('Intimidation (185): draws 2 only while you control a 4+ power unit', () => {
    const strong = state({ cards: F, players: { player: rich({ hand: ['ASH_185'], units: [unit('b', 'BRUTE')], deck: ['GRD', 'GRD', 'GRD'] }), opponent: player() } })
    expect(resolve(strong, { type: 'playEvent', handIndex: 0 }).players.player.hand).toHaveLength(2)

    const weak = state({ cards: F, players: { player: rich({ hand: ['ASH_185'], units: [unit('g', 'GRD')], deck: ['GRD', 'GRD', 'GRD'] }), opponent: player() } })
    expect(resolve(weak, { type: 'playEvent', handIndex: 0 }).players.player.hand).toHaveLength(0)
  })

  it('Grassroots Resistance (258): 3 damage to a chosen unit, and heals your base 3', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_258'], base: { cardId: 'TST_B', damage: 7 } }),
        opponent: player({ units: [unit('e', 'GRD')] }),
      },
    })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(played.players.player.base.damage).toBe(4) // healed immediately
    const done = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, targetInstanceId: 'e' })
    expect(U(done, 'e').damage).toBe(3)
  })

  it('Display of Strength (136): +3/+3 to a chosen unit for the phase', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_136'], units: [unit('g', 'GRD')] }), opponent: player() } })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices![0]).toMatchObject({ kind: 'mayLastingBuff', power: 3, hp: 3 })
    const done = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, targetInstanceId: 'g' })
    expect(effectivePower(done, U(done, 'g'))).toBe(2 + 3)
  })
})
