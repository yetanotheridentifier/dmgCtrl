import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { unitHasKeyword } from '../engine/keywords'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/** Events whose effects reuse the existing effect primitives and pending choices. */
const F = {
  ...CARDS,
  ASH_151: card({ id: 'ASH_151', type: 'event', name: 'Operation Cinder', cost: 6 }),
  ASH_187: card({ id: 'ASH_187', type: 'event', name: 'Reckoning', cost: 3 }),
  ASH_138: card({ id: 'ASH_138', type: 'event', name: 'Turning the Tide', cost: 3 }),
  ASH_264: card({ id: 'ASH_264', type: 'event', name: 'A New Order', cost: 1 }),
  ASH_067: card({ id: 'ASH_067', type: 'event', name: 'Get Lost', cost: 4 }),
  ASH_092: card({ id: 'ASH_092', type: 'event', name: 'Foundling Rescue', cost: 4 }),
  ASH_091: card({ id: 'ASH_091', type: 'event', name: 'Buy Time', cost: 3 }),
  ASH_103: card({ id: 'ASH_103', type: 'event', name: 'Long Live the Empire', cost: 2 }),
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  TOUGH: card({ id: 'TOUGH', type: 'unit', arena: 'ground', cost: 4, power: 2, hp: 20 }),
  IMP: card({ id: 'IMP', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 6, traits: ['Imperial'] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const play = (s: GameState) => resolve(s, { type: 'playEvent', handIndex: 0 })
const choice = (s: GameState) => s.pendingChoices![0]
const upgraded = (id: string, cardId: string) => unit(id, cardId, { upgrades: [{ cardId: 'UPG', owner: 'player' }] })

describe('Operation Cinder (151) — 5 to your base, then 5 to every unit', () => {
  it('hits both sides and your own base', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_151'], units: [unit('a', 'TOUGH')], base: { cardId: 'TST_B', damage: 2 } }),
        opponent: player({ units: [unit('e', 'TOUGH')] }),
      },
    })
    const done = play(s)
    expect(done.players.player.base.damage).toBe(7)
    expect(U(done, 'a')!.damage).toBe(5)
    expect(U(done, 'e')!.damage).toBe(5)
  })
})

describe('Reckoning (187) — damage equal to the total damage on your units', () => {
  it('totals your own units’ damage and deals it to a chosen unit', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_187'], units: [unit('a', 'TOUGH', { damage: 3 }), unit('b', 'TOUGH', { damage: 4 })] }),
        opponent: player({ units: [unit('e', 'TOUGH')] }),
      },
    })
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'selectDamageTarget', amount: 7 })
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, targetInstanceId: 'e' })
    expect(U(done, 'e')!.damage).toBe(7)
  })

  it('does nothing when your units are undamaged', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_187'], units: [unit('a', 'TOUGH')] }), opponent: player({ units: [unit('e', 'TOUGH')] }) } })
    expect(play(s).pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Turning the Tide (138) — 1 damage per friendly unit', () => {
  it('scales with how many units you control', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_138'], units: [unit('a', 'GRD'), unit('b', 'GRD'), unit('c', 'GRD')] }),
        opponent: player({ units: [unit('e', 'TOUGH')] }),
      },
    })
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'selectDamageTarget', amount: 3 })
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, targetInstanceId: 'e' })
    expect(U(done, 'e')!.damage).toBe(3)
  })
})

describe('A New Order (264) — an Advantage token to each of up to 2 units', () => {
  it('gives one each to two different units, and can stop early', () => {
    const s = state({
      cards: F,
      players: { player: rich({ hand: ['ASH_264'], units: [unit('a', 'GRD'), unit('b', 'GRD')] }), opponent: player() },
    })
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'multiPick' })
    const one = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, targetInstanceId: 'a' })
    const two = resolve(one, { type: 'acceptChoice', choiceId: choice(one).id, targetInstanceId: 'b' })
    const advs = (id: string) => U(two, id)!.upgrades.filter(u => u.cardId === TOKEN_ADVANTAGE).length
    expect(advs('a')).toBe(1)
    expect(advs('b')).toBe(1)
    expect(two.pendingChoices ?? []).toHaveLength(0) // pool spent
  })
})

describe('Get Lost (067) — defeat an upgraded non-leader unit', () => {
  it('offers only upgraded non-leader units, on either side', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_067'], units: [upgraded('mine', 'GRD'), unit('plain', 'GRD')] }),
        opponent: player({ units: [upgraded('theirs', 'GRD'), unit('lead', 'GRD', { isLeader: true, upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })] }),
      },
    })
    const played = play(s)
    const c = choice(played)
    expect(c.kind === 'selectUnitToDefeat' && c.targets.sort()).toEqual(['mine', 'theirs'])
    const done = resolve(played, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'theirs' })
    expect(U(done, 'theirs')).toBeUndefined()
  })

  it('raises no choice when nothing is upgraded', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_067'], units: [unit('a', 'GRD')] }), opponent: player() } })
    expect(play(s).pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Foundling Rescue (092) — optional defeat, then a token', () => {
  it('offers only units with 2 or less remaining HP, and always creates the token', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_092'] }),
        opponent: player({ units: [unit('weak', 'GRD', { damage: 5 }), unit('healthy', 'GRD')] }), // 6hp: 1 left vs 6
      },
    })
    const played = play(s)
    const c = choice(played)
    expect(c.kind === 'selectUnitToDefeat' && c.targets).toEqual(['weak'])
    const done = resolve(played, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'weak' })
    expect(U(done, 'weak')).toBeUndefined()
    expect(done.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(1)
  })

  it('still creates the token when the defeat is declined', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_092'] }), opponent: player({ units: [unit('weak', 'GRD', { damage: 5 })] }) } })
    const played = play(s)
    const done = resolve(played, { type: 'skipTrigger', choiceId: choice(played).id })
    expect(U(done, 'weak')).toBeDefined()
    expect(done.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(1)
  })
})

describe('Buy Time (091) — a Mandalorian token with Sentinel for the phase', () => {
  it('creates the token and gives that token Sentinel', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_091'] }), opponent: player() } })
    const done = play(s)
    const token = done.players.player.units.find(u => u.cardId === TOKEN_MANDALORIAN)!
    expect(token).toBeDefined()
    expect(unitHasKeyword(done, token, 'Sentinel')).toBe(true)
  })
})

describe('Long Live the Empire (103) — defeat a friendly Imperial to resource the top card', () => {
  it('defeats the chosen Imperial and resources the top card', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_103'], units: [unit('imp', 'IMP'), unit('plain', 'GRD')], deck: ['GRD', 'TOUGH'] }),
        opponent: player(),
      },
    })
    const played = play(s)
    const c = choice(played)
    expect(c.kind === 'selectUnitToDefeat' && c.targets).toEqual(['imp']) // friendly Imperials only
    const before = played.players.player.resources.length
    const done = resolve(played, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'imp' })
    expect(U(done, 'imp')).toBeUndefined()
    expect(done.players.player.resources).toHaveLength(before + 1)
    expect(done.players.player.deck[0]).toBe('TOUGH') // top card went to resources
  })

  it('resources nothing if the defeat is declined', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_103'], units: [unit('imp', 'IMP')], deck: ['GRD'] }), opponent: player() } })
    const played = play(s)
    const before = played.players.player.resources.length
    const done = resolve(played, { type: 'skipTrigger', choiceId: choice(played).id })
    expect(done.players.player.resources).toHaveLength(before)
  })
})
