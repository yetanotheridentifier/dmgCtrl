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
  ASH_195: card({ id: 'ASH_195', type: 'unit', arena: 'ground', power: 6, hp: 4 }), // Helgait
  ASH_043: card({ id: 'ASH_043', type: 'unit', arena: 'space', power: 2, hp: 3 }), // Corona Four
  ZEROPOW: card({ id: 'ZEROPOW', type: 'unit', arena: 'ground', power: 0, hp: 3 }),
  ASH_165: card({ id: 'ASH_165', type: 'unit', arena: 'ground', power: 2, hp: 3 }), // Clan Vizsla Soldier
  ASH_097: card({ id: 'ASH_097', type: 'unit', arena: 'ground', power: 2, hp: 5, keywords: [{ name: 'Sentinel' }] }), // Moff Gideon
  UPG: card({ id: 'UPG', type: 'upgrade', power: 1, hp: 1 }),
  IMPUNIT: card({ id: 'IMPUNIT', type: 'unit', arena: 'ground', power: 3, hp: 3, traits: ['Imperial'] }),
  IMPUNIQUE: card({ id: 'IMPUNIQUE', type: 'unit', arena: 'ground', power: 3, hp: 3, traits: ['Imperial'], unique: true }),
  REBELUNIT: card({ id: 'REBELUNIT', type: 'unit', arena: 'ground', power: 3, hp: 3, traits: ['Rebel'] }),
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

describe('Group E — Helgait (195): distribute Advantage = power', () => {
  it('distributes power(6) Advantage among friendly units, stacking allowed, Done stops early', () => {
    const s = defeat('ASH_195', { playerUnits: [unit('a', 'FILLER', { arena: 'ground' }), unit('b', 'FILLER', { arena: 'ground' })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'distributeTokens', token: TOKEN_ADVANTAGE, remaining: 6, total: 6 })
    const targets = legalMoves(s).filter(a => a.type === 'acceptChoice').map(a => a.targetInstanceId)
    expect(targets.sort()).toEqual(['a', 'b']) // friendly only
    let cur = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, targetInstanceId: 'a' })
    expect(advs(U(cur, 'a'))).toBe(1)
    expect(cur.pendingChoices?.[0]).toMatchObject({ remaining: 5 })
    cur = resolve(cur, { type: 'acceptChoice', choiceId: cur.pendingChoices![0].id, targetInstanceId: 'a' }) // stack on the same unit
    expect(advs(U(cur, 'a'))).toBe(2)
    const done = resolve(cur, { type: 'skipTrigger', choiceId: cur.pendingChoices![0].id })
    expect(done.pendingChoices ?? []).toHaveLength(0)
  })

  it('no effect with no other friendly unit', () => {
    expect(defeat('ASH_195').pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Group E — Corona Four (043)', () => {
  it('whenDefeated: may defeat a non-leader unit with 0 power', () => {
    const s = defeat('ASH_043', { oppUnits: [unit('z', 'ZEROPOW', { arena: 'ground' }), unit('e', 'FILLER', { arena: 'ground' })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayDefeatEnemyUnit' })
    const targets = legalMoves(s).filter(a => a.type === 'acceptChoice').map(a => a.targetInstanceId)
    expect(targets).toEqual(['z']) // only the 0-power unit (FILLER has power 2)
    const done = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, targetInstanceId: 'z' })
    expect(done.players.opponent.units.find(u => u.instanceId === 'z')).toBeUndefined()
  })

  it('onAttack: may give a unit -2/-0 this phase', () => {
    const s = state({
      cards: E,
      players: {
        player: player({ units: [unit('c', 'ASH_043', { arena: 'space' })] }),
        opponent: player({ units: [unit('e', 'FILLERSPACE', { arena: 'space' })] }),
      },
    })
    const attacked = resolve(s, { type: 'attack', attackerId: 'c', target: { kind: 'base' } })
    expect(attacked.pendingChoices?.[0]).toMatchObject({ kind: 'mayLastingBuff', power: -2 })
  })
})

describe('Group E — Clan Vizsla Soldier (165): may defeat an upgrade', () => {
  it('raises an optional upgrade-defeat choice covering upgrades on either side', () => {
    const s = defeat('ASH_165', { oppUnits: [unit('e', 'FILLER', { arena: 'ground', upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'selectUpgradeToDefeat', optional: true })
    const done = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, optionIndex: 0 })
    expect(U(done, 'e').upgrades).toHaveLength(0) // the upgrade was defeated
    expect(done.pendingChoices ?? []).toHaveLength(0) // no damage follow-up (unlike Vane)
  })

  it('no upgrades in play → no choice', () => {
    expect(defeat('ASH_165', { oppUnits: [unit('e', 'FILLER', { arena: 'ground' })] }).pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Group E — Moff Gideon (097): return a non-unique Imperial from discard', () => {
  it('offers only non-unique Imperial units in your discard, and returns the pick to hand', () => {
    // seed the discard, then defeat Moff Gideon
    const board = state({
      cards: E,
      players: {
        player: player({ units: [unit('t', 'ASH_097', { arena: 'ground', damage: 4 })], discard: ['IMPUNIT', 'IMPUNIQUE', 'REBELUNIT'] }),
        opponent: player({}),
      },
    })
    const defeated = dealDamageToUnit(board, 't', 1)
    expect(defeated.pendingChoices?.[0]).toMatchObject({ kind: 'selectFromDiscard', optional: true })
    const cands = (defeated.pendingChoices![0] as { candidates: string[] }).candidates
    expect(cands).toEqual(['IMPUNIT']) // unique Imperial + Rebel excluded
    const done = resolve(defeated, { type: 'acceptChoice', choiceId: defeated.pendingChoices![0].id, optionIndex: 0 })
    expect(done.players.player.hand).toContain('IMPUNIT')
    expect(done.players.player.discard).not.toContain('IMPUNIT')
  })
})
