import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToUnit } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * Units whose text is a sequence of decisions: pick two things, pay-then-choose,
 * reveal-then-target, or pick-then-pick-a-mode.
 */
const F = {
  ...CARDS,
  ASH_052: card({ id: 'ASH_052', type: 'unit', arena: 'space', cost: 7, power: 6, hp: 6 }), // Chimaera
  ASH_042: card({ id: 'ASH_042', type: 'unit', arena: 'ground', cost: 4, power: 2, hp: 6, keywords: [{ name: 'Restore', value: 2 }] }), // Jabba the Hutt
  ASH_219: card({ id: 'ASH_219', type: 'unit', arena: 'ground', cost: 3, power: 4, hp: 3, keywords: [{ name: 'Sentinel' }] }), // Jod Na Nawood
  ASH_132: card({ id: 'ASH_132', type: 'unit', arena: 'ground', cost: 6, power: 5, hp: 7 }), // Queen Soruna
  ASH_133: card({ id: 'ASH_133', type: 'unit', arena: 'ground', cost: 8, power: 5, hp: 9 }), // Trask Walker
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 5 }),
  SPC: card({ id: 'SPC', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 5 }),
  COST3: card({ id: 'COST3', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 9 }),
  COST5: card({ id: 'COST5', type: 'unit', arena: 'ground', cost: 5, power: 2, hp: 9 }),
  DEAR: card({ id: 'DEAR', type: 'unit', arena: 'ground', cost: 9, power: 2, hp: 2 }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 2, power: 1, hp: 1 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const choice = (s: GameState) => s.pendingChoices![0]
const readyCount = (s: GameState, p: 'player' | 'opponent' = 'player') => s.players[p].resources.filter(r => !r.exhausted).length

describe('Chimaera (052) — pair a friendly and an enemy unit for defeat', () => {
  const board = () => state({
    cards: F,
    players: {
      player: rich({ hand: ['ASH_052'], units: [unit('f', 'GRD')] }),
      opponent: player({ units: [unit('e', 'GRD')], base: { cardId: 'TST_B', damage: 5 } }),
    },
  })

  it('defeats both chosen units, in two picks', () => {
    const p = resolve(board(), { type: 'playUnit', handIndex: 0 })
    expect(choice(p)).toMatchObject({ kind: 'selectPairToDefeat' })
    const friendly = resolve(p, { type: 'acceptChoice', choiceId: choice(p).id, targetInstanceId: 'f' })
    expect(choice(friendly)).toMatchObject({ kind: 'selectPairToDefeat', chosenFriendly: 'f' })
    const done = resolve(friendly, { type: 'acceptChoice', choiceId: choice(friendly).id, targetInstanceId: 'e' })
    expect(U(done, 'f')).toBeUndefined()
    expect(U(done, 'e')).toBeUndefined()
  })

  it('declining costs nothing', () => {
    const p = resolve(board(), { type: 'playUnit', handIndex: 0 })
    const done = resolve(p, { type: 'skipTrigger', choiceId: choice(p).id })
    expect(U(done, 'f')).toBeDefined()
    expect(U(done, 'e')).toBeDefined()
  })

  it('heals 2 from your base when an enemy unit is defeated', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ units: [unit('c', 'ASH_052', { arena: 'space' })], base: { cardId: 'TST_B', damage: 5 } }),
        opponent: player({ units: [unit('e', 'GRD')] }),
      },
    })
    const dead = dealDamageToUnit(s, 'e', 9)
    expect(dead.players.player.base.damage).toBe(3)
  })
})

describe('Jabba the Hutt (042) — return an upgrade, then replay it free', () => {
  it('returns your own upgrade and offers to replay it for free', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_042'], units: [unit('g', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] }),
        opponent: player(),
      },
    })
    const p = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(choice(p)).toMatchObject({ kind: 'selectUpgradeToReturn' })
    const returned = resolve(p, { type: 'acceptChoice', choiceId: choice(p).id, optionIndex: 0 })
    expect(U(returned, 'g').upgrades).toHaveLength(0)
    expect(returned.players.player.hand).toContain('UPG')
    expect(choice(returned)).toMatchObject({ kind: 'mayPlayUpgradeFree', cardId: 'UPG' })

    const before = readyCount(returned)
    const replayed = resolve(returned, { type: 'acceptChoice', choiceId: choice(returned).id, targetInstanceId: 'g' })
    expect(U(replayed, 'g').upgrades).toHaveLength(1)
    expect(readyCount(replayed)).toBe(before) // free
    expect(replayed.players.player.hand).not.toContain('UPG')
  })

  it('does not offer a free replay for an enemy-owned upgrade', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_042'] }),
        opponent: player({ units: [unit('e', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })] }),
      },
    })
    const p = resolve(s, { type: 'playUnit', handIndex: 0 })
    const returned = resolve(p, { type: 'acceptChoice', choiceId: choice(p).id, optionIndex: 0 })
    expect(returned.players.opponent.hand).toContain('UPG') // to ITS owner's hand
    expect(returned.pendingChoices ?? []).toHaveLength(0) // not your hand → no free play
  })
})

describe('Jod Na Nawood (219) — pay 4 to exhaust an arena', () => {
  it('pays 4 and exhausts every unit in the chosen arena, both sides', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_219'], units: [unit('pg', 'GRD'), unit('ps', 'SPC', { arena: 'space' })] }),
        opponent: player({ units: [unit('eg', 'GRD'), unit('es', 'SPC', { arena: 'space' })] }),
      },
    })
    const p = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(choice(p)).toMatchObject({ kind: 'mayPayExhaustArena', cost: 4 })
    const before = readyCount(p)
    const done = resolve(p, { type: 'acceptChoice', choiceId: choice(p).id, optionIndex: 0 }) // ground
    expect(readyCount(done)).toBe(before - 4)
    expect(U(done, 'pg').exhausted).toBe(true)
    expect(U(done, 'eg').exhausted).toBe(true)
    expect(U(done, 'ps').exhausted).toBe(false) // space untouched
    expect(U(done, 'es').exhausted).toBe(false)
  })

  it('is not offered when the player cannot pay', () => {
    const s = state({
      cards: F,
      players: { player: player({ resources: ready(3), hand: ['ASH_219'] }), opponent: player() },
    })
    const p = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(p.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Queen Soruna (132) — reveal a unit to snipe one of matching cost', () => {
  it('deals 3 to a unit costing the same as the revealed card', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_132', 'COST3'] }),
        opponent: player({ units: [unit('match', 'COST3'), unit('other', 'COST5')] }),
      },
    })
    const p = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(choice(p)).toMatchObject({ kind: 'revealUnitFromHand' })
    const revealed = resolve(p, { type: 'acceptChoice', choiceId: choice(p).id, handIndex: 0 }) // COST3
    const dmg = choice(revealed)
    expect(dmg).toMatchObject({ kind: 'selectDamageTarget', amount: 3, unitTargets: ['match'] })
    const done = resolve(revealed, { type: 'acceptChoice', choiceId: dmg.id, targetInstanceId: 'match' })
    expect(U(done, 'match').damage).toBe(3)
  })

  it('can be declined', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_132', 'COST3'] }), opponent: player({ units: [unit('m', 'COST3')] }) } })
    const p = resolve(s, { type: 'playUnit', handIndex: 0 })
    const done = resolve(p, { type: 'skipTrigger', choiceId: choice(p).id })
    expect(U(done, 'm').damage).toBe(0)
  })
})

describe('Trask Walker (133) — take a discarded unit to hand, or bottom it and heal', () => {
  const board = () => state({
    cards: F,
    players: {
      player: rich({ hand: ['ASH_133'], discard: ['COST3', 'DEAR'], base: { cardId: 'TST_B', damage: 6 } }),
      opponent: player(),
    },
  })

  it('offers only discard units costing 7 or less, then the two modes', () => {
    const p = resolve(board(), { type: 'playUnit', handIndex: 0 })
    expect(choice(p)).toMatchObject({ kind: 'selectFromDiscard', candidates: ['COST3'] }) // DEAR costs 9
    const picked = resolve(p, { type: 'acceptChoice', choiceId: choice(p).id, optionIndex: 0 })
    expect(choice(picked)).toMatchObject({ kind: 'chooseDiscardFate', cardId: 'COST3' })

    const toHand = resolve(picked, { type: 'acceptChoice', choiceId: choice(picked).id, optionIndex: 1 })
    expect(toHand.players.player.hand).toContain('COST3')
    expect(toHand.players.player.discard).not.toContain('COST3')
    expect(toHand.players.player.base.damage).toBe(6) // no heal on this branch
  })

  it('bottoms the card and heals 3 on the other mode', () => {
    const p = resolve(board(), { type: 'playUnit', handIndex: 0 })
    const picked = resolve(p, { type: 'acceptChoice', choiceId: choice(p).id, optionIndex: 0 })
    const bottomed = resolve(picked, { type: 'acceptChoice', choiceId: choice(picked).id, optionIndex: 0 })
    expect(bottomed.players.player.deck.at(-1)).toBe('COST3')
    expect(bottomed.players.player.discard).not.toContain('COST3')
    expect(bottomed.players.player.base.damage).toBe(3)
  })
})
