import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { effectivePower } from '../engine/stats'
import { reprintCanonicalId } from '../data/reprints'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'

/**
 * When Played units and upgrades from the sealed sets beyond ASH whose ability is an existing primitive
 * or pending choice. Each ability is run directly from its source unit (the unit itself, or for an
 * upgrade the unit it is attached to), so a table can state per card which units qualify, how much,
 * and whether the card's "may" lets it be declined. Two cases play a real card through `resolve`.
 *
 * Every card under test is a space unit here unless its own arena matters, so its instance `src`
 * appears in a target list only where the text lets it.
 */

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'space', cost: 5, power: 1, hp: 5, ...over })
const upg = (id: string) => card({ id, type: 'upgrade', cost: 1, power: 0, hp: 0 })
const F = {
  ...CARDS,
  // One friendly ally meets every "if you control another ..." condition below.
  ALLY: card({
    id: 'ALLY', arena: 'ground', cost: 2, power: 2, hp: 6,
    aspects: ['Villainy', 'Aggression', 'Command', 'Cunning', 'Vigilance'],
    traits: ['OFFICIAL', 'BOUNTY HUNTER', 'REPUBLIC', 'WOOKIEE', 'SEPARATIST', 'FIGHTER'],
  }),
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  SPACE: card({ id: 'SPACE', arena: 'space', cost: 3, power: 2, hp: 6 }),
  FORCE: card({ id: 'FORCE', arena: 'ground', cost: 3, power: 3, hp: 5, traits: ['FORCE'] }),
  CHEAP: card({ id: 'CHEAP', arena: 'ground', cost: 2, power: 1, hp: 3 }),
  TOUGH: card({ id: 'TOUGH', arena: 'ground', cost: 4, power: 2, hp: 20 }),
  BIG: card({ id: 'BIG', arena: 'ground', cost: 6, power: 5, hp: 8 }),
  FRAIL: card({ id: 'FRAIL', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  VEH: card({ id: 'VEH', arena: 'ground', cost: 5, power: 3, hp: 9, traits: ['VEHICLE'] }),
  BH: card({ id: 'BH', arena: 'ground', cost: 2, power: 2, hp: 4, traits: ['BOUNTY HUNTER'] }),
  BH5: card({ id: 'BH5', arena: 'ground', cost: 5, power: 5, hp: 5, traits: ['BOUNTY HUNTER'] }),
  SENTINEL: card({ id: 'SENTINEL', arena: 'ground', cost: 2, power: 1, hp: 9, keywords: [{ name: 'Sentinel' }] }),
  SITHL: card({ id: 'SITHL', type: 'leader', arena: 'ground', cost: 6, power: 5, hp: 7, traits: ['SITH'] }),
  SITH: card({ id: 'SITH', arena: 'ground', cost: 3, power: 3, hp: 3, traits: ['SITH'] }),
  LUKE: card({ id: 'LUKE', name: 'Luke Skywalker', arena: 'ground', cost: 6, power: 6, hp: 7 }),
  MACE: card({ id: 'MACE', name: 'Mace Windu', arena: 'ground', cost: 5, power: 5, hp: 7 }),
  MANDO: card({ id: 'MANDO', arena: 'ground', cost: 3, power: 3, hp: 5, traits: ['MANDALORIAN'] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  UNQ: card({ id: 'UNQ', type: 'upgrade', cost: 2, power: 1, hp: 1, unique: true }),
  // Damage
  LAW_213: src('LAW_213'), LAW_045: src('LAW_045'), LAW_137: src('LAW_137', { aspects: ['Villainy'] }),
  SEC_241: src('SEC_241', { traits: ['OFFICIAL'] }), SEC_254: src('SEC_254'), LOF_133: src('LOF_133'),
  LOF_158: src('LOF_158', { aspects: ['Aggression'] }), LOF_145: src('LOF_145'), LOF_259: src('LOF_259'), LOF_198: src('LOF_198'),
  JTL_239: src('JTL_239'), JTL_153: src('JTL_153'), JTL_102: src('JTL_102'), SHD_254: src('SHD_254', { traits: ['BOUNTY HUNTER'] }),
  SHD_235: src('SHD_235'), SOR_132: src('SOR_132'), SOR_090: src('SOR_090'), TWI_149: src('TWI_149', { traits: ['REPUBLIC'] }),
  SHD_158: src('SHD_158', { arena: 'ground' }),
  // Defeat
  LAW_124: src('LAW_124'), LOF_071: src('LOF_071'), TWI_036: src('TWI_036'), SOR_038: src('SOR_038'),
  SOR_162: src('SOR_162'), SEC_163: src('SEC_163'), LOF_155: src('LOF_155'),
  // Ready
  LAW_061: src('LAW_061', { traits: ['BOUNTY HUNTER'] }), SHD_189: src('SHD_189'), JTL_135: src('JTL_135'), TWI_137: src('TWI_137'),
  SOR_148: src('SOR_148'), LOF_234: src('LOF_234', { traits: ['SITH'] }),
  // Return
  SOR_202: src('SOR_202'), LAW_241: src('LAW_241'), LAW_089: src('LAW_089'), LAW_240: src('LAW_240'), TWI_191: src('TWI_191'), SOR_209: src('SOR_209'),
  // Shield, exhaust, heal
  LOF_242: src('LOF_242'), JTL_044: src('JTL_044'), JTL_199: src('JTL_199'), JTL_217: src('JTL_217'),
  SOR_178: src('SOR_178', { aspects: ['Cunning'] }), SOR_039: src('SOR_039', { arena: 'ground' }), TWI_109: src('TWI_109', { traits: ['REPUBLIC'] }),
  LAW_035: src('LAW_035'),
  // For this phase
  SEC_206: src('SEC_206'), LAW_151: src('LAW_151'), LOF_114: src('LOF_114'), SOR_086: src('SOR_086'), TWI_031: src('TWI_031'), SOR_051: src('SOR_051'),
  // Draw and bases
  SOR_111: src('SOR_111'), SHD_249: src('SHD_249', { traits: ['WOOKIEE'] }), LOF_121: src('LOF_121', { hp: 8 }),
  SOR_068: src('SOR_068', { aspects: ['Vigilance'] }), LAW_109: src('LAW_109'), SEC_102: src('SEC_102', { traits: ['OFFICIAL'] }),
  TWI_160: src('TWI_160', { traits: ['SEPARATIST'] }),
  // This unit
  SEC_240: src('SEC_240'), JTL_248: src('JTL_248'), TWI_059: src('TWI_059'), JTL_158: src('JTL_158', { traits: ['FIGHTER'] }), JTL_067: src('JTL_067'),
  // Upgrades
  TWI_155: upg('TWI_155'), LAW_127: upg('LAW_127'), TWI_070: upg('TWI_070'), SOR_053: upg('SOR_053'), SHD_073: upg('SHD_073'),
  TWI_152: upg('TWI_152'), TWI_168: upg('TWI_168'),
}

/** The fixture helper reads a unit's arena from the shared pool, which does not hold these cards. */
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: (F as Record<string, EngineCard>)[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)
const board = (mine: UnitState[], theirs: UnitState[], over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: player({ units: mine, resources: ready(4), deck: ['GRD', 'GRD', 'GRD'] }), opponent: player({ units: theirs }) }, ...over })
const withHand = (s: GameState, hand: string[]): GameState => ({ ...s, players: { ...s.players, player: { ...s.players.player, hand } } })
const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, leaderLeftPlay: [], played: { player: [], opponent: [] },
  ...over,
})
const friendlyDefeated = { phaseEvents: phaseEvents({ defeated: { player: ['gone'], opponent: [] } }) }

/** Run `cardId`'s When Played as the player, sourced from `host` (the unit itself, or an upgrade's host). */
const fire = (s: GameState, cardId: string, host = 'src'): GameState => {
  const ability = getCardDefinition(cardId)?.abilities?.find(a => a.trigger === 'whenPlayed')
  if (!ability) throw new Error(`${cardId} has no When Played ability`)
  return ability.effect(s, { owner: 'player', cardId, sourceInstanceId: host })
}
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices ?? [], 'a choice is raised').toHaveLength(1)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
const targetsOf = (c: PendingChoice): string[] => {
  const t = 'unitTargets' in c ? c.unitTargets : 'targets' in c ? c.targets : []
  return [...t].sort()
}
const declinable = (s: GameState) => legalMoves(s).some(m => m.type === 'skipTrigger')
const accept = (s: GameState, extra: { targetInstanceId?: string; baseTarget?: PlayerId; optionIndex?: number }) =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const shields = (s: GameState, id: string) => U(s, id)!.upgrades.filter(x => x.cardId === TOKEN_SHIELD).length

const GROUND = ['a', 'd', 'fo', 'g', 'x']
const ALL = ['a', 'd', 'es', 'fo', 'g', 'sp', 'src', 'x']
const ENEMY = ['d', 'es', 'fo', 'g', 'x']

describe('damage to a chosen unit', () => {
  // Friendly: the source (space), a damaged ally meeting every condition, a space unit. Enemy: a ready,
  // an exhausted and a damaged ground unit, a Force unit, a space unit. Two cards in hand, four resources.
  const rich = (id: string) => withHand(board(
    [unit('src', id), unit('a', 'ALLY', { damage: 1 }), unit('sp', 'SPACE')],
    [unit('g', 'GRD'), unit('x', 'GRD', { exhausted: true }), unit('d', 'GRD', { damage: 1 }), unit('fo', 'FORCE'), unit('es', 'SPACE')],
    { initiative: 'player' },
  ), ['GRD', 'GRD'])

  it.each([
    ['LAW_213', 'Cutthroat Podracer: may, 2 to an exhausted ground unit', 2, ['x'], true],
    ['LAW_045', 'Zeb Orellios: may, 5 to a ground unit with a Command or Cunning unit', 5, GROUND, true],
    ['LAW_137', 'Ruthless Duo: may, 2 to a ground unit with another Villainy unit', 2, GROUND, true],
    ['SEC_241', 'Political Bully: may, 2 to a ground unit with another Official unit', 2, GROUND, true],
    ['SEC_254', 'Heroic ARC-170: may, 2 to an enemy unit while you control a damaged unit', 2, ENEMY, true],
    ['LOF_133', 'Purge Trooper: may, 2 to a Force unit', 2, ['fo'], true],
    ['LOF_158', 'Hyena Bomber: may, 2 to a ground unit with another Aggression unit', 2, GROUND, true],
    ['LOF_145', 'Jedi Knight: 2 to an enemy ground unit with the initiative', 2, ['d', 'fo', 'g', 'x'], false],
    ['LOF_259', 'Ravening Gundark: 1 to a ground unit', 1, GROUND, false],
    ['LOF_198', 'Stinger Mantis: may, 2 to an exhausted unit', 2, ['x'], true],
    ['JTL_239', 'TIE Dagger Vanguard: may, 2 to a damaged unit', 2, ['a', 'd'], true],
    ['JTL_153', 'Rebellious Hammerhead: may, the cards in your hand to a unit', 2, ALL, true],
    ['JTL_102', 'Resistance Blue Squadron: may, the friendly space units to a unit', 2, ALL, true],
    ['SHD_254', 'Bounty Guild Initiate: may, 2 to a ground unit with another Bounty Hunter', 2, GROUND, true],
    ['SHD_235', 'Ruthless Assassin: 2 to a friendly unit', 2, ['a', 'sp', 'src'], false],
    ['SOR_132', 'Imperial Interceptor: may, 3 to a space unit', 3, ['es', 'sp', 'src'], true],
    ['SOR_090', 'Devastator: may, the resources you control to a unit', 4, ALL, true],
    ['TWI_149', 'Low Altitude Gunship: 1 per friendly Republic unit to an enemy unit', 2, ENEMY, false],
  ])('%s %s', (id, _label, amount, targets, optional) => {
    const fired = fire(rich(id), id)
    expect(choice(fired)).toMatchObject({ kind: 'selectDamageTarget', amount, baseTargets: [] })
    expect(targetsOf(choice(fired))).toEqual(targets)
    expect(declinable(fired)).toBe(optional)
  })

  it('deals the damage to the chosen unit', () => {
    expect(U(accept(fire(rich('LAW_045'), 'LAW_045'), { targetInstanceId: 'g' }), 'g')!.damage).toBe(5)
  })

  // Alone, with no initiative and an empty hand: "another" does not count the source itself.
  const lonely = (id: string) => board([unit('src', id)], [unit('g', 'GRD')], { initiative: 'opponent' })
  it.each(['LAW_137', 'SEC_241', 'SEC_254', 'LOF_158', 'LOF_145', 'SHD_254', 'JTL_153'])('%s raises nothing when its condition is unmet', id => {
    noChoice(fire(lonely(id), id))
  })

  it('Zeb Orellios (LAW_045) deals 3 without a Command or Cunning unit', () => {
    expect(choice(fire(lonely('LAW_045'), 'LAW_045'))).toMatchObject({ amount: 3 })
  })

  it('Wild Rancor (SHD_158) deals 2 to each other ground unit, and none in space', () => {
    const done = fire(board([unit('src', 'SHD_158'), unit('a', 'ALLY'), unit('sp', 'SPACE')], [unit('g', 'GRD'), unit('es', 'SPACE')]), 'SHD_158')
    expect(['src', 'a', 'sp', 'g', 'es'].map(id => U(done, id)!.damage)).toEqual([0, 2, 0, 2, 0])
  })
})

describe('defeat', () => {
  // Remaining HP: src 5 (space), leader 4, ally 5; enemy CHEAP 3, BIG 5, space 6, FRAIL 1.
  const s = (id: string) => board(
    [unit('src', id), unit('L', 'TST_L', { isLeader: true, damage: 3 }), unit('a', 'ALLY', { damage: 1 })],
    [unit('c', 'CHEAP'), unit('b', 'BIG', { damage: 3 }), unit('s2', 'SPACE'), unit('f', 'FRAIL')],
  )

  it.each([
    ['LAW_124', 'Industrious Team: may, a non-leader with 4 or less remaining HP', ['c', 'f'], true],
    ['LOF_071', 'Grappling Guardian: may, a space unit with 6 or less remaining HP', ['s2', 'src'], true],
    ['TWI_036', 'Devastating Gunship: an enemy unit with 2 or less remaining HP', ['f'], false],
    ['SOR_038', 'Count Dooku: may, a unit with 4 or less remaining HP', ['L', 'c', 'f'], true],
  ])('%s %s', (id, _label, targets, optional) => {
    const fired = fire(s(id), id)
    expect(choice(fired).kind).toBe('selectUnitToDefeat')
    expect(targetsOf(choice(fired))).toEqual(targets)
    expect(declinable(fired)).toBe(optional)
  })

  it('defeats the chosen unit', () => {
    expect(U(accept(fire(s('LAW_124'), 'LAW_124'), { targetInstanceId: 'c' }), 'c')).toBeUndefined()
  })

  const upgraded = (id: string) => board(
    [unit('src', id), unit('a', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'player' }, { cardId: 'UNQ', owner: 'player' }] })],
    [unit('e', 'GRD', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })],
  )
  const candidates = (c: PendingChoice) => (c.kind === 'selectUpgradeToDefeat' ? c.candidates.map(x => `${x.unitId}:${x.cardId}`).sort() : [])

  it.each([
    ['SOR_162', 'Disabling Fang Fighter: may, any upgrade', ['a:UNQ', 'a:UPG', `e:${TOKEN_SHIELD}`]],
    ['SEC_163', 'Outer Rim Constable: may, any upgrade', ['a:UNQ', 'a:UPG', `e:${TOKEN_SHIELD}`]],
    ['LOF_155', 'DRK-1 Probe Droid: may, a non-unique upgrade', ['a:UPG', `e:${TOKEN_SHIELD}`]],
  ])('%s %s', (id, _label, expected) => {
    const fired = fire(upgraded(id), id)
    expect(choice(fired)).toMatchObject({ kind: 'selectUpgradeToDefeat', optional: true })
    expect(candidates(choice(fired))).toEqual([...expected].sort())
    expect(declinable(fired)).toBe(true)
  })
})

describe('ready', () => {
  // Two Shield tokens on enemy units, so Slaver's Freighter readies power 2 or less.
  const s = (id: string) => board(
    [unit('src', id), unit('bh1', 'BH', { exhausted: true })],
    [unit('bh2', 'BH5', { exhausted: true }), unit('e', 'GRD', { exhausted: true, upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }, { cardId: TOKEN_SHIELD, owner: 'opponent' }] })],
  )

  it.each([
    ['LAW_061', 'Asajj Ventress: may, another Bounty Hunter unit', ['bh1', 'bh2']],
    ['SHD_189', "Slaver's Freighter: may, another unit with power up to the upgrades on enemy units", ['bh1', 'e']],
  ])('%s %s', (id, _label, targets) => {
    const fired = fire(s(id), id)
    expect(choice(fired).kind).toBe('selectUnitToReady')
    expect(targetsOf(choice(fired))).toEqual(targets)
    expect(declinable(fired)).toBe(true)
    expect(U(accept(fired, { targetInstanceId: 'bh1' }), 'bh1')!.exhausted).toBe(false)
  })

  const exhaustedSelf = (id: string, mine: UnitState[], theirs: UnitState[], over: Partial<GameState> = {}) =>
    U(fire(board([unit('src', id, { exhausted: true }), ...mine], theirs, over), id), 'src')!.exhausted

  it('Special Forces TIE Fighter (JTL_135) readies itself while an opponent has more space units', () => {
    expect(exhaustedSelf('JTL_135', [], [unit('s1', 'SPACE'), unit('s2', 'SPACE')])).toBe(false)
    expect(exhaustedSelf('JTL_135', [], [unit('s1', 'SPACE')])).toBe(true)
  })

  it('Savage Opress (TWI_137) readies himself while you control fewer units, himself included', () => {
    expect(exhaustedSelf('TWI_137', [], [unit('g', 'GRD'), unit('h', 'GRD')])).toBe(false)
    expect(exhaustedSelf('TWI_137', [unit('a', 'GRD')], [unit('g', 'GRD'), unit('h', 'GRD')])).toBe(true)
  })

  it('Guerilla Attack Pod (SOR_148) readies itself if either base has 15 or more damage', () => {
    const damaged = (who: PlayerId, n: number) => {
      const s0 = board([unit('src', 'SOR_148', { exhausted: true })], [])
      s0.players[who].base.damage = n
      return U(fire(s0, 'SOR_148'), 'src')!.exhausted
    }
    expect(damaged('opponent', 15)).toBe(false)
    expect(damaged('player', 15)).toBe(false)
    expect(damaged('opponent', 14)).toBe(true)
  })

  it('Darth Malak (LOF_234) may ready himself only while you control a Sith leader unit', () => {
    const withLeader = fire(board([unit('src', 'LOF_234', { exhausted: true }), unit('L', 'SITHL', { isLeader: true })], []), 'LOF_234')
    expect(choice(withLeader).kind).toBe('selectUnitToReady')
    expect(targetsOf(choice(withLeader))).toEqual(['src'])
    expect(declinable(withLeader)).toBe(true)
    noChoice(fire(board([unit('src', 'LOF_234', { exhausted: true }), unit('s', 'SITH')], []), 'LOF_234'))
  })
})

describe('return to hand', () => {
  const s = (id: string) => board(
    [unit('src', id), unit('L', 'TST_L', { isLeader: true }), unit('a', 'ALLY'), unit('v', 'VEH')],
    [unit('c', 'CHEAP'), unit('b', 'BIG'), unit('m', 'TOUGH')],
  )

  it.each([
    ['SOR_202', 'Cantina Bouncer: may, a non-leader unit', ['a', 'b', 'c', 'm', 'src', 'v'], true],
    ['LAW_241', 'The Blade Wing: may, a non-leader unit', ['a', 'b', 'c', 'm', 'src', 'v'], true],
    ['LAW_089', 'Kanan Jarrus: may, a non-leader costing 4 or less with a Command or Aggression unit', ['a', 'c', 'm'], true],
    ['LAW_240', 'Milodon Rider: may, another friendly non-leader unit', ['a', 'v'], true],
    ['TWI_191', 'Wolf Pack Escort: may, a friendly non-leader non-Vehicle unit', ['a', 'src'], true],
    ['SOR_209', 'Pirated Starfighter: a friendly non-leader unit', ['a', 'src', 'v'], false],
  ])('%s %s', (id, _label, targets, optional) => {
    const fired = fire(s(id), id)
    expect(choice(fired).kind).toBe('selectUnitToReturn')
    expect(targetsOf(choice(fired))).toEqual(targets)
    expect(declinable(fired)).toBe(optional)
  })

  it("returns the chosen unit to its owner's hand", () => {
    const done = accept(fire(s('SOR_202'), 'SOR_202'), { targetInstanceId: 'b' })
    expect(U(done, 'b')).toBeUndefined()
    expect(done.players.opponent.hand).toContain('BIG')
  })

  it('Kanan Jarrus (LAW_089) returns only a unit costing 2 or less without a Command or Aggression unit', () => {
    const fired = fire(board([unit('src', 'LAW_089')], [unit('c', 'CHEAP'), unit('m', 'TOUGH')]), 'LAW_089')
    expect(targetsOf(choice(fired))).toEqual(['c'])
  })
})

describe('Shield tokens, exhausting and healing', () => {
  it.each([
    ['LOF_242', 'Refugee of The Path: may, a unit with Sentinel', ['se']],
    ['JTL_044', 'Echo Base Engineer: may, a damaged Vehicle unit', ['v']],
  ])('%s %s', (id, _label, targets) => {
    const fired = fire(board([unit('src', id), unit('a', 'ALLY'), unit('v', 'VEH', { damage: 2 })], [unit('se', 'SENTINEL'), unit('e', 'GRD', { damage: 1 })]), id)
    expect(choice(fired)).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_SHIELD, count: 1, optional: true })
    expect(targetsOf(choice(fired))).toEqual(targets)
    expect(declinable(fired)).toBe(true)
    expect(shields(accept(fired, { targetInstanceId: targets[0] }), targets[0])).toBe(1)
  })

  it('Blade Squadron B-Wing (JTL_199) gives a Shield token to a unit while an opponent has 3 exhausted units, and must', () => {
    const tired = (n: number) => Array.from({ length: n }, (_, i) => unit(`t${i}`, 'GRD', { exhausted: true }))
    const fired = fire(board([unit('src', 'JTL_199')], tired(3)), 'JTL_199')
    expect(choice(fired)).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_SHIELD, count: 1, optional: false })
    expect(targetsOf(choice(fired))).toEqual(['src', 't0', 't1', 't2'])
    expect(declinable(fired)).toBe(false)
    noChoice(fire(board([unit('src', 'JTL_199')], tired(2)), 'JTL_199'))
  })

  it('Death Space Skirmisher (JTL_217) may exhaust a unit while you control another space unit', () => {
    const fired = fire(board([unit('src', 'JTL_217'), unit('sp', 'SPACE')], [unit('g', 'GRD')]), 'JTL_217')
    expect(choice(fired).kind).toBe('mayExhaustUnit')
    expect(targetsOf(choice(fired))).toEqual(['g', 'sp', 'src'])
    expect(declinable(fired)).toBe(true)
    expect(U(accept(fired, { targetInstanceId: 'g' }), 'g')!.exhausted).toBe(true)
    noChoice(fire(board([unit('src', 'JTL_217')], [unit('g', 'GRD')]), 'JTL_217'))
  })

  it('Cartel Spacer (SOR_178) exhausts an enemy unit costing 4 or less while you control another Cunning unit, and must', () => {
    const theirs = [unit('c', 'CHEAP'), unit('b', 'BIG'), unit('m', 'TOUGH')]
    const fired = fire(board([unit('src', 'SOR_178'), unit('a', 'ALLY')], theirs), 'SOR_178')
    expect(choice(fired).kind).toBe('mayExhaustUnit')
    expect(targetsOf(choice(fired))).toEqual(['c', 'm'])
    expect(declinable(fired)).toBe(false)
    noChoice(fire(board([unit('src', 'SOR_178')], theirs), 'SOR_178'))
  })

  it('AT-AT Suppressor (SOR_039) exhausts every ground unit and no space unit', () => {
    const done = fire(board([unit('src', 'SOR_039'), unit('sp', 'SPACE')], [unit('g', 'GRD'), unit('es', 'SPACE')]), 'SOR_039')
    expect(['src', 'sp', 'g', 'es'].map(id => U(done, id)!.exhausted)).toEqual([true, false, true, false])
  })

  it('501st Liberator (TWI_109) may heal 3 from a base while you control another Republic unit', () => {
    const s = board([unit('src', 'TWI_109'), unit('a', 'ALLY')], [])
    s.players.player.base.damage = 5
    const fired = fire(s, 'TWI_109')
    expect(choice(fired)).toMatchObject({ kind: 'selectHealTarget', amount: 3, unitTargets: [], baseTargets: ['player', 'opponent'] })
    expect(declinable(fired)).toBe(true)
    expect(accept(fired, { baseTarget: 'player' }).players.player.base.damage).toBe(2)
    noChoice(fire(board([unit('src', 'TWI_109')], []), 'TWI_109'))
  })

  it('Ezra Bridger (LAW_035) may heal 4 from a unit with an Aggression or Cunning unit, 2 without', () => {
    const fired = fire(board([unit('src', 'LAW_035'), unit('a', 'ALLY', { damage: 1 })], [unit('e', 'GRD', { damage: 5 })]), 'LAW_035')
    expect(choice(fired)).toMatchObject({ kind: 'selectHealTarget', amount: 4, baseTargets: [] })
    expect(targetsOf(choice(fired))).toEqual(['a', 'e', 'src'])
    expect(declinable(fired)).toBe(true)
    expect(U(accept(fired, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
    expect(choice(fire(board([unit('src', 'LAW_035')], [unit('e', 'GRD', { damage: 5 })]), 'LAW_035'))).toMatchObject({ amount: 2 })
  })
})

describe('"for this phase" on one unit', () => {
  const s = (id: string, over: Partial<GameState> = {}) => board([unit('src', id), unit('a', 'ALLY')], [unit('e', 'GRD'), unit('n', 'GRD')], over)

  it.each([
    ['SEC_206', 'Emissaries from Ryloth: may, a unit -3/-0', ['a', 'e', 'n', 'src'], { power: -3 }, true, {}],
    ['LAW_151', 'Profiteering Hunter: another friendly unit +1/+1', ['a'], { power: 1, hp: 1 }, false, {}],
    ['LOF_114', 'Kaadu: may, another friendly unit Overwhelm', ['a'], { keywords: [{ name: 'Overwhelm' }] }, true, {}],
    ['SOR_086', 'Gladiator Star Destroyer: a unit Sentinel', ['a', 'e', 'n', 'src'], { keywords: [{ name: 'Sentinel' }] }, false, {}],
    ['TWI_031', 'Rune Haako: may, a unit -1/-1 after a friendly unit was defeated', ['a', 'e', 'n', 'src'], { power: -1, hp: -1 }, true, friendlyDefeated],
    ['SOR_051', 'Luke Skywalker: an enemy unit -3/-3', ['e', 'n'], { power: -3, hp: -3 }, false, {}],
    ['SOR_051', 'Luke Skywalker: an enemy unit -6/-6 after a friendly unit was defeated', ['e', 'n'], { power: -6, hp: -6 }, false, friendlyDefeated],
  ])('%s %s', (id, _label, targets, buff, optional, over) => {
    const fired = fire(s(id, over), id)
    expect(choice(fired)).toMatchObject({ kind: 'mayLastingBuff', ...buff })
    expect(targetsOf(choice(fired))).toEqual(targets)
    expect(declinable(fired)).toBe(optional)
  })

  it('applies the buff to the chosen unit', () => {
    const done = accept(fire(s('LAW_151'), 'LAW_151'), { targetInstanceId: 'a' })
    expect(effectivePower(done, U(done, 'a')!)).toBe(3)
  })

  it('Rune Haako (TWI_031) raises nothing when no friendly unit was defeated this phase', () => {
    noChoice(fire(s('TWI_031'), 'TWI_031'))
  })
})

describe('draw and bases', () => {
  const hand = (s: GameState) => s.players.player.hand.length

  it('Patrolling V-Wing (SOR_111) draws a card', () => {
    expect(hand(fire(board([unit('src', 'SOR_111')], []), 'SOR_111'))).toBe(1)
  })

  it('Wookiee Warrior (SHD_249) draws a card only with another Wookiee unit', () => {
    expect(hand(fire(board([unit('src', 'SHD_249'), unit('a', 'ALLY')], []), 'SHD_249'))).toBe(1)
    expect(hand(fire(board([unit('src', 'SHD_249')], []), 'SHD_249'))).toBe(0)
  })

  it('The Purrgil King (LOF_121) draws a card for each friendly unit with 7 or more remaining HP, itself included', () => {
    const mine = [unit('src', 'LOF_121'), unit('b', 'BIG'), unit('bd', 'BIG', { damage: 2 }), unit('a', 'ALLY')]
    expect(hand(fire(board(mine, [unit('e', 'BIG')]), 'LOF_121'))).toBe(2)
  })

  const baseAfter = (id: string, mine: UnitState[], over: Partial<GameState> = {}) => {
    const s = board([unit('src', id), ...mine], [], over)
    s.players.player.base.damage = 10
    return fire(s, id).players.player.base.damage
  }

  it('Cargo Juggernaut (SOR_068) heals 4 from your base only with another Vigilance unit', () => {
    expect(baseAfter('SOR_068', [unit('a', 'ALLY')])).toBe(6)
    expect(baseAfter('SOR_068', [])).toBe(10)
  })

  it('Tantive IV (LAW_109) heals 4 from your base only if a friendly unit was defeated this phase', () => {
    expect(baseAfter('LAW_109', [], friendlyDefeated)).toBe(6)
    expect(baseAfter('LAW_109', [])).toBe(10)
  })

  it('Renowned Dignitaries (SEC_102) heals 2 from your base for each friendly Official unit, itself included', () => {
    expect(baseAfter('SEC_102', [unit('a', 'ALLY')])).toBe(6)
  })

  it('Vanguard Droid Bomber (TWI_160) deals 2 to the enemy base only with another Separatist unit', () => {
    expect(fire(board([unit('src', 'TWI_160'), unit('a', 'ALLY')], []), 'TWI_160').players.opponent.base.damage).toBe(2)
    expect(fire(board([unit('src', 'TWI_160')], []), 'TWI_160').players.opponent.base.damage).toBe(0)
  })
})

describe('this unit', () => {
  const selfDamage = (id: string, mine: UnitState[] = []) => U(fire(board([unit('src', id), ...mine], []), id), 'src')!.damage

  it.each([
    ['SEC_240', 'Hutt Cartel Starfighter', 2],
    ['JTL_248', 'Dilapidated Ski Speeder', 3],
    ['TWI_059', 'Royal Guard Attaché', 2],
  ])('%s %s deals %i damage to itself', (id, _label, amount) => {
    expect(selfDamage(id)).toBe(amount)
  })

  it('Crackshot V-Wing (JTL_158) deals 1 damage to itself unless you control another Fighter unit', () => {
    expect(selfDamage('JTL_158')).toBe(1)
    expect(selfDamage('JTL_158', [unit('a', 'ALLY')])).toBe(0)
  })

  it('Cloaked StarViper (JTL_067) gives itself 2 Shield tokens', () => {
    expect(shields(fire(board([unit('src', 'JTL_067')], []), 'JTL_067'), 'src')).toBe(2)
  })
})

describe('upgrades acting on the attached unit', () => {
  const on = (id: string, hostCard: string, over: Partial<UnitState> = {}, theirs: UnitState[] = []) =>
    fire(board([unit('h', hostCard, over)], theirs), id, 'h')

  it('Twice the Pride (TWI_155) deals 2 damage to the attached unit', () => {
    expect(U(on('TWI_155', 'GRD'), 'h')!.damage).toBe(2)
  })

  it.each([['LAW_127', 'Kill Switch'], ['TWI_070', 'Perilous Position']])('%s %s exhausts the attached unit', id => {
    expect(U(on(id, 'GRD'), 'h')!.exhausted).toBe(true)
  })

  it("Luke's Lightsaber (SOR_053) heals all damage from Luke Skywalker and shields him, and does nothing on anyone else", () => {
    const luke = on('SOR_053', 'LUKE', { damage: 5 })
    expect(U(luke, 'h')!.damage).toBe(0)
    expect(shields(luke, 'h')).toBe(1)
    const other = on('SOR_053', 'GRD', { damage: 3 })
    expect(U(other, 'h')!.damage).toBe(3)
    expect(shields(other, 'h')).toBe(0)
  })

  it('Mandalorian Armor (SHD_073) shields a Mandalorian only', () => {
    expect(shields(on('SHD_073', 'MANDO'), 'h')).toBe(1)
    expect(shields(on('SHD_073', 'GRD'), 'h')).toBe(0)
  })

  it("Mace Windu's Lightsaber (TWI_152) draws 2 cards on Mace Windu only", () => {
    expect(on('TWI_152', 'MACE').players.player.hand).toHaveLength(2)
    expect(on('TWI_152', 'GRD').players.player.hand).toHaveLength(0)
  })

  it('Old Access Codes (TWI_168) draws a card while an opponent controls more units', () => {
    expect(on('TWI_168', 'GRD', {}, [unit('e1', 'GRD'), unit('e2', 'GRD')]).players.player.hand).toHaveLength(1)
    expect(on('TWI_168', 'GRD', {}, [unit('e1', 'GRD')]).players.player.hand).toHaveLength(0)
  })

  it.each(['SOR_053', 'SHD_073', 'TWI_152'])('%s attaches only to a non-Vehicle unit', id => {
    const s = board([unit('v', 'VEH'), unit('g', 'GRD')], [])
    const restriction = getCardDefinition(id)?.attachRestriction
    expect(restriction?.(s, U(s, 'v')!)).toBe(false)
    expect(restriction?.(s, U(s, 'g')!)).toBe(true)
  })
})

describe('played for real', () => {
  it('playing Imperial Interceptor (SOR_132) from hand raises its optional damage choice, attributed to it', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['SOR_132'], resources: ready(20) }), opponent: player({ units: [unit('es', 'SPACE')] }) } })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(choice(played)).toMatchObject({ kind: 'selectDamageTarget', amount: 3, source: { cardId: 'SOR_132' } })
    expect(declinable(played)).toBe(true)
  })

  it('playing Twice the Pride (TWI_155) deals 2 damage to the unit it attaches to', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['TWI_155'], resources: ready(20), units: [unit('h', 'GRD')] }), opponent: player() } })
    const played = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'h' })
    expect(U(played, 'h')!.damage).toBe(2)
  })
})

describe('cross-set reprints of these cards', () => {
  it.each([['TWI_107', 'SOR_111'], ['SHD_066', 'SOR_068'], ['SHD_166', 'SOR_162']])('%s plays as %s', (printing, canonical) => {
    expect(reprintCanonicalId(printing)).toBe(canonical)
  })
})
