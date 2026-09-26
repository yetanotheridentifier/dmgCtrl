import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { defeatUnit } from '../engine/combat'
import { effectiveCost } from '../engine/legalMoves'
import { effectivePower } from '../engine/stats'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState } from '../engine/types'
import { TOKEN_SHIELD, hasToken } from '../engine/tokenUpgrades'
import { TOKEN_BATTLE_DROID } from '../engine/tokenUnits'

/**
 * #707, wave 2: cards needing a CHOSEN guardian AND/OR a chosen target in one action (the guardian
 * first, or the reverse, Ephant Mon), and the rescue/discard actions built on #466's
 * `rescueCaptured`/`discardCaptured`. Each test checks the registration wires the right filter and
 * chaining, not the capture primitive itself (`capture.test.ts`) or the shared filter helpers
 * (`captureCards.test.ts`). Every choice here is `selectUnitThen`/`selectCardThen`/`mayCollectBounty`,
 * already generic kinds, so nothing new is owed in legalMoves.ts.
 */
const F: Record<string, EngineCard> = {
  ...CARDS,
  SEC_068: card({ id: 'SEC_068', name: 'Lando Calrissian', type: 'unit', arena: 'ground', cost: 7, power: 6, hp: 8 }),
  SEC_212: card({ id: 'SEC_212', name: 'Libertine', type: 'unit', arena: 'space', cost: 4, power: 3, hp: 7 }),
  SHD_232: card({ id: 'SHD_232', name: 'Relentless Pursuit', type: 'event', cost: 3 }),
  SHD_131: card({ id: 'SHD_131', name: 'Take Captive', type: 'event', cost: 3 }),
  TWI_128: card({ id: 'TWI_128', name: 'Take Captive', type: 'event', cost: 3 }),
  TS26_61: card({ id: 'TS26_61', name: 'Encircle', type: 'event', cost: 5 }),
  TWI_227: card({ id: 'TWI_227', name: 'Prisoner of War', type: 'event', cost: 4 }),
  SEC_193: card({ id: 'SEC_193', name: 'Grand Admiral Thrawn', subtitle: 'Grand Schemer', type: 'unit', arena: 'ground', cost: 7, power: 8, hp: 7 }),
  SHD_088: card({ id: 'SHD_088', name: 'Ephant Mon', type: 'unit', arena: 'ground', cost: 5, power: 4, hp: 6 }),
  TS26_27: card({ id: 'TS26_27', name: 'Fortune and Glory', type: 'unit', arena: 'space', cost: 4, power: 3, hp: 5, keywords: [{ name: 'Bounty' }] }),
  SHD_106: card({ id: 'SHD_106', name: 'Rule with Respect', type: 'event', cost: 4 }),
  SHD_076: card({ id: 'SHD_076', name: 'Unexpected Escape', type: 'event', cost: 1 }),
  SHD_243: card({ id: 'SHD_243', name: 'Altering the Deal', type: 'event', cost: 1 }),
  BH: card({ id: 'BH', name: 'Bounty Hunter Grunt', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, traits: ['Bounty Hunter'] }),
  RIG: card({ id: 'RIG', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 2, traits: ['Vehicle'] }),
  CHEAP: card({ id: 'CHEAP', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 2 }),
  PRICEY: card({ id: 'PRICEY', type: 'unit', arena: 'ground', cost: 5, power: 4, hp: 6 }),
  GRD3: card({ id: 'GRD3', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 3 }),
  GRD3B: card({ id: 'GRD3B', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 3 }),
  SPC3: card({ id: 'SPC3', type: 'unit', arena: 'space', cost: 3, power: 2, hp: 3 }),
  LDR_U: card({ id: 'LDR_U', type: 'unit', arena: 'ground', cost: 4, power: 3, hp: 5 }),
  TOUGH: card({ id: 'TOUGH', type: 'unit', arena: 'ground', cost: 5, power: 1, hp: 10 }),
}
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
type Side = Parameters<typeof player>[0]
const rich = (over: Side = {}) => player({ resources: ready(20), deck: [], ...over })
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
type Extra = { targetInstanceId?: string; optionIndex?: number }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
const targetsOf = (s: GameState) => (choice(s) as unknown as { targets: string[] }).targets
const candidatesOf = (s: GameState) => (choice(s) as unknown as { candidates: string[] }).candidates
const controllerOf = (s: GameState) => (choice(s) as unknown as { controller: PlayerId }).controller
const optionalOf = (s: GameState) => (choice(s) as unknown as { optional?: boolean }).optional

describe('SEC_068 Lando Calrissian — may choose an enemy unit and a friendly non-leader unit; the enemy captures the friendly one', () => {
  it('offers any enemy unit, then a friendly non-leader unit excluding itself; heals 6 and captures', () => {
    const s = board(
      { hand: ['SEC_068'], units: [unit('friendo', 'GRD3')], base: { cardId: 'TST_B', damage: 10 } },
      { units: [unit('foe', 'GRD3')] },
    )
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(targetsOf(played)).toEqual(['foe'])
    expect(optionalOf(played)).toBe(true)
    const guardianChosen = accept(played, { targetInstanceId: 'foe' })
    expect(targetsOf(guardianChosen)).toEqual(['friendo']) // excludes Lando himself
    const done = accept(guardianChosen, { targetInstanceId: 'friendo' })
    expect(U(done, 'friendo')).toBeUndefined()
    expect(U(done, 'foe')?.captured).toEqual([{ cardId: 'GRD3', owner: 'player' }])
    expect(done.players.player.base.damage).toBe(4) // healed 6 from 10
  })

  it('does nothing when declined (no heal, no capture)', () => {
    const s = board({ hand: ['SEC_068'], units: [unit('friendo', 'GRD3')], base: { cardId: 'TST_B', damage: 10 } }, { units: [unit('foe', 'GRD3')] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    const declined = skip(played)
    expect(U(declined, 'friendo')).toBeDefined()
    expect(declined.players.player.base.damage).toBe(10)
  })
})

describe('SEC_212 Libertine — mandatory: choose an enemy unit and a non-leader friendly unit; gets +1/+0 per captured card it guards', () => {
  it('offers any enemy unit, then any non-leader friendly unit (no "another" restriction, so itself qualifies too), and captures', () => {
    const s = board({ hand: ['SEC_212'], units: [unit('friendo', 'GRD3')] }, { units: [unit('foe', 'GRD3')] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(targetsOf(played)).toEqual(['foe'])
    expect(optionalOf(played)).toBeFalsy()
    const guardianChosen = accept(played, { targetInstanceId: 'foe' })
    const lib = played.players.player.units.find(u => u.cardId === 'SEC_212')!.instanceId
    expect(new Set(targetsOf(guardianChosen))).toEqual(new Set([lib, 'friendo']))
    const done = accept(guardianChosen, { targetInstanceId: 'friendo' })
    expect(U(done, 'foe')?.captured).toEqual([{ cardId: 'GRD3', owner: 'player' }])
  })

  it('gets +1/+0 for each captured card it is guarding', () => {
    const s = board({ units: [unit('lib', 'SEC_212', { captured: [{ cardId: 'CHEAP', owner: 'opponent' }, { cardId: 'CHEAP', owner: 'opponent' }] })] })
    expect(effectivePower(s, U(s, 'lib')!)).toBe(5) // base 3 + 2
  })
})

describe('SHD_232 Relentless Pursuit — choose a friendly guardian; it captures an enemy unit costing no more than it', () => {
  it('filters the target by the CHOSEN guardian\'s own cost, and gives a Shield only to a Bounty Hunter guardian', () => {
    const s = board({ hand: ['SHD_232'], units: [unit('bh', 'BH'), unit('other', 'GRD3')] }, { units: [unit('cheap', 'CHEAP'), unit('pricey', 'PRICEY')] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(new Set(targetsOf(played))).toEqual(new Set(['bh', 'other']))
    const guardianChosen = accept(played, { targetInstanceId: 'bh' }) // cost 2
    expect(targetsOf(guardianChosen)).toEqual(['cheap']) // pricey (cost 5) excluded
    const done = accept(guardianChosen, { targetInstanceId: 'cheap' })
    expect(U(done, 'cheap')).toBeUndefined()
    expect(hasToken(U(done, 'bh')?.upgrades ?? [], TOKEN_SHIELD)).toBe(true)
  })

  it('gives no Shield when the chosen guardian is not a Bounty Hunter', () => {
    const s = board({ hand: ['SHD_232'], units: [unit('other', 'GRD3')] }, { units: [unit('cheap', 'CHEAP')] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const guardianChosen = accept(played, { targetInstanceId: 'other' })
    const done = accept(guardianChosen, { targetInstanceId: 'cheap' })
    expect(hasToken(U(done, 'other')?.upgrades ?? [], TOKEN_SHIELD)).toBe(false)
  })
})

describe('SHD_131 Take Captive (+ reprint TWI_128) — a friendly unit captures an enemy non-leader unit in the same arena', () => {
  it('filters the target by the CHOSEN guardian\'s own arena', () => {
    const s = board({ hand: ['SHD_131'], units: [unit('gf', 'GRD3', { arena: 'ground' }), unit('sf', 'SPC3', { arena: 'space' })] },
      { units: [unit('ge', 'GRD3B', { arena: 'ground' }), unit('se', 'SPC3', { arena: 'space' })] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(new Set(targetsOf(played))).toEqual(new Set(['gf', 'sf']))
    const guardianChosen = accept(played, { targetInstanceId: 'gf' })
    expect(targetsOf(guardianChosen)).toEqual(['ge']) // se excluded: different arena
    const done = accept(guardianChosen, { targetInstanceId: 'ge' })
    expect(U(done, 'ge')).toBeUndefined()
    expect(U(done, 'gf')?.captured).toEqual([{ cardId: 'GRD3B', owner: 'opponent' }])
  })

  it('TWI_128 registers the identical shape', () => {
    const s = board({ hand: ['TWI_128'], units: [unit('gf', 'GRD3')] }, { units: [unit('ge', 'GRD3B')] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const guardianChosen = accept(played, { targetInstanceId: 'gf' })
    const done = accept(guardianChosen, { targetInstanceId: 'ge' })
    expect(U(done, 'ge')).toBeUndefined()
  })
})

describe('TS26_61 Encircle — same shape as Take Captive, and costs 1 less per friendly unit', () => {
  it('reduces its own cost by the number of friendly units', () => {
    const s = board({ units: [unit('a', 'GRD3'), unit('b', 'GRD3B')] })
    expect(effectiveCost(s, 'player', F.TS26_61)).toBe(3) // 5 - 2
  })

  it('captures a same-arena enemy non-leader unit', () => {
    const s = board({ hand: ['TS26_61'], units: [unit('gf', 'GRD3')] }, { units: [unit('ge', 'GRD3B')] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const guardianChosen = accept(played, { targetInstanceId: 'gf' })
    const done = accept(guardianChosen, { targetInstanceId: 'ge' })
    expect(U(done, 'ge')).toBeUndefined()
  })
})

describe('TWI_227 Prisoner of War — a friendly unit captures an enemy non-leader, non-Vehicle unit; cheaper prey makes 2 Battle Droids', () => {
  it('excludes Vehicles from the target list', () => {
    const s = board({ hand: ['TWI_227'], units: [unit('gf', 'PRICEY')] }, { units: [unit('rig', 'RIG'), unit('ge', 'CHEAP')] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const guardianChosen = accept(played, { targetInstanceId: 'gf' })
    expect(targetsOf(guardianChosen)).toEqual(['ge']) // rig (Vehicle) excluded
  })

  it('creates 2 Battle Droid tokens when the captured unit costs less than the guardian', () => {
    const s = board({ hand: ['TWI_227'], units: [unit('gf', 'PRICEY')] }, { units: [unit('ge', 'CHEAP')] }) // cost 5 vs cost 2
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const guardianChosen = accept(played, { targetInstanceId: 'gf' })
    const done = accept(guardianChosen, { targetInstanceId: 'ge' })
    expect(done.players.player.units.filter(u => u.cardId === TOKEN_BATTLE_DROID)).toHaveLength(2)
  })

  it('creates no tokens when the captured unit does not cost less', () => {
    const s = board({ hand: ['TWI_227'], units: [unit('gf', 'CHEAP')] }, { units: [unit('ge', 'PRICEY')] }) // cost 2 vs cost 5: prey costs MORE
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const guardianChosen = accept(played, { targetInstanceId: 'gf' })
    const done = accept(guardianChosen, { targetInstanceId: 'ge' })
    expect(done.players.player.units.filter(u => u.cardId === TOKEN_BATTLE_DROID)).toHaveLength(0)
  })
})

describe('SEC_193 Grand Admiral Thrawn — When Played: the OPPONENT may choose one of their own non-leader units to be captured, or Thrawn readies; When Defeated: a friendly guardian captures a same-arena enemy', () => {
  it('offers the choice to the opponent, over their own non-leader units only', () => {
    const s = board({ hand: ['SEC_193'] }, { units: [unit('foe', 'GRD3'), unit('ldr', 'LDR_U', { isLeader: true })] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(controllerOf(played)).toBe('opponent')
    expect(targetsOf(played)).toEqual(['foe']) // the leader unit excluded
  })

  it('captures the unit the opponent chooses', () => {
    const s = board({ hand: ['SEC_193'] }, { units: [unit('foe', 'GRD3')] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    const done = accept(played, { targetInstanceId: 'foe' })
    expect(U(done, 'foe')).toBeUndefined()
    const [thrawn] = done.players.player.units
    expect(thrawn.captured).toEqual([{ cardId: 'GRD3', owner: 'opponent' }])
  })

  it('readies Thrawn when the opponent declines', () => {
    const s = board({ hand: ['SEC_193'] }, { units: [unit('foe', 'GRD3')] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    const thrawnId = played.players.player.units[0].instanceId
    const exhaustedFirst: GameState = { ...played, players: { ...played.players, player: { ...played.players.player, units: played.players.player.units.map(u => (u.instanceId === thrawnId ? { ...u, exhausted: true } : u)) } } }
    const declined = skip(exhaustedFirst)
    expect(U(declined, thrawnId)?.exhausted).toBe(false)
    expect(U(declined, 'foe')).toBeDefined() // not captured
  })

  it('readies Thrawn directly when the opponent controls no non-leader unit', () => {
    const s = board({ hand: ['SEC_193'] }, { units: [unit('ldr', 'LDR_U', { isLeader: true })] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    noChoice(played)
  })

  it('When Defeated: a friendly guardian captures an enemy non-leader unit in the same arena', () => {
    const s = board({ units: [unit('thrawn', 'SEC_193'), unit('guard', 'GRD3')] }, { units: [unit('prey', 'GRD3B'), unit('sp', 'SPC3')] })
    const defeated = defeatUnit(s, 'thrawn')
    expect(controllerOf(defeated)).toBe('player')
    expect(targetsOf(defeated)).toEqual(['guard']) // the only surviving friendly unit
    const guardianChosen = accept(defeated, { targetInstanceId: 'guard' })
    expect(targetsOf(guardianChosen)).toEqual(['prey']) // sp excluded: different arena
    const done = accept(guardianChosen, { targetInstanceId: 'prey' })
    expect(U(done, 'prey')).toBeUndefined()
    expect(U(done, 'guard')?.captured).toEqual([{ cardId: 'GRD3B', owner: 'opponent' }])
  })
})

describe('SHD_088 Ephant Mon — On Attack: choose an enemy unit that attacked your base this phase; a friendly unit in the same arena captures it', () => {
  it('offers only enemy units that attacked this phase, then a same-arena friendly guardian', () => {
    const s = board({ units: [unit('mon', 'SHD_088'), unit('guard', 'GRD3')] }, { units: [unit('raider', 'GRD3B'), unit('bystander', 'PRICEY')] }, { activePlayer: 'opponent' })
    const raided = resolve(s, { type: 'attack', attackerId: 'raider', target: { kind: 'base' } })
    const attacked = resolve({ ...raided, activePlayer: 'player' }, { type: 'attack', attackerId: 'mon', target: { kind: 'base' } })
    expect(targetsOf(attacked)).toEqual(['raider']) // bystander never attacked
    const targetChosen = accept(attacked, { targetInstanceId: 'raider' })
    expect(new Set(targetsOf(targetChosen))).toEqual(new Set(['mon', 'guard'])) // no "another": Ephant Mon himself qualifies too
    const done = accept(targetChosen, { targetInstanceId: 'guard' })
    expect(U(done, 'raider')).toBeUndefined()
    expect(U(done, 'guard')?.captured).toEqual([{ cardId: 'GRD3B', owner: 'opponent' }])
  })
})

describe('TS26_27 Fortune and Glory — When Played: captures any non-leader unit; Bounty: a friendly unit (the collector\'s) captures any non-leader unit', () => {
  it('When Played offers any non-leader unit (not restricted to enemies) and captures it', () => {
    const s = board({ hand: ['TS26_27'] }, { units: [unit('foe', 'GRD3')] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(targetsOf(played)).toEqual(['foe'])
    const done = accept(played, { targetInstanceId: 'foe' })
    expect(U(done, 'foe')).toBeUndefined()
  })

  it('Bounty: collected by the opponent, who chooses their own guardian and then any non-leader unit', () => {
    const s = board({ units: [unit('fng', 'TS26_27'), unit('prey', 'GRD3B')] }, { units: [unit('collector', 'GRD3')] })
    const defeated = defeatUnit(s, 'fng')
    expect(controllerOf(defeated)).toBe('opponent') // mayCollectBounty, collected by the opponent
    const collected = accept(defeated) // no target: a bare accept/skip
    expect(controllerOf(collected)).toBe('opponent')
    expect(targetsOf(collected)).toEqual(['collector']) // the opponent's own guardian
    const guardianChosen = accept(collected, { targetInstanceId: 'collector' })
    expect(targetsOf(guardianChosen)).toEqual(['prey']) // any non-leader unit, not restricted to enemies
    const done = accept(guardianChosen, { targetInstanceId: 'prey' })
    expect(U(done, 'prey')).toBeUndefined()
    expect(U(done, 'collector')?.captured).toEqual([{ cardId: 'GRD3B', owner: 'player' }])
  })
})

describe('SHD_106 Rule with Respect — a friendly unit captures EACH enemy non-leader unit that attacked your base this phase', () => {
  it('captures every qualifying attacker at once, no further picks', () => {
    const s = board({ units: [unit('guard', 'GRD3')], hand: ['SHD_106'] }, { units: [unit('raider1', 'GRD3B'), unit('raider2', 'CHEAP'), unit('bystander', 'PRICEY')] }, { activePlayer: 'opponent' })
    const raided1 = resolve(s, { type: 'attack', attackerId: 'raider1', target: { kind: 'base' } })
    const raided2 = resolve({ ...raided1, activePlayer: 'opponent' }, { type: 'attack', attackerId: 'raider2', target: { kind: 'base' } })
    const played = resolve({ ...raided2, activePlayer: 'player' }, { type: 'playEvent', handIndex: 0 })
    expect(targetsOf(played)).toEqual(['guard'])
    const done = accept(played, { targetInstanceId: 'guard' })
    expect(U(done, 'raider1')).toBeUndefined()
    expect(U(done, 'raider2')).toBeUndefined()
    expect(U(done, 'bystander')).toBeDefined() // never attacked, not captured
    expect(new Set(U(done, 'guard')?.captured?.map(c => c.cardId))).toEqual(new Set(['GRD3B', 'CHEAP']))
  })
})

describe('SHD_076 Unexpected Escape — exhaust a unit; may rescue a captured card it is guarding', () => {
  it('offers no rescue choice when the exhausted unit is guarding nothing', () => {
    const s = board({ hand: ['SHD_076'], units: [unit('u', 'GRD3')] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const done = accept(played, { targetInstanceId: 'u' })
    expect(U(done, 'u')?.exhausted).toBe(true)
    noChoice(done)
  })

  it('offers which held card to rescue, optionally, and rescues the chosen one', () => {
    const s = board({ hand: ['SHD_076'], units: [unit('u', 'GRD3', { captured: [{ cardId: 'CHEAP', owner: 'opponent' }] })] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const exhausted = accept(played, { targetInstanceId: 'u' })
    expect(U(exhausted, 'u')?.exhausted).toBe(true)
    expect(candidatesOf(exhausted)).toEqual(['CHEAP'])
    expect(optionalOf(exhausted)).toBe(true)
    const done = accept(exhausted, { optionIndex: 0 })
    expect(U(done, 'u')?.captured).toEqual([])
    expect(done.players.opponent.units.some(x => x.cardId === 'CHEAP')).toBe(true)
  })

  it('does nothing further when the rescue is declined', () => {
    const s = board({ hand: ['SHD_076'], units: [unit('u', 'GRD3', { captured: [{ cardId: 'CHEAP', owner: 'opponent' }] })] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const exhausted = accept(played, { targetInstanceId: 'u' })
    const declined = skip(exhausted)
    expect(U(declined, 'u')?.captured).toEqual([{ cardId: 'CHEAP', owner: 'opponent' }])
  })
})

describe('SHD_243 Altering the Deal — discard a captured card guarded by a friendly unit', () => {
  it('offers only friendly units guarding a captured card, then which one to discard', () => {
    const s = board({ hand: ['SHD_243'], units: [unit('holder', 'GRD3', { captured: [{ cardId: 'CHEAP', owner: 'opponent' }] }), unit('empty', 'GRD3B')] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(targetsOf(played)).toEqual(['holder']) // empty excluded: nothing captured
    const holderChosen = accept(played, { targetInstanceId: 'holder' })
    expect(candidatesOf(holderChosen)).toEqual(['CHEAP'])
    const done = accept(holderChosen, { optionIndex: 0 })
    expect(U(done, 'holder')?.captured).toEqual([])
    expect(done.players.opponent.discard).toContain('CHEAP')
    expect(done.players.opponent.units.some(x => x.cardId === 'CHEAP')).toBe(false) // discarded, not rescued
  })
})
