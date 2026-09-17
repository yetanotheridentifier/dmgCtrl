import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PendingChoice, UnitState } from '../engine/types'
import { recordCardPlayed } from '../engine/types'
import { unitHasKeyword } from '../engine/keywords'
import { effectivePower, effectiveHp } from '../engine/stats'

/**
 * Units with an activated "Action:" ability, in groups taken whole: targeted effects, attacks, abilities
 * gated on a card played this phase, costs that move the unit itself, plays from hand, and an ability
 * any player may use.
 *
 * Each test states what may be chosen as well as what happens, since a filter that lets everything
 * through would still pass a test that only picks the right target.
 */

const u = (id: string, arena: 'ground' | 'space', cost: number, power: number, hp: number, over: Partial<EngineCard> = {}) =>
  card({ id, arena, cost, power, hp, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  GRD: u('GRD', 'ground', 2, 2, 6),
  GRD5: u('GRD5', 'ground', 3, 5, 8),
  SPC: u('SPC', 'space', 2, 2, 6),
  VIL: u('VIL', 'ground', 2, 2, 6, { aspects: ['Villainy'] }),
  HERO: u('HERO', 'ground', 2, 2, 6, { aspects: ['Heroism'] }),
  FIGHTER: u('FIGHTER', 'space', 2, 2, 6, { traits: ['VEHICLE', 'FIGHTER'] }),
  DROID: u('DROID', 'ground', 2, 2, 6, { traits: ['DROID'] }),
  DROID2: u('DROID2', 'ground', 2, 3, 6, { traits: ['DROID'] }),
  FO: u('FO', 'ground', 2, 2, 6, { traits: ['FIRST ORDER'] }),
  IMP: u('IMP', 'ground', 3, 2, 6, { traits: ['IMPERIAL'] }),
  REB: u('REB', 'ground', 3, 2, 6, { traits: ['REBEL'] }),
  FORCE_EV: card({ id: 'FORCE_EV', type: 'event', cost: 1, traits: ['FORCE'] }),
  FO_EV: card({ id: 'FO_EV', type: 'event', cost: 1, traits: ['FIRST ORDER'] }),
  PLAIN_EV: card({ id: 'PLAIN_EV', type: 'event', cost: 1 }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),

  LOF_134: u('LOF_134', 'space', 4, 4, 3, { name: 'Heavy Missile Gunship', traits: ['SEPARATIST', 'DROID', 'VEHICLE', 'TRANSPORT'] }),
  IBH_16: u('IBH_16', 'ground', 4, 0, 5, { name: 'Ion Cannon', traits: ['WEAPON'] }),
  SHD_196: u('SHD_196', 'ground', 2, 0, 5, { name: 'Grogu', traits: ['FORCE'], unique: true }),
  TWI_206: u('TWI_206', 'ground', 1, 0, 4, { name: 'Independent Senator', traits: ['SEPARATIST', 'OFFICIAL'] }),
  TWI_056: u('TWI_056', 'ground', 1, 0, 4, { name: 'Compassionate Senator', traits: ['REPUBLIC', 'OFFICIAL'] }),
  TWI_157: u('TWI_157', 'ground', 1, 0, 4, { name: 'Disaffected Senator', traits: ['SEPARATIST', 'OFFICIAL'] }),
  IBH_62: u('IBH_62', 'ground', 2, 1, 4, { name: 'Imperial Deck Officer', traits: ['IMPERIAL'] }),
  SHD_087: u('SHD_087', 'ground', 4, 2, 6, { name: 'Crosshair', traits: ['IMPERIAL', 'CLONE', 'TROOPER'], unique: true }),
  SEC_216: u('SEC_216', 'ground', 2, 0, 5, { name: 'Regulations Bureaucrat', traits: ['IMPERIAL', 'OFFICIAL'] }),

  JTL_146: u('JTL_146', 'ground', 1, 0, 4, { name: 'Massassi Tactical Officer', traits: ['REBEL'] }),
  TWI_105: u('TWI_105', 'ground', 1, 0, 4, { name: 'Steadfast Senator', traits: ['REPUBLIC', 'OFFICIAL'] }),
  IBH_23: u('IBH_23', 'ground', 4, 2, 6, { name: 'General Rieekan', traits: ['REBEL', 'OFFICIAL'], aspects: ['Command', 'Heroism'], unique: true }),
  SOR_110: u('SOR_110', 'space', 2, 1, 3, { name: 'Frontline Shuttle', traits: ['VEHICLE', 'TRANSPORT'] }),
  TWI_082: u('TWI_082', 'space', 3, 3, 4, { name: 'MagnaGuard Wing Leader', traits: ['SEPARATIST', 'VEHICLE', 'FIGHTER'] }),

  LOF_243: u('LOF_243', 'ground', 2, 0, 4, { name: 'Caretaker Matron', traits: ['FRINGE'] }),
  JTL_134: u('JTL_134', 'ground', 2, 1, 4, { name: 'General Hux', traits: ['FIRST ORDER', 'OFFICIAL'], unique: true }),

  SEC_093: u('SEC_093', 'ground', 1, 1, 3, { name: 'C-3P0', traits: ['REPUBLIC', 'DROID'], unique: true }),
  LAW_084: u('LAW_084', 'ground', 8, 7, 7, { name: 'Krrsantan', traits: ['UNDERWORLD', 'WOOKIEE', 'BOUNTY HUNTER'], unique: true }),
  SHD_028: u('SHD_028', 'ground', 2, 0, 5, { name: 'Doctor Pershing', traits: ['IMPERIAL'], unique: true }),
  TWI_194: u('TWI_194', 'ground', 3, 3, 4, { name: 'Ahsoka Tano', traits: ['FORCE', 'JEDI', 'REPUBLIC'], unique: true }),

  SOR_093: u('SOR_093', 'ground', 1, 1, 2, { name: 'Alliance Dispatcher', traits: ['REBEL'] }),
  SOR_129: u('SOR_129', 'ground', 2, 2, 3, { name: 'Admiral Ozzel', traits: ['IMPERIAL', 'OFFICIAL'], unique: true }),

  LOF_246: u('LOF_246', 'ground', 3, 1, 6, { name: 'Grogu', traits: ['FORCE'], unique: true }),
  SHD_256: u('SHD_256', 'space', 2, 3, 2, { name: 'Mercenary Gunship', traits: ['UNDERWORLD', 'VEHICLE', 'FIGHTER'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)

type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(20), deck: [], ...mine }),
      opponent: player({ resources: ready(20), deck: [], ...theirs }),
    },
  })
const moves = (s: GameState): Action[] => legalMoves(s)
/** Whether `instanceId`'s ability `index` of `cardId` is offered. */
const offered = (s: GameState, instanceId: string, cardId: string, index = 0) =>
  moves(s).some(m => m.type === 'useAbility' && m.instanceId === instanceId && m.cardId === cardId && m.index === index)
const use = (s: GameState, instanceId: string, cardId: string, index = 0) => resolve(s, { type: 'useAbility', instanceId, cardId, index })
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; baseTarget?: 'player' | 'opponent' }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const declinable = (s: GameState) => moves(s).some(m => m.type === 'skipTrigger')
/** The unit ids the current choice offers, sorted. */
const unitOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : [])))].sort()
const baseOffers = (s: GameState) =>
  moves(s).flatMap(m => (m.type === 'acceptChoice' && m.baseTarget ? [m.baseTarget] : [])).sort()
const amountOf = (c: PendingChoice) => ('amount' in c ? c.amount : undefined)
const readyCount = (s: GameState, who: 'player' | 'opponent') => s.players[who].resources.filter(r => !r.exhausted).length

type AttackMove = Extract<Action, { type: 'attack' }>
const attackMoves = (s: GameState) => moves(s).filter((m): m is AttackMove => m.type === 'attack')
const attackers = (s: GameState) => [...new Set(attackMoves(s).map(m => m.attackerId))].sort()
const baseOffered = (s: GameState, attackerId: string) => attackMoves(s).some(m => m.attackerId === attackerId && m.target.kind === 'base')
const hitBase = (s: GameState, attackerId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' }, choiceId: choice(s).id })
const hitUnit = (s: GameState, attackerId: string, instanceId: string) =>
  resolve(s, { type: 'attack', attackerId, target: { kind: 'unit', instanceId }, choiceId: choice(s).id })

// ── Targeted effects ──────────────────────────────────────────────────────────────────────────────

describe('unit actions with a target', () => {
  it('Heavy Missile Gunship (LOF_134) exhausts to deal 2 damage to a ground unit, either side', () => {
    const s = board({ units: [unit('me', 'LOF_134'), unit('g', 'GRD'), unit('sp', 'SPC')] }, { units: [unit('e', 'GRD')] })
    const used = use(s, 'me', 'LOF_134')
    expect(U(used, 'me')!.exhausted).toBe(true)
    expect(choice(used).kind).toBe('selectDamageTarget')
    expect(amountOf(choice(used))).toBe(2)
    expect(unitOffers(used)).toEqual(['e', 'g'])
    expect(U(accept(used, { targetInstanceId: 'e' }), 'e')!.damage).toBe(2)
  })

  it('Heavy Missile Gunship is not offered with no ground unit, nor while exhausted', () => {
    expect(offered(board({ units: [unit('me', 'LOF_134')] }), 'me', 'LOF_134')).toBe(false)
    expect(offered(board({ units: [unit('me', 'LOF_134', { exhausted: true }), unit('g', 'GRD')] }), 'me', 'LOF_134')).toBe(false)
  })

  it('Ion Cannon (IBH_16) exhausts to deal 3 damage to a space unit', () => {
    const s = board({ units: [unit('me', 'IBH_16'), unit('g', 'GRD')] }, { units: [unit('sp', 'SPC')] })
    const used = use(s, 'me', 'IBH_16')
    expect(amountOf(choice(used))).toBe(3)
    expect(unitOffers(used)).toEqual(['sp'])
    expect(U(accept(used, { targetInstanceId: 'sp' }), 'sp')!.damage).toBe(3)
  })

  it('Grogu (SHD_196) exhausts an enemy unit, and only an enemy unit', () => {
    const s = board({ units: [unit('me', 'SHD_196'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] })
    const used = use(s, 'me', 'SHD_196')
    expect(unitOffers(used)).toEqual(['e'])
    expect(declinable(used)).toBe(false)
    expect(U(accept(used, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
    expect(offered(board({ units: [unit('me', 'SHD_196')] }), 'me', 'SHD_196')).toBe(false)
  })

  it('Independent Senator (TWI_206) pays 2 and exhausts to exhaust a unit with 4 or less power', () => {
    const s = board({ units: [unit('me', 'TWI_206')] }, { units: [unit('e', 'GRD'), unit('big', 'GRD5')] })
    const used = use(s, 'me', 'TWI_206')
    expect(readyCount(used, 'player')).toBe(18)
    expect(U(used, 'me')!.exhausted).toBe(true)
    expect(unitOffers(used)).toEqual(['e', 'me'])
    expect(U(accept(used, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
  })

  it('Compassionate Senator (TWI_056) pays 2 and exhausts to heal 2 damage from a unit or a base', () => {
    const s = board({ units: [unit('me', 'TWI_056'), unit('g', 'GRD', { damage: 3 })], base: { cardId: 'TST_B', damage: 5 } })
    const used = use(s, 'me', 'TWI_056')
    expect(readyCount(used, 'player')).toBe(18)
    expect(choice(used).kind).toBe('selectHealTarget')
    expect(amountOf(choice(used))).toBe(2)
    expect(baseOffers(used)).toEqual(['opponent', 'player'])
    expect(U(accept(used, { targetInstanceId: 'g' }), 'g')!.damage).toBe(1)
    expect(accept(used, { baseTarget: 'player' }).players.player.base.damage).toBe(3)
  })

  it('Disaffected Senator (TWI_157) pays 2 and exhausts to deal 2 damage to a base, never a unit', () => {
    const s = board({ units: [unit('me', 'TWI_157')] }, { units: [unit('e', 'GRD')] })
    const used = use(s, 'me', 'TWI_157')
    expect(unitOffers(used)).toEqual([])
    expect(baseOffers(used)).toEqual(['opponent', 'player'])
    expect(accept(used, { baseTarget: 'opponent' }).players.opponent.base.damage).toBe(2)
  })

  it('Imperial Deck Officer (IBH_62) exhausts to heal 2 damage from a Villainy unit', () => {
    const s = board({ units: [unit('me', 'IBH_62'), unit('v', 'VIL', { damage: 4 }), unit('g', 'GRD', { damage: 4 })] })
    const used = use(s, 'me', 'IBH_62')
    expect(unitOffers(used)).toEqual(['v'])
    expect(baseOffers(used)).toEqual([])
    expect(U(accept(used, { targetInstanceId: 'v' }), 'v')!.damage).toBe(2)
  })

  it('Crosshair (SHD_087) pays 2 for +1/+0 this phase without exhausting, and still has his exhaust ability', () => {
    const s = board({ units: [unit('me', 'SHD_087')] }, { units: [unit('e', 'GRD5'), unit('sp', 'SPC')] })
    let next = use(s, 'me', 'SHD_087', 0)
    noChoice(next)
    expect(readyCount(next, 'player')).toBe(18)
    expect(U(next, 'me')!.exhausted).toBe(false)
    expect(effectivePower(next, U(next, 'me')!)).toBe(3)
    next = { ...next, activePlayer: 'player' }
    expect(offered(next, 'me', 'SHD_087', 1)).toBe(true)
    next = use(next, 'me', 'SHD_087', 1)
    expect(U(next, 'me')!.exhausted).toBe(true)
    expect(unitOffers(next)).toEqual(['e'])
    expect(U(accept(next, { targetInstanceId: 'e' }), 'e')!.damage).toBe(3)
  })

  it('Crosshair does not offer his damage ability with no enemy ground unit', () => {
    expect(offered(board({ units: [unit('me', 'SHD_087'), unit('g', 'GRD')] }, { units: [unit('sp', 'SPC')] }), 'me', 'SHD_087', 1)).toBe(false)
  })

  it("Regulations Bureaucrat (SEC_216) exhausts to exhaust a resource of the chosen player's", () => {
    const s = board({ units: [unit('me', 'SEC_216')] }, { resources: ready(3) })
    const used = use(s, 'me', 'SEC_216')
    expect(choice(used).kind).toBe('choosePlayerThen')
    const theirs = accept(used, { optionIndex: 0 })
    expect(readyCount(theirs, 'opponent')).toBe(2)
    expect(readyCount(theirs, 'player')).toBe(20)
    expect(readyCount(accept(used, { optionIndex: 1 }), 'player')).toBe(19)
  })
})

// ── Attacks ───────────────────────────────────────────────────────────────────────────────────────

describe('unit actions that attack', () => {
  it('Massassi Tactical Officer (JTL_146) exhausts to attack with a Fighter unit, which gets +2/+0', () => {
    const s = board({ units: [unit('me', 'JTL_146'), unit('f', 'FIGHTER'), unit('g', 'GRD')] })
    const used = use(s, 'me', 'JTL_146')
    expect(attackers(used)).toEqual(['f'])
    const done = hitBase(used, 'f')
    expect(done.players.opponent.base.damage).toBe(4)
    expect(effectivePower(done, U(done, 'f')!)).toBe(2) // only for the attack
  })

  it('Massassi Tactical Officer is not offered with no Fighter able to attack', () => {
    expect(offered(board({ units: [unit('me', 'JTL_146'), unit('g', 'GRD')] }), 'me', 'JTL_146')).toBe(false)
  })

  it('Steadfast Senator (TWI_105) pays 2 and exhausts to attack with a unit, which gets +2/+0', () => {
    const s = board({ units: [unit('me', 'TWI_105'), unit('g', 'GRD')] })
    const used = use(s, 'me', 'TWI_105')
    expect(readyCount(used, 'player')).toBe(18)
    expect(attackers(used)).toEqual(['g'])
    expect(hitBase(used, 'g').players.opponent.base.damage).toBe(4)
  })

  it('General Rieekan (IBH_23) exhausts to attack with another Heroism unit, which gets +2/+0', () => {
    const s = board({ units: [unit('me', 'IBH_23'), unit('h', 'HERO'), unit('g', 'GRD')] })
    const used = use(s, 'me', 'IBH_23')
    expect(attackers(used)).toEqual(['h'])
    expect(hitBase(used, 'h').players.opponent.base.damage).toBe(4)
  })

  it('Frontline Shuttle (SOR_110) defeats itself to attack with a unit even if exhausted, never a base', () => {
    const s = board({ units: [unit('me', 'SOR_110'), unit('g', 'GRD', { exhausted: true })] }, { units: [unit('e', 'GRD5')] })
    const used = use(s, 'me', 'SOR_110')
    expect(U(used, 'me')).toBeUndefined()
    expect(used.players.player.discard).toContain('SOR_110')
    expect(attackers(used)).toEqual(['g'])
    expect(baseOffered(used, 'g')).toBe(false)
    expect(U(hitUnit(used, 'g', 'e'), 'e')!.damage).toBe(2)
  })

  it('Frontline Shuttle is not offered when no other unit could attack a unit', () => {
    expect(offered(board({ units: [unit('me', 'SOR_110'), unit('g', 'GRD')] }), 'me', 'SOR_110')).toBe(false)
  })

  it('MagnaGuard Wing Leader (TWI_082) attacks with a Droid, then another Droid, once each round and without exhausting', () => {
    const s = board({ units: [unit('me', 'TWI_082'), unit('d1', 'DROID'), unit('d2', 'DROID2'), unit('g', 'GRD')] })
    let next = use(s, 'me', 'TWI_082')
    expect(U(next, 'me')!.exhausted).toBe(false)
    expect(attackers(next)).toEqual(['d1', 'd2'])
    next = hitBase(next, 'd1')
    expect(attackers(next)).toEqual(['d2'])
    next = hitBase(next, 'd2')
    expect(next.players.opponent.base.damage).toBe(5)
    expect(offered({ ...next, activePlayer: 'player', pendingChoices: [] }, 'me', 'TWI_082')).toBe(false)
  })
})

// ── Gated on a card played this phase ─────────────────────────────────────────────────────────────

describe('unit actions gated on a card played this phase', () => {
  it('Caretaker Matron (LOF_243) exhausts to draw a card only once a Force card was played this phase', () => {
    const s = board({ units: [unit('me', 'LOF_243')], deck: ['GRD'] })
    expect(offered(s, 'me', 'LOF_243')).toBe(false)
    expect(offered(recordCardPlayed(s, 'player', 'PLAIN_EV'), 'me', 'LOF_243')).toBe(false)
    expect(offered(recordCardPlayed(s, 'opponent', 'FORCE_EV'), 'me', 'LOF_243')).toBe(false)
    const played = recordCardPlayed(s, 'player', 'FORCE_EV')
    const used = use(played, 'me', 'LOF_243')
    expect(used.players.player.hand).toEqual(['GRD'])
    expect(U(used, 'me')!.exhausted).toBe(true)
  })

  it('General Hux (JTL_134) gives each other friendly First Order unit Raid 1', () => {
    const s = board({ units: [unit('me', 'JTL_134'), unit('fo', 'FO'), unit('g', 'GRD')] }, { units: [unit('efo', 'FO')] })
    expect(unitHasKeyword(s, U(s, 'fo')!, 'Raid')).toBe(true)
    expect(unitHasKeyword(s, U(s, 'me')!, 'Raid')).toBe(false)
    expect(unitHasKeyword(s, U(s, 'g')!, 'Raid')).toBe(false)
    expect(unitHasKeyword(s, U(s, 'efo')!, 'Raid')).toBe(false)
  })

  it('General Hux exhausts to draw a card only once a First Order card was played this phase', () => {
    const s = board({ units: [unit('me', 'JTL_134')], deck: ['GRD'] })
    expect(offered(s, 'me', 'JTL_134')).toBe(false)
    const used = use(recordCardPlayed(s, 'player', 'FO_EV'), 'me', 'JTL_134')
    expect(used.players.player.hand).toEqual(['GRD'])
  })
})

// ── Costs that move the unit ─────────────────────────────────────────────────────────────────────

describe('unit actions whose cost moves or damages a unit', () => {
  it('C-3P0 (SEC_093) exhausts and returns to hand to give a unit +2/+2 for this phase', () => {
    const s = board({ units: [unit('me', 'SEC_093'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] })
    const used = use(s, 'me', 'SEC_093')
    expect(U(used, 'me')).toBeUndefined()
    expect(used.players.player.hand).toEqual(['SEC_093'])
    expect(unitOffers(used)).toEqual(['e', 'g'])
    const done = accept(used, { targetInstanceId: 'g' })
    expect(effectivePower(done, U(done, 'g')!)).toBe(4)
    expect(effectiveHp(done, U(done, 'g')!)).toBe(8)
  })

  it('Krrsantan (LAW_084) discards 2 cards to return to hand, without exhausting, and needs 2 cards', () => {
    expect(offered(board({ units: [unit('me', 'LAW_084', { exhausted: true })], hand: ['GRD'] }), 'me', 'LAW_084')).toBe(false)
    const s = board({ units: [unit('me', 'LAW_084', { exhausted: true })], hand: ['GRD', 'SPC', 'VIL'] })
    expect(offered(s, 'me', 'LAW_084')).toBe(true)
    let next = use(s, 'me', 'LAW_084')
    expect(choice(next).kind).toBe('selectDiscard')
    expect(U(next, 'me')).toBeDefined()
    next = accept(next, { handIndex: 0 })
    expect(U(next, 'me')).toBeDefined()
    next = accept(next, { handIndex: 0 })
    noChoice(next)
    expect(U(next, 'me')).toBeUndefined()
    expect(next.players.player.discard).toEqual(['GRD', 'SPC'])
    expect(next.players.player.hand).toEqual(['VIL', 'LAW_084'])
  })

  it('Doctor Pershing (SHD_028) exhausts and deals 1 damage to a friendly unit to draw a card', () => {
    const s = board({ units: [unit('me', 'SHD_028'), unit('g', 'GRD')], deck: ['SPC'] }, { units: [unit('e', 'GRD')] })
    const used = use(s, 'me', 'SHD_028')
    expect(unitOffers(used)).toEqual(['g', 'me'])
    expect(declinable(used)).toBe(false)
    const done = accept(used, { targetInstanceId: 'g' })
    expect(U(done, 'g')!.damage).toBe(1)
    expect(done.players.player.hand).toEqual(['SPC'])
    expect(U(done, 'me')!.exhausted).toBe(true)
  })

  it("Ahsoka Tano (TWI_194) pays 2 to return to hand with each upgrade on her going to its owner's hand", () => {
    const s = board(
      { units: [unit('me', 'TWI_194', { exhausted: true, upgrades: [{ cardId: 'UPG', owner: 'player' }, { cardId: 'UPG', owner: 'opponent' }, { cardId: 'TOKEN_SHIELD', owner: 'player' }] })] },
    )
    expect(offered(s, 'me', 'TWI_194')).toBe(true)
    const done = use(s, 'me', 'TWI_194')
    expect(readyCount(done, 'player')).toBe(18)
    expect(U(done, 'me')).toBeUndefined()
    expect(done.players.player.hand.slice().sort()).toEqual(['TWI_194', 'UPG'])
    expect(done.players.opponent.hand).toEqual(['UPG'])
    expect(done.players.player.discard).toEqual([])
  })

  it('Ahsoka Tano gains Ambush while you control fewer units than an opponent, herself included', () => {
    const fewer = board({ units: [unit('me', 'TWI_194')] }, { units: [unit('e1', 'GRD'), unit('e2', 'GRD')] })
    expect(unitHasKeyword(fewer, U(fewer, 'me')!, 'Ambush')).toBe(true)
    const even = board({ units: [unit('me', 'TWI_194')] }, { units: [unit('e1', 'GRD')] })
    expect(unitHasKeyword(even, U(even, 'me')!, 'Ambush')).toBe(false)
  })
})

// ── Plays from hand ───────────────────────────────────────────────────────────────────────────────

describe('unit actions that play a unit from hand', () => {
  it('Alliance Dispatcher (SOR_093) exhausts to play a unit from hand for 1 less', () => {
    const s = board({ units: [unit('me', 'SOR_093')], hand: ['REB', 'PLAIN_EV'] })
    const used = use(s, 'me', 'SOR_093')
    expect(choice(used).kind).toBe('playUnitFromHand')
    const done = accept(used, { handIndex: 0 })
    expect(readyCount(done, 'player')).toBe(18)
    expect(done.players.player.units.map(x => x.cardId)).toEqual(['SOR_093', 'REB'])
  })

  it('Alliance Dispatcher is not offered with no unit in hand', () => {
    expect(offered(board({ units: [unit('me', 'SOR_093')], hand: ['PLAIN_EV'] }), 'me', 'SOR_093')).toBe(false)
  })

  it('Admiral Ozzel (SOR_129) plays an Imperial unit ready, then each opponent may ready a unit', () => {
    const s = board({ units: [unit('me', 'SOR_129')], hand: ['REB', 'IMP'] }, { units: [unit('e', 'GRD', { exhausted: true })] })
    let next = use(s, 'me', 'SOR_129')
    const play = choice(next)
    expect(play.kind).toBe('playUnitFromHand')
    expect(play.kind === 'playUnitFromHand' ? play.candidates.map(c => c.handIndex) : []).toEqual([1])
    next = accept(next, { handIndex: 1 })
    expect(readyCount(next, 'player')).toBe(17)
    const imp = next.players.player.units.find(x => x.cardId === 'IMP')!
    expect(imp.exhausted).toBe(false)
    expect(choice(next).kind).toBe('selectUnitToReady')
    expect(choice(next).controller).toBe('opponent')
    expect(declinable(next)).toBe(true)
    expect(U(accept(next, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(false)
    noChoice(skip(next))
  })
})

// ── Heal, then damage ─────────────────────────────────────────────────────────────────────────────

describe('Grogu (LOF_246)', () => {
  it('exhausts to heal up to 2 damage from a unit, then deals that much damage to a unit', () => {
    const s = board({ units: [unit('me', 'LOF_246'), unit('g', 'GRD', { damage: 1 })] }, { units: [unit('e', 'GRD')] })
    let next = use(s, 'me', 'LOF_246')
    expect(unitOffers(next)).toEqual(['g'])
    next = accept(next, { targetInstanceId: 'g' })
    expect(U(next, 'g')!.damage).toBe(0)
    expect(choice(next).kind).toBe('selectDamageTarget')
    expect(amountOf(choice(next))).toBe(1)
    expect(declinable(next)).toBe(false)
    expect(U(accept(next, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
  })

  it('is not offered when no unit is damaged', () => {
    expect(offered(board({ units: [unit('me', 'LOF_246'), unit('g', 'GRD')] }), 'me', 'LOF_246')).toBe(false)
  })
})

// ── Any player may use ────────────────────────────────────────────────────────────────────────────

describe('Mercenary Gunship (SHD_256)', () => {
  it('any player may pay 4 to take control of it: its opponent is offered the ability', () => {
    const s = { ...board({ units: [unit('gun', 'SHD_256')] }), activePlayer: 'opponent' as const }
    expect(offered(s, 'gun', 'SHD_256')).toBe(true)
    const done = use(s, 'gun', 'SHD_256')
    expect(readyCount(done, 'opponent')).toBe(16)
    expect(readyCount(done, 'player')).toBe(20)
    expect(done.players.opponent.units.map(x => x.instanceId)).toEqual(['gun'])
    expect(done.players.player.units).toEqual([])
  })

  it('is not offered to the player who already controls it', () => {
    expect(offered(board({ units: [unit('gun', 'SHD_256')] }), 'gun', 'SHD_256')).toBe(false)
  })

  it('is not offered to an opponent who cannot pay 4', () => {
    const s = { ...board({ units: [unit('gun', 'SHD_256')] }, { resources: ready(3) }), activePlayer: 'opponent' as const }
    expect(offered(s, 'gun', 'SHD_256')).toBe(false)
  })
})
