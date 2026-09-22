import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { effectivePower } from '../engine/stats'
import { unitHasKeyword, unitKeywordValue, unitCannotBeAttacked } from '../engine/keywords'
import { defeatUnit } from '../engine/combat'
import { healBase } from '../engine/effects'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'
import { addLastingEffect, clearLastingEffects } from '../engine/types'

/**
 * Units with an "On Attack" ability, in groups taken whole: simple targets and draws, effects on the
 * defender or for this attack, cards milled from a deck, "if you do" costs, choices an opponent makes,
 * constant abilities printed alongside, and the few that needed a small engine addition.
 *
 * Every ability is fired the way the game fires it, by declaring an attack through `resolve`, so each
 * test also shows the choice arrives before combat damage and the attack finishes after it. Each test
 * states what may be chosen as well as what happens, since a filter that lets everything through would
 * still pass a test that only picks the right target.
 *
 * Printed stats, traits and keywords come from the shipped set fixtures, post-correction.
 */

const SHIPPED = [
  // A: targets, draws and base damage
  'LAW_057', 'LAW_181', 'IBH_6', 'LAW_079', 'LAW_104', 'LAW_095', 'LAW_107', 'LAW_087', 'LAW_182', 'SOR_156', 'SEC_045',
  'LAW_064', 'SEC_204', 'LOF_106', 'LOF_144', 'LOF_250', 'SOR_059', 'LOF_163', 'LOF_135', 'LOF_045', 'JTL_151', 'JTL_160',
  'JTL_147', 'JTL_168', 'JTL_037', 'TWI_063', 'TWI_154', 'TWI_150', 'SHD_199', 'SHD_150', 'SHD_048', 'SOR_067', 'SOR_208',
  'SOR_158', 'SOR_116', 'SOR_244', 'TS26_75', 'IBH_60', 'IBH_11', 'TS26_43', 'LAW_184', 'LAW_031', 'LAW_068', 'LAW_228',
  'SEC_110', 'SEC_225', 'SEC_188', 'JTL_157', 'TWI_085', 'TWI_202', 'LOF_170', 'LOF_068', 'TWI_034',
  // B: the defender, and this attack
  'SHD_183', 'SOR_142', 'SHD_220', 'SHD_151', 'SOR_179', 'JTL_238', 'SEC_208', 'IBH_10',
  // C: decks and discard piles
  'LAW_192', 'LAW_173', 'LAW_194', 'SHD_041', 'TWI_195', 'LOF_184', 'SOR_047', 'SOR_188', 'LAW_174', 'LAW_163',
  // D: if you do
  'SOR_131', 'LAW_048', 'SEC_162', 'SEC_197', 'LOF_160', 'TWI_035', 'SHD_118', 'SOR_206', 'TWI_179', 'SEC_185', 'SEC_220',
  'SHD_046', 'SEC_137', 'LAW_062',
  // E: an opponent chooses, or each player
  'TS26_66', 'TS26_29', 'SEC_218', 'LAW_216', 'SHD_246',
  // F: engine additions
  'LAW_051', 'LAW_197', 'LOF_204', 'SOR_185',
]
/** Scoped by the triage but lifted out to the ticket that owns their blocker. */
const LIFTED = ['SHD_216', 'SHD_139', 'LOF_197', 'SHD_153', 'SOR_056']

const POOL = poolFor(['LAW', 'SEC', 'LOF', 'JTL', 'TWI', 'SHD', 'SOR', 'TS26', 'IBH'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 8, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  GRD: src('GRD'),
  GRD2: src('GRD2'),
  BIG: src('BIG', { cost: 6, power: 1, hp: 20 }),
  SPC: src('SPC', { arena: 'space' }),
  UNQ: src('UNQ', { unique: true }),
  REB: src('REB', { traits: ['REBEL'] }),
  OFF: src('OFF', { traits: ['OFFICIAL'] }),
  JEDI: src('JEDI', { traits: ['JEDI'] }),
  INQ: src('INQ', { arena: 'space', traits: ['INQUISITOR'] }),
  BH: src('BH', { traits: ['BOUNTY HUNTER'] }),
  UW: src('UW', { traits: ['UNDERWORLD'] }),
  DROID: src('DROID', { arena: 'space', traits: ['DROID'] }),
  SPECTRE: src('SPECTRE', { traits: ['SPECTRE'] }),
  AGG: src('AGG', { aspects: ['Aggression'] }),
  CMD: src('CMD', { aspects: ['Command'] }),
  HERO: src('HERO', { aspects: ['Heroism'] }),
  VIL: src('VIL', { aspects: ['Villainy'] }),
  CUN: src('CUN', { aspects: ['Cunning'] }),
  VIG: src('VIG', { aspects: ['Vigilance'] }),
  VEH: src('VEH', { cost: 5, traits: ['VEHICLE'] }),
  CHEAP: src('CHEAP', { cost: 4 }),
  PRICEY: src('PRICEY', { cost: 5 }),
  FORCEC: src('FORCEC', { traits: ['FORCE'] }),
  POE: src('POE', { name: 'Poe Dameron', unique: true }),
  KYLO: src('KYLO', { name: 'Kylo Ren', unique: true }),
  GRIEVOUS: src('GRIEVOUS', { name: 'General Grievous', unique: true }),
  L_POE: card({ id: 'L_POE', type: 'leader', name: 'Poe Dameron', cost: 6, power: 4, hp: 6 }),
  L_GRIEVOUS: card({ id: 'L_GRIEVOUS', type: 'leader', name: 'General Grievous', cost: 6, power: 4, hp: 6 }),
  U_POE: card({ id: 'U_POE', type: 'upgrade', name: 'Poe Dameron', cost: 2, power: 1, hp: 1 }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  ITEM: card({ id: 'ITEM', type: 'upgrade', cost: 1, power: 1, hp: 1, traits: ['ITEM'] }),
  SABER: card({ id: 'SABER', type: 'upgrade', cost: 1, power: 0, hp: 0, traits: ['LIGHTSABER'], aspects: ['Aggression'] }),
  EV: card({ id: 'EV', type: 'event', cost: 1 }),
  EV2: card({ id: 'EV2', type: 'event', cost: 2 }),
  EV3: card({ id: 'EV3', type: 'event', cost: 3 }),
  AGG_EV: card({ id: 'AGG_EV', type: 'event', cost: 1, aspects: ['Aggression'] }),
  VIG_EV: card({ id: 'VIG_EV', type: 'event', cost: 1, aspects: ['Vigilance'] }),
  CUN_EV: card({ id: 'CUN_EV', type: 'event', cost: 1, aspects: ['Cunning'] }),
  HERO_EV: card({ id: 'HERO_EV', type: 'event', cost: 1, aspects: ['Heroism'] }),
  UW_EV: card({ id: 'UW_EV', type: 'event', cost: 1, traits: ['UNDERWORLD'] }),
  FORCE_EV: card({ id: 'FORCE_EV', type: 'event', cost: 1, traits: ['FORCE'] }),
  REB_EV: card({ id: 'REB_EV', type: 'event', cost: 1, traits: ['REBEL'] }),
  VIG_BASE: card({ id: 'VIG_BASE', type: 'base', hp: 30, aspects: ['Vigilance'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(10), deck: [], base: { cardId: 'VIG_BASE', damage: 0 }, ...mine }),
      opponent: player({ resources: ready(10), deck: [], ...theirs }),
    },
    ...over,
  })
const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, played: { player: [], opponent: [] },
  leaderLeftPlay: [],
  ...over,
})

/** Declare an attack with `attackerId`, on the enemy base or on `target`. */
const attack = (s: GameState, attackerId: string, target?: string) =>
  resolve(s, { type: 'attack', attackerId, target: target ? { kind: 'unit', instanceId: target } : { kind: 'base' } })
const moves = (s: GameState): Action[] => legalMoves(s)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; deckIndex?: number; baseTarget?: PlayerId; cardName?: string }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const declinable = (s: GameState) => moves(s).some(m => m.type === 'skipTrigger')
const unitOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : [])))].sort()
const baseOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.baseTarget ? [m.baseTarget] : [])))].sort()
const amountOf = (c: PendingChoice) => ('amount' in c ? c.amount : undefined)
const buffOf = (c: PendingChoice) => (c.kind === 'mayLastingBuff' ? { power: c.power ?? 0, hp: c.hp ?? 0, keywords: c.keywords ?? [] } : undefined)
const baseDamage = (s: GameState, who: PlayerId) => s.players[who].base.damage
const readyCount = (s: GameState, who: PlayerId) => s.players[who].resources.filter(r => !r.exhausted).length
const exhausted = (n: number) => Array.from({ length: n }, (_, i) => ({ cardId: `X${i}`, exhausted: true }))

describe('On Attack coverage', () => {
  it('registers an On Attack ability on every shipped card', () => {
    for (const id of SHIPPED) expect(getCardDefinition(id)?.abilities?.some(a => a.trigger === 'onAttack'), id).toBe(true)
  })
  it('leaves the lifted cards unregistered', () => {
    for (const id of LIFTED) expect(getCardDefinition(id), id).toBeUndefined()
  })
  it('corrects the keywords the source lists but the card only gains or gives', () => {
    for (const id of ['LAW_104', 'SOR_156', 'SOR_188', 'SOR_131', 'TS26_75']) expect(F[id].keywords, id).toEqual([])
  })
})

// ── A: targets, draws and base damage ─────────────────────────────────────────────────────────────

describe('On Attack: deal damage to a chosen target', () => {
  it('Benthic "Two Tubes" (LAW_057) deals 1 to an enemy ground unit, and 1 to a base when defeated', () => {
    const s = board({ units: [unit('me', 'LAW_057'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] })
    const a = attack(s, 'me')
    expect(choice(a).kind).toBe('selectDamageTarget')
    expect(amountOf(choice(a))).toBe(1)
    expect(unitOffers(a)).toEqual(['e'])
    expect(declinable(a)).toBe(false)
    expect(U(accept(a, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
    const defeated = defeatUnit(s, 'me')
    expect(amountOf(choice(defeated))).toBe(1)
    expect(baseOffers(defeated)).toEqual(['opponent', 'player'])
  })

  it('Cloud-Rider Veteran (LAW_181) and Rebellion Y-Wing (IBH_6) deal damage to a base, not a unit', () => {
    for (const [id, amount] of [['LAW_181', 2], ['IBH_6', 1]] as const) {
      const s = board({ units: [unit('me', id)] }, { units: [unit('e', F[id].arena === 'space' ? 'SPC' : 'BIG')] })
      const a = attack(s, 'me', 'e')
      expect(amountOf(choice(a)), id).toBe(amount)
      expect(unitOffers(a), id).toEqual([])
      expect(baseOffers(a), id).toEqual(['opponent', 'player'])
      expect(declinable(a), id).toBe(false)
      expect(baseDamage(accept(a, { baseTarget: 'opponent' }), 'opponent'), id).toBe(amount)
    }
  })

  it('K-2S0 (LAW_079) may deal 3 to a damaged ground unit', () => {
    const s = board({ units: [unit('me', 'LAW_079'), unit('g', 'GRD', { damage: 1 })] }, { units: [unit('e', 'GRD', { damage: 1 }), unit('clean', 'GRD'), unit('sp', 'SPC', { damage: 1 })] })
    const a = attack(s, 'me')
    expect(amountOf(choice(a))).toBe(3)
    expect(unitOffers(a)).toEqual(['e', 'g'])
    expect(declinable(a)).toBe(true)
  })

  it('Zuckuss (LAW_064) may deal his power to a ground unit while you control another Bounty Hunter', () => {
    noChoice(attack(board({ units: [unit('me', 'LAW_064')] }, { units: [unit('e', 'GRD')] }), 'me'))
    const a = attack(board({ units: [unit('me', 'LAW_064'), unit('bh', 'BH')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'me')
    expect(amountOf(choice(a))).toBe(3)
    expect(unitOffers(a)).toEqual(['bh', 'e', 'me'])
    expect(declinable(a)).toBe(true)
  })

  it('Jedi Starfighter (LOF_144) may deal 1 to a space unit', () => {
    const a = attack(board({ units: [unit('me', 'LOF_144')] }, { units: [unit('e', 'SPC'), unit('g', 'GRD')] }), 'me')
    expect(amountOf(choice(a))).toBe(1)
    expect(unitOffers(a)).toEqual(['e', 'me'])
    expect(declinable(a)).toBe(true)
  })

  it('Quinlan Vos (LOF_163) may deal 2 to an enemy base only with 6 or more power', () => {
    noChoice(attack(board({ units: [unit('me', 'LOF_163')] }), 'me'))
    const s = addLastingEffect(board({ units: [unit('me', 'LOF_163')] }), { targetInstanceId: 'me', power: 2 })
    const a = attack(s, 'me')
    expect(amountOf(choice(a))).toBe(2)
    expect(baseOffers(a)).toEqual(['opponent'])
    expect(unitOffers(a)).toEqual([])
    expect(declinable(a)).toBe(true)
  })

  it('Red Five (JTL_151) may deal 2 to a damaged unit', () => {
    const a = attack(board({ units: [unit('me', 'JTL_151')] }, { units: [unit('e', 'GRD', { damage: 1 }), unit('clean', 'SPC')] }), 'me')
    expect(amountOf(choice(a))).toBe(2)
    expect(unitOffers(a)).toEqual(['e'])
    expect(declinable(a)).toBe(true)
  })

  it('Black One (JTL_147) gets +1/+0 while upgraded, and may deal 1 while you control Poe Dameron in any form', () => {
    const plain = board({ units: [unit('me', 'JTL_147')] })
    expect(effectivePower(plain, U(plain, 'me')!)).toBe(2)
    const up = board({ units: [unit('me', 'JTL_147', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] })
    expect(effectivePower(up, U(up, 'me')!)).toBe(4)
    noChoice(attack(plain, 'me'))
    const withUnit = board({ units: [unit('me', 'JTL_147'), unit('poe', 'POE')] }, { units: [unit('e', 'GRD')] })
    const withLeader = board({ units: [unit('me', 'JTL_147')], leader: { cardId: 'L_POE', deployed: false, epicActionUsed: false, exhausted: false } }, { units: [unit('e', 'GRD')] })
    const withUpgrade = board({ units: [unit('me', 'JTL_147'), unit('g', 'GRD', { upgrades: [{ cardId: 'U_POE', owner: 'player' }] })] }, { units: [unit('e', 'GRD')] })
    for (const s of [withUnit, withLeader, withUpgrade]) {
      const a = attack(s, 'me')
      expect(amountOf(choice(a))).toBe(1)
      expect(unitOffers(a)).toContain('e')
      expect(declinable(a)).toBe(true)
    }
  })

  it('Banshee (JTL_037) may deal damage equal to the damage on itself', () => {
    noChoice(attack(board({ units: [unit('me', 'JTL_037')] }, { units: [unit('e', 'SPC')] }), 'me'))
    const a = attack(board({ units: [unit('me', 'JTL_037', { damage: 2 })] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(amountOf(choice(a))).toBe(2)
    expect(unitOffers(a)).toEqual(['e', 'me'])
    expect(declinable(a)).toBe(true)
  })

  it('Mister Bones (TWI_154) may deal 3 to a ground unit only with an empty hand', () => {
    noChoice(attack(board({ units: [unit('me', 'TWI_154')], hand: ['EV'] }, { units: [unit('e', 'GRD')] }), 'me'))
    const a = attack(board({ units: [unit('me', 'TWI_154')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'me')
    expect(amountOf(choice(a))).toBe(3)
    expect(unitOffers(a)).toEqual(['e', 'me'])
    expect(declinable(a)).toBe(true)
  })

  it('Saw Gerrera (TWI_150) deals 1 to each enemy ground unit while your base has 15 or more damage', () => {
    const before = board({ units: [unit('me', 'TWI_150'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD'), unit('e2', 'GRD'), unit('sp', 'SPC')] })
    const quiet = attack(before, 'me')
    expect(U(quiet, 'e')!.damage).toBe(0)
    const hurt = { ...before, players: { ...before.players, player: { ...before.players.player, base: { cardId: 'VIG_BASE', damage: 15 } } } }
    const a = attack(hurt, 'me')
    expect([U(a, 'e')!.damage, U(a, 'e2')!.damage, U(a, 'sp')!.damage, U(a, 'g')!.damage]).toEqual([1, 1, 0, 0])
  })

  it('Koska Reeves (SHD_150) may deal 2 to a ground unit while upgraded', () => {
    noChoice(attack(board({ units: [unit('me', 'SHD_150')] }, { units: [unit('e', 'GRD')] }), 'me'))
    const a = attack(board({ units: [unit('me', 'SHD_150', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'me')
    expect(amountOf(choice(a))).toBe(2)
    expect(unitOffers(a)).toEqual(['e', 'me'])
    expect(declinable(a)).toBe(true)
  })

  it('Jedha Agitator (SOR_158) deals 2 to a ground unit or a base while you control a leader unit', () => {
    noChoice(attack(board({ units: [unit('me', 'SOR_158')] }, { units: [unit('e', 'GRD')] }), 'me'))
    const a = attack(board({ units: [unit('me', 'SOR_158'), unit('L', 'GRD', { isLeader: true })] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'me')
    expect(amountOf(choice(a))).toBe(2)
    expect(unitOffers(a)).toEqual(['L', 'e', 'me'])
    expect(baseOffers(a)).toEqual(['opponent', 'player'])
    expect(declinable(a)).toBe(false)
  })

  it('Aerie (LAW_184) deals 2 to an enemy ground unit and 2 to a base', () => {
    const s = board({ units: [unit('me', 'LAW_184'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] })
    const a = attack(s, 'me')
    expect(unitOffers(a)).toEqual(['e'])
    expect(declinable(a)).toBe(false)
    const b = accept(a, { targetInstanceId: 'e' })
    expect(U(b, 'e')!.damage).toBe(2)
    expect(baseOffers(b)).toEqual(['opponent', 'player'])
    expect(declinable(b)).toBe(false)
    expect(baseDamage(accept(b, { baseTarget: 'player' }), 'player')).toBe(2)
  })

  it('Bendu (LOF_170) deals 3 damage to each other unit', () => {
    const a = attack(board({ units: [unit('me', 'LOF_170'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'me')
    expect([U(a, 'g')!.damage, U(a, 'e')!.damage, U(a, 'sp')!.damage, U(a, 'me')!.damage]).toEqual([3, 3, 3, 0])
  })

  it('Jar Jar Binks (TWI_202) deals 2 damage to a random unit or base', () => {
    const s = board({ units: [unit('me', 'TWI_202'), unit('g', 'GRD')] }, { units: [unit('e', 'BIG'), unit('sp', 'SPC')] })
    const a = attack(s, 'me', 'e')
    noChoice(a)
    const total = (x: GameState) => all(x).reduce((n, u) => n + u.damage, 0) + baseDamage(x, 'player') + baseDamage(x, 'opponent')
    // The combat itself is 2 to the defender and 1 back to Jar Jar.
    expect(total(a) - total(s)).toBe(2 + 3)
  })
})

describe('On Attack: heal, shield, exhaust, ready', () => {
  it('Medical Frigate (LOF_250) and 2-1B Surgical Droid (SOR_059) may heal 2 from another unit', () => {
    for (const id of ['LOF_250', 'SOR_059']) {
      const a = attack(board({ units: [unit('me', id, { damage: 1 }), unit('g', 'GRD', { damage: 3 })] }, { units: [unit('e', F[id].arena === 'space' ? 'SPC' : 'GRD', { damage: 1 })] }), 'me')
      expect(choice(a).kind, id).toBe('selectHealTarget')
      expect(amountOf(choice(a)), id).toBe(2)
      expect(unitOffers(a), id).toEqual(['e', 'g'])
      expect(baseOffers(a), id).toEqual([])
      expect(declinable(a), id).toBe(true)
      expect(U(accept(a, { targetInstanceId: 'g' }), 'g')!.damage, id).toBe(1)
    }
  })

  it('Gentle Giant (SHD_048) may heal another unit as much as the damage on itself', () => {
    noChoice(attack(board({ units: [unit('me', 'SHD_048'), unit('g', 'GRD', { damage: 3 })] }), 'me'))
    const a = attack(board({ units: [unit('me', 'SHD_048', { damage: 3 }), unit('g', 'GRD', { damage: 4 })] }), 'me')
    expect(amountOf(choice(a))).toBe(3)
    expect(unitOffers(a)).toEqual(['g'])
    expect(U(accept(a, { targetInstanceId: 'g' }), 'g')!.damage).toBe(1)
  })

  it('Finn (LAW_095) may give a Shield token to a non-unique unit', () => {
    const a = attack(board({ units: [unit('me', 'LAW_095'), unit('u', 'UNQ'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(choice(a).kind).toBe('mayGiveTokens')
    expect(unitOffers(a)).toEqual(['e', 'g'])
    expect(declinable(a)).toBe(true)
  })

  it('Jango Fett (LAW_087) exhausts an enemy unit while upgraded', () => {
    noChoice(attack(board({ units: [unit('me', 'LAW_087')] }, { units: [unit('e', 'GRD')] }), 'me'))
    const a = attack(board({ units: [unit('me', 'LAW_087', { upgrades: [{ cardId: 'UPG', owner: 'player' }] }), unit('g', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'me')
    expect(unitOffers(a)).toEqual(['e', 'sp'])
    expect(declinable(a)).toBe(false)
    expect(U(accept(a, { targetInstanceId: 'sp' }), 'sp')!.exhausted).toBe(true)
  })

  it('Outer Rim Headhunter (SOR_208) may exhaust a non-leader unit while you control a leader unit', () => {
    noChoice(attack(board({ units: [unit('me', 'SOR_208')] }, { units: [unit('e', 'GRD')] }), 'me'))
    const a = attack(board({ units: [unit('me', 'SOR_208'), unit('L', 'GRD', { isLeader: true })] }, { units: [unit('e', 'GRD'), unit('eL', 'GRD', { isLeader: true })] }), 'me')
    expect(unitOffers(a)).toEqual(['e', 'me'])
    expect(declinable(a)).toBe(true)
  })

  it('Snowspeeder (SOR_244) exhausts an enemy ground Vehicle', () => {
    const a = attack(board({ units: [unit('me', 'SOR_244'), unit('v', 'VEH')] }, { units: [unit('e', 'VEH'), unit('g', 'GRD')] }), 'me')
    expect(unitOffers(a)).toEqual(['e'])
    expect(declinable(a)).toBe(false)
  })

  it('R2-D2 (IBH_11) exhausts an enemy ground unit costing 4 or less while you control a Command unit', () => {
    noChoice(attack(board({ units: [unit('me', 'IBH_11')] }, { units: [unit('e', 'CHEAP')] }), 'me'))
    const a = attack(board({ units: [unit('me', 'IBH_11'), unit('c', 'CMD')] }, { units: [unit('e', 'CHEAP'), unit('p', 'PRICEY'), unit('sp', 'SPC')] }), 'me')
    expect(unitOffers(a)).toEqual(['e'])
    expect(declinable(a)).toBe(false)
  })

  it('Blue Ace (SEC_204) readies an exhausted enemy unit', () => {
    const a = attack(board({ units: [unit('me', 'SEC_204'), unit('g', 'GRD', { exhausted: true })] }, { units: [unit('e', 'GRD', { exhausted: true }), unit('r', 'SPC')] }), 'me')
    expect(choice(a).kind).toBe('selectUnitToReady')
    expect(unitOffers(a)).toEqual(['e'])
    expect(declinable(a)).toBe(false)
    expect(U(accept(a, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(false)
  })

  it('Coruscant Dissident (SHD_199) readies a resource', () => {
    const a = attack(board({ units: [unit('me', 'SHD_199')], resources: exhausted(2) }), 'me')
    expect(readyCount(a, 'player')).toBe(1)
  })

  it('Synara San (SEC_225) readies a friendly resource for each friendly unit', () => {
    const a = attack(board({ units: [unit('me', 'SEC_225'), unit('g', 'GRD'), unit('g2', 'GRD')], resources: exhausted(5) }, { units: [unit('e', 'GRD')] }), 'me')
    expect(readyCount(a, 'player')).toBe(3)
  })

  it('Darth Traya (SEC_188) may ready an exhausted leader that is not a unit, either player\'s', () => {
    const tired = { cardId: 'TST_L', deployed: false, epicActionUsed: false, exhausted: true }
    noChoice(attack(board({ units: [unit('me', 'SEC_188')] }), 'me'))
    noChoice(attack(board({ units: [unit('me', 'SEC_188')], leader: { ...tired, deployed: true } }), 'me'))
    const both = attack(board({ units: [unit('me', 'SEC_188')], leader: tired }, { leader: tired }), 'me')
    expect(choice(both).kind).toBe('selectCardThen')
    expect(moves(both).filter(m => m.type === 'acceptChoice')).toHaveLength(2)
    expect(declinable(both)).toBe(true)
    const mine = attack(board({ units: [unit('me', 'SEC_188')], leader: tired }), 'me')
    expect(accept(mine, { optionIndex: 0 }).players.player.leader.exhausted).toBe(false)
  })

  it('Relentless Firespray (JTL_157) readies itself, once each round', () => {
    const s = board({ units: [unit('me', 'JTL_157')] }, { units: [unit('e', 'BIG', { arena: 'space' })] })
    const first = attack(s, 'me', 'e')
    expect(U(first, 'me')!.exhausted).toBe(false)
    const second = attack({ ...first, activePlayer: 'player' }, 'me', 'e')
    expect(U(second, 'me')!.exhausted).toBe(true)
  })
})

describe('On Attack: lasting buffs and keywords', () => {
  it('Bodhi Rook (LAW_104) may give a friendly Rebel unit Sentinel for this phase', () => {
    const a = attack(board({ units: [unit('me', 'LAW_104'), unit('r', 'REB'), unit('g', 'GRD')] }, { units: [unit('er', 'REB')] }), 'me')
    expect(buffOf(choice(a))!.keywords).toEqual([{ name: 'Sentinel' }])
    expect(unitOffers(a)).toEqual(['me', 'r'])
    expect(declinable(a)).toBe(true)
    const b = accept(a, { targetInstanceId: 'r' })
    expect(unitHasKeyword(b, U(b, 'r')!, 'Sentinel')).toBe(true)
  })

  it('Weazel (LAW_182) and Benthic "Two Tubes" (SOR_156) give another friendly unit Raid 2 for this phase', () => {
    const w = attack(board({ units: [unit('me', 'LAW_182'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(buffOf(choice(w))!.keywords).toEqual([{ name: 'Raid', value: 2 }])
    expect(unitOffers(w)).toEqual(['g'])
    expect(declinable(w)).toBe(false)
    const b = attack(board({ units: [unit('me', 'SOR_156'), unit('a', 'AGG'), unit('g', 'GRD')] }, { units: [unit('e', 'AGG')] }), 'me')
    expect(unitOffers(b)).toEqual(['a'])
    expect(declinable(b)).toBe(false)
    const done = accept(b, { targetInstanceId: 'a' })
    expect(unitKeywordValue(done, U(done, 'a')!, 'Raid')).toBe(2)
  })

  it('Senator Chuchi (SEC_045) gives another friendly Official unit Restore 2 for this phase', () => {
    const a = attack(board({ units: [unit('me', 'SEC_045'), unit('o', 'OFF'), unit('g', 'GRD')] }, { units: [unit('eo', 'OFF')] }), 'me')
    expect(buffOf(choice(a))!.keywords).toEqual([{ name: 'Restore', value: 2 }])
    expect(unitOffers(a)).toEqual(['o'])
    expect(declinable(a)).toBe(false)
  })

  it('Yaddle (LOF_045) gives each other friendly Jedi unit Restore 1 for this phase', () => {
    const a = attack(board({ units: [unit('me', 'LOF_045'), unit('j', 'JEDI'), unit('g', 'GRD')] }, { units: [unit('ej', 'JEDI')] }), 'me')
    expect(unitKeywordValue(a, U(a, 'j')!, 'Restore')).toBe(1)
    expect(unitKeywordValue(a, U(a, 'ej')!, 'Restore')).toBe(0)
    expect(unitKeywordValue(a, U(a, 'me')!, 'Restore')).toBe(1)
  })

  it('Acclamator Assault Ship (LOF_106) may give another unit +5/+5 for this phase', () => {
    const a = attack(board({ units: [unit('me', 'LOF_106'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(buffOf(choice(a))).toMatchObject({ power: 5, hp: 5 })
    expect(unitOffers(a)).toEqual(['e', 'g'])
    expect(declinable(a)).toBe(true)
  })

  it('Scythe (LOF_135) may give another friendly Inquisitor unit +2/+0 for this phase', () => {
    const a = attack(board({ units: [unit('me', 'LOF_135'), unit('i', 'INQ'), unit('g', 'GRD')] }, { units: [unit('ei', 'INQ')] }), 'me')
    expect(buffOf(choice(a))).toMatchObject({ power: 2, hp: 0 })
    expect(unitOffers(a)).toEqual(['i'])
    expect(declinable(a)).toBe(true)
  })

  it('Supporting Eta-2 (JTL_160) may give a ground unit +2/+0 for this phase', () => {
    const a = attack(board({ units: [unit('me', 'JTL_160'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'me')
    expect(buffOf(choice(a))).toMatchObject({ power: 2, hp: 0 })
    expect(unitOffers(a)).toEqual(['e', 'g'])
    expect(declinable(a)).toBe(true)
  })

  it('Vulture Interceptor Wing (TWI_063) gives an enemy unit -1/-1 for this phase', () => {
    const a = attack(board({ units: [unit('me', 'TWI_063'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'me')
    expect(buffOf(choice(a))).toMatchObject({ power: -1, hp: -1 })
    expect(unitOffers(a)).toEqual(['e', 'sp'])
    expect(declinable(a)).toBe(false)
  })

  it('Steadfast Battalion (SOR_116) gives a friendly unit +2/+2 for this phase while you control a leader unit', () => {
    noChoice(attack(board({ units: [unit('me', 'SOR_116')] }), 'me'))
    const a = attack(board({ units: [unit('me', 'SOR_116'), unit('L', 'GRD', { isLeader: true })] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(buffOf(choice(a))).toMatchObject({ power: 2, hp: 2 })
    expect(unitOffers(a)).toEqual(['L', 'me'])
    expect(declinable(a)).toBe(false)
  })

  it('Jango Fett (TS26_75) gives an enemy unit -3/-0, and has Ambush only while an enemy has attacked your base this phase', () => {
    const a = attack(board({ units: [unit('me', 'TS26_75'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(buffOf(choice(a))).toMatchObject({ power: -3, hp: 0 })
    expect(unitOffers(a)).toEqual(['e'])
    expect(declinable(a)).toBe(false)
    const quiet = board({ units: [unit('me', 'TS26_75')] })
    expect(unitHasKeyword(quiet, U(quiet, 'me')!, 'Ambush')).toBe(false)
    const attacked = board({ units: [unit('me', 'TS26_75')] }, {}, { phaseEvents: phaseEvents({ basesAttacked: ['player'] }) })
    expect(unitHasKeyword(attacked, U(attacked, 'me')!, 'Ambush')).toBe(true)
  })

  it('Bossk (LAW_031) gives a unit +1/+1, then may give a unit -1/-1', () => {
    const a = attack(board({ units: [unit('me', 'LAW_031')] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(unitOffers(a)).toEqual(['e', 'me'])
    expect(declinable(a)).toBe(false)
    const b = accept(a, { targetInstanceId: 'me' })
    expect(effectivePower(b, U(b, 'me')!)).toBe(4)
    expect(unitOffers(b)).toEqual(['e', 'me'])
    expect(declinable(b)).toBe(true)
    const c = accept(b, { targetInstanceId: 'e' })
    expect(effectivePower(c, U(c, 'e')!)).toBe(1)
  })

  it('Millennium Falcon (LAW_068) may give a space unit -2/-0, and may give a ground unit +2/+0', () => {
    const s = board({ units: [unit('me', 'LAW_068'), unit('g', 'GRD')] }, { units: [unit('sp', 'SPC')] })
    const a = attack(s, 'me')
    expect(unitOffers(a)).toEqual(['me', 'sp'])
    expect(declinable(a)).toBe(true)
    const b = skip(a)
    expect(unitOffers(b)).toEqual(['g'])
    expect(declinable(b)).toBe(true)
    const both = accept(accept(attack(s, 'me'), { targetInstanceId: 'sp' }), { targetInstanceId: 'g' })
    expect([effectivePower(both, U(both, 'sp')!), effectivePower(both, U(both, 'g')!)]).toEqual([0, 4])
  })

  it('Canyon Frontrunner (LAW_228) may give a unit -2/-0 only if no other unit has attacked this phase', () => {
    const a = attack(board({ units: [unit('me', 'LAW_228')] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(buffOf(choice(a))).toMatchObject({ power: -2, hp: 0 })
    expect(declinable(a)).toBe(true)
    noChoice(attack(board({ units: [unit('me', 'LAW_228')] }, { units: [unit('e', 'GRD')] }, { phaseEvents: phaseEvents({ attackedUnits: ['e'] }) }), 'me'))
  })

  it('Kalani (TWI_085) may give another unit +2/+2, or up to 2 with the initiative', () => {
    const s = board({ units: [unit('me', 'TWI_085'), unit('g', 'GRD'), unit('g2', 'GRD')] }, { units: [unit('e', 'GRD')] })
    const one = accept(attack({ ...s, initiative: 'opponent' }, 'me'), { targetInstanceId: 'g' })
    noChoice(one)
    expect(effectivePower(one, U(one, 'g')!)).toBe(4)
    const a = attack(s, 'me')
    expect(unitOffers(a)).toEqual(['e', 'g', 'g2'])
    expect(declinable(a)).toBe(true)
    const b = accept(a, { targetInstanceId: 'g' })
    expect(unitOffers(b)).toEqual(['e', 'g2'])
    const c = accept(b, { targetInstanceId: 'g2' })
    expect(effectivePower(c, U(c, 'g2')!)).toBe(4)
  })

  it('GNK Power Droid (SEC_110) makes the next unit you play this phase cost 1 less', () => {
    const a = attack(board({ units: [unit('me', 'SEC_110')] }), 'me')
    expect(effectiveCost(a, 'player', F.GRD)).toBe(1)
    expect(effectiveCost(a, 'player', F.EV)).toBe(1)
  })

  it('Screeching TIE Fighter (SEC_185) may make a ground unit lose its keywords, and gain none, for this phase', () => {
    const s = board({ units: [unit('me', 'SEC_185')] }, { units: [unit('e', 'LAW_095'), unit('sp', 'SPC')] })
    const a = attack(s, 'me')
    expect(unitOffers(a)).toEqual(['e'])
    expect(declinable(a)).toBe(true)
    let b = accept(a, { targetInstanceId: 'e' })
    expect(unitHasKeyword(b, U(b, 'e')!, 'Ambush')).toBe(false)
    b = addLastingEffect(b, { targetInstanceId: 'e', keywords: [{ name: 'Sentinel' }] })
    expect(unitHasKeyword(b, U(b, 'e')!, 'Sentinel')).toBe(false)
  })
})

describe('On Attack: draw and search', () => {
  it('Swoop Bike Marauder (LAW_107) draws a card', () => {
    const a = attack(board({ units: [unit('me', 'LAW_107')], deck: ['EV', 'EV2'] }), 'me')
    expect(a.players.player.hand).toEqual(['EV'])
  })

  it('Admiral Piett (IBH_60) draws a card while you control an Aggression unit', () => {
    expect(attack(board({ units: [unit('me', 'IBH_60')], deck: ['EV'] }), 'me').players.player.hand).toEqual([])
    expect(attack(board({ units: [unit('me', 'IBH_60'), unit('a', 'AGG')], deck: ['EV'] }), 'me').players.player.hand).toEqual(['EV'])
  })

  it('Rugged Survivors (SOR_067) may draw a card while you control a leader unit', () => {
    noChoice(attack(board({ units: [unit('me', 'SOR_067')], deck: ['EV'] }), 'me'))
    const a = attack(board({ units: [unit('me', 'SOR_067'), unit('L', 'GRD', { isLeader: true })], deck: ['EV'] }), 'me')
    expect(declinable(a)).toBe(true)
    expect(accept(a).players.player.hand).toEqual(['EV'])
  })

  it('Luthen Rael (LOF_068) searches the top 5 for an Item upgrade', () => {
    const a = attack(board({ units: [unit('me', 'LOF_068')], deck: ['EV', 'UPG', 'ITEM', 'GRD', 'EV2', 'ITEM'] }), 'me')
    const c = choice(a)
    expect(c.kind).toBe('searchDraw')
    expect(c.kind === 'searchDraw' && c.revealed).toHaveLength(5)
    expect(c.kind === 'searchDraw' && c.eligibleIndices).toEqual([2])
  })

  it('Insurgent Saboteurs (JTL_168) may defeat an upgrade', () => {
    const a = attack(board({ units: [unit('me', 'JTL_168')] }, { units: [unit('e', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })] }), 'me')
    expect(choice(a).kind).toBe('selectUpgradeToDefeat')
    expect(declinable(a)).toBe(true)
    expect(U(accept(a, { optionIndex: 0 }), 'e')!.upgrades).toEqual([])
  })

  it('Wartime Refugee (TS26_43) heals 1 damage from an opponent\'s base', () => {
    const s = board({ units: [unit('me', 'TS26_43')] }, { base: { cardId: 'TST_B', damage: 3 } })
    // The attack then deals Wartime Refugee's 2 back to that base.
    expect(baseDamage(attack(s, 'me'), 'opponent')).toBe(3 - 1 + 2)
  })
})

describe('On Attack: General Grievous (TWI_034)', () => {
  const sabers = (n: number) => Array.from({ length: n }, () => ({ cardId: 'SABER', owner: 'player' as PlayerId }))

  it('defeats 4 enemy units, chosen, with 4 Lightsaber upgrades attached', () => {
    noChoice(attack(board({ units: [unit('me', 'TWI_034', { upgrades: sabers(3) })] }, { units: [unit('e1', 'GRD')] }), 'me'))
    const few = attack(board({ units: [unit('me', 'TWI_034', { upgrades: sabers(4) })] }, { units: [unit('e1', 'GRD'), unit('e2', 'SPC')] }), 'me')
    expect(few.players.opponent.units).toEqual([])
    let a = attack(board({ units: [unit('me', 'TWI_034', { upgrades: sabers(4) }), unit('g', 'GRD')] }, { units: ['e1', 'e2', 'e3', 'e4', 'e5'].map(id => unit(id, 'GRD')) }), 'me')
    expect(unitOffers(a)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5'])
    expect(declinable(a)).toBe(false)
    for (const id of ['e1', 'e2', 'e3']) a = accept(a, { targetInstanceId: id })
    expect(a.players.opponent.units).toHaveLength(5)
    a = accept(a, { targetInstanceId: 'e5' })
    expect(a.players.opponent.units.map(u => u.instanceId)).toEqual(['e4'])
  })

  it('ignores the aspect penalty on a Lightsaber upgrade played on him, not on another unit', () => {
    const s = board({ units: [unit('me', 'TWI_034'), unit('g', 'GRD')] })
    expect(effectiveCost(s, 'player', F.SABER, U(s, 'me'))).toBe(1)
    expect(effectiveCost(s, 'player', F.SABER, U(s, 'g'))).toBe(3)
    expect(effectiveCost(s, 'player', F.UPG, U(s, 'me'))).toBe(1)
  })
})

// ── B: the defender, and this attack ──────────────────────────────────────────────────────────────

describe('On Attack: the defender and this attack', () => {
  it('Kintan Intimidator (SHD_183) exhausts the defender', () => {
    const a = attack(board({ units: [unit('me', 'SHD_183')] }, { units: [unit('e', 'BIG')] }), 'me', 'e')
    expect(U(a, 'e')!.exhausted).toBe(true)
  })

  it('Sabine Wren (SOR_142) may deal 1 to the defender or a base, and can\'t be attacked with 3 aspects among other friendly units', () => {
    const a = attack(board({ units: [unit('me', 'SOR_142'), unit('g', 'GRD')] }, { units: [unit('e', 'BIG'), unit('e2', 'GRD')] }), 'me', 'e')
    expect(amountOf(choice(a))).toBe(1)
    expect(unitOffers(a)).toEqual(['e'])
    expect(baseOffers(a)).toEqual(['opponent', 'player'])
    expect(declinable(a)).toBe(true)
    const onBase = attack(board({ units: [unit('me', 'SOR_142')] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(unitOffers(onBase)).toEqual([])
    const two = board({ units: [unit('me', 'SOR_142'), unit('a', 'AGG'), unit('c', 'CMD')] })
    expect(unitCannotBeAttacked(two, U(two, 'me')!)).toBe(false)
    const three = board({ units: [unit('me', 'SOR_142'), unit('a', 'AGG'), unit('c', 'CMD'), unit('h', 'HERO')] })
    expect(unitCannotBeAttacked(three, U(three, 'me')!)).toBe(true)
    const sentinel = addLastingEffect(three, { targetInstanceId: 'me', keywords: [{ name: 'Sentinel' }] })
    expect(unitCannotBeAttacked(sentinel, U(sentinel, 'me')!)).toBe(false)
  })

  it('Fennec Shand (SHD_220) deals 1 to a defending unit for each different cost in your discard pile', () => {
    const s = board({ units: [unit('me', 'SHD_220')], discard: ['EV', 'EV2', 'EV2', 'EV3'] }, { units: [unit('e', 'BIG')] })
    expect(U(attack(s, 'me', 'e'), 'e')!.damage).toBe(3 + 4)
    expect(baseDamage(attack(s, 'me'), 'opponent')).toBe(4)
  })

  it('Valiant Assault Ship (SHD_151) gets +2/+0 for this attack while the defending player controls more resources', () => {
    const more = board({ units: [unit('me', 'SHD_151')], resources: ready(3) }, { resources: ready(4) })
    const even = board({ units: [unit('me', 'SHD_151')], resources: ready(4) }, { resources: ready(4) })
    expect(baseDamage(attack(more, 'me'), 'opponent')).toBe(5)
    expect(baseDamage(attack(even, 'me'), 'opponent')).toBe(3)
    expect(attack(more, 'me').lastingEffects ?? []).toEqual([])
  })

  it('Boba Fett (SOR_179) deals 3 to an exhausted defender that did not enter play this round', () => {
    const s = board({ units: [unit('me', 'SOR_179')] }, { units: [unit('e', 'BIG', { exhausted: true }), unit('r', 'BIG')] })
    expect(U(attack(s, 'me', 'e'), 'e')!.damage).toBe(3 + 3)
    expect(U(attack(s, 'me', 'r'), 'r')!.damage).toBe(3)
    const fresh = { ...s, phaseEvents: phaseEvents({ enteredPlay: { player: [], opponent: ['e'] } }) }
    expect(U(attack(fresh, 'me', 'e'), 'e')!.damage).toBe(3)
  })

  it('Sith Trooper (JTL_238) gets +1/+0 for this attack for each damaged unit the defending player controls', () => {
    const s = board({ units: [unit('me', 'JTL_238'), unit('g', 'GRD', { damage: 1 })] }, { units: [unit('e', 'GRD', { damage: 1 }), unit('e2', 'SPC', { damage: 2 }), unit('e3', 'GRD')] })
    expect(baseDamage(attack(s, 'me'), 'opponent')).toBe(5)
  })

  it('Hunter (SEC_208) gives an exhausted defender -4/-0 for this attack', () => {
    const tough = src('TOUGH', { power: 5, hp: 20 })
    const s = board({ units: [unit('me', 'SEC_208')] }, { units: [unit('e', 'TOUGH', { exhausted: true }), unit('r', 'TOUGH')] }, { cards: { ...F, TOUGH: tough } })
    expect(U(attack(s, 'me', 'e'), 'me')!.damage).toBe(1)
    expect(U(attack(s, 'me', 'r'), 'me')!.damage).toBe(5)
  })

  it('Han Solo (IBH_10) gives the defender -2/-0 for this attack', () => {
    const tough = src('TOUGH', { power: 5, hp: 20 })
    const s = board({ units: [unit('me', 'IBH_10')] }, { units: [unit('e', 'TOUGH')] }, { cards: { ...F, TOUGH: tough } })
    const a = attack(s, 'me', 'e')
    expect(U(a, 'me')!.damage).toBe(3)
    expect(effectivePower(a, U(a, 'e')!)).toBe(5)
  })
})

// ── C: decks and discard piles ────────────────────────────────────────────────────────────────────

describe('On Attack: cards discarded from a deck', () => {
  it('Bracca Shipbreaker (LAW_192) discards the top card of your deck', () => {
    const a = attack(board({ units: [unit('me', 'LAW_192')], deck: ['EV', 'EV2'] }), 'me')
    expect([a.players.player.deck, a.players.player.discard]).toEqual([['EV2'], ['EV']])
  })

  it('BT-1 (LAW_173) may deal 1 to a ground unit when the discarded card is Aggression', () => {
    noChoice(attack(board({ units: [unit('me', 'LAW_173')], deck: ['CUN_EV'] }, { units: [unit('e', 'GRD')] }), 'me'))
    const a = attack(board({ units: [unit('me', 'LAW_173')], deck: ['AGG_EV'] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'me')
    expect(a.players.player.discard).toEqual(['AGG_EV'])
    expect(amountOf(choice(a))).toBe(1)
    expect(unitOffers(a)).toEqual(['e', 'me'])
    expect(declinable(a)).toBe(true)
  })

  it('Doctor Aphra (LAW_194) discards 3 and may return an Underworld card discarded this way', () => {
    const a = attack(board({ units: [unit('me', 'LAW_194')], deck: ['UW_EV', 'EV', 'UW', 'EV2'], discard: ['UW_EV'] }), 'me')
    expect(a.players.player.deck).toEqual(['EV2'])
    const c = choice(a)
    expect(c.kind === 'selectFromDiscard' && c.candidates).toEqual(['UW_EV', 'UW'])
    expect(declinable(a)).toBe(true)
    const b = accept(a, { optionIndex: 1 })
    expect(b.players.player.hand).toEqual(['UW'])
  })

  it('Kuiil (SHD_041) returns the discarded card to your hand when it shares an aspect with your base', () => {
    const shared = attack(board({ units: [unit('me', 'SHD_041')], deck: ['VIG_EV'] }), 'me')
    expect([shared.players.player.hand, shared.players.player.discard]).toEqual([['VIG_EV'], []])
    const other = attack(board({ units: [unit('me', 'SHD_041')], deck: ['CUN_EV'] }), 'me')
    expect([other.players.player.hand, other.players.player.discard]).toEqual([[], ['CUN_EV']])
  })

  it('Sabine Wren (TWI_195) may discard from her deck, then deals 2 to a ground unit if it shares no aspect with your base', () => {
    const a = attack(board({ units: [unit('me', 'TWI_195')], deck: ['CUN_EV'] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'me')
    expect(declinable(a)).toBe(true)
    const b = accept(a)
    expect(b.players.player.discard).toEqual(['CUN_EV'])
    expect(amountOf(choice(b))).toBe(2)
    expect(unitOffers(b)).toEqual(['e', 'me'])
    expect(declinable(b)).toBe(false)
    noChoice(accept(attack(board({ units: [unit('me', 'TWI_195')], deck: ['VIG_EV'] }, { units: [unit('e', 'GRD')] }), 'me')))
    const s = board({ units: [unit('me', 'TWI_195', { exhausted: true })] })
    expect(unitCannotBeAttacked(s, U(s, 'me')!)).toBe(true)
    const r = board({ units: [unit('me', 'TWI_195')] })
    expect(unitCannotBeAttacked(r, U(r, 'me')!)).toBe(false)
  })

  it('Second Sister (LOF_184) may discard 2 and readies a resource for each Force card among them', () => {
    const a = attack(board({ units: [unit('me', 'LOF_184')], deck: ['FORCE_EV', 'FORCEC', 'EV'], resources: exhausted(3) }), 'me')
    expect(declinable(a)).toBe(true)
    const b = accept(a)
    expect(b.players.player.discard).toEqual(['FORCE_EV', 'FORCEC'])
    expect(readyCount(b, 'player')).toBe(2)
  })

  it('Kanan Jarrus (SOR_047) may discard from the defending player\'s deck per friendly Spectre, healing per aspect', () => {
    const s = board({ units: [unit('me', 'SOR_047'), unit('sp', 'SPECTRE')], base: { cardId: 'VIG_BASE', damage: 5 } }, { deck: ['VIG_EV', 'AGG_EV', 'CUN_EV'] })
    const a = attack(s, 'me')
    expect(declinable(a)).toBe(true)
    const b = accept(a)
    expect(b.players.opponent.discard).toEqual(['VIG_EV', 'AGG_EV'])
    expect(baseDamage(b, 'player')).toBe(3)
  })

  it('Chopper (SOR_188) discards from the defending player\'s deck, exhausting a resource on an event, and has Raid 1 with another Spectre', () => {
    const ev = attack(board({ units: [unit('me', 'SOR_188')] }, { deck: ['EV'], resources: ready(3) }), 'me')
    expect([ev.players.opponent.discard, readyCount(ev, 'opponent')]).toEqual([['EV'], 2])
    const unitCard = attack(board({ units: [unit('me', 'SOR_188')] }, { deck: ['GRD'], resources: ready(3) }), 'me')
    expect(readyCount(unitCard, 'opponent')).toBe(3)
    const alone = board({ units: [unit('me', 'SOR_188')] })
    expect(unitKeywordValue(alone, U(alone, 'me')!, 'Raid')).toBe(0)
    const team = board({ units: [unit('me', 'SOR_188'), unit('sp', 'SPECTRE')] })
    expect(unitKeywordValue(team, U(team, 'me')!, 'Raid')).toBe(1)
  })

  it('0-0-0 (LAW_174) may put an Aggression card from your discard pile on the bottom of your deck to deal 1 to each enemy base', () => {
    const a = attack(board({ units: [unit('me', 'LAW_174')], discard: ['AGG_EV', 'EV'], deck: ['EV2'] }), 'me')
    const c = choice(a)
    expect(c.kind === 'selectCardThen' && c.candidates).toEqual(['AGG_EV'])
    expect(declinable(a)).toBe(true)
    const b = accept(a, { optionIndex: 0 })
    expect([b.players.player.deck, b.players.player.discard, baseDamage(b, 'opponent')]).toEqual([['EV2', 'AGG_EV'], ['EV'], 1 + 4])
  })

  it('The Sarlacc of Carkoon (LAW_163) bottoms a unit from your discard pile and deals its power to an enemy ground unit', () => {
    const a = attack(board({ units: [unit('me', 'LAW_163')], discard: ['EV', 'BH', 'LAW_163'] }, { units: [unit('e', 'BIG'), unit('sp', 'SPC')] }), 'me')
    const c = choice(a)
    expect(c.kind === 'selectCardThen' && c.candidates).toEqual(['BH', 'LAW_163'])
    expect(declinable(a)).toBe(false)
    const b = accept(a, { optionIndex: 1 })
    expect(b.players.player.deck).toEqual(['LAW_163'])
    expect(amountOf(choice(b))).toBe(8)
    expect(unitOffers(b)).toEqual(['e'])
  })
})

// ── D: if you do ──────────────────────────────────────────────────────────────────────────────────

describe('On Attack: if you do', () => {
  it('Fifth Brother (SOR_131) may deal 1 to himself and 1 to another ground unit, and has Raid 1 per damage', () => {
    const a = attack(board({ units: [unit('me', 'SOR_131'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'me')
    expect(unitOffers(a)).toEqual(['e', 'g'])
    expect(declinable(a)).toBe(true)
    const b = accept(a, { targetInstanceId: 'e' })
    expect([U(b, 'me')!.damage, U(b, 'e')!.damage]).toEqual([1, 1])
    const hurt = board({ units: [unit('me', 'SOR_131', { damage: 2 })] })
    expect(unitKeywordValue(hurt, U(hurt, 'me')!, 'Raid')).toBe(2)
    const clean = board({ units: [unit('me', 'SOR_131')] })
    expect(unitKeywordValue(clean, U(clean, 'me')!, 'Raid')).toBe(0)
  })

  it('Chio Fain (LAW_048) may have both players draw a card', () => {
    const a = attack(board({ units: [unit('me', 'LAW_048')], deck: ['EV'] }, { deck: ['EV2'] }), 'me')
    expect(declinable(a)).toBe(true)
    const b = accept(a)
    expect([b.players.player.hand, b.players.opponent.hand]).toEqual([['EV'], ['EV2']])
  })

  it('Crosshair (SEC_162) may deal 1 to another friendly unit to deal 2 to the defending player\'s base', () => {
    const a = attack(board({ units: [unit('me', 'SEC_162'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(unitOffers(a)).toEqual(['g'])
    expect(declinable(a)).toBe(true)
    const b = accept(a, { targetInstanceId: 'g' })
    expect([U(b, 'g')!.damage, baseDamage(b, 'opponent')]).toEqual([1, 2 + 2])
  })

  it('Furtive Handmaiden (SEC_197) may discard a card from hand to draw a card', () => {
    const a = attack(board({ units: [unit('me', 'SEC_197')], hand: ['EV'], deck: ['EV2'] }), 'me')
    expect(declinable(a)).toBe(true)
    const b = accept(a, { handIndex: 0 })
    expect([b.players.player.hand, b.players.player.discard]).toEqual([['EV2'], ['EV']])
  })

  it('Merrin (LOF_160) may discard a card from hand to deal 2 to a unit', () => {
    noChoice(attack(board({ units: [unit('me', 'LOF_160')] }), 'me'))
    const a = attack(board({ units: [unit('me', 'LOF_160')], hand: ['EV'] }, { units: [unit('e', 'SPC')] }), 'me')
    expect(declinable(a)).toBe(true)
    const b = accept(a, { handIndex: 0 })
    expect(amountOf(choice(b))).toBe(2)
    expect(unitOffers(b)).toEqual(['e', 'me'])
  })

  it('Morgan Elsbeth (TWI_035) may defeat another friendly unit to draw a card', () => {
    const a = attack(board({ units: [unit('me', 'TWI_035'), unit('g', 'GRD')], deck: ['EV'] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(unitOffers(a)).toEqual(['g'])
    expect(declinable(a)).toBe(true)
    const b = accept(a, { targetInstanceId: 'g' })
    expect([U(b, 'g'), b.players.player.hand]).toEqual([undefined, ['EV']])
  })

  it('Kihrazx Heavy Fighter (SHD_118) may exhaust another friendly unit for +3/+0 this attack', () => {
    const a = attack(board({ units: [unit('me', 'SHD_118'), unit('g', 'GRD'), unit('t', 'GRD', { exhausted: true })] }), 'me')
    expect(unitOffers(a)).toEqual(['g'])
    expect(declinable(a)).toBe(true)
    const b = accept(a, { targetInstanceId: 'g' })
    expect([U(b, 'g')!.exhausted, baseDamage(b, 'opponent')]).toEqual([true, 6])
    expect(b.lastingEffects ?? []).toEqual([])
  })

  it('Mining Guild TIE Fighter (SOR_206) may pay 2 to draw a card', () => {
    const a = attack(board({ units: [unit('me', 'SOR_206')], deck: ['EV'] }), 'me')
    expect(choice(a).kind).toBe('mayPayThen')
    const b = accept(a)
    expect([b.players.player.hand, readyCount(b, 'player')]).toEqual([['EV'], 8])
    noChoice(attack(board({ units: [unit('me', 'SOR_206')], deck: ['EV'], resources: ready(1) }), 'me'))
  })

  it('Soulless One (TWI_179) may exhaust a friendly Droid or General Grievous, leader or unit, for +2/+0 this attack', () => {
    const a = attack(board({ units: [unit('me', 'TWI_179'), unit('d', 'DROID'), unit('gg', 'GRIEVOUS'), unit('g', 'SPC')] }), 'me')
    expect(unitOffers(a)).toEqual(['d', 'gg'])
    expect(declinable(a)).toBe(true)
    const b = accept(a, { targetInstanceId: 'd' })
    expect([U(b, 'd')!.exhausted, baseDamage(b, 'opponent')]).toEqual([true, 3])
    const leader = { cardId: 'L_GRIEVOUS', deployed: false, epicActionUsed: false, exhausted: false }
    const l = attack(board({ units: [unit('me', 'TWI_179')], leader }), 'me')
    expect(declinable(l)).toBe(true)
    const lb = accept(l)
    expect([lb.players.player.leader.exhausted, baseDamage(lb, 'opponent')]).toEqual([true, 3])
    noChoice(attack(board({ units: [unit('me', 'TWI_179')] }), 'me'))
  })

  it('Hired Slicer (SEC_220) reveals the top 2 of a deck, may exhaust a unit sharing a Trait with one, and bottoms them', () => {
    const a = attack(board({ units: [unit('me', 'SEC_220'), unit('r', 'REB')] }, { units: [unit('e', 'UW'), unit('g', 'GRD')], deck: ['UW_EV', 'EV', 'EV2'] }), 'me')
    expect(choice(a).kind).toBe('choosePlayerThen')
    const b = accept(a, { optionIndex: 0 })
    expect(b.players.opponent.deck[0]).toBe('EV2')
    expect([...b.players.opponent.deck].sort()).toEqual(['EV', 'EV2', 'UW_EV'])
    expect(unitOffers(b)).toEqual(['e'])
    expect(declinable(b)).toBe(true)
    expect(U(accept(b, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
  })

  it('Rey (SHD_046) may heal 2 from a unit, shielding a non-Heroism one, and ignores her Heroism penalty with Kylo Ren', () => {
    const a = attack(board({ units: [unit('me', 'SHD_046'), unit('v', 'VIL', { damage: 3 }), unit('h', 'HERO', { damage: 3 })] }), 'me')
    expect(unitOffers(a)).toEqual(['h', 'me', 'v'])
    expect(declinable(a)).toBe(true)
    const v = accept(a, { targetInstanceId: 'v' })
    expect([U(v, 'v')!.damage, U(v, 'v')!.upgrades.length]).toEqual([1, 1])
    const h = accept(a, { targetInstanceId: 'h' })
    expect([U(h, 'h')!.damage, U(h, 'h')!.upgrades.length]).toEqual([1, 0])
    // TST_L is Command/Heroism and VIG_BASE Vigilance, so Rey pays no penalty there: use a plain base and leader.
    const bare = (units: UnitState[]) => board({ units, leader: { cardId: 'L_POE', deployed: false, epicActionUsed: false, exhausted: false }, base: { cardId: 'VIG_BASE', damage: 0 } })
    expect(effectiveCost(bare([]), 'player', F.SHD_046)).toBe(7)
    expect(effectiveCost(bare([unit('k', 'KYLO')]), 'player', F.SHD_046)).toBe(5)
  })

  it('Dryden Vos (SEC_137) may double his power for this attack, and then does not ready in the next regroup phase', () => {
    const a = attack(board({ units: [unit('me', 'SEC_137')] }), 'me')
    expect(declinable(a)).toBe(true)
    const b = accept(a)
    expect(baseDamage(b, 'opponent')).toBe(4)
    const me = U(b, 'me')!
    expect(getCardDefinition('SEC_137')!.readiesInRegroup!(b, me)).toBe(false)
    const declined = skip(attack(board({ units: [unit('me', 'SEC_137')] }), 'me'))
    expect(getCardDefinition('SEC_137')!.readiesInRegroup!(declined, U(declined, 'me')!)).toBe(true)
  })

  it('Defiant Hammerhead (LAW_062) may get +4/+0 attacking a unit, and is defeated after the attack', () => {
    noChoice(attack(board({ units: [unit('me', 'LAW_062')] }), 'me'))
    const s = board({ units: [unit('me', 'LAW_062')] }, { units: [unit('e', 'BIG', { arena: 'space' })] })
    const a = attack(s, 'me', 'e')
    expect(declinable(a)).toBe(true)
    const b = accept(a)
    expect(U(b, 'e')!.damage).toBe(10)
    expect(U(b, 'me')).toBeUndefined()
    const declined = skip(attack(s, 'me', 'e'))
    expect([U(declined, 'e')!.damage, U(declined, 'me') !== undefined]).toEqual([6, true])
  })
})

// ── E: an opponent chooses, or each player ────────────────────────────────────────────────────────

describe('On Attack: an opponent chooses', () => {
  it('Wartime Pirate (TS26_66) has an opponent deal 1 damage to a unit, then the turn passes', () => {
    const a = attack(board({ units: [unit('me', 'TS26_66')] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(choice(a).controller).toBe('opponent')
    expect(a.activePlayer).toBe('opponent')
    expect(unitOffers(a)).toEqual(['e', 'me'])
    const b = accept(a, { targetInstanceId: 'me' })
    expect([U(b, 'me')!.damage, baseDamage(b, 'opponent'), b.activePlayer]).toEqual([1, 4, 'opponent'])
    noChoice(b)
  })

  it('Ziton Moj (TS26_29) deals 1 to a unit each player controls', () => {
    const a = attack(board({ units: [unit('me', 'TS26_29'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(unitOffers(a)).toEqual(['g', 'me'])
    expect(declinable(a)).toBe(false)
    const b = accept(a, { targetInstanceId: 'g' })
    expect(unitOffers(b)).toEqual(['e'])
    expect(U(accept(b, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
  })

  it('Cikatro Vizago (SEC_218) draws the top card unless an opponent pays 1', () => {
    const s = board({ units: [unit('me', 'SEC_218')], deck: ['EV'] })
    const a = attack(s, 'me')
    expect(choice(a)).toMatchObject({ kind: 'mayPayThen', controller: 'opponent', cost: 1 })
    const paid = accept(a)
    expect([paid.players.player.hand, readyCount(paid, 'opponent'), paid.activePlayer]).toEqual([[], 9, 'opponent'])
    const refused = skip(a)
    expect(refused.players.player.hand).toEqual(['EV'])
    const broke = attack(board({ units: [unit('me', 'SEC_218')], deck: ['EV'] }, { resources: [] }), 'me')
    expect(broke.players.player.hand).toEqual(['EV'])
  })

  it('Jabba\'s Rancor (LAW_216) has an opponent choose a ground unit they control, then may deal 7 to it', () => {
    const a = attack(board({ units: [unit('me', 'LAW_216'), unit('g', 'GRD')] }, { units: [unit('e', 'BIG'), unit('e2', 'GRD'), unit('sp', 'SPC')] }), 'me')
    expect(choice(a).controller).toBe('opponent')
    expect(unitOffers(a)).toEqual(['e', 'e2'])
    expect(declinable(a)).toBe(false)
    const b = accept(a, { targetInstanceId: 'e2' })
    expect(choice(b)).toMatchObject({ kind: 'mayPayThen', controller: 'player' })
    expect(U(accept(b), 'e2')!.damage).toBe(7)
  })

  it('Grey Squadron Y-Wing (SHD_246) has an opponent choose a unit or base they control, then may deal 2 to it', () => {
    const a = attack(board({ units: [unit('me', 'SHD_246')] }, { units: [unit('e', 'GRD')] }), 'me')
    expect(choice(a)).toMatchObject({ kind: 'selectCardThen', controller: 'opponent' })
    expect(moves(a).filter(m => m.type === 'acceptChoice')).toHaveLength(2)
    const onBase = accept(accept(a, { optionIndex: 1 }))
    expect(baseDamage(onBase, 'opponent')).toBe(2 + 1)
    const onUnit = accept(accept(a, { optionIndex: 0 }))
    expect(U(onUnit, 'e')!.damage).toBe(2)
  })
})

// ── F: small engine additions ─────────────────────────────────────────────────────────────────────

describe('On Attack: cards that needed a small engine addition', () => {
  it('Beilert Valance (LAW_051) draws, then may deal damage equal to the cards you have drawn this phase', () => {
    const s = board({ units: [unit('me', 'LAW_051')], deck: ['EV', 'EV2', 'EV3'] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }, { phaseEvents: phaseEvents({ cardsDrawn: { player: 2, opponent: 5 } }) })
    const a = attack(s, 'me')
    expect(a.players.player.hand).toEqual(['EV'])
    expect(amountOf(choice(a))).toBe(3)
    expect(unitOffers(a)).toEqual(['e', 'me'])
    expect(declinable(a)).toBe(true)
  })

  it('Shifty Suspects (LAW_197) stops bases being healed for this phase', () => {
    const s = board({ units: [unit('me', 'LAW_197')], base: { cardId: 'VIG_BASE', damage: 5 } })
    const a = attack(s, 'me')
    expect(baseDamage(healBase(a, 'player', 2), 'player')).toBe(5)
    expect(baseDamage(healBase(clearLastingEffects(a), 'player', 2), 'player')).toBe(3)
  })

  it('Zuckuss (LOF_204) names a card and gets +4/+0 for this attack if the defending player discards it from their deck', () => {
    const s = board({ units: [unit('me', 'LOF_204')] }, { deck: ['GRD', 'EV'] })
    const a = attack(s, 'me')
    expect(choice(a).kind).toBe('nameCard')
    const hit = accept(a, { cardName: 'GRD' })
    expect([hit.players.opponent.discard, baseDamage(hit, 'opponent')]).toEqual([['GRD'], 8])
    const miss = accept(a, { cardName: 'EV' })
    expect([miss.players.opponent.discard, baseDamage(miss, 'opponent')]).toEqual([['GRD'], 4])
  })

  it('Chimaera (SOR_185) names a card, and an opponent discards a card with that name from their hand', () => {
    const s = board({ units: [unit('me', 'SOR_185')] }, { hand: ['EV', 'GRD', 'GRD'], deck: ['EV2'] })
    const a = attack(s, 'me')
    const hit = accept(a, { cardName: 'GRD' })
    expect([hit.players.opponent.hand, hit.players.opponent.discard]).toEqual([['EV', 'GRD'], ['GRD']])
    const miss = accept(a, { cardName: 'EV2' })
    expect(miss.players.opponent.hand).toEqual(['EV', 'GRD', 'GRD'])
  })
})
