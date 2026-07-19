import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { dealDamageToUnit } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState, PlayerState, UnitState } from '../engine/types'

/**
 * Group E (#356): whenDefeated / onAttack / attack-end / action abilities. Tests defeat the unit
 * (via `dealDamageToUnit`, which fires `whenDefeated` through the same `finishDefeats` path combat
 * uses) and assert the resulting board / raised choice. The mid-combat handoff is covered separately
 * by `whenDefeatedCombat.test.ts`.
 */
const E = {
  ...CARDS,
  ASH_116: card({ id: 'ASH_116', type: 'unit', arena: 'ground', power: 1, hp: 2 }), // Ant Droid
  ASH_080: card({ id: 'ASH_080', type: 'unit', arena: 'ground', power: 4, hp: 5 }), // Covert Believers
  ASH_058: card({ id: 'ASH_058', type: 'unit', arena: 'ground', power: 2, hp: 3 }), // Duchess's Protector
  ASH_153: card({ id: 'ASH_153', type: 'unit', arena: 'space', power: 3, hp: 1 }), // Green Leader
  ASH_254: card({ id: 'ASH_254', type: 'unit', arena: 'space', power: 3, hp: 5 }), // Gallofree Transport
  ASH_216: card({ id: 'ASH_216', type: 'unit', arena: 'ground', power: 3, hp: 3 }), // Mandalorian Scout
  ASH_028: card({ id: 'ASH_028', type: 'unit', arena: 'ground', power: 4, hp: 7, keywords: [{ name: 'Sentinel' }] }), // Paz Vizsla
  ASH_191: card({ id: 'ASH_191', type: 'unit', arena: 'space', power: 3, hp: 1 }), // Shin Hati's Fiend Fighter
  ASH_167: card({ id: 'ASH_167', type: 'unit', arena: 'space', power: 2, hp: 1 }), // Flarestar Attack Shuttle
  FILLER: card({ id: 'FILLER', type: 'unit', arena: 'ground', power: 2, hp: 5 }),
  FILLERSPACE: card({ id: 'FILLERSPACE', type: 'unit', arena: 'space', power: 2, hp: 5 }),
  BRUISERBIG: card({ id: 'BRUISERBIG', type: 'unit', arena: 'ground', power: 9, hp: 10 }),
  BRUISERSPACE: card({ id: 'BRUISERSPACE', type: 'unit', arena: 'space', power: 9, hp: 10 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!
const advs = (u: { upgrades: { cardId: string }[] }) => u.upgrades.filter(a => a.cardId === TOKEN_ADVANTAGE).length

/** Defeat the player's own `cardId` unit (placed 1 short of lethal) so its whenDefeated fires. */
function defeat(cardId: string, extra: { playerUnits?: UnitState[]; oppUnits?: UnitState[]; resources?: PlayerState['resources'] } = {}): GameState {
  const c = E[cardId as keyof typeof E]
  const s = state({
    cards: E,
    players: {
      player: player({ units: [unit('t', cardId, { arena: c.arena, damage: (c.hp ?? 1) - 1 }), ...(extra.playerUnits ?? [])], resources: extra.resources ?? [] }),
      opponent: player({ units: extra.oppUnits ?? [] }),
    },
  })
  return dealDamageToUnit(s, 't', 1)
}

/** Defeat the player's own `cardId` unit *in combat* (attacking a bruiser that kills it on the counter). */
function defeatInCombat(cardId: string): GameState {
  const c = E[cardId as keyof typeof E]
  const bruiser = c.arena === 'space' ? 'BRUISERSPACE' : 'BRUISERBIG'
  const s = state({
    cards: E,
    players: {
      player: player({ units: [unit('t', cardId, { arena: c.arena })] }),
      opponent: player({ units: [unit('br', bruiser, { arena: c.arena })] }),
    },
  })
  return resolve(s, { type: 'attack', attackerId: 't', target: { kind: 'unit', instanceId: 'br' } })
}

describe('Group E — whenDefeated, simple effects (#356)', () => {
  it('Ant Droid (116): draws a card', () => {
    expect(defeat('ASH_116').players.player.hand).toHaveLength(1)
  })

  it('Covert Believers (080): creates a Mandalorian token', () => {
    expect(defeat('ASH_080').players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(1)
  })

  it("Duchess's Protector (058): creates a Mandalorian token", () => {
    expect(defeat('ASH_058').players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(1)
  })

  it('Mandalorian Scout (216): exhausts one ready friendly resource', () => {
    const s = defeat('ASH_216', { resources: ready(3) })
    expect(s.players.player.resources.filter(r => r.exhausted)).toHaveLength(1)
  })

  it('Mandalorian Scout: a no-op with no ready resource', () => {
    const s = defeat('ASH_216', { resources: [] })
    expect(s.players.player.resources).toHaveLength(0) // no crash, nothing exhausted
  })
})

describe('Group E — whenDefeated, target choices (#356)', () => {
  it('Green Leader (153): may deal 2 damage to a unit', () => {
    const s = defeat('ASH_153', { oppUnits: [unit('e', 'FILLER', { arena: 'ground' })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayDamage', amount: 2, controller: 'player', optional: true })
    const done = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, targetInstanceId: 'e' })
    expect(U(done, 'e').damage).toBe(2)
  })

  it('Green Leader: the choice can be declined', () => {
    const s = defeat('ASH_153', { oppUnits: [unit('e', 'FILLER', { arena: 'ground' })] })
    const done = resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id })
    expect(U(done, 'e').damage).toBe(0)
  })

  it('Gallofree Transport (254): gives 2 Advantage tokens to a friendly unit', () => {
    const s = defeat('ASH_254', { playerUnits: [unit('f', 'FILLER', { arena: 'ground' })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_ADVANTAGE, count: 2 })
    // mandatory, and only friendly units are eligible
    const targets = legalMoves(s).filter(a => a.type === 'acceptChoice').map(a => a.targetInstanceId)
    expect(targets).toEqual(['f'])
    expect(legalMoves(s).some(a => a.type === 'skipTrigger')).toBe(false)
    const done = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, targetInstanceId: 'f' })
    expect(advs(U(done, 'f'))).toBe(2)
  })

  it('Gallofree Transport: no other friendly unit → no effect', () => {
    expect(defeat('ASH_254').pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Group E — whenDefeated, combat-context (#356)', () => {
  it('Paz Vizsla (028): creates 2 Mandalorian tokens when NOT defeated by combat', () => {
    const s = defeat('ASH_028') // ability damage, not combat
    expect(s.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(2)
  })

  it('Paz Vizsla: makes no tokens when defeated by combat damage', () => {
    const s = defeatInCombat('ASH_028')
    expect(s.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(0)
  })

  it("Shin Hati's Fiend Fighter (191): offers 3 Advantage when NOT defeated by combat", () => {
    const s = defeat('ASH_191', { oppUnits: [unit('e', 'FILLERSPACE', { arena: 'space' })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_ADVANTAGE, count: 3, optional: true })
  })

  it("Shin Hati's Fiend Fighter: only 2 Advantage when defeated by combat", () => {
    const s = defeatInCombat('ASH_191')
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens', count: 2 })
  })
})

describe('Group E — Flarestar (167): whenPlayed / whenDefeated (#356)', () => {
  it('may give an Advantage token to a unit when defeated', () => {
    const s = defeat('ASH_167', { oppUnits: [unit('e', 'FILLER', { arena: 'ground' })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_ADVANTAGE, count: 1, optional: true })
    const done = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, targetInstanceId: 'e' })
    expect(advs(U(done, 'e'))).toBe(1)
  })
})
