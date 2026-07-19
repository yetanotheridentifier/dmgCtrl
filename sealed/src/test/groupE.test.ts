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
  UPG0: card({ id: 'UPG0', type: 'upgrade', power: 0, hp: 0 }), // stat-neutral (just marks a unit "upgraded")
  IMPUNIT: card({ id: 'IMPUNIT', type: 'unit', arena: 'ground', power: 3, hp: 3, traits: ['Imperial'] }),
  IMPUNIQUE: card({ id: 'IMPUNIQUE', type: 'unit', arena: 'ground', power: 3, hp: 3, traits: ['Imperial'], unique: true }),
  REBELUNIT: card({ id: 'REBELUNIT', type: 'unit', arena: 'ground', power: 3, hp: 3, traits: ['Rebel'] }),
  ASH_027: card({ id: 'ASH_027', type: 'unit', arena: 'ground', power: 4, hp: 5 }), // Enoch
  ASH_038: card({ id: 'ASH_038', type: 'unit', arena: 'space', power: 6, hp: 10 }), // Purrgil Ultra
  ASH_045: card({ id: 'ASH_045', type: 'unit', arena: 'ground', power: 2, hp: 2 }), // Reanimated Night Trooper
  COST3UNIT: card({ id: 'COST3UNIT', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2 }),
  // onAttack batch A
  ASH_157: card({ id: 'ASH_157', type: 'unit', arena: 'space', power: 4, hp: 5 }), // Danger Squadron Wingmen
  ASH_189: card({ id: 'ASH_189', type: 'unit', arena: 'ground', power: 0, hp: 3, keywords: [{ name: 'Support' }] }), // Emperor's Messenger
  ASH_056: card({ id: 'ASH_056', type: 'unit', arena: 'ground', power: 2, hp: 4 }), // Huyang
  ASH_168: card({ id: 'ASH_168', type: 'unit', arena: 'ground', power: 2, hp: 3, keywords: [{ name: 'Support' }] }), // Migs Mayfeld
  ASH_083: card({ id: 'ASH_083', type: 'unit', arena: 'space', power: 15, hp: 15, keywords: [{ name: 'Sentinel' }] }), // Summa-verminoth
  ASH_156: card({ id: 'ASH_156', type: 'unit', arena: 'ground', power: 3, hp: 4, keywords: [{ name: 'Support' }] }), // R5-D4
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

describe('Group E — Enoch (027): self base-damage for a discount', () => {
  it('deals up to 6 to your base; -1 discount per 2 dealt (Done at 4 → -2)', () => {
    let s = defeat('ASH_027')
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'dealOwnBaseForDiscount', dealt: 0, max: 6 })
    for (let i = 0; i < 4; i++) s = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id })
    s = resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id }) // Done at 4
    expect(s.players.player.base.damage).toBe(4)
    expect(s.players.player.nextUnitGrants).toEqual([{ costDelta: -2 }])
  })

  it('reaching the max deals 6 and grants -3 (no extra Done)', () => {
    let s = defeat('ASH_027')
    for (let i = 0; i < 6; i++) s = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id })
    expect(s.pendingChoices ?? []).toHaveLength(0)
    expect(s.players.player.base.damage).toBe(6)
    expect(s.players.player.nextUnitGrants).toEqual([{ costDelta: -3 }])
  })

  it('declining immediately deals nothing and grants no discount', () => {
    const d = defeat('ASH_027')
    const s = resolve(d, { type: 'skipTrigger', choiceId: d.pendingChoices![0].id })
    expect(s.players.player.base.damage).toBe(0)
    expect(s.players.player.nextUnitGrants ?? []).toHaveLength(0)
  })
})

describe('Group E — Purrgil Ultra (038): return a unit, deal its cost', () => {
  it('returns a friendly unit to hand, then deals its cost to a chosen unit', () => {
    const s = defeat('ASH_038', { playerUnits: [unit('r', 'COST3UNIT', { arena: 'ground' })], oppUnits: [unit('e', 'FILLER', { arena: 'ground' })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'returnFriendlyUnit' })
    const ret = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, targetInstanceId: 'r' })
    expect(ret.players.player.hand).toContain('COST3UNIT') // returned to hand
    expect(ret.players.player.units.find(u => u.instanceId === 'r')).toBeUndefined()
    expect(ret.pendingChoices?.[0]).toMatchObject({ kind: 'mayDamage', amount: 3, optional: false })
    const done = resolve(ret, { type: 'acceptChoice', choiceId: ret.pendingChoices![0].id, targetInstanceId: 'e' })
    expect(U(done, 'e').damage).toBe(3)
  })

  it('is optional — declining returns nothing', () => {
    const s = defeat('ASH_038', { playerUnits: [unit('r', 'COST3UNIT', { arena: 'ground' })] })
    const done = resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id })
    expect(done.players.player.hand).not.toContain('COST3UNIT')
    expect(done.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Group E — Reanimated Night Trooper (045): peek & maybe discard a deck top', () => {
  const board = () => state({
    cards: E,
    players: {
      player: player({ units: [unit('t', 'ASH_045', { arena: 'ground', damage: 1 })], deck: ['FILLER', 'ZEROPOW'] }),
      opponent: player({ deck: ['REBELUNIT', 'IMPUNIT'] }),
    },
  })

  it('may discard the top card of a chosen deck', () => {
    const s = dealDamageToUnit(board(), 't', 1)
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'peekTopDiscard', decks: ['player', 'opponent'] })
    const done = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, baseTarget: 'opponent' })
    expect(done.players.opponent.deck).toEqual(['IMPUNIT'])
    expect(done.players.opponent.discard).toContain('REBELUNIT')
  })

  it('may decline (look only)', () => {
    const s = dealDamageToUnit(board(), 't', 1)
    const done = resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id })
    expect(done.players.player.deck).toEqual(['FILLER', 'ZEROPOW'])
    expect(done.players.opponent.deck).toEqual(['REBELUNIT', 'IMPUNIT'])
  })
})

/** Attack with `cardId` (a ready player unit) and return the resulting state. */
function onAtk(cardId: string, opts: { target?: { kind: 'base' } | { kind: 'unit'; instanceId: string }; oppUnits?: UnitState[]; playerUnits?: UnitState[]; upgrades?: { cardId: string; owner: 'player' | 'opponent' }[]; resources?: PlayerState['resources'] } = {}): GameState {
  const c = E[cardId as keyof typeof E]
  const s = state({
    cards: E,
    players: {
      player: player({ units: [unit('a', cardId, { arena: c.arena, upgrades: opts.upgrades ?? [] }), ...(opts.playerUnits ?? [])], resources: opts.resources ?? [] }),
      opponent: player({ units: opts.oppUnits ?? [] }),
    },
  })
  return resolve(s, { type: 'attack', attackerId: 'a', target: opts.target ?? { kind: 'base' } })
}

describe('Group E — onAttack, simple (#356)', () => {
  it('Danger Squadron Wingmen (157): may give an Advantage to ANOTHER unit', () => {
    const s = onAtk('ASH_157', { playerUnits: [unit('f', 'FILLER', { arena: 'ground' })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_ADVANTAGE, count: 1, optional: true })
    const targets = legalMoves(s).filter(a => a.type === 'acceptChoice').map(a => a.targetInstanceId)
    expect(targets).toContain('f')
    expect(targets).not.toContain('a') // "another" excludes self
  })

  it("Emperor's Messenger (189): readies a resource on attack", () => {
    const s = onAtk('ASH_189', { resources: [{ cardId: 'FILLER', exhausted: true }, { cardId: 'FILLER', exhausted: true }] })
    expect(s.players.player.resources.filter(r => !r.exhausted)).toHaveLength(1)
  })

  it('Huyang (056): may give an upgraded unit -4/-0', () => {
    const s = onAtk('ASH_056', { oppUnits: [unit('up', 'FILLER', { arena: 'ground', upgrades: [{ cardId: 'UPG', owner: 'opponent' }] }), unit('plain', 'FILLER', { arena: 'ground' })] })
    expect(s.pendingChoices?.[0]).toMatchObject({ kind: 'mayLastingBuff', power: -4 })
    const targets = legalMoves(s).filter(a => a.type === 'acceptChoice').map(a => a.targetInstanceId)
    expect(targets).toEqual(['up']) // only the upgraded unit
  })

  it('Migs Mayfeld (168): deals 1 to the defender, 2 if upgraded', () => {
    const plain = onAtk('ASH_168', { oppUnits: [unit('e', 'FILLER', { arena: 'ground' })], target: { kind: 'unit', instanceId: 'e' } })
    expect(U(plain, 'e').damage).toBe(1 + 2) // 1 onAttack + 2 combat
    const up = onAtk('ASH_168', { upgrades: [{ cardId: 'UPG0', owner: 'player' }], oppUnits: [unit('e', 'FILLER', { arena: 'ground' })], target: { kind: 'unit', instanceId: 'e' } })
    expect(U(up, 'e').damage).toBe(2 + 2) // 2 onAttack (upgraded) + 2 combat
  })

  it('R5-D4 (156): defeats all upgrades on the defending unit', () => {
    const s = onAtk('ASH_156', { oppUnits: [unit('e', 'FILLER', { arena: 'ground', upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })], target: { kind: 'unit', instanceId: 'e' } })
    expect(U(s, 'e').upgrades).toHaveLength(0)
  })

  it('Summa-verminoth (083): defeats all other space units', () => {
    const s = onAtk('ASH_083', { playerUnits: [unit('mine', 'FILLERSPACE', { arena: 'space' })], oppUnits: [unit('theirs', 'FILLERSPACE', { arena: 'space' }), unit('grd', 'FILLER', { arena: 'ground' })] })
    expect(U(s, 'mine')).toBeUndefined()
    expect(U(s, 'theirs')).toBeUndefined()
    expect(U(s, 'grd')).toBeDefined() // ground survives
    expect(s.players.player.units.some(u => u.instanceId === 'a')).toBe(true) // Summa itself survives
  })
})
