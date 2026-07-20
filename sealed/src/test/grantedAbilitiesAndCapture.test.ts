import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToUnit } from '../engine/combat'
import { returnUnitToHand } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * An aura that grants a *triggered ability* to other units
 * (Bo-Katan's Gauntlet), capturing a card under a unit (Bothan-5), and Elzar Mann's
 * distribute-then-opponent-searches chain.
 */
const F = {
  ...CARDS,
  ASH_063: card({ id: 'ASH_063', type: 'unit', arena: 'ground', cost: 5, power: 4, hp: 5, keywords: [{ name: 'Restore', value: 1 }] }), // Bo-Katan's Gauntlet
  ASH_128: card({ id: 'ASH_128', type: 'unit', arena: 'ground', cost: 5, power: 4, hp: 5 }), // Bothan-5
  ASH_224: card({ id: 'ASH_224', type: 'unit', arena: 'ground', cost: 6, power: 3, hp: 7 }), // Elzar Mann
  FODDER: card({ id: 'FODDER', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 1 }),
  RIG: card({ id: 'RIG', type: 'unit', arena: 'ground', cost: 3, power: 1, hp: 1, traits: ['Vehicle'] }),
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 5 }),
  EVT: card({ id: 'EVT', type: 'event', cost: 2 }),
  FORCE_L: card({ id: 'FORCE_L', type: 'leader', cost: 5, power: 3, hp: 6, traits: ['Force'] }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const choice = (s: GameState) => s.pendingChoices![0]
const mandos = (s: GameState, p: 'player' | 'opponent' = 'player') => s.players[p].units.filter(u => u.cardId === TOKEN_MANDALORIAN).length

describe("Bo-Katan's Gauntlet (063) — grants other friendly units a When Defeated ability", () => {
  it('creates a Mandalorian token when another friendly non-token unit is defeated', () => {
    const s = state({ cards: F, players: { player: rich({ units: [unit('bk', 'ASH_063'), unit('f', 'FODDER')] }), opponent: player() } })
    const dead = dealDamageToUnit(s, 'f', 1)
    expect(U(dead, 'f')).toBeUndefined()
    expect(mandos(dead)).toBe(1)
  })

  it('does not grant it to token units, to itself, or to enemy units', () => {
    const tokenDies = state({
      cards: F,
      players: { player: rich({ units: [unit('bk', 'ASH_063'), unit('t', TOKEN_MANDALORIAN)] }), opponent: player() },
    })
    expect(mandos(dealDamageToUnit(tokenDies, 't', 99))).toBe(0) // the token itself died, none created

    const selfDies = state({ cards: F, players: { player: rich({ units: [unit('bk', 'ASH_063')] }), opponent: player() } })
    expect(mandos(dealDamageToUnit(selfDies, 'bk', 99))).toBe(0)

    const enemyDies = state({
      cards: F,
      players: { player: rich({ units: [unit('bk', 'ASH_063')] }), opponent: player({ units: [unit('e', 'FODDER')] }) },
    })
    const done = dealDamageToUnit(enemyDies, 'e', 1)
    expect(mandos(done)).toBe(0)
    expect(mandos(done, 'opponent')).toBe(0)
  })

  it('stops granting once it leaves play', () => {
    const s = state({ cards: F, players: { player: rich({ units: [unit('bk', 'ASH_063', { damage: 4 }), unit('f', 'FODDER')] }), opponent: player() } })
    const gauntletGone = dealDamageToUnit(s, 'bk', 1) // Gauntlet dies first
    expect(U(gauntletGone, 'bk')).toBeUndefined()
    const then = dealDamageToUnit(gauntletGone, 'f', 1)
    expect(mandos(then)).toBe(0)
  })
})

describe('Bothan-5 (128) — captures a defeated friendly unit from the discard', () => {
  const board = (extra: Parameters<typeof unit>[2] = {}) => state({
    cards: F,
    players: { player: rich({ units: [unit('b', 'ASH_128', extra), unit('f', 'FODDER')] }), opponent: player() },
  })

  it('offers the capture, taking the card out of the discard and under this unit', () => {
    const dead = dealDamageToUnit(board(), 'f', 1)
    expect(dead.players.player.discard).toContain('FODDER')
    expect(choice(dead)).toMatchObject({ kind: 'mayCapture', cardId: 'FODDER' })

    const captured = resolve(dead, { type: 'acceptChoice', choiceId: choice(dead).id })
    expect(captured.players.player.discard).not.toContain('FODDER')
    expect(U(captured, 'b').captured).toEqual(['FODDER'])
  })

  it('only once each round, and not for a Vehicle', () => {
    const captured = resolve(dealDamageToUnit(board(), 'f', 1), { type: 'acceptChoice', choiceId: choice(dealDamageToUnit(board(), 'f', 1)).id })
    const second = dealDamageToUnit({ ...captured, players: { ...captured.players, player: { ...captured.players.player, units: [...captured.players.player.units, unit('g', 'FODDER')] } } }, 'g', 1)
    expect(second.pendingChoices ?? []).toHaveLength(0) // already used this round

    const vehicle = state({ cards: F, players: { player: rich({ units: [unit('b', 'ASH_128'), unit('v', 'RIG')] }), opponent: player() } })
    expect(dealDamageToUnit(vehicle, 'v', 1).pendingChoices ?? []).toHaveLength(0)
  })

  // The captor alone, so the only FODDER that can appear is the rescued one.
  const captorOnly = (over: Parameters<typeof unit>[2] = {}) => state({
    cards: F,
    players: { player: rich({ units: [unit('b', 'ASH_128', { captured: ['FODDER'], ...over })] }), opponent: player() },
  })

  it('springs captured units back into play, exhausted, when the captor leaves play', () => {
    const dead = dealDamageToUnit(captorOnly({ damage: 4 }), 'b', 1)
    expect(U(dead, 'b')).toBeUndefined()
    expect(dead.players.player.discard).toContain('ASH_128') // the captor itself is defeated
    const rescued = dead.players.player.units.find(u => u.cardId === 'FODDER')!
    expect(rescued).toBeDefined() // back in play, not in the discard
    expect(rescued.exhausted).toBe(true)
    expect(rescued.arena).toBe('ground') // its own arena
    expect(dead.players.player.discard).not.toContain('FODDER')
  })

  it('does not fire the rescued unit’s When Played — it is not being played', () => {
    // ASH_161 (Zeb) would push a mayGiveTokens choice if its When Played fired.
    const s = state({
      cards: { ...F, ASH_161: card({ id: 'ASH_161', type: 'unit', arena: 'ground', cost: 7, power: 5, hp: 7 }) },
      players: { player: rich({ units: [unit('b', 'ASH_128', { captured: ['ASH_161'], damage: 4 }), unit('o', 'GRD')] }), opponent: player() },
    })
    const dead = dealDamageToUnit(s, 'b', 1)
    expect(dead.players.player.units.some(u => u.cardId === 'ASH_161')).toBe(true)
    expect(dead.pendingChoices ?? []).toHaveLength(0) // no When Played choice
  })

  it('also releases them when the captor is returned to hand', () => {
    const bounced = returnUnitToHand(captorOnly(), 'b')
    expect(bounced.players.player.units.find(u => u.cardId === 'FODDER')?.exhausted).toBe(true)
    expect(bounced.players.player.hand).toContain('ASH_128')
  })
})

describe('Elzar Mann (224) — distribute Advantage, then the opponent digs for an event', () => {
  const board = () => state({
    cards: F,
    players: {
      player: rich({ hand: ['ASH_224'], units: [unit('x', 'GRD'), unit('y', 'GRD')] }),
      opponent: player({ deck: ['GRD', 'GRD', 'EVT', 'GRD', 'GRD', 'GRD', 'EVT'] }),
    },
  })

  it('distributes up to 5, then has the opponent search twice that many for an event', () => {
    const p = resolve(board(), { type: 'playUnit', handIndex: 0 })
    expect(choice(p)).toMatchObject({ kind: 'distributeTokens', remaining: 5, total: 5 })

    // Give 2 tokens, then stop.
    const one = resolve(p, { type: 'acceptChoice', choiceId: choice(p).id, targetInstanceId: 'x' })
    const two = resolve(one, { type: 'acceptChoice', choiceId: choice(one).id, targetInstanceId: 'y' })
    const stopped = resolve(two, { type: 'skipTrigger', choiceId: choice(two).id })
    expect(U(stopped, 'x').upgrades.filter(a => a.cardId === TOKEN_ADVANTAGE)).toHaveLength(1)

    // 2 distributed → the opponent searches 4, and decides, so control passes to them.
    const search = choice(stopped)
    expect(search).toMatchObject({ kind: 'searchDraw', controller: 'opponent' })
    expect(search.kind === 'searchDraw' && search.revealed).toHaveLength(4)
    expect(search.kind === 'searchDraw' && search.eligibleIndices).toEqual([2]) // only the event in the top 4
    expect(stopped.activePlayer).toBe('opponent')

    const drawn = resolve(stopped, { type: 'acceptChoice', choiceId: search.id, deckIndex: 2 })
    expect(drawn.players.opponent.hand).toContain('EVT')
  })

  it('skips the search entirely when no tokens are distributed', () => {
    const p = resolve(board(), { type: 'playUnit', handIndex: 0 })
    const stopped = resolve(p, { type: 'skipTrigger', choiceId: choice(p).id })
    expect(stopped.pendingChoices ?? []).toHaveLength(0)
  })

  it('enters play ready only while you control a Force leader', () => {
    const withForce = state({
      cards: F,
      players: { player: rich({ hand: ['ASH_224'], leader: { cardId: 'FORCE_L', deployed: false, epicActionUsed: false, exhausted: false } }), opponent: player() },
    })
    const played = resolve(withForce, { type: 'playUnit', handIndex: 0 })
    expect(played.players.player.units.find(u => u.cardId === 'ASH_224')!.exhausted).toBe(false)

    const without = resolve(state({ cards: F, players: { player: rich({ hand: ['ASH_224'] }), opponent: player() } }), { type: 'playUnit', handIndex: 0 })
    expect(without.players.player.units.find(u => u.cardId === 'ASH_224')!.exhausted).toBe(true)
  })
})
