import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectiveCost, enemyAttackTargets, legalMoves } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { effectiveHp, effectivePower } from '../engine/stats'
import { unitHasKeyword, unitKeywordValue, unitDealsDamageFirst, unitCannotAttack } from '../engine/keywords'
import { applyUnitDamage } from '../engine/combat'
import { healBase, healUnit } from '../engine/effects'
import { normaliseCard } from '../engine/cardDb'
import { reprintCanonicalId } from '../data/reprints'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { CombatContext, EngineCard, GameState, PhaseEvents, UnitState } from '../engine/types'

/**
 * The constant abilities #455 left out, in the ten groups this batch takes whole. Each group needed
 * one thing the static hooks could not express, so the tests are written through the engine's own
 * readers (`effectivePower`, `unitKeywords`, `enemyAttackTargets`, `effectiveCost`, ...) on both
 * sides of every condition, and each group also drives one real action through `resolve` so the hook
 * is shown to be WIRED rather than merely registered.
 *
 * Printed stats, traits and keywords in `F` are the real ones, post-correction; the corrections
 * themselves are asserted against the shipped set fixtures in "card data" at the bottom.
 */

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 3, power: 2, hp: 5, ...over })
const upg = (id: string, over: Partial<EngineCard> = {}) => card({ id, type: 'upgrade', cost: 2, power: 0, hp: 0, ...over })

const F: Record<string, EngineCard> = {
  ...CARDS,
  // Board furniture.
  GRD: src('GRD', { cost: 2, power: 2, hp: 6 }),
  GRD2: src('GRD2', { cost: 2, power: 2, hp: 6 }),
  SMALL: src('SMALL', { cost: 1, power: 1, hp: 2 }),
  SPACE: src('SPACE', { arena: 'space', cost: 2, power: 2, hp: 6 }),
  CUN: src('CUN', { aspects: ['Cunning'] }),
  INQ: src('INQ', { traits: ['INQUISITOR'] }),
  BOBA: src('BOBA', { name: 'Boba Fett' }),
  CREATURE: src('CREATURE', { traits: ['CREATURE'] }),
  CREATURE2: src('CREATURE2', { traits: ['CREATURE'], cost: 4 }),
  FORCEU: src('FORCEU', { traits: ['FORCE'] }),
  POWER4: src('POWER4', { power: 4 }),
  SENT: src('SENT', { keywords: [{ name: 'Sentinel' }] }),
  SENTSPACE: src('SENTSPACE', { arena: 'space', keywords: [{ name: 'Sentinel' }] }),
  RAIDER: src('RAIDER', { keywords: [{ name: 'Raid', value: 2 }] }),
  RESTORER: src('RESTORER', { keywords: [{ name: 'Restore', value: 2 }] }),
  UPG: upg('UPG', { power: 1, hp: 1 }),
  UPG3: upg('UPG3', { power: 3, hp: 0 }),
  EVT: card({ id: 'EVT', type: 'event', cost: 3 }),

  // B — the attacker's power while a unit defends
  LAW_108: src('LAW_108', { cost: 5, power: 4, hp: 5, keywords: [{ name: 'Sentinel' }], unique: true }),
  JTL_054: src('JTL_054', { arena: 'space', cost: 6, power: 5, hp: 5, keywords: [{ name: 'Shielded' }], unique: true }),
  SOR_071: upg('SOR_071', { power: 2, hp: 2 }),
  SEC_042: src('SEC_042', { cost: 2, power: 2, hp: 2, unique: true }),

  // C — combat-conditional keywords and attack variants
  SOR_130: src('SOR_130', { cost: 2, power: 2, hp: 3 }),
  JTL_185: src('JTL_185', { arena: 'space', cost: 3, power: 4, hp: 3, unique: true }),
  LAW_219: src('LAW_219', { cost: 3, power: 3, hp: 2, keywords: [{ name: 'Ambush' }], unique: true }),
  SHD_219: src('SHD_219', { cost: 6, power: 5, hp: 4, keywords: [{ name: 'Ambush' }], unique: true }),
  JTL_259: src('JTL_259', { cost: 5, power: 3, hp: 6, keywords: [{ name: 'Ambush' }] }),

  // D — keywords that act on entry, when granted rather than printed
  SHD_212: src('SHD_212', { arena: 'space', cost: 2, power: 2, hp: 2, traits: ['FRINGE', 'VEHICLE'] }),
  LOF_132: src('LOF_132', { cost: 3, power: 3, hp: 4, traits: ['FORCE', 'IMPERIAL', 'INQUISITOR'], keywords: [{ name: 'Hidden' }, { name: 'Raid', value: 1 }], unique: true }),

  // E — conditions on computed power or keywords
  LOF_085: src('LOF_085', { cost: 3, power: 2, hp: 5 }),
  JTL_137: src('JTL_137', { arena: 'space', cost: 3, power: 3, hp: 4, unique: true }),
  SEC_032: src('SEC_032', { arena: 'space', cost: 4, power: 3, hp: 5, keywords: [{ name: 'Sentinel' }], unique: true }),
  LOF_186: src('LOF_186', { cost: 6, power: 6, hp: 7, unique: true }),

  // F — "this unit can't attack"
  LOF_044: src('LOF_044', { cost: 2, power: 3, hp: 3, traits: ['CREATURE'], keywords: [{ name: 'Sentinel' }] }),
  JTL_059: src('JTL_059', { arena: 'space', cost: 2, power: 3, hp: 5 }),

  // G — damage prevention
  SEC_067: src('SEC_067', { cost: 6, power: 7, hp: 3 }),
  SHD_224: upg('SHD_224', { power: 2, hp: 2, unique: true }),
  LOF_108: src('LOF_108', { cost: 2, power: 1, hp: 4, unique: true }),

  // H — cost rules that remember plays or reach other cards
  SEC_064: src('SEC_064', { cost: 5, power: 5, hp: 5 }),
  LOF_058: src('LOF_058', { cost: 2, power: 2, hp: 2, traits: ['FORCE', 'FRINGE'] }),
  SOR_034: src('SOR_034', { cost: 3, power: 3, hp: 3, keywords: [{ name: 'Restore', value: 1 }], unique: true }),
  JTL_105: src('JTL_105', { arena: 'space', cost: 9, power: 6, hp: 9, keywords: [{ name: 'Ambush' }], unique: true }),

  // I — printed stats replaced
  LAW_036: src('LAW_036', { cost: 7, power: 7, hp: 7, keywords: [{ name: 'Sentinel' }], unique: true }),
  LOF_056: upg('LOF_056', { cost: 3, power: 0, hp: 0, traits: ['FORCE'] }),

  // J — rule changes
  TWI_132: src('TWI_132', { arena: 'space', cost: 3, power: 3, hp: 3 }),
  JTL_182: src('JTL_182', { arena: 'space', cost: 2, power: 3, hp: 3, unique: true }),
  TWI_042: src('TWI_042', { cost: 1, power: 1, hp: 1, unique: true }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)!

const phaseEvents = (over: Partial<PhaseEvents> = {}): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, played: { player: [], opponent: [] },
  leaderLeftPlay: [],
  ...over,
})

const board = (mine: UnitState[], theirs: UnitState[] = [], over: Partial<GameState> = {}): GameState =>
  state({
    cards: F,
    players: {
      player: player({ units: mine, resources: ready(10), deck: ['GRD', 'GRD2'], hand: [] }),
      opponent: player({ units: theirs, resources: ready(10), deck: ['GRD', 'GRD2'], hand: [] }),
    },
    ...over,
  })

const withHand = (s: GameState, hand: string[]): GameState =>
  ({ ...s, players: { ...s.players, player: { ...s.players.player, hand } } })

/** The attacker's power as `completeAttack` computes it, with the combat roles in the context. */
const attackerPower = (s: GameState, attackerId: string, defenderId: string, over: Partial<CombatContext> = {}): number =>
  effectivePower(s, U(s, attackerId), { attacking: true, combat: { attackerInstanceId: attackerId, defenderInstanceId: defenderId, ...over } })

/** The defender's power as `completeAttack` computes it. */
const defenderPower = (s: GameState, attackerId: string, defenderId: string, over: Partial<CombatContext> = {}): number =>
  effectivePower(s, U(s, defenderId), { defending: true, combat: { attackerInstanceId: attackerId, defenderInstanceId: defenderId, ...over } })

const attack = (s: GameState, attackerId: string, defenderId: string): GameState =>
  resolve(s, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: defenderId } })

// ── B. The attacker's power while a unit defends ────────────────────────────────────────────────

describe("the attacker's power while a unit defends", () => {
  it.each<[string, string, number]>([
    ['LAW_108', 'Lando Calrissian: the attacker gets -1/-0', 1],
    ['JTL_054', 'Gold Leader: the attacker gets -1/-0', 1],
    ['SEC_042', 'Cassian Andor: the attacker gets -2/-0', 2],
  ])('%s %s', (id, _label, debuff) => {
    // The defender's own arena, so the attack is legal wherever the card lives.
    const arena = F[id].arena
    const attacker = unit('a', arena === 'space' ? 'SPACE' : 'GRD')
    const s = board([attacker], [unit('d', id), unit('other', arena === 'space' ? 'SPACE' : 'GRD')])
    expect(attackerPower(s, 'a', 'd')).toBe(2 - debuff)
    // It is the defending that does it: attacking anything else leaves the attacker alone.
    expect(attackerPower(s, 'a', 'other')).toBe(2)
  })

  it('Electrostaff (SOR_071) debuffs the attacker from the unit it is attached to, and attaches to a non-Vehicle unit', () => {
    const s = board([unit('a', 'GRD')], [unit('d', 'GRD', { upgrades: [{ cardId: 'SOR_071', owner: 'opponent' }] }), unit('other', 'GRD')])
    expect(attackerPower(s, 'a', 'd')).toBe(1)
    expect(attackerPower(s, 'a', 'other')).toBe(2)
    const attach = getCardDefinition('SOR_071')!.attachRestriction!
    const veh = board([], [unit('v', 'SPACE')])
    expect(attach(s, U(s, 'd'), 'player')).toBe(true)
    expect(attach(veh, unit('v2', 'GRD2', { cardId: 'GRD2' }), 'player')).toBe(true)
  })

  it('a real attack into Lando (LAW_108) lands the reduced damage', () => {
    const s = board([unit('a', 'GRD')], [unit('d', 'LAW_108')])
    const done = attack(s, 'a', 'd')
    expect(U(done, 'd').damage).toBe(1) // 2 power less 1
    expect(U(done, 'a').damage).toBe(4) // Lando hits back at full power
  })
})

// ── C. Combat-conditional keywords and attack variants ──────────────────────────────────────────

describe('combat-conditional keywords and attack variants', () => {
  it('First Legion Snowtrooper (SOR_130) gets +2/+0 and Overwhelm only while attacking a damaged unit', () => {
    const s = board([unit('a', 'SOR_130')], [unit('d', 'GRD', { damage: 1 }), unit('fresh', 'GRD')])
    const vs = (defenderDamaged: boolean) => ({ attacking: true, defenderDamaged })
    expect(effectivePower(s, U(s, 'a'), vs(true))).toBe(4)
    expect(effectivePower(s, U(s, 'a'), vs(false))).toBe(2)
    expect(unitHasKeyword(s, U(s, 'a'), 'Overwhelm', vs(true))).toBe(true)
    expect(unitHasKeyword(s, U(s, 'a'), 'Overwhelm', vs(false))).toBe(false)
    expect(unitHasKeyword(s, U(s, 'a'), 'Overwhelm')).toBe(false)
  })

  it('Snowtrooper (SOR_130) tramples a damaged defender in a real attack, and does not against a fresh one', () => {
    const damaged = board([unit('a', 'SOR_130')], [unit('d', 'GRD2', { damage: 5 })])
    const done = attack(damaged, 'a', 'd')
    // 4 power against 1 remaining HP: the defender dies and 3 tramples through.
    expect(done.players.opponent.units.some(u => u.instanceId === 'd')).toBe(false)
    expect(done.players.opponent.base.damage).toBe(3)
    // An undamaged 1/2: 2 power against 2 HP, and no Overwhelm at all, so nothing reaches the base.
    const fresh = board([unit('a', 'SOR_130')], [unit('d', 'SMALL')])
    const noTrample = attack(fresh, 'a', 'd')
    expect(noTrample.players.opponent.units.some(u => u.instanceId === 'd')).toBe(false)
    expect(noTrample.players.opponent.base.damage).toBe(0)
  })

  it("Hound's Tooth (JTL_185) strikes first only against an exhausted unit that did not enter play this phase", () => {
    const s = board([unit('a', 'JTL_185')], [unit('d', 'SPACE', { exhausted: true }), unit('ready', 'SPACE')])
    expect(unitDealsDamageFirst(s, U(s, 'a'), { defender: U(s, 'd') })).toBe(true)
    expect(unitDealsDamageFirst(s, U(s, 'a'), { defender: U(s, 'ready') })).toBe(false)
    const entered = { ...s, phaseEvents: phaseEvents({ enteredPlay: { player: [], opponent: ['d'] } }) }
    expect(unitDealsDamageFirst(entered, U(entered, 'a'), { defender: U(entered, 'd') })).toBe(false)
    expect(unitDealsDamageFirst(s, U(s, 'a'))).toBe(false)
  })

  it("Hound's Tooth (JTL_185) takes no counter damage when its first strike defeats the defender", () => {
    const s = board([unit('a', 'JTL_185')], [unit('d', 'SPACE', { exhausted: true, damage: 4 })])
    const done = attack(s, 'a', 'd')
    expect(done.players.opponent.units.some(u => u.instanceId === 'd')).toBe(false)
    expect(U(done, 'a').damage).toBe(0)
  })

  it("Anakin's Podracer (LAW_219) strikes first only while no other unit has attacked this phase", () => {
    const s = board([unit('a', 'LAW_219'), unit('mate', 'GRD')], [unit('d', 'GRD'), unit('small', 'SMALL')])
    expect(unitDealsDamageFirst(s, U(s, 'a'), { defender: U(s, 'd') })).toBe(true)
    const after = attack(s, 'mate', 'd')
    expect(unitDealsDamageFirst(after, U(after, 'a'), { defender: U(after, 'd') })).toBe(false)
    // Its own attack does not disqualify it: "no OTHER units". 3 power kills the 1/2 before it
    // strikes back, which is what dealing damage first buys.
    const solo = attack(s, 'a', 'small')
    expect(solo.players.opponent.units.some(u => u.instanceId === 'small')).toBe(false)
    expect(U(solo, 'a').damage).toBe(0)
    // After another unit has attacked, the same combat costs it the counter damage. The turn passed
    // to the opponent when `mate` attacked, so this is the podracer's own next turn in that phase.
    const second = attack({ ...after, activePlayer: 'player' }, 'a', 'small')
    expect(U(second, 'a').damage).toBe(1)
  })

  it('Enfys Nest (SHD_219) takes 3 power off the defender of a friendly Ambush attack only', () => {
    const s = board([unit('nest', 'SHD_219'), unit('a', 'GRD')], [unit('d', 'GRD')])
    expect(defenderPower(s, 'a', 'd', { viaAmbush: true })).toBe(0) // 2 power, less 3, floored at 0
    expect(defenderPower(s, 'a', 'd')).toBe(2)
    // "A friendly unit" is friendly to Enfys Nest. An ENEMY unit attacking with Ambush is not one,
    // so the defender she is standing next to keeps its power.
    const theirs = board([unit('nest', 'SHD_219'), unit('d', 'GRD')], [unit('a', 'GRD')])
    expect(defenderPower(theirs, 'a', 'd', { viaAmbush: true })).toBe(2)
  })

  it('Retrofitted Airspeeder (JTL_259) is a ground unit that reaches space units and gets -1/-0 doing it', () => {
    const s = board([unit('a', 'JTL_259')], [unit('space', 'SPACE'), unit('ground', 'GRD')])
    expect(getCardDefinition('JTL_259')!.attacksEitherArena!(s, U(s, 'a'))).toBe(true)
    expect(effectivePower(s, U(s, 'a'), { attacking: true, defenderArena: 'space' })).toBe(2)
    expect(effectivePower(s, U(s, 'a'), { attacking: true, defenderArena: 'ground' })).toBe(3)
    expect(enemyAttackTargets(s, U(s, 'a')).targets.map(u => u.instanceId).sort()).toEqual(['ground', 'space'])
  })

  it('Retrofitted Airspeeder (JTL_259) deals the reduced damage to a space unit in a real attack', () => {
    const s = board([unit('a', 'JTL_259')], [unit('space', 'SPACE')])
    expect(U(attack(s, 'a', 'space'), 'space').damage).toBe(2)
    const ground = board([unit('a', 'JTL_259')], [unit('g', 'GRD')])
    expect(U(attack(ground, 'a', 'g'), 'g').damage).toBe(3)
  })
})

// ── D. Keywords that act on entry, when granted rather than printed ─────────────────────────────

describe('keywords granted rather than printed still act on entry', () => {
  it('Privateer Scyk (SHD_212) enters with a Shield token only while you control another Cunning unit', () => {
    const withCunning = withHand(board([unit('c', 'CUN')]), ['SHD_212'])
    const scyk = resolve(withCunning, { type: 'playUnit', handIndex: 0 }).players.player.units.find(u => u.cardId === 'SHD_212')!
    expect(scyk.upgrades.map(a => a.cardId)).toEqual([TOKEN_SHIELD])
    const alone = withHand(board([unit('g', 'GRD')]), ['SHD_212'])
    const bare = resolve(alone, { type: 'playUnit', handIndex: 0 }).players.player.units.find(u => u.cardId === 'SHD_212')!
    expect(bare.upgrades).toEqual([])
  })

  it('Grand Inquisitor (LOF_132) hides other friendly Inquisitor units as they enter play', () => {
    const s = withHand(board([unit('gi', 'LOF_132')]), ['INQ', 'GRD'])
    const inq = resolve(s, { type: 'playUnit', handIndex: 0 }).players.player.units.find(u => u.cardId === 'INQ')!
    expect(inq.hidden).toBe(true)
    const plain = resolve(s, { type: 'playUnit', handIndex: 1 }).players.player.units.find(u => u.cardId === 'GRD')!
    expect(plain.hidden).toBeFalsy()
    // Without the Grand Inquisitor, an Inquisitor is just a unit.
    const noGi = withHand(board([]), ['INQ'])
    expect(resolve(noGi, { type: 'playUnit', handIndex: 0 }).players.player.units[0].hidden).toBeFalsy()
  })

  it('a hidden Inquisitor cannot be attacked', () => {
    const s = board([unit('e', 'GRD')], [unit('gi', 'LOF_132'), unit('inq', 'INQ', { hidden: true })])
    expect(enemyAttackTargets(s, U(s, 'e')).targets.map(u => u.instanceId)).toEqual(['gi'])
  })
})

// ── E. Conditions on computed power or keywords ─────────────────────────────────────────────────

describe('conditions on computed power or keywords', () => {
  it('Praetorian Guard (LOF_085) gains Sentinel while you control a unit with 4 or more power', () => {
    const on = board([unit('p', 'LOF_085'), unit('big', 'POWER4')])
    expect(unitHasKeyword(on, U(on, 'p'), 'Sentinel')).toBe(true)
    const off = board([unit('p', 'LOF_085'), unit('g', 'GRD')], [unit('big', 'POWER4')])
    expect(unitHasKeyword(off, U(off, 'p'), 'Sentinel')).toBe(false)
    // An upgrade that lifts a friendly unit to 4 power turns it on: the condition reads live power.
    const upgraded = board([unit('p', 'LOF_085'), unit('g', 'GRD', { upgrades: [{ cardId: 'UPG3', owner: 'player' }] })])
    expect(unitHasKeyword(upgraded, U(upgraded, 'p'), 'Sentinel')).toBe(true)
  })

  it("Vonreg's TIE Interceptor (JTL_137) gains Overwhelm at 4 power and Raid 1 at 6", () => {
    const bare = board([unit('v', 'JTL_137')])
    expect(unitHasKeyword(bare, U(bare, 'v'), 'Overwhelm')).toBe(false)
    expect(unitKeywordValue(bare, U(bare, 'v'), 'Raid')).toBe(0)
    const four = board([unit('v', 'JTL_137', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })])
    expect(unitHasKeyword(four, U(four, 'v'), 'Overwhelm')).toBe(true)
    expect(unitKeywordValue(four, U(four, 'v'), 'Raid')).toBe(0)
    const six = board([unit('v', 'JTL_137', { upgrades: [{ cardId: 'UPG3', owner: 'player' }] })])
    expect(unitHasKeyword(six, U(six, 'v'), 'Overwhelm')).toBe(true)
    expect(unitKeywordValue(six, U(six, 'v'), 'Raid')).toBe(1)
    expect(effectivePower(six, U(six, 'v'), { attacking: true })).toBe(7) // 3 + 3 upgrade + Raid 1
  })

  it("Kylo Ren's Command Shuttle (SEC_032) gives +0/+2 to friendly ground units with Sentinel", () => {
    const s = board([unit('k', 'SEC_032'), unit('sent', 'SENT'), unit('plain', 'GRD'), unit('space', 'SENTSPACE')], [unit('foe', 'SENT')])
    expect(effectiveHp(s, U(s, 'sent'))).toBe(7)
    expect(effectiveHp(s, U(s, 'plain'))).toBe(6)
    expect(effectiveHp(s, U(s, 'space'))).toBe(5)
    expect(effectiveHp(s, U(s, 'foe'))).toBe(5)
  })

  it('Marchion Ro (LOF_186) doubles each friendly unit\'s Raid', () => {
    const s = board([unit('m', 'LOF_186'), unit('r', 'RAIDER'), unit('g', 'GRD')], [unit('foe', 'RAIDER')])
    expect(unitKeywordValue(s, U(s, 'r'), 'Raid')).toBe(4)
    expect(unitKeywordValue(s, U(s, 'g'), 'Raid')).toBe(0)
    expect(unitKeywordValue(s, U(s, 'foe'), 'Raid')).toBe(2)
    expect(effectivePower(s, U(s, 'r'), { attacking: true })).toBe(6) // 2 printed + Raid 4
  })

  it('a board of cards that read each other\'s power and keywords terminates', () => {
    // Two Praetorian Guards each read every friendly unit's power, and a Vonreg reads its own, which
    // is what the keyword pass has to stop recursing through.
    const s = board([unit('p1', 'LOF_085'), unit('p2', 'LOF_085'), unit('v', 'JTL_137', { upgrades: [{ cardId: 'UPG3', owner: 'player' }] }), unit('m', 'LOF_186')])
    expect(unitHasKeyword(s, U(s, 'p1'), 'Sentinel')).toBe(true) // Vonreg is at 6 power
    expect(unitHasKeyword(s, U(s, 'p2'), 'Sentinel')).toBe(true)
    expect(unitKeywordValue(s, U(s, 'v'), 'Raid')).toBe(2) // Raid 1, doubled by Marchion Ro
    expect(effectivePower(s, U(s, 'v'), { attacking: true })).toBe(8)
  })
})

// ── F. "This unit can't attack" ─────────────────────────────────────────────────────────────────

describe("units that can't attack", () => {
  it.each([['LOF_044', 'Loth-Wolf'], ['JTL_059', 'Corporate Defense Shuttle']])('%s %s offers no attack at all', id => {
    const arena = F[id].arena === 'space' ? 'SPACE' : 'GRD'
    const s = board([unit('a', id)], [unit('e', arena)])
    expect(unitCannotAttack(s, U(s, 'a'))).toBe(true)
    const { targets, canAttackBase } = enemyAttackTargets(s, U(s, 'a'))
    expect(targets).toEqual([])
    expect(canAttackBase).toBe(false)
    expect(legalMoves(s).some(m => m.type === 'attack' && m.attackerId === 'a')).toBe(false)
  })

  it('Loth-Wolf (LOF_044) still forces enemy attacks onto itself with Sentinel', () => {
    const s = board([unit('e', 'GRD')], [unit('w', 'LOF_044'), unit('other', 'GRD')])
    expect(enemyAttackTargets(s, U(s, 'e')).targets.map(u => u.instanceId)).toEqual(['w'])
    expect(legalMoves(s).some(m => m.type === 'attack')).toBe(true) // our own unit is unaffected
  })
})

// ── G. Damage prevention ────────────────────────────────────────────────────────────────────────

describe('damage prevention', () => {
  const damage = (s: GameState, id: string, amount: number, over: { byCombat?: boolean; source?: { cardId: string; controller: 'player' | 'opponent' } } = {}): GameState =>
    applyUnitDamage(s, 'player', new Map([[id, amount]]), over.byCombat ?? false, {}, over.source)

  it('Umbaran Mobile Cannon (SEC_067) prevents the first damage it takes each phase, and no more', () => {
    const s = board([unit('c', 'SEC_067')])
    const once = damage(s, 'c', 2)
    expect(U(once, 'c').damage).toBe(0)
    const twice = damage(once, 'c', 2)
    expect(U(twice, 'c').damage).toBe(2)
  })

  it("Boba Fett's Armor (SHD_224) prevents 2 of each damage to Boba Fett only", () => {
    const boba = board([unit('b', 'BOBA', { upgrades: [{ cardId: 'SHD_224', owner: 'player' }] })])
    expect(U(damage(boba, 'b', 3), 'b').damage).toBe(1)
    expect(U(damage(damage(boba, 'b', 3), 'b', 3), 'b').damage).toBe(2) // each instance, not the first
    const other = board([unit('o', 'GRD', { upgrades: [{ cardId: 'SHD_224', owner: 'player' }] })])
    expect(U(damage(other, 'o', 3), 'o').damage).toBe(3)
  })

  it('Malakili (LOF_108) prevents damage a friendly Creature would deal to a friendly unit', () => {
    const s = board([unit('m', 'LOF_108'), unit('ally', 'GRD')])
    expect(U(damage(s, 'ally', 2, { source: { cardId: 'CREATURE', controller: 'player' } }), 'ally').damage).toBe(0)
    expect(U(damage(s, 'ally', 2, { source: { cardId: 'CREATURE', controller: 'opponent' } }), 'ally').damage).toBe(2)
    expect(U(damage(s, 'ally', 2, { source: { cardId: 'GRD', controller: 'player' } }), 'ally').damage).toBe(2)
  })

  it('Malakili (LOF_108) makes the first Creature unit you play each phase cost 1 less', () => {
    const s = board([unit('m', 'LOF_108')])
    expect(effectiveCost(s, 'player', F.CREATURE)).toBe(2) // printed 3
    expect(effectiveCost(s, 'player', F.GRD)).toBe(2) // printed 2, not a Creature
    const played = { ...s, phaseEvents: phaseEvents({ played: { player: ['CREATURE'], opponent: [] } }) }
    expect(effectiveCost(played, 'player', F.CREATURE2)).toBe(4) // the second one is full price
  })

  it('Cassian Andor (SEC_042) prevents 2 damage from an enemy card ability, but not combat damage', () => {
    // He is printed 2/2, so the unprevented instances are 1 damage: enough to land, not to kill him.
    const s = board([unit('c', 'SEC_042')])
    expect(U(damage(s, 'c', 2, { source: { cardId: 'GRD', controller: 'opponent' } }), 'c').damage).toBe(0)
    expect(U(damage(s, 'c', 1, { source: { cardId: 'GRD', controller: 'player' } }), 'c').damage).toBe(1)
    expect(U(damage(s, 'c', 1, { byCombat: true, source: { cardId: 'GRD', controller: 'opponent' } }), 'c').damage).toBe(1)
  })
})

// ── H. Cost rules that remember plays or reach other cards ──────────────────────────────────────

describe('cost rules that remember plays or reach other cards', () => {
  it('Congress of Malastare (SEC_064) makes the first upgrade you play each phase cost 1 less', () => {
    const s = board([unit('c', 'SEC_064')])
    expect(effectiveCost(s, 'player', F.UPG)).toBe(1) // printed 2
    const played = { ...s, phaseEvents: phaseEvents({ played: { player: ['UPG'], opponent: [] } }) }
    expect(effectiveCost(played, 'player', F.UPG)).toBe(2)
  })

  it('Guardian of the Whills (LOF_058) discounts the first upgrade played on it each round', () => {
    const s = board([unit('g', 'LOF_058'), unit('other', 'GRD')])
    expect(effectiveCost(s, 'player', F.UPG, U(s, 'g'))).toBe(1)
    expect(effectiveCost(s, 'player', F.UPG, U(s, 'other'))).toBe(2)
    const used = board([unit('g', 'LOF_058', { upgradesPlayedThisRound: 1 })])
    expect(effectiveCost(used, 'player', F.UPG, U(used, 'g'))).toBe(2)
  })

  it('playing an upgrade on Guardian of the Whills (LOF_058) records it, and the record clears next round', () => {
    const s = withHand(board([unit('g', 'LOF_058')]), ['UPG', 'UPG'])
    const first = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'g' })
    expect(U(first, 'g').upgradesPlayedThisRound).toBe(1)
    expect(effectiveCost(first, 'player', F.UPG, U(first, 'g'))).toBe(2)
    // Through the regroup phase: both players pass, then both decline the resource.
    let next = resolve(resolve(first, { type: 'pass' }), { type: 'pass' })
    next = resolve(next, { type: 'skipResource' })
    next = resolve(next, { type: 'skipResource' })
    expect(next.round).toBe(3)
    expect(U(next, 'g').upgradesPlayedThisRound ?? 0).toBe(0)
    expect(effectiveCost(next, 'player', F.UPG, U(next, 'g'))).toBe(1)
  })

  it('Del Meeko (SOR_034) makes each event an opponent plays cost 1 more', () => {
    const s = board([unit('d', 'SOR_034')], [])
    expect(effectiveCost(s, 'opponent', F.EVT)).toBe(4) // printed 3
    expect(effectiveCost(s, 'player', F.EVT)).toBe(3) // his own controller pays normally
    expect(effectiveCost(s, 'opponent', F.GRD)).toBe(2) // units are not events
  })

  it('The Starhawk (JTL_105) halves what its controller pays, rounded up', () => {
    const s = board([unit('h', 'JTL_105')])
    expect(effectiveCost(s, 'player', F.EVT)).toBe(2) // 3 halved, rounded up
    expect(effectiveCost(s, 'player', F.SEC_064)).toBe(3) // 5 halved, rounded up
    expect(effectiveCost(s, 'opponent', F.EVT)).toBe(3)
    // Halving is applied to what is actually owed, after a discount.
    const withCongress = board([unit('h', 'JTL_105'), unit('c', 'SEC_064')])
    expect(effectiveCost(withCongress, 'player', F.UPG)).toBe(1) // 2, less 1, halved and rounded up
  })
})

// ── I. Printed stats replaced ───────────────────────────────────────────────────────────────────

describe('printed stats replaced', () => {
  it('Obi-Wan Kenobi (LAW_036) makes friendly printed stats 7/7 while you control 7 or more units', () => {
    const mine = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => unit(id, 'GRD'))
    const seven = board([unit('obi', 'LAW_036'), ...mine], [unit('foe', 'GRD')])
    expect(effectivePower(seven, U(seven, 'a'))).toBe(7)
    expect(effectiveHp(seven, U(seven, 'a'))).toBe(7)
    expect(effectivePower(seven, U(seven, 'foe'))).toBe(2) // the enemy keeps its own
    // An upgrade still adds on top of the replaced printed value.
    const upgraded = board([unit('obi', 'LAW_036'), unit('u', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'player' }] }), ...mine.slice(1)])
    expect(effectivePower(upgraded, U(upgraded, 'u'))).toBe(8)
    const six = board([unit('obi', 'LAW_036'), ...mine.slice(1)])
    expect(effectivePower(six, U(six, 'b'))).toBe(2)
  })

  it('Size Matters Not (LOF_056) makes its host 5/5, and costs 1 less with a Force unit', () => {
    const s = board([unit('h', 'GRD', { upgrades: [{ cardId: 'LOF_056', owner: 'player' }] })])
    expect(effectivePower(s, U(s, 'h'))).toBe(5)
    expect(effectiveHp(s, U(s, 'h'))).toBe(5)
    const stacked = board([unit('h', 'GRD', { upgrades: [{ cardId: 'LOF_056', owner: 'player' }, { cardId: 'UPG', owner: 'player' }] })])
    expect(effectivePower(stacked, U(stacked, 'h'))).toBe(6)
    expect(effectiveCost(board([unit('f', 'FORCEU')]), 'player', F.LOF_056)).toBe(2)
    expect(effectiveCost(board([unit('g', 'GRD')]), 'player', F.LOF_056)).toBe(3)
  })
})

// ── J. Rule changes ─────────────────────────────────────────────────────────────────────────────

describe('rule changes', () => {
  it('Confederate Tri-Fighter (TWI_132) stops bases being healed, from either side', () => {
    const damaged = (s: GameState) => ({ ...s, players: { ...s.players, player: { ...s.players.player, base: { ...s.players.player.base, damage: 5 } } } })
    const mine = damaged(board([unit('t', 'TWI_132')]))
    expect(healBase(mine, 'player', 3).players.player.base.damage).toBe(5)
    const theirs = damaged(board([], [unit('t', 'TWI_132')]))
    expect(healBase(theirs, 'player', 3).players.player.base.damage).toBe(5)
    const clear = damaged(board([unit('g', 'GRD')]))
    expect(healBase(clear, 'player', 3).players.player.base.damage).toBe(2)
  })

  it('Restore does not heal a base while the Tri-Fighter (TWI_132) is in play', () => {
    const s = board([unit('r', 'RESTORER')], [unit('t', 'TWI_132'), unit('d', 'GRD')])
    const hurt = { ...s, players: { ...s.players, player: { ...s.players.player, base: { ...s.players.player.base, damage: 5 } } } }
    expect(attack(hurt, 'r', 'd').players.player.base.damage).toBe(5)
  })

  it('Rampart (JTL_182) readies in regroup only at 4 or more power', () => {
    const toRegroup = (s: GameState) => {
      let next = resolve(resolve(s, { type: 'pass' }), { type: 'pass' })
      next = resolve(next, { type: 'skipResource' })
      return resolve(next, { type: 'skipResource' })
    }
    const weak = board([unit('r', 'JTL_182', { exhausted: true })])
    expect(U(toRegroup(weak), 'r').exhausted).toBe(true)
    const strong = board([unit('r', 'JTL_182', { exhausted: true, upgrades: [{ cardId: 'UPG', owner: 'player' }] })])
    expect(U(toRegroup(strong), 'r').exhausted).toBe(false)
    // Everything else readies as usual.
    const mate = board([unit('r', 'JTL_182', { exhausted: true }), unit('g', 'GRD', { exhausted: true })])
    expect(U(toRegroup(mate), 'g').exhausted).toBe(false)
  })

  it('Barriss Offee (TWI_042) gives +1/+0 to each friendly unit healed this phase, herself included', () => {
    const s = board([unit('b', 'TWI_042', { damage: 1 }), unit('ally', 'GRD', { damage: 2 }), unit('fresh', 'GRD')], [unit('foe', 'GRD', { damage: 2 })])
    expect(effectivePower(s, U(s, 'ally'))).toBe(2) // nothing healed yet
    const marked = { ...s, phaseEvents: phaseEvents({ healedUnits: ['ally', 'b', 'foe'] }) }
    expect(effectivePower(marked, U(marked, 'ally'))).toBe(3)
    expect(effectivePower(marked, U(marked, 'b'))).toBe(2) // 1 printed + 1
    expect(effectivePower(marked, U(marked, 'fresh'))).toBe(2)
    expect(effectivePower(marked, U(marked, 'foe'))).toBe(2) // enemies are not friendly units
  })

  it('healing a unit records it for the phase, which is what Barriss Offee reads', () => {
    const s = board([unit('b', 'TWI_042'), unit('ally', 'GRD', { damage: 2 }), unit('fresh', 'GRD')])
    const healed = healUnit(s, 'ally', 1)
    expect(healed.phaseEvents?.healedUnits ?? []).toEqual(['ally'])
    expect(effectivePower(healed, U(healed, 'ally'))).toBe(3)
    expect(effectivePower(healed, U(healed, 'fresh'))).toBe(2)
    // Healing an undamaged unit heals nothing, so it is not "healed this phase".
    expect(healUnit(s, 'fresh', 1).phaseEvents?.healedUnits ?? []).toEqual([])
  })
})

// ── Card data ───────────────────────────────────────────────────────────────────────────────────

describe('card data', () => {
  const row = (id: string) => {
    const [set, number] = id.split('_')
    const found = poolFor([set]).find(c => c.Set === set && String(c.Number) === number && (c.VariantType == null || c.VariantType === 'Normal'))
    if (!found) throw new Error(`${id} is not in the ${set} fixture`)
    return normaliseCard(found)
  }
  const printed = (id: string) => row(id).keywords.map(k => (k.value ? `${k.name} ${k.value}` : k.name))

  it.each<[string, string[]]>([
    // The card prints Ambush and Overwhelm; the source lists Ambush and Shielded.
    ['LAW_081', ['Ambush', 'Overwhelm']],
    // The source omits a printed keyword.
    ['JTL_054', ['Shielded']],
    // Keywords the card only gains conditionally, or only gives to other units.
    ['SOR_130', []], ['SHD_212', []], ['LOF_085', []], ['JTL_137', []], ['LOF_186', []],
    // Unchanged: these are the card's own.
    ['LOF_132', ['Hidden', 'Raid 1']], ['SEC_032', ['Sentinel']], ['LAW_036', ['Sentinel']],
    ['LOF_044', ['Sentinel']], ['LAW_108', ['Sentinel']], ['SOR_034', ['Restore 1']],
  ])('%s prints %j', (id, expected) => {
    expect(printed(id)).toEqual(expected)
  })

  it('Retrofitted Airspeeder (JTL_259) is a ground unit, as its "can attack space units" says', () => {
    expect(row('JTL_259').arena).toBe('ground')
  })

  it('Sullustan Sapper (LAW_081) ships as a data correction with no registered ability', () => {
    expect(getCardDefinition('LAW_081')).toBeUndefined()
  })

  it('Guardian of the Whills plays as one card in both of its sets', () => {
    expect(reprintCanonicalId('SOR_061')).toBe('LOF_058')
  })
})
