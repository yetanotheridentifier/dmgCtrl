import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { defeatUnit } from '../engine/combat'
import { normaliseCard } from '../engine/cardDb'
import { legalMoves, effectiveCost } from '../engine/legalMoves'
import { effectiveHp, effectivePower } from '../engine/stats'
import { unitHasKeyword, unitHasTrait, unitKeywordValue } from '../engine/keywords'
import { protectedFromEnemyAbility } from '../engine/effects'
import { getCardDefinition } from '../engine/abilities'
import { poolFor, SET_CODES } from '../bench/setPools'
import { TOKEN_EXPERIENCE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { TOKEN_BATTLE_DROID, TOKEN_CLONE_TROOPER, TOKEN_SPY } from '../engine/tokenUnits'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState, UpgradeAttachment } from '../engine/types'

/**
 * Cards that hand a unit a whole ability block ("Attached unit gains: ...", "each friendly unit gains:
 * ...", "For this attack, it gains: ..."). An upgrade's abilities are its host's (`abilityCardIds`), a
 * phase-long grant is a lasting effect's `abilityCardIds`, and an aura grant is `grantsAbilities`; the
 * primitive is covered in `grantedAbilities.test.ts`. Each test here checks one card's own effect and
 * restriction, driven through legal moves so an answer the engine would not offer fails the test.
 */

const POOL = poolFor(SET_CODES)
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the bundled fixtures`)
  return normaliseCard(row)
}
const SHIPPED = [
  'LAW_186', 'LAW_125', 'LAW_201', 'LAW_077', 'LAW_126',
  'SEC_264', 'SEC_210', 'SEC_039', 'SEC_156', 'SEC_052', 'SEC_104', 'SEC_231',
  'LOF_139', 'LOF_051', 'LOF_052', 'LOF_138', 'LOF_187', 'LOF_040', 'LOF_090', 'LOF_205',
  'JTL_172', 'JTL_227', 'JTL_171', 'JTL_073', 'JTL_120', 'JTL_260',
  'TWI_169', 'TWI_218', 'TWI_121', 'TWI_122', 'TWI_120', 'TWI_129', 'TWI_103', 'TWI_047',
  'SHD_104', 'SHD_126', 'SHD_177', 'SHD_074', 'SHD_053', 'SHD_143', 'SHD_155', 'SHD_123', 'SHD_222', 'SHD_226',
  'SOR_121', 'SOR_214', 'SOR_054', 'SOR_137', 'SOR_105',
  'TS26_35', 'TS26_52',
]

const u = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 5, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  GRD: u('GRD'),
  GRD2: u('GRD2'),
  BIG: u('BIG', { power: 3, hp: 9 }),
  WEAK: u('WEAK', { power: 1, hp: 1 }),
  FORCE: u('FORCE', { traits: ['Force'] }),
  JEDI: u('JEDI', { traits: ['Force', 'Jedi'] }),
  REBEL: u('REBEL', { traits: ['Rebel'] }),
  MANDO: u('MANDO', { traits: ['Mandalorian'] }),
  TROOPER: u('TROOPER', { traits: ['Trooper'] }),
  REPUBLIC: u('REPUBLIC', { traits: ['Republic'] }),
  UNIQ: u('UNIQ', { unique: true }),
  VEH: u('VEH', { arena: 'space', traits: ['Vehicle', 'Fighter'], power: 3, hp: 6 }),
  CAP: u('CAP', { arena: 'space', traits: ['Vehicle', 'Capital Ship'], power: 4, hp: 9 }),
  SPACE: u('SPACE', { arena: 'space', power: 2, hp: 5 }),
  SPACE2: u('SPACE2', { arena: 'space', power: 2, hp: 5 }),
  CHEAP: u('CHEAP', { cost: 3, power: 1, hp: 1 }),
  DEAR: u('DEAR', { cost: 4 }),
  EV: card({ id: 'EV', type: 'event', cost: 1 }),
  EV2: card({ id: 'EV2', type: 'event', cost: 1 }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 0, hp: 0 }),
  UNIQUP: card({ id: 'UNIQUP', type: 'upgrade', cost: 1, power: 0, hp: 0, unique: true }),
  VIG: card({ id: 'VIG', type: 'event', cost: 1, aspects: ['Vigilance'] }),
  HER: card({ id: 'HER', type: 'event', cost: 1, aspects: ['Heroism'] }),
  VIG_L: card({ id: 'VIG_L', type: 'leader', cost: 5, power: 4, hp: 7, aspects: ['Vigilance'] }),
}

const up = (cardId: string, owner: PlayerId = 'player'): UpgradeAttachment => ({ cardId, owner })
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
/** A unit carrying the named upgrades, all owned by `owner`. */
const host = (instanceId: string, cardId: string, upgrades: string[], over: Partial<UnitState> = {}, owner: PlayerId = 'player'): UnitState =>
  unit(instanceId, cardId, { upgrades: upgrades.map(c => up(c, owner)), ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
const tokens = (s: GameState, id: string, token: string) => (U(s, id)?.upgrades ?? []).filter(a => a.cardId === token).length
type Side = Parameters<typeof player>[0]
const rich = (over: Side = {}) => player({ resources: ready(20), deck: [], ...over })
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })

const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toEqual([])
type Answer = Partial<Extract<Action, { type: 'acceptChoice' }>>
/**
 * The moves the pending choice's controller has. A raw `defeatUnit` does not hand the turn to the
 * player who answers (the resolver does that around an action), so the choice is read as its own
 * controller's.
 */
const choiceMoves = (s: GameState) => legalMoves({ ...s, activePlayer: choice(s).controller })
/** Answer the pending choice with the legal accept matching every field of `match`. */
const answer = (s: GameState, match: Answer = {}): GameState => {
  const move = choiceMoves(s).find(m => m.type === 'acceptChoice' && Object.entries(match).every(([k, v]) => (m as Record<string, unknown>)[k] === v))
  if (!move) throw new Error(`no legal answer ${JSON.stringify(match)} to ${JSON.stringify(choice(s))}`)
  return resolve(s, move)
}
const decline = (s: GameState): GameState => {
  const move = choiceMoves(s).find(m => m.type === 'skipTrigger')
  if (!move) throw new Error(`no decline for ${JSON.stringify(choice(s))}`)
  return resolve(s, move)
}
const attackBase = (s: GameState, attackerId: string, who: PlayerId = 'player') =>
  resolve({ ...s, activePlayer: who }, { type: 'attack', attackerId, target: { kind: 'base' } })
const attackUnit = (s: GameState, attackerId: string, defenderId: string, who: PlayerId = 'player') =>
  resolve({ ...s, activePlayer: who }, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: defenderId } })
const canPlayUpgradeOn = (s: GameState, targetInstanceId: string) =>
  legalMoves(s).some(m => m.type === 'playUpgrade' && m.targetInstanceId === targetInstanceId)
/** Use the Action `cardId` gives the unit, whether it is on that card or on the carrier it grants. */
const useAbility = (s: GameState, instanceId: string, cardId: string) => {
  const move = legalMoves(s).find(m => m.type === 'useAbility' && m.instanceId === instanceId
    && (m.cardId === cardId || getCardDefinition(m.cardId)?.sourceCardId === cardId))
  if (!move) throw new Error(`${cardId} on ${instanceId} offers no action`)
  return resolve(s, move)
}
/** Answer an "attack with a unit" choice: `attackerId` attacks `defenderId`. */
const attackChoice = (s: GameState, attackerId: string, defenderId: string) => {
  const move = legalMoves(s).find(m => m.type === 'attack' && m.attackerId === attackerId && m.target.kind === 'unit' && m.target.instanceId === defenderId)
  if (!move) throw new Error(`${attackerId} is not offered an attack on ${defenderId}`)
  return resolve(s, move)
}
/** Both passes: into the regroup phase, whose start raises "when the regroup phase starts". */
const toRegroup = (s: GameState) => resolve({ ...s, consecutivePasses: 1 }, { type: 'pass' })

describe('On Attack, handed to the attached unit', () => {
  it('LAW_186 Enfys Nest\'s Helmet: may give another unit +3/+0 for this phase', () => {
    const s = board({ units: [host('h', 'GRD', ['LAW_186']), unit('f', 'GRD2')] })
    const attacked = attackBase(s, 'h')
    const done = answer(attacked, { targetInstanceId: 'f' })
    expect(effectivePower(done, U(done, 'f')!)).toBe(5)
    expect(legalMoves(attacked).some(m => m.type === 'acceptChoice' && m.targetInstanceId === 'h')).toBe(false) // "another"
  })

  it('LAW_125 Watchful: look at the top card of a deck and may put it on the bottom', () => {
    const s = board({ units: [host('h', 'GRD', ['LAW_125'])] }, { deck: ['GRD', 'BIG', 'WEAK'] })
    const picked = answer(attackBase(s, 'h'), { optionIndex: 0 }) // the opponent's deck
    const done = answer(picked)
    expect(done.players.opponent.deck).toEqual(['BIG', 'WEAK', 'GRD'])
    expect(decline(picked).players.opponent.deck).toEqual(['GRD', 'BIG', 'WEAK'])
  })

  it('SEC_264 Clandestine Connections: may pay 2 to deal 2 damage to a base', () => {
    const s = board({ units: [host('h', 'GRD', ['SEC_264'])], resources: ready(2) }, { units: [unit('e', 'BIG')] })
    const paid = answer(attackUnit(s, 'h', 'e'))
    const done = answer(paid, { baseTarget: 'opponent' })
    expect(done.players.opponent.base.damage).toBe(2)
    expect(done.players.player.resources.filter(r => !r.exhausted)).toHaveLength(0)
  })

  it('SEC_210 Stolen Starpath Unit: name a card; a Spy token for each copy in the defending player\'s hand', () => {
    const s = board({ units: [host('h', 'GRD', ['SEC_210'])] }, { hand: ['BIG', 'WEAK', 'BIG'] })
    const done = answer(attackBase(s, 'h'), { cardName: 'BIG' })
    expect(done.players.player.units.filter(x => x.cardId === TOKEN_SPY)).toHaveLength(2)
  })

  it('LOF_139 Battle Fury: discard a card from your hand', () => {
    const s = board({ units: [host('h', 'GRD', ['LOF_139'])], hand: ['BIG', 'WEAK'] })
    const done = answer(attackBase(s, 'h'), { handIndex: 1 })
    expect(done.players.player.hand).toEqual(['BIG'])
    expect(done.players.player.discard).toEqual(['WEAK'])
  })

  it('LOF_051 Jedi Holocron: attaches to a Force unit; may heal 3 damage from another unit', () => {
    expect(canPlayUpgradeOn(board({ hand: ['LOF_051'], units: [unit('f', 'FORCE'), unit('g', 'GRD')] }), 'g')).toBe(false)
    const s = board({ units: [host('h', 'FORCE', ['LOF_051']), unit('f', 'BIG', { damage: 4 })] })
    const done = answer(attackBase(s, 'h'), { targetInstanceId: 'f' })
    expect(U(done, 'f')?.damage).toBe(1)
  })

  it('LOF_052 Jedi Trials: On Attack gives this unit an Experience token; 4 upgrades give it the Jedi trait', () => {
    const s = board({ units: [host('h', 'FORCE', ['LOF_052'])] })
    expect(tokens(attackBase(s, 'h'), 'h', TOKEN_EXPERIENCE)).toBe(1)
    expect(unitHasTrait(s, U(s, 'h')!, 'Jedi')).toBe(false)
    const four = board({ units: [host('h', 'FORCE', ['LOF_052', 'UPG', 'UPG', 'UPG'])] })
    expect(unitHasTrait(four, U(four, 'h')!, 'Jedi')).toBe(true)
  })

  it('LOF_138 Sith Holocron: may deal 2 damage to a friendly unit; if so, +2/+0 for this attack', () => {
    const s = board({ units: [host('h', 'FORCE', ['LOF_138']), unit('f', 'BIG')] }, { units: [unit('e', 'BIG')] })
    const done = answer(attackUnit(s, 'h', 'e'), { targetInstanceId: 'f' })
    expect(U(done, 'f')?.damage).toBe(2)
    expect(U(done, 'e')?.damage).toBe(effectivePower(s, U(s, 'h')!) + 2)
  })

  it('JTL_172 Twin Laser Turret: attaches to a Vehicle; 1 damage to each of up to 2 units in this arena', () => {
    expect(canPlayUpgradeOn(board({ hand: ['JTL_172'], units: [unit('g', 'GRD')] }), 'g')).toBe(false)
    const s = board({ units: [host('h', 'VEH', ['JTL_172'])] }, { units: [unit('e1', 'SPACE'), unit('e2', 'SPACE2'), unit('g', 'GRD')] })
    const attacked = attackBase(s, 'h')
    expect(legalMoves(attacked).some(m => m.type === 'acceptChoice' && m.targetInstanceId === 'g')).toBe(false)
    const done = answer(answer(attacked, { targetInstanceId: 'e1' }), { targetInstanceId: 'e2' })
    expect([U(done, 'e1')?.damage, U(done, 'e2')?.damage]).toEqual([1, 1])
  })

  it('JTL_227 Superheavy Ion Cannon: may exhaust an enemy non-leader unit, then indirect damage equal to its power', () => {
    expect(canPlayUpgradeOn(board({ hand: ['JTL_227'], units: [unit('v', 'VEH')] }), 'v')).toBe(false) // a Fighter
    const s = board({ units: [host('h', 'CAP', ['JTL_227'])] }, { units: [unit('e', 'BIG')] })
    const exhausted = answer(attackBase(s, 'h'), { targetInstanceId: 'e' })
    expect(U(exhausted, 'e')?.exhausted).toBe(true)
    expect(choice(exhausted).controller).toBe('opponent') // the receiving player assigns it
  })

  it('JTL_171 Targeting Computer: you assign the indirect damage this unit deals', () => {
    const s = board({ units: [host('h', 'CAP', ['JTL_227', 'JTL_171'])] }, { units: [unit('e', 'BIG')] })
    const exhausted = answer(attackBase(s, 'h'), { targetInstanceId: 'e' })
    expect(choice(exhausted).controller).toBe('player')
  })

  it('SHD_104 Inspiring Mentor: On Attack and When Defeated, an Experience token to another friendly unit', () => {
    const s = board({ units: [host('h', 'GRD', ['SHD_104']), unit('f', 'GRD2')] })
    expect(tokens(answer(attackBase(s, 'h'), { targetInstanceId: 'f' }), 'f', TOKEN_EXPERIENCE)).toBe(1)
    expect(tokens(answer(defeatUnit(s, 'h'), { targetInstanceId: 'f' }), 'f', TOKEN_EXPERIENCE)).toBe(1)
  })

  it('SHD_126 The Darksaber: Experience to each other friendly Mandalorian; no aspect penalty on a Mandalorian', () => {
    const s = board({ units: [host('h', 'MANDO', ['SHD_126']), unit('m', 'MANDO'), unit('g', 'GRD')] })
    const done = attackBase(s, 'h')
    expect([tokens(done, 'h', TOKEN_EXPERIENCE), tokens(done, 'm', TOKEN_EXPERIENCE), tokens(done, 'g', TOKEN_EXPERIENCE)]).toEqual([0, 1, 0])
    // A leader and base that provide no Command icon, so the Darksaber carries a penalty unless waived.
    const play = board({ units: [unit('m', 'MANDO'), unit('g', 'GRD')], leader: { cardId: 'VIG_L', deployed: false, epicActionUsed: false, exhausted: false } })
    expect(effectiveCost(play, 'player', F.SHD_126, U(play, 'm'))).toBe(F.SHD_126.cost)
    expect(effectiveCost(play, 'player', F.SHD_126, U(play, 'g'))).toBe(F.SHD_126.cost + 2)
  })

  it('SHD_177 Vambrace Flamethrower: may deal 3 damage divided among enemy ground units', () => {
    const s = board({ units: [host('h', 'GRD', ['SHD_177'])] }, { units: [unit('e1', 'BIG'), unit('e2', 'BIG'), unit('sp', 'SPACE')] })
    const attacked = attackBase(s, 'h')
    expect(legalMoves(attacked).some(m => m.type === 'acceptChoice' && m.targetInstanceId === 'sp')).toBe(false)
    const done = answer(answer(answer(attacked, { targetInstanceId: 'e1' }), { targetInstanceId: 'e1' }), { targetInstanceId: 'e2' })
    expect([U(done, 'e1')?.damage, U(done, 'e2')?.damage]).toEqual([2, 1])
  })

  it('SHD_074 Vambrace Grappleshot: exhaust the defender', () => {
    const s = board({ units: [host('h', 'GRD', ['SHD_074'])] }, { units: [unit('e', 'BIG')] })
    expect(U(attackUnit(s, 'h', 'e'), 'e')?.exhausted).toBe(true)
  })

  it('SOR_121 Hardpoint Heavy Blaster: not attacking a base, may deal 2 damage to a unit in the defender\'s arena', () => {
    const s = board({ units: [host('h', 'VEH', ['SOR_121'])] }, { units: [unit('e', 'SPACE'), unit('e2', 'SPACE2'), unit('g', 'GRD')] })
    const attacked = attackUnit(s, 'h', 'e')
    expect(legalMoves(attacked).some(m => m.type === 'acceptChoice' && m.targetInstanceId === 'g')).toBe(false)
    expect(U(answer(attacked, { targetInstanceId: 'e2' }), 'e2')?.damage).toBe(2)
    noChoice(attackBase(s, 'h'))
  })

  it('SOR_214 Smuggling Compartment: ready a resource', () => {
    const s = board({ units: [host('h', 'VEH', ['SOR_214'])], resources: [{ cardId: 'R', exhausted: true }] })
    expect(attackBase(s, 'h').players.player.resources[0].exhausted).toBe(false)
  })

  it('TS26_35 Ahsoka\'s Lightsabers: may Shield an enemy unit; if so the next event this phase costs 2 less', () => {
    const s = board({ units: [host('h', 'GRD', ['TS26_35'])], hand: ['EV'] }, { units: [unit('e', 'BIG')] })
    const done = answer(attackBase(s, 'h'), { targetInstanceId: 'e' })
    expect(tokens(done, 'e', TOKEN_SHIELD)).toBe(1)
    expect(done.players.player.nextUnitGrants).toEqual([expect.objectContaining({ event: true, costDelta: -2 })])
    const died = answer(defeatUnit(s, 'h'), { targetInstanceId: 'e' })
    expect(tokens(died, 'e', TOKEN_SHIELD)).toBe(1)
  })

  it('TS26_52 Sith Traditions: On Attack Experience to this unit; When Defeated Experience to a friendly unit', () => {
    const s = board({ units: [host('h', 'GRD', ['TS26_52']), unit('f', 'GRD2')] })
    expect(tokens(attackBase(s, 'h'), 'h', TOKEN_EXPERIENCE)).toBe(1)
    expect(tokens(answer(defeatUnit(s, 'h'), { targetInstanceId: 'f' }), 'f', TOKEN_EXPERIENCE)).toBe(1)
  })
})

describe('When Defeated, handed to the attached unit', () => {
  it('LAW_201 Thermal Detonator: if this unit was ready, 2 damage to each enemy ground unit', () => {
    const readyHost = board({ units: [host('h', 'GRD', ['LAW_201'])] }, { units: [unit('e', 'BIG'), unit('sp', 'SPACE')] })
    const done = defeatUnit(readyHost, 'h')
    expect([U(done, 'e')?.damage, U(done, 'sp')?.damage]).toEqual([2, 0])
    const exhausted = board({ units: [host('h', 'GRD', ['LAW_201'], { exhausted: true })] }, { units: [unit('e', 'BIG')] })
    expect(U(defeatUnit(exhausted, 'h'), 'e')?.damage).toBe(0)
  })

  it('SEC_039 Creditor\'s Claim: may defeat a unit with 3 or less remaining HP', () => {
    const s = board({ units: [host('h', 'GRD', ['SEC_039'])] }, { units: [unit('low', 'BIG', { damage: 6 }), unit('high', 'BIG')] })
    const died = defeatUnit(s, 'h')
    expect(legalMoves(died).some(m => m.type === 'acceptChoice' && m.targetInstanceId === 'high')).toBe(false)
    expect(U(answer(died, { targetInstanceId: 'low' }), 'low')).toBeUndefined()
  })

  it('SEC_156 Nemik\'s Manifesto: the Rebel trait; When Defeated 1 damage to each enemy base per other friendly Rebel', () => {
    const s = board({ units: [host('h', 'GRD', ['SEC_156']), unit('r1', 'REBEL'), unit('r2', 'REBEL'), unit('g', 'GRD2')] })
    expect(unitHasTrait(s, U(s, 'h')!, 'Rebel')).toBe(true)
    expect(defeatUnit(s, 'h').players.opponent.base.damage).toBe(2)
  })

  it('JTL_073 Grim Valor: may exhaust a unit', () => {
    const s = board({ units: [host('h', 'GRD', ['JTL_073'])] }, { units: [unit('e', 'BIG')] })
    expect(U(answer(defeatUnit(s, 'h'), { targetInstanceId: 'e' }), 'e')?.exhausted).toBe(true)
  })

  it('TWI_169 Clone Cohort: Raid 2 and a Clone Trooper token when defeated', () => {
    const s = board({ units: [host('h', 'GRD', ['TWI_169'])] })
    expect(unitKeywordValue(s, U(s, 'h')!, 'Raid')).toBe(2)
    expect(defeatUnit(s, 'h').players.player.units.map(x => x.cardId)).toEqual([TOKEN_CLONE_TROOPER])
  })

  it('TWI_218 Droid Cohort: a Battle Droid token when defeated', () => {
    const s = board({ units: [host('h', 'GRD', ['TWI_218'])] })
    expect(defeatUnit(s, 'h').players.player.units.map(x => x.cardId)).toEqual([TOKEN_BATTLE_DROID])
  })

  it('SHD_053 Second Chance: its owner may play the unit from their discard pile for free this phase', () => {
    expect(canPlayUpgradeOn(board({ hand: ['SHD_053'], units: [unit('l', 'GRD', { isLeader: true })] }), 'l')).toBe(false)
    const s = board({ units: [host('h', 'DEAR', ['SHD_053'])], resources: [] })
    const died = defeatUnit(s, 'h')
    const play = legalMoves(died).find(m => m.type === 'playFromDiscard' || (m.type as string).startsWith('play') && JSON.stringify(m).includes('DEAR'))
    expect(play, 'the defeated unit is offered from the discard pile').toBeDefined()
    const played = resolve(died, play!)
    expect(played.players.player.units.map(x => x.cardId)).toContain('DEAR')
  })
})

describe('Granted only while the attached unit qualifies', () => {
  it('SOR_054 Jedi Lightsaber: a Force unit gives the defender -2/-2 for this phase', () => {
    const s = board({ units: [host('h', 'FORCE', ['SOR_054'])] }, { units: [unit('e', 'BIG')] })
    const done = attackUnit(s, 'h', 'e')
    expect(effectiveHp(done, U(done, 'e')!)).toBe(7)
    const plain = board({ units: [host('h', 'GRD', ['SOR_054'])] }, { units: [unit('e', 'BIG')] })
    const none = attackUnit(plain, 'h', 'e')
    expect(effectiveHp(none, U(none, 'e')!)).toBe(9)
  })

  it('SOR_137 Fallen Lightsaber: a Force unit deals 1 damage to each ground unit the defending player controls', () => {
    const s = board({ units: [host('h', 'FORCE', ['SOR_137'])] }, { units: [unit('e1', 'BIG'), unit('e2', 'BIG'), unit('sp', 'SPACE')] })
    const done = attackBase(s, 'h')
    expect([U(done, 'e1')?.damage, U(done, 'e2')?.damage, U(done, 'sp')?.damage]).toEqual([1, 1, 0])
    const plain = board({ units: [host('h', 'GRD', ['SOR_137'])] }, { units: [unit('e1', 'BIG')] })
    expect(U(attackBase(plain, 'h'), 'e1')?.damage).toBe(0)
  })

  it('LOF_187 Corrupted Saber: a Force unit gives the defender -2/-0 for this attack', () => {
    const s = board({ units: [host('h', 'FORCE', ['LOF_187'], {})] }, { units: [unit('e', 'BIG')] })
    const done = attackUnit(s, 'h', 'e')
    expect(U(done, 'h')?.damage).toBe(1) // BIG strikes back for 3 - 2
    const plain = board({ units: [host('h', 'GRD', ['LOF_187'])] }, { units: [unit('e', 'BIG')] })
    expect(U(attackUnit(plain, 'h', 'e'), 'h')?.damage).toBe(3)
  })

  it('LOF_040 Kylo Ren\'s Lightsaber: a Force unit can\'t be exhausted by enemy card abilities', () => {
    const s = board({ units: [host('h', 'FORCE', ['LOF_040']), host('g', 'GRD', ['LOF_040'])] })
    expect(protectedFromEnemyAbility(s, U(s, 'h')!, 'player', 'opponent', 'exhaust')).toBe(true)
    expect(protectedFromEnemyAbility(s, U(s, 'h')!, 'player', 'opponent', 'defeat')).toBe(false)
    expect(protectedFromEnemyAbility(s, U(s, 'g')!, 'player', 'opponent', 'exhaust')).toBe(false)
  })

  it('TWI_121 General\'s Blade: a Jedi makes the next unit you play this phase cost 2 less', () => {
    const s = board({ units: [host('h', 'JEDI', ['TWI_121'])] })
    expect(attackBase(s, 'h').players.player.nextUnitGrants).toEqual([expect.objectContaining({ costDelta: -2 })])
    const plain = board({ units: [host('h', 'FORCE', ['TWI_121'])] })
    expect(attackBase(plain, 'h').players.player.nextUnitGrants ?? []).toEqual([])
  })
})

describe('Other trigger points, handed to the attached unit', () => {
  it('LAW_077 Shadow of Stygeon Prime: the unit can\'t ready, and its controller\'s base takes 2 as the regroup phase starts', () => {
    expect(canPlayUpgradeOn(board({ hand: ['LAW_077'] }, { units: [unit('l', 'GRD', { isLeader: true })] }), 'l')).toBe(false)
    // Decks to draw from, so the regroup draw deals no damage of its own.
    const s = board({ units: [host('h', 'GRD', ['LAW_077'], { exhausted: true }, 'opponent')], deck: ['GRD', 'GRD'] }, { deck: ['GRD', 'GRD'] })
    const regroup = toRegroup(s)
    expect(regroup.players.player.base.damage).toBe(2)
    expect(regroup.players.opponent.base.damage).toBe(0)
    expect(U(resolve(s, { type: 'pass' }), 'h')?.exhausted).toBe(true)
  })

  it('SEC_052 Diplomatic Immunity: when attacked, may disclose Vigilance Vigilance Heroism Heroism for -2/-0 on the attacker', () => {
    const s = board({ units: [host('h', 'BIG', ['SEC_052'])], hand: ['VIG', 'VIG', 'HER', 'HER'] }, { units: [unit('e', 'BIG')] })
    let next = attackUnit(s, 'e', 'h', 'opponent')
    for (const handIndex of [0, 1, 2, 3]) next = answer(next, { handIndex })
    next = answer(next)
    expect(U(next, 'h')?.damage).toBe(1)
  })

  it('SHD_143 Ruthlessness: attacking and defeating a unit deals 2 damage to the defending player\'s base', () => {
    const s = board({ units: [host('h', 'BIG', ['SHD_143'])] }, { units: [unit('e', 'WEAK')] })
    expect(attackUnit(s, 'h', 'e').players.opponent.base.damage).toBe(2)
    const survives = board({ units: [host('h', 'GRD', ['SHD_143'])] }, { units: [unit('e', 'BIG')] })
    expect(attackUnit(survives, 'h', 'e').players.opponent.base.damage).toBe(0)
  })

  it('JTL_120 Dorsal Turret: combat damage to a unit while attacking defeats it', () => {
    const s = board({ units: [host('h', 'VEH', ['JTL_120'])] }, { units: [unit('e', 'SPACE', { hp: 99 } as Partial<UnitState>)] })
    expect(U(attackUnit(s, 'h', 'e'), 'e')).toBeUndefined()
    const defending = board({ units: [host('h', 'VEH', ['JTL_120'])] }, { units: [unit('e', 'CAP')] })
    expect(U(attackUnit(defending, 'e', 'h', 'opponent'), 'e')).toBeDefined()
  })
})

describe('Constant and Action abilities, handed to the attached unit', () => {
  it('LAW_126 Adventurer Sniper Rifle: exhaust to set an undamaged non-leader ground unit\'s printed HP to 1 for this phase', () => {
    const s = board({ units: [host('h', 'GRD', ['LAW_126'])] }, { units: [unit('e', 'BIG'), unit('hurt', 'BIG', { damage: 1 }), unit('sp', 'SPACE')] })
    const used = useAbility(s, 'h', 'LAW_126')
    expect(U(used, 'h')?.exhausted).toBe(true)
    const offered = legalMoves(used).filter(m => m.type === 'acceptChoice').map(m => (m as { targetInstanceId?: string }).targetInstanceId)
    expect(offered).toContain('e')
    expect(offered).not.toContain('hurt')
    expect(offered).not.toContain('sp')
    const done = answer(used, { targetInstanceId: 'e' })
    expect(effectiveHp(done, U(done, 'e')!)).toBe(1)
  })

  it('SEC_104 Figure of Unity: while ready, each OTHER friendly unit has Overwhelm, Raid 1 and Restore 1', () => {
    const s = board({ units: [host('h', 'UNIQ', ['SEC_104']), unit('f', 'GRD')] }, { units: [unit('e', 'GRD2')] })
    expect(['Overwhelm', 'Raid', 'Restore'].map(k => unitHasKeyword(s, U(s, 'f')!, k))).toEqual([true, true, true])
    expect(['Overwhelm', 'Raid', 'Restore'].map(k => unitHasKeyword(s, U(s, 'h')!, k))).toEqual([false, false, false])
    expect(unitHasKeyword(s, U(s, 'e')!, 'Overwhelm')).toBe(false)
    const tired = board({ units: [host('h', 'UNIQ', ['SEC_104'], { exhausted: true }), unit('f', 'GRD')] })
    expect(unitHasKeyword(tired, U(tired, 'f')!, 'Overwhelm')).toBe(false)
    expect(canPlayUpgradeOn(board({ hand: ['SEC_104'], units: [unit('g', 'GRD')] }), 'g')).toBe(false)
  })

  it('LOF_090 Inquisitor\'s Lightsaber: +2/+0 while attacking a Force unit', () => {
    const s = board({ units: [host('h', 'GRD', ['LOF_090'])] }, { units: [unit('f', 'FORCE', { damage: 0 }), unit('g', 'BIG')] })
    const hostPower = effectivePower(s, U(s, 'h')!)
    expect(U(attackUnit(s, 'h', 'f'), 'f')).toBeUndefined() // 2 + 1 + 2 = 5 on a 5 HP unit
    expect(U(attackUnit(s, 'h', 'g'), 'g')?.damage).toBe(hostPower)
  })

  it('TWI_122 Squad Support: +1/+1 for each Trooper unit you control', () => {
    const s = board({ units: [host('h', 'TROOPER', ['TWI_122']), unit('t', 'TROOPER'), unit('g', 'GRD')] }, { units: [unit('et', 'TROOPER')] })
    expect(effectivePower(s, U(s, 'h')!)).toBe(2 + 2)
    expect(effectiveHp(s, U(s, 'h')!)).toBe(5 + 2)
  })

  it('TWI_120 Strategic Acumen: exhaust to play a unit from your hand for 1 less', () => {
    const s = board({ units: [host('h', 'GRD', ['TWI_120'])], hand: ['DEAR'], resources: ready(3) })
    const used = useAbility(s, 'h', 'TWI_120')
    const played = answer(used)
    expect(played.players.player.units.map(x => x.cardId)).toContain('DEAR')
    expect(played.players.player.resources.filter(r => !r.exhausted)).toHaveLength(0)
  })

  it('SHD_155 Heroic Resolve: pay 2 and defeat it to attack with +4/+0 and Overwhelm', () => {
    const s = board({ units: [host('h', 'GRD', ['SHD_155'])], resources: ready(2) }, { units: [unit('e', 'WEAK')] })
    const used = useAbility(s, 'h', 'SHD_155')
    expect(U(used, 'h')?.upgrades.some(x => x.cardId === 'SHD_155')).toBe(false)
    expect(used.players.player.discard).toContain('SHD_155')
    const done = attackChoice(used, 'h', 'e')
    // The upgrade's own +1/+1 left with it as the cost was paid: 2 + 4, Overwhelm past the 1 HP.
    expect(done.players.opponent.base.damage).toBe(2 + 4 - 1)
  })

  it('JTL_260 Death Star Plans: the first unit you play each round costs 2 less; the attacker takes it when attacked', () => {
    const s = board({ units: [host('h', 'GRD', ['JTL_260'])], hand: ['DEAR'] }, { units: [unit('e', 'BIG'), unit('e2', 'GRD2')] })
    expect(effectiveCost(s, 'player', F.DEAR)).toBe(F.DEAR.cost - 2)
    const moved = answer(attackUnit(s, 'e', 'h', 'opponent'), { targetInstanceId: 'e2' })
    expect(U(moved, 'h')?.upgrades.some(x => x.cardId === 'JTL_260')).toBe(false)
    expect(U(moved, 'e2')?.upgrades).toContainEqual({ cardId: 'JTL_260', owner: 'opponent' })
  })
})

describe('Bounty, handed to the attached unit', () => {
  it('SHD_123 Bounty Hunter\'s Quarry: search the top 5 for a unit costing 3 or less and play it free', () => {
    const s = board({ units: [host('h', 'GRD', ['SHD_123'], {}, 'opponent')] }, { deck: ['DEAR', 'CHEAP', 'EV', 'GRD', 'GRD2', 'WEAK'], resources: [] })
    const collected = answer(defeatUnit(s, 'h'))
    const done = answer(collected, { deckIndex: 1 })
    expect(done.players.opponent.units.map(x => x.cardId)).toContain('CHEAP')
  })

  it('SHD_222 Enticing Reward: search the top 10 for 2 non-unit cards and draw them, then discard for a non-unique host', () => {
    const s = board({ units: [host('h', 'GRD', ['SHD_222'], {}, 'opponent')] }, { deck: ['DEAR', 'EV', 'GRD', 'EV2'], hand: ['WEAK'] })
    let next = answer(defeatUnit(s, 'h'))
    next = answer(next, { deckIndex: 1 })
    next = answer(next, { deckIndex: 2 }) // re-indexed once EV has left the revealed window
    expect(next.players.opponent.hand).toEqual(expect.arrayContaining(['EV', 'EV2']))
    next = answer(next, { handIndex: 0 })
    expect(next.players.opponent.hand).toHaveLength(2)
  })

  it('SHD_226 Unrefusable Offer: the collector plays the defeated unit free and ready, defeated at the regroup start', () => {
    expect(canPlayUpgradeOn(board({ hand: ['SHD_226'], units: [unit('l', 'GRD', { isLeader: true })] }), 'l')).toBe(false)
    const s = board({ units: [host('h', 'DEAR', ['SHD_226'], {}, 'opponent')] }, { resources: [] })
    const collected = answer(defeatUnit(s, 'h'))
    const played = answer(collected)
    const taken = played.players.opponent.units.find(x => x.cardId === 'DEAR')
    expect(taken?.exhausted).toBe(false)
    const regroup = toRegroup(played)
    expect(regroup.players.opponent.units.some(x => x.cardId === 'DEAR')).toBe(false)
    expect(regroup.players.player.discard).toContain('DEAR') // its owner's discard pile
  })
})

describe('Granted by an event or another unit', () => {
  it('SEC_231 Implicate: a unit gains Sentinel and "When this unit is attacked: Create a Spy token" for this phase', () => {
    const s = board({ hand: ['SEC_231'], units: [unit('f', 'BIG')] }, { units: [unit('e', 'GRD')] })
    const done = answer(resolve(s, { type: 'playEvent', handIndex: 0 }), { targetInstanceId: 'f' })
    expect(unitHasKeyword(done, U(done, 'f')!, 'Sentinel')).toBe(true)
    const attacked = attackUnit(done, 'e', 'f', 'opponent')
    expect(attacked.players.player.units.filter(x => x.cardId === TOKEN_SPY)).toHaveLength(1)
  })

  it('LOF_205 Force Speed: the attacker returns any number of non-unique upgrades on the defender to their owners\' hands', () => {
    const s = board({ hand: ['LOF_205'], units: [unit('a', 'BIG')] }, { units: [host('e', 'BIG', ['UPG', 'UNIQUP', 'UPG'], {}, 'opponent')] })
    let next = attackChoice(resolve(s, { type: 'playEvent', handIndex: 0 }), 'a', 'e')
    const offered = choice(next)
    expect(JSON.stringify(offered)).not.toContain('UNIQUP')
    next = answer(next, { optionIndex: 0 })
    next = answer(next, { optionIndex: 0 })
    expect(next.players.opponent.hand.filter(c => c === 'UPG')).toHaveLength(2)
  })

  it('TWI_129 In Defense of Kamino: each friendly Republic unit gains Restore 2 and a Clone Trooper when defeated, this phase', () => {
    const s = board({ hand: ['TWI_129'], units: [unit('r', 'REPUBLIC'), unit('g', 'GRD')] })
    const done = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(unitKeywordValue(done, U(done, 'r')!, 'Restore')).toBe(2)
    expect(unitHasKeyword(done, U(done, 'g')!, 'Restore')).toBe(false)
    expect(defeatUnit(done, 'r').players.player.units.map(x => x.cardId)).toContain(TOKEN_CLONE_TROOPER)
    expect(defeatUnit(done, 'g').players.player.units.map(x => x.cardId)).not.toContain(TOKEN_CLONE_TROOPER)
  })

  it('TWI_103 Pyrrhic Assault: each friendly unit gains "When Defeated: Deal 2 damage to an enemy unit" for this phase', () => {
    const s = board({ hand: ['TWI_103'], units: [unit('f', 'GRD')] }, { units: [unit('e', 'BIG')] })
    const done = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(U(answer(defeatUnit(done, 'f'), { targetInstanceId: 'e' }), 'e')?.damage).toBe(2)
  })

  it('TWI_047 Satine Kryze: every unit, enemy ones too, may exhaust to mill an opponent half its remaining HP, rounded up', () => {
    const s = board({ units: [unit('sat', 'TWI_047'), unit('f', 'BIG', { damage: 4 })] }, { units: [unit('e', 'GRD')], deck: ['GRD', 'GRD', 'GRD', 'GRD', 'GRD'] })
    const done = useAbility(s, 'f', 'TWI_047')
    expect(U(done, 'f')?.exhausted).toBe(true)
    expect(done.players.opponent.discard).toHaveLength(3) // 5 remaining HP, halved and rounded up
    const theirs = board({ units: [unit('sat', 'TWI_047')], deck: ['GRD', 'GRD', 'GRD'] }, { units: [unit('e', 'WEAK')] })
    const enemyUse = useAbility({ ...theirs, activePlayer: 'opponent' }, 'e', 'TWI_047')
    expect(enemyUse.players.player.discard).toHaveLength(1)
    expect(legalMoves(board({ units: [unit('f', 'GRD')] })).some(m => m.type === 'useAbility')).toBe(false)
  })

  it('SOR_105 General Krell: each other friendly unit gains "When Defeated: You may draw a card"', () => {
    const s = board({ units: [unit('k', 'SOR_105'), unit('f', 'GRD')], deck: ['BIG', 'GRD2'] }, { units: [unit('e', 'GRD')], deck: ['BIG'] })
    expect(answer(defeatUnit(s, 'f')).players.player.hand).toEqual(['BIG'])
    noChoice(defeatUnit(s, 'e'))
  })
})
