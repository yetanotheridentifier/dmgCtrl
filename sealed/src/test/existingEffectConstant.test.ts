import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectiveCost, enemyAttackTargets } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { effectiveHp, effectivePower } from '../engine/stats'
import { unitKeywords, unitHasTrait, unitDealsDamageFirst, unitCannotAttackBases, unitCannotBeAttacked } from '../engine/keywords'
import { normaliseCard } from '../engine/cardDb'
import { reprintCanonicalId } from '../data/reprints'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, KeywordInstance, PhaseEvents, PlayerId, UnitState } from '../engine/types'

/**
 * Constant abilities on units and upgrades from the sealed sets beyond ASH: conditional keywords, stat
 * modifiers, auras, cost modifiers, attach restrictions and enters-ready conditions. Each is read through
 * the engine's own readers (`unitKeywords`, `effectivePower`, `effectiveCost`, ...), both sides of every
 * condition, so a table can state per card what holds and what does not.
 *
 * Every source here is a ground unit printed 2/5 with no keywords, carrying only the traits and aspects
 * its own condition needs to show that "another" leaves the source out.
 */

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 3, power: 2, hp: 5, ...over })
const ally = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 4, ...over })
const upg = (id: string, over: Partial<EngineCard> = {}) => card({ id, type: 'upgrade', cost: 1, power: 0, hp: 0, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  GRD: ally('GRD'),
  SPACE: ally('SPACE', { arena: 'space' }),
  OFFICIAL: ally('OFFICIAL', { traits: ['OFFICIAL'] }),
  AGG: ally('AGG', { aspects: ['Aggression'] }),
  CMD: ally('CMD', { aspects: ['Command'] }),
  CUN: ally('CUN', { aspects: ['Cunning'] }),
  VIL: ally('VIL', { aspects: ['Villainy'] }),
  HERO: ally('HERO', { aspects: ['Heroism'] }),
  VEH: ally('VEH', { traits: ['VEHICLE'] }),
  JEDIVEH: ally('JEDIVEH', { traits: ['JEDI', 'VEHICLE'] }),
  SEP: ally('SEP', { traits: ['SEPARATIST'] }),
  FIGHTER: ally('FIGHTER', { arena: 'space', traits: ['FIGHTER'] }),
  TROOPER: ally('TROOPER', { traits: ['TROOPER'] }),
  MANDO: ally('MANDO', { traits: ['MANDALORIAN'] }),
  JEDI: ally('JEDI', { traits: ['JEDI'] }),
  FORCE: ally('FORCE', { traits: ['FORCE'] }),
  SITH: ally('SITH', { traits: ['SITH'] }),
  DROID: ally('DROID', { traits: ['DROID'] }),
  REBEL: ally('REBEL', { traits: ['REBEL'] }),
  IMPERIAL: ally('IMPERIAL', { traits: ['IMPERIAL'] }),
  REPUBLIC: ally('REPUBLIC', { traits: ['REPUBLIC'] }),
  UNQ: ally('UNQ', { unique: true }),
  BIG: ally('BIG', { cost: 6 }),
  CHEAP4: ally('CHEAP4', { cost: 4 }),
  PADME: card({ id: 'PADME', name: 'Padmé Amidala', type: 'leader', cost: 5, power: 3, hp: 6 }),
  PADME_U: ally('PADME_U', { name: 'Padmé Amidala' }),
  PALP: card({ id: 'PALP', name: 'Emperor Palpatine', type: 'leader', cost: 6, power: 5, hp: 7 }),
  JABBA: card({ id: 'JABBA', name: 'Jabba the Hutt', type: 'leader', cost: 6, power: 5, hp: 7 }),
  JABBA_U: ally('JABBA_U', { name: 'Jabba the Hutt' }),
  GRIEVOUS: ally('GRIEVOUS', { name: 'General Grievous' }),
  ZUCK: ally('ZUCK', { name: 'Zuckuss' }),
  FOURLOM: ally('FOURLOM', { name: '4-LOM' }),
  UPG: upg('UPG'),
  LSABER: upg('LSABER', { traits: ['LIGHTSABER'] }),
  FUPG: upg('FUPG', { traits: ['FORCE'] }),
  // Conditional keywords on the unit itself
  LAW_105: src('LAW_105'), SEC_201: src('SEC_201'), SEC_079: src('SEC_079'), SEC_249: src('SEC_249', { traits: ['OFFICIAL'] }),
  SEC_134: src('SEC_134'), SEC_116: src('SEC_116'), SEC_063: src('SEC_063'), SEC_029: src('SEC_029'),
  LOF_162: src('LOF_162', { aspects: ['Aggression'] }), LOF_212: src('LOF_212'), LOF_118: src('LOF_118'), JTL_107: src('JTL_107'),
  JTL_081: src('JTL_081'), JTL_257: src('JTL_257', { traits: ['FIGHTER'] }), JTL_113: src('JTL_113'), TWI_062: src('TWI_062'),
  TWI_081: src('TWI_081', { traits: ['SEPARATIST'] }), TWI_054: src('TWI_054'), TWI_180: src('TWI_180', { traits: ['SEPARATIST'] }),
  SHD_169: src('SHD_169'), SHD_112: src('SHD_112', { aspects: ['Command'] }), SHD_247: src('SHD_247'), SHD_034: src('SHD_034'),
  SOR_065: src('SOR_065'), SOR_114: src('SOR_114', { aspects: ['Command'] }), SOR_249: src('SOR_249', { traits: ['VEHICLE'] }),
  SOR_211: src('SOR_211', { aspects: ['Cunning'] }), SOR_159: src('SOR_159', { aspects: ['Aggression'] }), SOR_048: src('SOR_048'),
  TS26_20: src('TS26_20'), SOR_082: src('SOR_082'), TWI_130: src('TWI_130', { traits: ['MANDALORIAN', 'TROOPER'] }),
  TWI_143: src('TWI_143'), TS26_50: src('TS26_50'),
  // Stat modifiers
  SEC_151: src('SEC_151'), SEC_114: src('SEC_114'), SEC_108: src('SEC_108'), LOF_062: src('LOF_062'), LOF_083: src('LOF_083'),
  LOF_049: src('LOF_049'), LOF_244: src('LOF_244', { traits: ['JEDI'] }), LOF_060: src('LOF_060', { traits: ['JEDI'] }),
  LOF_153: src('LOF_153'), LOF_233: src('LOF_233'), LOF_081: src('LOF_081', { aspects: ['Villainy'] }),
  JTL_115: src('JTL_115', { arena: 'space' }), JTL_052: src('JTL_052', { power: 6 }),
  JTL_256: src('JTL_256', { name: 'Swarming Vulture Droid' }), TWI_142: src('TWI_142'), TWI_163: src('TWI_163', { traits: ['TROOPER'] }),
  SHD_042: src('SHD_042'), SHD_056: src('SHD_056'), SHD_083: src('SHD_083'), SOR_118: src('SOR_118'), SOR_161: src('SOR_161'),
  // Auras
  LAW_139: src('LAW_139'), SEC_047: src('SEC_047'), LOF_169: src('LOF_169'), LOF_089: src('LOF_089', { traits: ['VEHICLE'] }),
  JTL_161: src('JTL_161'), JTL_085: src('JTL_085', { arena: 'space' }), TWI_092: src('TWI_092', { aspects: ['Heroism'] }),
  SHD_188: src('SHD_188'), SHD_190: src('SHD_190'), SHD_037: src('SHD_037'), SOR_079: src('SOR_079'),
  SOR_242: src('SOR_242', { traits: ['REBEL'] }), SOR_230: src('SOR_230', { traits: ['IMPERIAL'] }),
  SOR_144: src('SOR_144', { aspects: ['Heroism'] }), SOR_100: src('SOR_100'), TS26_40: src('TS26_40', { traits: ['REPUBLIC'] }),
  SEC_224: src('SEC_224'), SOR_212: src('SOR_212', { arena: 'space' }),
  // Cost modifiers and entering ready
  LAW_110: src('LAW_110', { cost: 8 }), JTL_163: src('JTL_163', { cost: 4 }), JTL_204: src('JTL_204', { cost: 9 }),
  TWI_197: src('TWI_197', { cost: 6 }), TWI_098: src('TWI_098', { cost: 11 }), SOR_248: src('SOR_248', { cost: 3 }),
  LAW_223: src('LAW_223', { unique: true }), LAW_210: src('LAW_210'), SEC_170: src('SEC_170'),
  SEC_135: src('SEC_135'), SOR_198: src('SOR_198'), SHD_234: src('SHD_234'),
  // Upgrades
  SEC_071: upg('SEC_071'), LOF_215: upg('LOF_215'), LOF_261: upg('LOF_261'), LOF_238: upg('LOF_238'), LOF_053: upg('LOF_053'),
  TWI_071: upg('TWI_071'), TWI_236: upg('TWI_236', { cost: 4 }), SOR_070: upg('SOR_070'),
  SOR_166: upg('SOR_166'), SOR_057: upg('SOR_057'), LAW_128: upg('LAW_128'), LOF_074: upg('LOF_074'), LOF_151: upg('LOF_151'),
  TS26_79: upg('TS26_79'), SHD_069: upg('SHD_069'), LAW_150: upg('LAW_150'), SOR_072: upg('SOR_072'), LAW_129: upg('LAW_129', { cost: 4 }),
}

/** The fixture helper reads a unit's arena from the shared pool, which does not hold these cards. */
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)!
const shield = { cardId: TOKEN_SHIELD, owner: 'player' as PlayerId }

interface Setup {
  self?: Partial<UnitState>
  mine?: UnitState[]
  theirs?: UnitState[]
  res?: number
  theirRes?: number
  over?: Partial<GameState>
  leader?: string
}
/** The source `src` as the player's first unit, plus whatever the setup adds. An empty id leaves `src` out. */
const b = (id: string, { self = {}, mine = [], theirs = [], res = 4, theirRes = 4, over = {}, leader }: Setup = {}): GameState =>
  state({
    cards: F,
    players: {
      player: player({ units: [...(id ? [unit('src', id, self)] : []), ...mine], resources: ready(res), ...(leader ? { leader: { cardId: leader, deployed: false, epicActionUsed: false, exhausted: false } } : {}) }),
      opponent: player({ units: theirs, resources: ready(theirRes) }),
    },
    ...over,
  })
const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, leaderLeftPlay: [], played: { player: [], opponent: [] },
  ...over,
})
const kws = (s: GameState, id = 'src'): KeywordInstance[] => unitKeywords(s, U(s, id))
const stats = (s: GameState, id = 'src', ctx = {}) => `${effectivePower(s, U(s, id), ctx)}/${effectiveHp(s, U(s, id), ctx)}`

const S = [{ name: 'Sentinel' }]
const raid = (value: number) => [{ name: 'Raid', value }]
const restore = (value: number) => [{ name: 'Restore', value }]

describe('conditional keywords on the unit itself', () => {
  it.each<[string, string, KeywordInstance[], Setup, Setup]>([
    ['LAW_105', 'Cinta Kaz: Sentinel while upgraded', S, { self: { upgrades: [shield] } }, {}],
    ['SEC_201', 'Anakin Skywalker: Raid 2 while you control Padmé Amidala as a leader', raid(2), { leader: 'PADME' }, { theirs: [unit('p', 'PADME_U')] }],
    ['SEC_201', 'Anakin Skywalker: Raid 2 while you control Padmé Amidala as a unit', raid(2), { mine: [unit('p', 'PADME_U')] }, {}],
    ['SEC_079', 'Corrupt Politician: Sentinel while you control more units', S, { mine: [unit('a', 'GRD')], theirs: [unit('e', 'GRD')] }, { theirs: [unit('e', 'GRD')] }],
    ['SEC_249', 'High Command Councilor: Raid 2 while you control another Official unit', raid(2), { mine: [unit('a', 'OFFICIAL')] }, {}],
    ['SEC_134', 'Hunting Assassin Droid: Raid 2 while an enemy unit is damaged', raid(2), { theirs: [unit('e', 'GRD', { damage: 1 })] }, { mine: [unit('a', 'GRD', { damage: 1 })], theirs: [unit('e', 'GRD')] }],
    ['SEC_116', 'Nubian Star Skiff: Restore 2 while you control an Official unit', restore(2), { mine: [unit('a', 'OFFICIAL')] }, { theirs: [unit('e', 'OFFICIAL')] }],
    ['SEC_063', 'Rotunda Senate Guards: Sentinel while undamaged', S, {}, { self: { damage: 1 } }],
    ['SEC_029', 'Zam Wesell: Grit while upgraded', [{ name: 'Grit' }], { self: { upgrades: [shield] } }, {}],
    ['LOF_162', 'Hunting Nexu: Raid 2 while you control another Aggression unit', raid(2), { mine: [unit('a', 'AGG')] }, { theirs: [unit('e', 'AGG')] }],
    ['LOF_212', 'Life Wind Sage: Raid 2 while an enemy unit is exhausted', raid(2), { theirs: [unit('e', 'GRD', { exhausted: true })] }, { mine: [unit('a', 'GRD', { exhausted: true })], theirs: [unit('e', 'GRD')] }],
    ['LOF_118', 'Terentatek: Ambush while an opponent controls a Force unit', [{ name: 'Ambush' }], { theirs: [unit('e', 'FORCE')] }, { mine: [unit('a', 'FORCE')] }],
    ['JTL_107', 'Bunker Defender: Sentinel while you control a Vehicle unit', S, { mine: [unit('a', 'VEH')] }, { theirs: [unit('e', 'VEH')] }],
    ['JTL_081', 'First Order TIE Fighter: Raid 1 while you control a token unit', raid(1), { mine: [unit('t', TOKEN_MANDALORIAN)] }, { mine: [unit('a', 'GRD')] }],
    ['JTL_257', 'Flanking Fang Fighter: Raid 2 while you control another Fighter unit', raid(2), { mine: [unit('a', 'FIGHTER')] }, {}],
    ['JTL_113', 'Homestead Militia: Sentinel while you control 6 or more resources', S, { res: 6 }, { res: 5, theirRes: 6 }],
    ['TWI_062', 'Daughter of Dathomir: Restore 2 while undamaged', restore(2), {}, { self: { damage: 1 } }],
    ['TWI_081', 'Droid Commando: Ambush while you control another Separatist unit', [{ name: 'Ambush' }], { mine: [unit('a', 'SEP')] }, {}],
    ['TWI_054', "Duchess's Champion: Sentinel while an opponent controls 3 or more units", S,
      { theirs: [unit('e1', 'GRD'), unit('e2', 'GRD'), unit('e3', 'GRD')] }, { mine: [unit('a', 'GRD'), unit('b', 'GRD')], theirs: [unit('e1', 'GRD'), unit('e2', 'GRD')] }],
    ['TWI_180', 'Separatist Commando: Raid 2 while you control another Separatist unit', raid(2), { mine: [unit('a', 'SEP')] }, {}],
    ['SHD_169', 'Clan Challengers: Overwhelm while upgraded', [{ name: 'Overwhelm' }], { self: { upgrades: [shield] } }, {}],
    ['SHD_112', 'Gamorrean Retainer: Sentinel while you control another Command unit', S, { mine: [unit('a', 'CMD')] }, {}],
    ['SHD_247', 'Protector of the Throne: Sentinel while upgraded', S, { self: { upgrades: [shield] } }, {}],
    ['SHD_034', 'Supercommando Squad: Sentinel while upgraded', S, { self: { upgrades: [shield] } }, {}],
    ['SOR_065', 'Baze Malbus: Sentinel while you have the initiative', S, { over: { initiative: 'player' } }, { over: { initiative: 'opponent' } }],
    ['SOR_114', 'Escort Skiff: Ambush while you control another Command unit', [{ name: 'Ambush' }], { mine: [unit('a', 'CMD')] }, {}],
    ['SOR_249', 'Frontier AT-RT: Ambush while you control another Vehicle unit', [{ name: 'Ambush' }], { mine: [unit('a', 'VEH')] }, {}],
    ['SOR_211', 'Gamorrean Guards: Sentinel while you control another Cunning unit', S, { mine: [unit('a', 'CUN')] }, {}],
    ['SOR_159', 'Partisan Insurgent: Raid 2 while you control another Aggression unit', raid(2), { mine: [unit('a', 'AGG')] }, {}],
    ['SOR_048', 'Vigilant Honor Guards: Sentinel while undamaged', S, {}, { self: { damage: 1 } }],
    ['TS26_20', '501st Veteran: Sentinel while undamaged', S, {}, { self: { damage: 1 } }],
    ['TS26_50', 'General Grievous: Sentinel while undamaged', S, {}, { self: { damage: 1 } }],
    ['SOR_082', "Emperor's Royal Guard: Sentinel while you control an Official unit", S, { mine: [unit('a', 'OFFICIAL')] }, {}],
    ['TWI_130', 'Bo-Katan Kryze: Overwhelm and Saboteur while you control another Mandalorian unit', [{ name: 'Overwhelm' }, { name: 'Saboteur' }], { mine: [unit('a', 'MANDO')] }, {}],
    ['TWI_143', 'Jyn Erso: Saboteur while an enemy unit was defeated this phase', [{ name: 'Saboteur' }],
      { over: { phaseEvents: phaseEvents({ defeated: { player: [], opponent: ['gone'] } }) } }, { over: { phaseEvents: phaseEvents({ defeated: { player: ['gone'], opponent: [] } }) } }],
  ])('%s %s', (id, _label, expected, on, off) => {
    expect(kws(b(id, on))).toEqual(expected)
    expect(kws(b(id, off))).toEqual([])
  })
})

describe('stat modifiers on the unit itself', () => {
  const tired = (n: number) => Array.from({ length: n }, (_, i) => unit(`t${i}`, 'GRD', { exhausted: true }))
  it.each<[string, string, string, Setup, string, Setup]>([
    ['SEC_151', 'Kazuda Xiono: +2/+0 while you control fewer resources than an opponent', '4/5', { res: 4, theirRes: 5 }, '2/5', { res: 5, theirRes: 5 }],
    ['SEC_114', 'Kino Loy: +1/+0 for each other exhausted friendly unit', '4/5', { self: { exhausted: true }, mine: [...tired(2), unit('r', 'GRD')], theirs: tired(1) }, '2/5', { self: { exhausted: true }, theirs: tired(2) }],
    ['SEC_108', "Senator's Aide: +2/+0 while you have the initiative", '4/5', { over: { initiative: 'player' } }, '2/5', { over: { initiative: 'opponent' } }],
    ['LOF_062', 'Axe Woves: +1/+1 for each upgrade on him', '4/7', { self: { upgrades: [shield, shield] } }, '2/5', {}],
    ['LOF_153', 'Paz Vizsla: +2/+0 for each damage on him', '6/5', { self: { damage: 2 } }, '2/5', {}],
    ['LOF_233', 'Scimitar: +3/+0 while damaged', '5/5', { self: { damage: 1 } }, '2/5', {}],
    ['LOF_081', 'Sith Legionnaire: +2/+0 while you control another Villainy unit', '4/5', { mine: [unit('a', 'VIL')] }, '2/5', { theirs: [unit('e', 'VIL')] }],
    ['LOF_060', 'Padawan Starfighter: +1/+1 while you control a Force unit', '3/6', { mine: [unit('a', 'FORCE')] }, '2/5', { theirs: [unit('e', 'FORCE')] }],
    ['LOF_060', 'Padawan Starfighter: +1/+1 while you control a Force upgrade', '3/6',
      { theirs: [unit('e', 'GRD', { upgrades: [{ cardId: 'FUPG', owner: 'player' }] })] }, '2/5', { mine: [unit('a', 'GRD', { upgrades: [{ cardId: 'FUPG', owner: 'opponent' }] })] }],
    ['LOF_244', 'Jedi Vector: +1/+0 with another Jedi unit and +1/+0 with a Lightsaber upgrade', '4/5',
      { mine: [unit('a', 'JEDI', { upgrades: [{ cardId: 'LSABER', owner: 'player' }] })] }, '2/5', { theirs: [unit('e', 'JEDI', { upgrades: [{ cardId: 'LSABER', owner: 'opponent' }] })] }],
    ['JTL_115', 'Clone Combat Squadron: +1/+1 for each other friendly space unit', '4/7', { mine: [unit('a', 'SPACE'), unit('b', 'SPACE'), unit('g', 'GRD')], theirs: [unit('e', 'SPACE')] }, '2/5', {}],
    ['JTL_052', "D'Qar Cargo Frigate: -1/-0 for each damage on it", '4/5', { self: { damage: 2 } }, '6/5', {}],
    ['JTL_256', 'Swarming Vulture Droid: +1/+0 for each other friendly Swarming Vulture Droid', '4/5', { mine: [unit('a', 'JTL_256'), unit('b', 'JTL_256')], theirs: [unit('e', 'JTL_256')] }, '2/5', {}],
    ['TWI_163', 'Relentless Rocket Droid: +2/+0 while you control another Trooper unit', '4/5', { mine: [unit('a', 'TROOPER')] }, '2/5', {}],
    ['SHD_056', 'Follower of The Way: +1/+1 while upgraded', '3/6', { self: { upgrades: [shield] } }, '2/5', {}],
    ['SHD_083', 'Seasoned Shoretrooper: +2/+0 while you control 6 or more resources', '4/5', { res: 6 }, '2/5', { res: 5 }],
    ['SOR_118', '97th Legion: +1/+1 for each resource you control', '6/9', { res: 4 }, '2/5', { res: 0 }],
    ['SOR_161', 'Ardent Sympathizer: +2/+0 while you have the initiative', '4/5', { over: { initiative: 'player' } }, '2/5', { over: { initiative: 'opponent' } }],
    ['TS26_50', 'General Grievous: +1/+1 for each resource you control', '5/8', { res: 3 }, '2/5', { res: 0 }],
    ['SOR_082', "Emperor's Royal Guard: +0/+1 while you control Emperor Palpatine", '2/6', { leader: 'PALP' }, '2/5', {}],
    ['TWI_130', 'Bo-Katan Kryze: +1/+0 while you control another Trooper unit', '3/5', { mine: [unit('a', 'TROOPER')] }, '2/5', {}],
    ['TWI_143', 'Jyn Erso: +1/+0 while an enemy unit was defeated this phase', '3/5', { over: { phaseEvents: phaseEvents({ defeated: { player: [], opponent: ['gone'] } }) } }, '2/5', {}],
  ])('%s %s', (id, _label, onStats, on, offStats, off) => {
    expect(stats(b(id, on))).toBe(onStats)
    expect(stats(b(id, off))).toBe(offStats)
  })

  it('Captain Enoch (LOF_083) gets +1/+0 for each Trooper unit in your own discard pile', () => {
    const s = b('LOF_083')
    s.players.player.discard = ['TROOPER', 'TROOPER', 'GRD', 'UPG']
    s.players.opponent.discard = ['TROOPER']
    expect(stats(s)).toBe('4/5')
  })

  it("Anakin's Interceptor (TWI_142) gets +2/+0 while your base has 15 or more damage", () => {
    const at = (who: PlayerId, n: number) => { const s = b('TWI_142'); s.players[who].base.damage = n; return stats(s) }
    expect([at('player', 15), at('player', 14), at('opponent', 20)]).toEqual(['4/5', '2/5', '2/5'])
  })

  it.each([['LOF_049', 'Jedi Guardian'], ['SHD_042', 'Concord Dawn Interceptors']])('%s %s gets +2/+0 while defending', id => {
    expect(stats(b(id), 'src', { defending: true })).toBe('4/5')
    expect(stats(b(id), 'src', { attacking: true })).toBe('2/5')
  })
})

/** Power/HP and keyword names of every unit on the board, by instance id. */
const view = (s: GameState) => Object.fromEntries(all(s).map(u => [u.instanceId, `${stats(s, u.instanceId)} ${unitKeywords(s, u).map(k => k.value ? `${k.name} ${k.value}` : k.name).join(',')}`.trim()]))

describe('auras on other units', () => {
  it.each<[string, string, Setup, Record<string, string>]>([
    ['LAW_139', 'Admiral Motti: friendly leader units +2/+2', { mine: [unit('L', 'TST_L', { isLeader: true }), unit('a', 'GRD')], theirs: [unit('EL', 'TST_L', { isLeader: true })] },
      { src: '2/5', L: '6/9', a: '2/4', EL: '4/7' }],
    ['SEC_047', 'Coronet: each other friendly unit gains Restore 1', { mine: [unit('a', 'GRD')], theirs: [unit('e', 'GRD')] }, { src: '2/5', a: '2/4 Restore 1', e: '2/4' }],
    ['LOF_169', 'Invasion Control Ship: friendly Droid units gain Raid 2', { mine: [unit('d', 'DROID'), unit('a', 'GRD')], theirs: [unit('e', 'DROID')] },
      { src: '2/5', d: '2/4 Raid 2', a: '2/4', e: '2/4' }],
    ['LOF_089', 'Supremacy: other friendly Vehicle units +6/+6', { mine: [unit('v', 'VEH'), unit('a', 'GRD')], theirs: [unit('e', 'VEH')] }, { src: '2/5', v: '8/10', a: '2/4', e: '2/4' }],
    ['JTL_161', 'Captain Tarkin: each friendly Vehicle unit +1/+0 and Overwhelm', { mine: [unit('v', 'VEH')], theirs: [unit('e', 'VEH')] }, { src: '2/5', v: '3/4 Overwhelm', e: '2/4' }],
    ['JTL_085', 'Victor Leader: each other friendly space unit +1/+1', { mine: [unit('sp', 'SPACE'), unit('a', 'GRD')], theirs: [unit('e', 'SPACE')] }, { src: '2/5', sp: '3/5', a: '2/4', e: '2/4' }],
    ['TWI_092', 'Admiral Yularen: each other friendly Heroism unit +0/+1', { mine: [unit('h', 'HERO'), unit('a', 'GRD')], theirs: [unit('e', 'HERO')] }, { src: '2/5', h: '2/5', a: '2/4', e: '2/4' }],
    ['SHD_188', '4-LOM: each friendly Zuckuss +1/+1 and Ambush', { mine: [unit('z', 'ZUCK'), unit('a', 'GRD')], theirs: [unit('e', 'ZUCK')] }, { src: '2/5', z: '3/5 Ambush', a: '2/4', e: '2/4' }],
    ['SHD_190', 'Zuckuss: each friendly 4-LOM +1/+1 and Saboteur', { mine: [unit('f', 'FOURLOM')], theirs: [unit('e', 'FOURLOM')] }, { src: '2/5', f: '3/5 Saboteur', e: '2/4' }],
    ['SHD_037', 'Supreme Leader Snoke: each enemy non-leader unit -2/-2', { mine: [unit('a', 'GRD')], theirs: [unit('e', 'GRD'), unit('EL', 'TST_L', { isLeader: true })] },
      { src: '2/5', a: '2/4', e: '0/2', EL: '4/7' }],
    ['SOR_079', 'Admiral Piett: each friendly non-leader unit costing 6 or more gains Ambush', { mine: [unit('big', 'BIG'), unit('a', 'GRD'), unit('L', 'PALP', { isLeader: true })], theirs: [unit('e', 'BIG')] },
      { src: '2/5', big: '2/4 Ambush', a: '2/4', L: '5/7', e: '2/4' }],
    ['SOR_242', 'General Dodonna: other friendly Rebel units +1/+1', { mine: [unit('r', 'REBEL'), unit('a', 'GRD')], theirs: [unit('e', 'REBEL')] }, { src: '2/5', r: '3/5', a: '2/4', e: '2/4' }],
    ['SOR_230', 'General Veers: other friendly Imperial units +1/+1', { mine: [unit('i', 'IMPERIAL'), unit('a', 'GRD')], theirs: [unit('e', 'IMPERIAL')] }, { src: '2/5', i: '3/5', a: '2/4', e: '2/4' }],
    ['SOR_144', 'Red Three: each other friendly Heroism unit gains Raid 1', { mine: [unit('h', 'HERO'), unit('a', 'GRD')], theirs: [unit('e', 'HERO')] }, { src: '2/5', h: '2/4 Raid 1', a: '2/4', e: '2/4' }],
    ['SOR_100', 'Wedge Antilles: each friendly Vehicle unit +1/+1 and Ambush', { mine: [unit('v', 'VEH')], theirs: [unit('e', 'VEH')] }, { src: '2/5', v: '3/5 Ambush', e: '2/4' }],
    ['TS26_40', 'Obi-Wan Kenobi: other friendly Republic units gain Restore 1', { mine: [unit('r', 'REPUBLIC'), unit('a', 'GRD')], theirs: [unit('e', 'REPUBLIC')] },
      { src: '2/5', r: '2/4 Restore 1', a: '2/4', e: '2/4' }],
  ])('%s %s', (id, _label, setup, expected) => {
    expect(view(b(id, setup))).toEqual(expected)
  })

  it('Vel Sartha (SEC_224) gives an exhausted enemy unit -2/-0 only while it defends', () => {
    const s = b('SEC_224', { mine: [unit('a', 'GRD')], theirs: [unit('x', 'GRD', { exhausted: true }), unit('r', 'GRD')] })
    const defending = (id: string) => effectivePower(s, U(s, id), { defending: true, combat: { attackerInstanceId: 'a', defenderInstanceId: id } })
    expect([defending('x'), defending('r'), effectivePower(s, U(s, 'x'))]).toEqual([0, 2, 2])
  })

  it('Strafing Gunship (SOR_212) attacks ground units, and gives a ground defender -2/-0 while it attacks', () => {
    const s = b('SOR_212', { mine: [unit('a', 'GRD')], theirs: [unit('g', 'GRD'), unit('sp', 'SPACE')] })
    expect(enemyAttackTargets(s, U(s, 'src')).targets.map(u => u.instanceId).sort()).toEqual(['g', 'sp'])
    const defender = (attacker: string, id: string) => effectivePower(s, U(s, id), { defending: true, combat: { attackerInstanceId: attacker, defenderInstanceId: id } })
    expect([defender('src', 'g'), defender('src', 'sp'), defender('a', 'g')]).toEqual([0, 2, 2])
  })
})

describe('upgrades', () => {
  const on = (upgrade: string, hostCard = 'GRD', host: Partial<UnitState> = {}) =>
    b('GRD', { mine: [unit('h', hostCard, { ...host, upgrades: [{ cardId: upgrade, owner: 'player' }] })] })

  it.each<[string, string, KeywordInstance[], string]>([
    ['LOF_215', 'Ascension Cable: Saboteur', [{ name: 'Saboteur' }], 'GRD'],
    ['TWI_071', 'Unshakeable Will: Sentinel', S, 'GRD'],
    ['TWI_236', "Grievous's Wheel Bike: Overwhelm", [{ name: 'Overwhelm' }], 'GRD'],
    ['SOR_070', 'Devotion: Restore 2', restore(2), 'GRD'],
    ['SOR_166', "Infiltrator's Skill: Saboteur", [{ name: 'Saboteur' }], 'GRD'],
    ['SOR_057', 'Protector: Sentinel', S, 'GRD'],
    ['LAW_128', 'Veiled Strength: Grit', [{ name: 'Grit' }], 'GRD'],
    ['LOF_238', "Darth Revan's Lightsabers: Grit on a Sith", [{ name: 'Grit' }], 'SITH'],
    ['LOF_053', 'Heirloom Lightsaber: Restore 1 on a Force unit', restore(1), 'FORCE'],
    ['LOF_261', 'Constructed Lightsaber: Restore 2 on a Heroism unit', restore(2), 'HERO'],
    ['LOF_261', 'Constructed Lightsaber: Raid 2 on a Villainy unit', raid(2), 'VIL'],
    ['LOF_261', 'Constructed Lightsaber: Sentinel on a unit neither Heroism nor Villainy', S, 'FORCE'],
  ])('%s %s', (id, _label, expected, host) => {
    const s = on(id, host)
    expect(unitKeywords(s, U(s, 'h')).filter(k => !F[host]?.keywords?.some(p => p.name === k.name))).toEqual(expected)
  })

  it.each([
    ['LOF_238', "Darth Revan's Lightsabers: nothing on a non-Sith"],
    ['LOF_053', 'Heirloom Lightsaber: nothing on a non-Force unit'],
  ])('%s %s', id => {
    const s = on(id)
    expect(kws(s, 'h')).toEqual([])
  })

  it("Disciples' Devotion (SEC_071) grants Sentinel only while the attached unit is exhausted", () => {
    expect(kws(on('SEC_071', 'GRD', { exhausted: true }), 'h')).toEqual(S)
    expect(kws(on('SEC_071'), 'h')).toEqual([])
  })

  it('Foundling (SHD_069) grants the Mandalorian trait, and Fulcrum (LAW_150) the Rebel trait', () => {
    expect(unitHasTrait(on('SHD_069'), U(on('SHD_069'), 'h'), 'Mandalorian')).toBe(true)
    expect(unitHasTrait(on('LAW_150'), U(on('LAW_150'), 'h'), 'Rebel')).toBe(true)
  })

  it('Fulcrum (LAW_150) gives each other friendly Rebel unit +2/+2', () => {
    const s = b('REBEL', { mine: [unit('h', 'GRD', { upgrades: [{ cardId: 'LAW_150', owner: 'player' }] }), unit('g', 'GRD')], theirs: [unit('e', 'REBEL')] })
    expect(view(s)).toEqual({ src: '4/6', h: '2/4', g: '2/4', e: '2/4' })
  })

  it("Entrenched (SOR_072) stops the attached unit attacking bases", () => {
    const s = on('SOR_072')
    expect(unitCannotAttackBases(s, U(s, 'h'))).toBe(true)
    expect(unitCannotAttackBases(s, U(s, 'src'))).toBe(false)
  })

  it.each<[string, string, string[]]>([
    ['LOF_215', 'Ascension Cable: a non-Vehicle unit', ['L', 'c', 'f', 'g', 'j', 't']],
    ['LOF_238', "Darth Revan's Lightsabers: a non-Vehicle unit", ['L', 'c', 'f', 'g', 'j', 't']],
    ['LOF_053', 'Heirloom Lightsaber: a non-Vehicle unit', ['L', 'c', 'f', 'g', 'j', 't']],
    ['TWI_236', "Grievous's Wheel Bike: a non-Vehicle unit", ['L', 'c', 'f', 'g', 'j', 't']],
    ['LAW_150', 'Fulcrum: a non-Vehicle unit', ['L', 'c', 'f', 'g', 'j', 't']],
    ['LAW_128', 'Veiled Strength: a non-leader unit', ['c', 'f', 'g', 'j', 'jv', 't', 'v']],
    ['LOF_261', 'Constructed Lightsaber: a Force unit', ['f']],
    ['LOF_074', 'Bolstered Endurance: a Force unit', ['f']],
    ['LOF_151', "Knight's Saber: a Jedi non-Vehicle unit", ['j']],
    ['TS26_79', 'Underestimated: a unit that costs 4 or less', ['c', 'f', 'g', 'j', 'jv', 't', 'v']],
  ])('%s attaches to %s', (id, _label, allowed) => {
    // Costs: the leader 6, CHEAP4 4, the rest 2 or less.
    const s = b('', { mine: [unit('g', 'GRD'), unit('v', 'VEH'), unit('jv', 'JEDIVEH'), unit('f', 'FORCE'), unit('j', 'JEDI'), unit('L', 'PALP', { isLeader: true }), unit('t', TOKEN_MANDALORIAN), unit('c', 'CHEAP4')] })
    const attach = getCardDefinition(id)!.attachRestriction!
    expect(all(s).filter(u => attach(s, u, 'player')).map(u => u.instanceId).sort()).toEqual([...allowed].sort())
  })
})

describe('costs', () => {
  const cost = (s: GameState, id: string, target?: string) => effectiveCost(s, 'player', F[id], target ? U(s, target) : undefined)

  it.each<[string, string, number, Setup, number, Setup]>([
    ['LAW_110', 'Phoenix Squadron Fighters: 1 less for each friendly damaged unit', 6,
      { mine: [unit('a', 'GRD', { damage: 1 }), unit('b', 'GRD'), unit('c', 'GRD', { damage: 2 })], theirs: [unit('e', 'GRD', { damage: 1 })] }, 8, { mine: [unit('b', 'GRD')], theirs: [unit('e', 'GRD', { damage: 1 })] }],
    ['JTL_163', 'AT-DP Occupier: 1 less for each damaged ground unit', 2,
      { mine: [unit('a', 'GRD', { damage: 1 })], theirs: [unit('e', 'GRD', { damage: 1 }), unit('s', 'SPACE', { damage: 1 })] }, 4, { theirs: [unit('s', 'SPACE', { damage: 1 })] }],
    ['JTL_204', 'Home One: 3 less while an opponent controls 3 or more space units', 6,
      { theirs: [unit('e1', 'SPACE'), unit('e2', 'SPACE'), unit('e3', 'SPACE')] }, 9, { mine: [unit('a', 'SPACE'), unit('b', 'SPACE')], theirs: [unit('e1', 'SPACE'), unit('e2', 'SPACE')] }],
    ['TWI_197', 'Republic Attack Pod: 1 less while you control 3 or more units', 5, { mine: [unit('a', 'GRD'), unit('b', 'GRD'), unit('c', 'GRD')] }, 6, { mine: [unit('a', 'GRD'), unit('b', 'GRD')], theirs: [unit('e', 'GRD')] }],
    ['TWI_098', 'Republic Defense Carrier: 1 less for each unit the opponent controls', 7,
      { theirs: [unit('e1', 'GRD'), unit('e2', 'GRD'), unit('e3', 'GRD'), unit('e4', 'GRD')] }, 11, { mine: [unit('a', 'GRD')] }],
    ['SOR_248', 'Volunteer Soldier: 1 less while you control a Trooper unit', 2, { mine: [unit('a', 'TROOPER')] }, 3, { theirs: [unit('e', 'TROOPER')] }],
  ])('%s %s', (id, _label, onCost, on, offCost, off) => {
    // These cards are being played, so they are not on the board.
    expect(cost(b('', on), id)).toBe(onCost)
    expect(cost(b('', off), id)).toBe(offCost)
  })

  it('Mastery (LAW_129) costs 1 less on a unique unit, and Grievous\'s Wheel Bike (TWI_236) 2 less on General Grievous', () => {
    const s = b('', { mine: [unit('u', 'UNQ'), unit('gg', 'GRIEVOUS'), unit('g', 'GRD')] })
    expect([cost(s, 'LAW_129', 'u'), cost(s, 'LAW_129', 'g'), cost(s, 'TWI_236', 'gg'), cost(s, 'TWI_236', 'g')]).toEqual([3, 4, 2, 4])
  })
})

describe('entering play ready', () => {
  it.each<[string, string, Setup, Setup]>([
    ['LAW_223', 'Rose Tico: while you control a non-unique unit', { mine: [unit('u', 'UNQ'), unit('g', 'GRD')] }, { mine: [unit('u', 'UNQ')], theirs: [unit('e', 'GRD')] }],
    ['LAW_210', 'Salacious Crumb: while you control Jabba the Hutt as a leader', { leader: 'JABBA' }, {}],
    ['LAW_210', 'Salacious Crumb: while you control Jabba the Hutt as a unit', { mine: [unit('j', 'JABBA_U')] }, { theirs: [unit('j', 'JABBA_U')] }],
    ['SEC_170', 'Corellian Hounds: while an opponent controls no ground units', { theirs: [unit('e', 'SPACE')] }, { theirs: [unit('e', 'GRD')] }],
  ])('%s %s', (id, _label, on, off) => {
    const entersReady = getCardDefinition(id)!.entersReady!
    expect(entersReady(b('', on), 'player')).toBe(true)
    expect(entersReady(b('', off), 'player')).toBe(false)
  })

  it('Corellian Hounds (SEC_170) played from hand enters ready', () => {
    const s = b('', { res: 6, theirs: [unit('e', 'SPACE')] })
    s.players.player.hand = ['SEC_170']
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    const hounds = played.players.player.units.find(u => u.cardId === 'SEC_170')!
    expect(hounds.exhausted).toBe(false)
  })
})

describe('combat rules', () => {
  it('Muckraker Crab Droid (SEC_135) cannot be attacked while ready', () => {
    const s = b('SEC_135', { self: {} })
    expect(unitCannotBeAttacked(s, U(s, 'src'))).toBe(true)
    const t = b('SEC_135', { self: { exhausted: true } })
    expect(unitCannotBeAttacked(t, U(t, 'src'))).toBe(false)
  })

  it.each([['SOR_198', 'Han Solo'], ['SHD_234', 'Incinerator Trooper']])('%s %s deals combat damage first', id => {
    const s = b(id)
    expect(unitDealsDamageFirst(s, U(s, 'src'))).toBe(true)
  })
})

describe('card data', () => {
  // The source lists a keyword a card only gains conditionally, or only gives to other units, as its own.
  const printed = (id: string) => {
    const [set, number] = id.split('_')
    const row = poolFor([set]).find(c => c.Set === set && String(c.Number) === number && (c.VariantType == null || c.VariantType === 'Normal'))
    if (!row) throw new Error(`${id} is not in the ${set} fixture`)
    return normaliseCard(row).keywords.map(k => (k.value ? `${k.name} ${k.value}` : k.name))
  }

  it.each<[string, string[]]>([
    ['LAW_105', []], ['SEC_201', ['Hidden']], ['SEC_079', []], ['SEC_249', []], ['SEC_134', []], ['SEC_116', []], ['SEC_063', []],
    ['SEC_029', []], ['LOF_162', []], ['LOF_212', []], ['LOF_118', []], ['JTL_107', []], ['JTL_081', []], ['JTL_257', []],
    ['JTL_113', []], ['TWI_062', []], ['TWI_081', []], ['TWI_180', []], ['SHD_169', ['Raid 3']], ['SHD_112', []], ['SHD_247', []],
    ['SHD_034', ['Shielded']], ['SOR_065', ['Grit']], ['SOR_114', []], ['SOR_249', []], ['SOR_211', []], ['SOR_159', []],
    ['SOR_048', []], ['TS26_20', ['Grit', 'Raid 1']], ['TS26_50', []], ['SOR_082', []], ['TWI_130', []], ['TWI_143', []],
    ['LOF_169', []], ['JTL_161', []], ['SOR_079', []], ['SOR_100', []], ['TS26_40', []], ['SHD_188', ['Ambush']],
    ['SEC_047', ['Restore 1']], ['TWI_092', ['Restore 1']], ['SOR_144', ['Raid 1']], ['SHD_190', ['Saboteur']],
    ['SEC_071', []], ['LOF_215', []], ['LOF_238', []], ['LOF_053', []], ['TWI_071', []], ['SOR_070', []],
    ['SOR_166', []], ['SOR_057', []], ['LAW_128', []],
  ])('%s prints %j', (id, expected) => {
    expect(printed(id)).toEqual(expected)
  })

  it.each([
    ['SOR_113', 'JTL_113'], ['SHD_168', 'LOF_162'], ['TWI_058', 'LOF_060'], ['SOR_081', 'SHD_083'], ['TWI_254', 'SOR_248'],
  ])('%s plays as %s', (printing, canonical) => {
    expect(reprintCanonicalId(printing)).toBe(canonical)
  })
})
