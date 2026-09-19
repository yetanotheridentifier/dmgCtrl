import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves, effectiveCost } from '../engine/legalMoves'
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword, unitKeywordValue } from '../engine/keywords'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
import { createTokenUnits } from '../engine/effects'
import { TOKEN_SHIELD, hasToken } from '../engine/tokenUpgrades'
import { TOKEN_CLONE_TROOPER } from '../engine/tokenUnits'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PhaseEvents, PlayerId, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Homeworlds units and upgrades whose ability is a constant: a keyword or a stat that holds while a
 * condition does, an aura on other units, a rule of combat, a cost, or how a unit enters play.
 *
 * Each is a registration on the stats pipeline, the auras or the cost hooks the other sets built; what
 * the tests pin is the condition each card reads and who it reaches. The two engine additions are named
 * where they are tested: friendly units entering play ready by a unit in play (Ritual Dragon), and an
 * Ambush that may attack a base (Fett's Firespray).
 */

const SHIPPED = [
  // A: a keyword or a stat on the unit itself, or on the unit an upgrade is attached to
  'HMW_073', 'HMW_074', 'HMW_083', 'HMW_084', 'HMW_090', 'HMW_107', 'HMW_117', 'HMW_118', 'HMW_129', 'HMW_131',
  'HMW_133', 'HMW_137', 'HMW_138', 'HMW_142', 'HMW_164', 'HMW_176', 'HMW_256', 'HMW_257', 'HMW_259',
  'HMW_096', 'HMW_190', 'HMW_191', 'HMW_235',
  // B: auras on other units, combat and damage
  'HMW_039', 'HMW_088', 'HMW_141', 'HMW_162', 'HMW_212', 'HMW_233', 'HMW_251',
  // C: costs and entering play
  'HMW_053', 'HMW_145', 'HMW_184', 'HMW_203', 'HMW_208', 'HMW_234',
]

const POOL = poolFor(['HMW'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 8, ...over })
const base = (id: string, trait?: string) => card({ id, type: 'base', hp: 30, aspects: ['Vigilance'], traits: trait ? [trait] : [] })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  GRD: src('GRD'),
  SPC: src('SPC', { arena: 'space' }),
  SPC5: src('SPC5', { arena: 'space', power: 5 }),
  BIG: src('BIG', { power: 5 }),
  ONE: src('ONE', { cost: 1 }),
  CHEAP: src('CHEAP', { cost: 3 }),
  PRICEY: src('PRICEY', { cost: 5 }),
  VEH: src('VEH', { traits: ['VEHICLE'] }),
  CRT: src('CRT', { traits: ['CREATURE'] }),
  CMD: src('CMD', { aspects: ['Command'] }),
  EWOK: src('EWOK', { traits: ['EWOK'] }),
  GUNGAN: src('GUNGAN', { traits: ['GUNGAN'] }),
  WOOKIEE: src('WOOKIEE', { traits: ['WOOKIEE'] }),
  TUSKEN: src('TUSKEN', { traits: ['TUSKEN'] }),
  TUSKR: src('TUSKR', { traits: ['TUSKEN'], keywords: [{ name: 'Raid', value: 1 }] }),
  AMB: src('AMB', { keywords: [{ name: 'Ambush' }] }),
  ABIL: src('ABIL', { text: 'When Played: Draw a card.' }),
  KWU: src('KWU', { keywords: [{ name: 'Sentinel' }], text: 'Sentinel' }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  CUPG: card({ id: 'CUPG', type: 'upgrade', cost: 1, power: 0, hp: 0, aspects: ['Command'] }),
  EVT: card({ id: 'EVT', type: 'event', cost: 1 }),
  NAB_B: base('NAB_B', 'NABOO'),
  KAS_B: base('KAS_B', 'KASHYYYK'),
  END_B: base('END_B', 'ENDOR'),
  TAT_B: base('TAT_B', 'TATOOINE'),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)!
const upg = (cardId: string, owner: PlayerId = 'player') => ({ cardId, owner })

type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(10), deck: [], ...mine }),
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
const exhausted = (n: number) => Array.from({ length: n }, (_, i) => ({ cardId: `X${i}`, exhausted: true }))

const has = (s: GameState, id: string, kw: string) => unitHasKeyword(s, U(s, id), kw)
const kwValue = (s: GameState, id: string, kw: string) => unitKeywordValue(s, U(s, id), kw)
const power = (s: GameState, id: string) => effectivePower(s, U(s, id))
const hp = (s: GameState, id: string) => effectiveHp(s, U(s, id))
const moves = (s: GameState): Action[] => legalMoves(s)
const play = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState => {
  const p = s.players[who]
  const withCard = { ...s, activePlayer: who, players: { ...s.players, [who]: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playUnit', handIndex: p.hand.length })
}
const played = (s: GameState, cardId: string): UnitState => s.players.player.units.find(u => u.cardId === cardId)!
const attack = (s: GameState, attackerId: string, target?: string) =>
  resolve(s, { type: 'attack', attackerId, target: target ? { kind: 'unit', instanceId: target } : { kind: 'base' } })
const cost = (s: GameState, cardId: string, who: PlayerId = 'player') => effectiveCost(s, who, F[cardId])

describe('HMW constant abilities: registration', () => {
  it('registers every shipped card', () => {
    for (const id of SHIPPED) expect(getCardDefinition(id), id).toBeDefined()
  })

  it('a keyword the card only gains conditionally, or gives away, is not printed on it', () => {
    const printed = (id: string) => F[id].keywords.map(k => (k.value ? `${k.name} ${k.value}` : k.name)).sort()
    expect(printed('HMW_039')).toEqual(['Raid 1'])
    expect(printed('HMW_074')).toEqual([])
    expect(printed('HMW_084')).toEqual(['Restore 1'])
    expect(printed('HMW_117')).toEqual([])
    expect(printed('HMW_131')).toEqual(['Raid 1'])
    expect(printed('HMW_259')).toEqual([])
    expect(printed('HMW_212')).toEqual([])
    expect(printed('HMW_096')).toEqual([])
  })
})

describe('HMW constant abilities, A: a keyword or a stat on the unit', () => {
  it('Peppi Bow (HMW_073) gets +1/+1 while upgraded, and keeps Restore 1', () => {
    const s = board({ units: [unit('p', 'HMW_073'), unit('q', 'HMW_073', { upgrades: [upg('UPG')] })] })
    expect([power(s, 'p'), hp(s, 'p')]).toEqual([2, 3])
    expect([power(s, 'q'), hp(s, 'q')]).toEqual([4, 5])
    expect(kwValue(s, 'p', 'Restore')).toBe(1)
  })

  it('Yord Fandar (HMW_074) gains Sentinel while either base has 15 or more damage', () => {
    const y = [unit('y', 'HMW_074')]
    expect(has(board({ units: y }), 'y', 'Sentinel')).toBe(false)
    expect(has(board({ units: y, base: { cardId: 'TST_B', damage: 14 } }), 'y', 'Sentinel')).toBe(false)
    expect(has(board({ units: y, base: { cardId: 'TST_B', damage: 15 } }), 'y', 'Sentinel')).toBe(true)
    expect(has(board({ units: y }, { base: { cardId: 'TST_B', damage: 20 } }), 'y', 'Sentinel')).toBe(true)
  })

  it('Batcher (HMW_083) gets +1/+0 while defending only', () => {
    const s = board({ units: [unit('b', 'HMW_083')] }, { units: [unit('e', 'GRD')] }, { activePlayer: 'opponent' })
    expect(U(attack(s, 'e', 'b'), 'e').damage).toBe(3)
    const mine = board({ units: [unit('b', 'HMW_083')] }, { units: [unit('e', 'GRD')] })
    expect(U(attack(mine, 'b', 'e'), 'e').damage).toBe(2)
  })

  it('Gunga City Guard (HMW_084) enters with a Shield while you control another Gungan unit or a Naboo base', () => {
    const shielded = (s: GameState) => hasToken(played(s, 'HMW_084').upgrades, TOKEN_SHIELD)
    expect(shielded(play(board(), 'HMW_084'))).toBe(false)
    expect(shielded(play(board({ units: [unit('g', 'GUNGAN')] }), 'HMW_084'))).toBe(true)
    expect(shielded(play(board({ base: { cardId: 'NAB_B', damage: 0 } }), 'HMW_084'))).toBe(true)
    expect(shielded(play(board({}, { units: [unit('g', 'GUNGAN')] }), 'HMW_084'))).toBe(false)
  })

  it('Opee Sea Killer (HMW_090) gains Grit while you control a Naboo base', () => {
    const o = [unit('o', 'HMW_090', { damage: 3 })]
    expect(power(board({ units: o }), 'o')).toBe(5)
    expect(power(board({ units: o, base: { cardId: 'NAB_B', damage: 0 } }), 'o')).toBe(8)
    expect(power(board({ units: o }, { base: { cardId: 'NAB_B', damage: 0 } }), 'o')).toBe(5)
  })

  it('Stormtrooper Patrol (HMW_107) gets +2/+0 while you control another unit that costs 3 or more', () => {
    const p = unit('p', 'HMW_107')
    expect(power(board({ units: [p, unit('c', 'ONE')] }), 'p')).toBe(2)
    expect(power(board({ units: [p, unit('c', 'CHEAP')] }), 'p')).toBe(4)
    expect(power(board({ units: [p, unit('p2', 'HMW_107')] }), 'p')).toBe(4)
    expect(power(board({ units: [p] }, { units: [unit('c', 'PRICEY')] }), 'p')).toBe(2)
    expect(has(board({ units: [p] }), 'p', 'Sentinel')).toBe(true)
  })

  it('Chewbacca (HMW_117) gains Raid 1 per exhausted resource, and Overwhelm while every resource is exhausted', () => {
    const c = [unit('c', 'HMW_117')]
    const none = board({ units: c, resources: ready(4) })
    expect([kwValue(none, 'c', 'Raid'), has(none, 'c', 'Overwhelm')]).toEqual([0, false])
    const some = board({ units: c, resources: [...ready(2), ...exhausted(3)] })
    expect([kwValue(some, 'c', 'Raid'), has(some, 'c', 'Overwhelm')]).toEqual([3, false])
    const every = board({ units: c, resources: exhausted(5) })
    expect([kwValue(every, 'c', 'Raid'), has(every, 'c', 'Overwhelm')]).toEqual([5, true])
  })

  it('Ryyk Blademaster (HMW_118) gains Ambush and Overwhelm while you control 6 or more resources', () => {
    const five = board({ units: [unit('r', 'HMW_118')], resources: ready(5) })
    expect([has(five, 'r', 'Ambush'), has(five, 'r', 'Overwhelm')]).toEqual([false, false])
    const six = board({ units: [unit('r', 'HMW_118')], resources: exhausted(6) })
    expect([has(six, 'r', 'Ambush'), has(six, 'r', 'Overwhelm')]).toEqual([true, true])
  })

  it('Child of Dathomir (HMW_129) gets +2/+0 while you control 3 or more units, counting itself', () => {
    expect(power(board({ units: [unit('c', 'HMW_129'), unit('a', 'GRD')] }), 'c')).toBe(1)
    expect(power(board({ units: [unit('c', 'HMW_129'), unit('a', 'GRD'), unit('b', 'GRD')] }), 'c')).toBe(3)
  })

  it('Soaring Can-Cell (HMW_131) has Raid 1, and gains Ambush while you control a Kashyyyk base', () => {
    const c = [unit('c', 'HMW_131')]
    expect([kwValue(board({ units: c }), 'c', 'Raid'), has(board({ units: c }), 'c', 'Ambush')]).toEqual([1, false])
    expect(has(board({ units: c, base: { cardId: 'KAS_B', damage: 0 } }), 'c', 'Ambush')).toBe(true)
  })

  it('Wroshyr Rebel (HMW_133) gets +1/+0 for every 2 resources you control', () => {
    expect(power(board({ units: [unit('w', 'HMW_133')], resources: ready(5) }), 'w')).toBe(2)
    expect(power(board({ units: [unit('w', 'HMW_133')], resources: [...ready(1), ...exhausted(5)] }), 'w')).toBe(3)
  })

  it('V-19 Skirmisher (HMW_137) gains Sentinel while you control 3 or more units', () => {
    expect(has(board({ units: [unit('v', 'HMW_137'), unit('a', 'SPC')] }), 'v', 'Sentinel')).toBe(false)
    expect(has(board({ units: [unit('v', 'HMW_137'), unit('a', 'SPC'), unit('b', 'GRD')] }), 'v', 'Sentinel')).toBe(true)
  })

  it('Commander Gree (HMW_138) gains Raid 4 while friendly units and upgrades show 3 or more Command icons', () => {
    const two = board({ units: [unit('g', 'HMW_138'), unit('c', 'CMD')] })
    expect(kwValue(two, 'g', 'Raid')).toBe(0)
    expect(kwValue(board({ units: [unit('g', 'HMW_138'), unit('c', 'CMD'), unit('d', 'CMD')] }), 'g', 'Raid')).toBe(4)
    // A friendly Command upgrade counts, wherever it is attached; one the opponent owns does not.
    expect(kwValue(board({ units: [unit('g', 'HMW_138'), unit('c', 'CMD', { upgrades: [upg('CUPG')] })] }), 'g', 'Raid')).toBe(4)
    expect(kwValue(board({ units: [unit('g', 'HMW_138'), unit('c', 'CMD', { upgrades: [upg('CUPG', 'opponent')] })] }), 'g', 'Raid')).toBe(0)
    // A doubled icon counts twice.
    expect(kwValue(board({ units: [unit('g', 'HMW_138'), unit('c', 'TST_U4')] }), 'g', 'Raid')).toBe(4)
    expect(kwValue(board({ units: [unit('g', 'HMW_138')] }, { units: [unit('c', 'CMD'), unit('d', 'CMD')] }), 'g', 'Raid')).toBe(0)
  })

  it('Wookiee Rangers (HMW_142) gain Sentinel while you control another Wookiee unit or a Kashyyyk base', () => {
    const w = unit('w', 'HMW_142')
    expect(has(board({ units: [w] }), 'w', 'Sentinel')).toBe(false)
    expect(has(board({ units: [w, unit('k', 'WOOKIEE')] }), 'w', 'Sentinel')).toBe(true)
    expect(has(board({ units: [w], base: { cardId: 'KAS_B', damage: 0 } }), 'w', 'Sentinel')).toBe(true)
  })

  it('Chief Chirpa (HMW_164) gets +1/+0 for each other friendly Ewok unit', () => {
    const s = board({ units: [unit('c', 'HMW_164'), unit('a', 'EWOK'), unit('b', 'EWOK')] }, { units: [unit('e', 'EWOK')] })
    expect(power(s, 'c')).toBe(3)
  })

  it('Village Troublemaker (HMW_176) gains Hidden and Saboteur while you control an Endor base', () => {
    const v = [unit('v', 'HMW_176')]
    expect([has(board({ units: v }), 'v', 'Hidden'), has(board({ units: v }), 'v', 'Saboteur')]).toEqual([false, false])
    const endor = board({ units: v, base: { cardId: 'END_B', damage: 0 } })
    expect([has(endor, 'v', 'Hidden'), has(endor, 'v', 'Saboteur')]).toEqual([true, true])
    expect(played(play(board({ base: { cardId: 'END_B', damage: 0 } }), 'HMW_176'), 'HMW_176').hidden).toBe(true)
  })

  it('Jedi Interceptor (HMW_256) gets +2/+0 while you control 6 or more resources', () => {
    expect(power(board({ units: [unit('j', 'HMW_256')], resources: ready(5) }), 'j')).toBe(2)
    expect(power(board({ units: [unit('j', 'HMW_256')], resources: ready(6) }), 'j')).toBe(4)
  })

  it('Ewok Archers (HMW_257) gain Ambush while you control another unit that costs 3 or less', () => {
    expect(has(board({ units: [unit('a', 'HMW_257'), unit('p', 'PRICEY')] }), 'a', 'Ambush')).toBe(false)
    expect(has(board({ units: [unit('a', 'HMW_257'), unit('c', 'CHEAP')] }), 'a', 'Ambush')).toBe(true)
    expect(has(board({ units: [unit('a', 'HMW_257')] }, { units: [unit('c', 'ONE')] }), 'a', 'Ambush')).toBe(false)
  })

  it('Pack Guardian (HMW_259) gains Sentinel while ready', () => {
    expect(has(board({ units: [unit('p', 'HMW_259')] }), 'p', 'Sentinel')).toBe(true)
    expect(has(board({ units: [unit('p', 'HMW_259', { exhausted: true })] }), 'p', 'Sentinel')).toBe(false)
  })

  it('Devotion (HMW_096) gives the attached unit Restore 2', () => {
    const s = board({ units: [unit('a', 'GRD', { upgrades: [upg('HMW_096')] })] })
    expect(kwValue(s, 'a', 'Restore')).toBe(2)
  })

  it('Enraged (HMW_190) gives the attached unit Raid 2', () => {
    expect(kwValue(board({ units: [unit('a', 'GRD', { upgrades: [upg('HMW_190')] })] }), 'a', 'Raid')).toBe(2)
  })

  it("Hunter's Instinct (HMW_191) gives Grit to an attached Creature only", () => {
    const s = board({ units: [unit('c', 'CRT', { upgrades: [upg('HMW_191')] }), unit('g', 'GRD', { upgrades: [upg('HMW_191')] })] })
    expect([has(s, 'c', 'Grit'), has(s, 'g', 'Grit')]).toEqual([true, false])
  })

  it('Gaderffii Stick (HMW_235) attaches only to a non-Vehicle unit with 3 or less power', () => {
    const s = board({ hand: ['HMW_235'], units: [unit('g', 'GRD'), unit('b', 'BIG'), unit('v', 'VEH')] })
    const targets = moves(s).flatMap(m => (m.type === 'playUpgrade' ? [m.targetInstanceId] : [])).sort()
    expect(targets).toEqual(['g'])
  })
})

describe('HMW constant abilities, B: auras, combat and damage', () => {
  it('Mother Talzin (HMW_039) gives each other friendly unit Restore 1', () => {
    const s = board({ units: [unit('t', 'HMW_039'), unit('a', 'GRD')] }, { units: [unit('e', 'GRD')] })
    expect([kwValue(s, 'a', 'Restore'), kwValue(s, 't', 'Restore'), kwValue(s, 'e', 'Restore')]).toEqual([1, 0, 0])
    expect(kwValue(s, 't', 'Raid')).toBe(1)
  })

  it('Numa (HMW_088) prevents 1 of each instance of damage dealt to her', () => {
    const s = board({ units: [unit('n', 'HMW_088')] }, { units: [unit('e', 'GRD')] })
    const after = attack(s, 'n', 'e')
    expect([U(after, 'n').damage, U(after, 'e').damage]).toEqual([1, 4])
  })

  it('Rex (HMW_141) gives friendly units with no abilities +1/+1', () => {
    const s = board({
      units: [unit('r', 'HMW_141'), unit('v', 'GRD'), unit('a', 'ABIL'), unit('k', 'KWU'), unit('c', TOKEN_CLONE_TROOPER)],
    }, { units: [unit('e', 'GRD')] })
    expect([power(s, 'v'), hp(s, 'v')]).toEqual([3, 9])
    expect([power(s, 'a'), power(s, 'k'), power(s, 'e'), power(s, 'r')]).toEqual([2, 2, 2, 5])
    expect(power(s, 'c')).toBe(3)
    // An upgrade handing it a keyword gives it an ability.
    expect(power(board({ units: [unit('r', 'HMW_141'), unit('v', 'GRD', { upgrades: [upg('HMW_190')] })] }), 'v')).toBe(2)
  })

  it('Teebo (HMW_162) gives other friendly Ewok units Hidden', () => {
    const s = board({ units: [unit('t', 'HMW_162'), unit('a', 'EWOK'), unit('g', 'GRD')] }, { units: [unit('e', 'EWOK')] })
    expect([has(s, 'a', 'Hidden'), has(s, 'g', 'Hidden'), has(s, 'e', 'Hidden'), has(s, 't', 'Hidden')]).toEqual([true, false, false, true])
    expect(played(play(board({ units: [unit('t', 'HMW_162')] }), 'EWOK'), 'EWOK').hidden).toBe(true)
  })

  it('The Chieftain (HMW_212) gains Raid 1 per other friendly Tusken, and a defending friendly Tusken gets +1/+0 per Raid', () => {
    const tuskens = [unit('c', 'HMW_212'), unit('a', 'TUSKEN'), unit('r', 'TUSKR')]
    const s = board({ units: tuskens }, { units: [unit('e', 'GRD')] })
    expect(kwValue(s, 'c', 'Raid')).toBe(2)
    const theirs = (x: GameState) => ({ ...x, activePlayer: 'opponent' as PlayerId })
    // The Chieftain defends at 2 + 2; a Raid 1 Tusken at 2 + 1; a Tusken with no Raid at 2.
    expect(U(attack(theirs(s), 'e', 'c'), 'e').damage).toBe(4)
    expect(U(attack(theirs(s), 'e', 'r'), 'e').damage).toBe(3)
    expect(U(attack(theirs(s), 'e', 'a'), 'e').damage).toBe(2)
  })

  it('Awakened Exogorth (HMW_233) gives the unit it attacks -3/-0', () => {
    const s = board({ units: [unit('x', 'HMW_233')] }, { units: [unit('e', 'SPC5')] })
    expect(U(attack(s, 'x', 'e'), 'x').damage).toBe(2)
    const theirs = board({ units: [unit('x', 'HMW_233')] }, { units: [unit('e', 'SPC5')] }, { activePlayer: 'opponent' })
    expect(U(attack(theirs, 'e', 'x'), 'x').damage).toBe(5)
  })

  it('Blockade Ship (HMW_251) gives enemy ground units -1/-0 while attacking', () => {
    const s = board({ units: [unit('b', 'HMW_251'), unit('g', 'GRD')] },
      { units: [unit('e', 'GRD'), unit('f', 'SPC')] }, { activePlayer: 'opponent' })
    expect(U(attack(s, 'e', 'g'), 'g').damage).toBe(1)
    // A space attacker is not a ground unit (the Ship's own Sentinel takes it).
    expect(U(attack(s, 'f', 'b'), 'b').damage).toBe(2)
    // Friendly ground units attack at full power.
    const mine = board({ units: [unit('b', 'HMW_251'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] })
    expect(U(attack(mine, 'g', 'e'), 'e').damage).toBe(2)
  })
})

describe('HMW constant abilities, C: costs and entering play', () => {
  it('Aggrocrab (HMW_184) costs 1 less while you have the initiative', () => {
    const withIt = cost(board(), 'HMW_184')
    expect(cost(board({}, {}, { initiative: 'opponent' }), 'HMW_184')).toBe(withIt + 1)
  })

  it('Origin Tree Shyyyo (HMW_145) makes the first three units you play each round cost 1, 2 and 3 less with a Kashyyyk base', () => {
    const at = (playedIds: string[], baseId = 'KAS_B') => cost(board({ units: [unit('o', 'HMW_145')], base: { cardId: baseId, damage: 0 } }, {},
      { phaseEvents: phaseEvents({ played: { player: playedIds, opponent: ['GRD', 'GRD'] } }) }), 'PRICEY')
    expect([at([]), at(['GRD']), at(['GRD', 'GRD']), at(['GRD', 'GRD', 'GRD'])]).toEqual([4, 3, 2, 5])
    // Only units count towards the three; and without the base there is no discount.
    expect(at(['EVT', 'UPG'])).toBe(4)
    expect(at([], 'TST_B')).toBe(5)
    expect(effectiveCost(board({ units: [unit('o', 'HMW_145')], base: { cardId: 'KAS_B', damage: 0 } }), 'player', F.EVT)).toBe(1)
  })

  it('Victor Squadron (HMW_203) enters play ready', () => {
    expect(played(play(board(), 'HMW_203'), 'HMW_203').exhausted).toBe(false)
  })

  it('Luke Skywalker (HMW_208) enters play ready in the first round of the game only', () => {
    expect(played(play(board({}, {}, { round: 1 }), 'HMW_208'), 'HMW_208').exhausted).toBe(false)
    expect(played(play(board({}, {}, { round: 2 }), 'HMW_208'), 'HMW_208').exhausted).toBe(true)
  })

  it('Ritual Dragon (HMW_234) makes friendly units enter play ready while you control a Tatooine base, itself included', () => {
    const tat = { base: { cardId: 'TAT_B', damage: 0 } }
    expect(played(play(board(tat), 'HMW_234'), 'HMW_234').exhausted).toBe(false)
    expect(played(play(board(), 'HMW_234'), 'HMW_234').exhausted).toBe(true)
    const dragon = board({ ...tat, units: [unit('d', 'HMW_234')] })
    expect(played(play(dragon, 'GRD'), 'GRD').exhausted).toBe(false)
    expect(createTokenUnits(dragon, 'player', TOKEN_CLONE_TROOPER, 1).players.player.units.find(u => u.cardId === TOKEN_CLONE_TROOPER)!.exhausted).toBe(false)
    expect(play(dragon, 'GRD', 'opponent').players.opponent.units.find(u => u.cardId === 'GRD')!.exhausted).toBe(true)
    expect(played(play(board({ units: [unit('d', 'HMW_234')] }), 'GRD'), 'GRD').exhausted).toBe(true)
  })

  it("Fett's Firespray (HMW_053) lets friendly units attack bases while using Ambush", () => {
    const baseAttack = (s: GameState) => moves(s).some(m => m.type === 'attack' && m.target.kind === 'base' && m.choiceId !== undefined)
    // No enemy unit to hit: the Ambush still happens, at the base.
    const empty = play(board({ units: [unit('f', 'HMW_053')] }), 'AMB')
    expect(played(empty, 'AMB').exhausted).toBe(false)
    expect(baseAttack(empty)).toBe(true)
    const hit = attack(empty, played(empty, 'AMB').instanceId)
    expect(hit.players.opponent.base.damage).toBe(2)
    // With an enemy unit, the base is offered beside it.
    const both = play(board({ units: [unit('f', 'HMW_053')] }, { units: [unit('e', 'GRD')] }), 'AMB')
    expect(baseAttack(both)).toBe(true)
    // Without Firespray an Ambush never reaches a base, and with nothing to hit the unit enters exhausted.
    expect(baseAttack(play(board({}, { units: [unit('e', 'GRD')] }), 'AMB'))).toBe(false)
    expect(played(play(board(), 'AMB'), 'AMB').exhausted).toBe(true)
    // An opponent's Firespray lends nothing.
    expect(played(play(board({}, { units: [unit('f', 'HMW_053')] }), 'AMB'), 'AMB').exhausted).toBe(true)
    // Firespray's own Ambush may hit the base.
    expect(baseAttack(play(board(), 'HMW_053'))).toBe(true)
  })
})
