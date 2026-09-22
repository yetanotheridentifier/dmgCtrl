import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves, zoneCardOwner } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { addResource, defeatResource, returnResourceToHand } from '../engine/effects'
import { describeAction } from '../utils/describeAction'
import { describeChoiceParts } from '../utils/describeChoice'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PhaseEvents, PlayerId, ResourceState, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * The resource zone as something cards change: resources defeated, returned to hand, and cards put
 * into play as resources, including cards another player owns.
 *
 * CR 1.7.5: a resource may be owned by an opponent, and that is open information. A defeated resource
 * goes to its OWNER's discard pile (CR 1.x "a resource is defeated when an ability defeats it"), and
 * one returned to hand goes to its owner's hand. CR 1.7.4: only the counts of ready and exhausted
 * resources are game state, so a resource leaving the zone is one of the exhausted ones whenever any
 * is, unless the card says it must be a ready one (Greater Sarlacc).
 */

const POOL = poolFor(['SOR', 'SHD', 'TWI', 'SEC', 'LAW', 'HMW', 'TS26'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && Number(c.Number) === Number(number) && (c.VariantType == null || c.VariantType === 'Normal'))
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return { ...normaliseCard(row), id }
}

const IDS = [
  'HMW_049', 'HMW_188', 'HMW_023', 'SEC_242', 'SHD_102', 'SOR_197', 'TS26_12', 'LAW_029', 'LAW_159', 'SEC_215', 'TS26_76',
  'SHD_009', 'SHD_105', 'SHD_114', 'SHD_154', 'SHD_214', 'SOR_017', 'TWI_177', 'SHD_122', 'SEC_008',
]
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(IDS.map(id => [id, real(id)])),
  G3: card({ id: 'G3', arena: 'ground', cost: 3, power: 3, hp: 3 }),
  G9: card({ id: 'G9', arena: 'ground', cost: 3, power: 1, hp: 9 }),
  S3: card({ id: 'S3', arena: 'space', cost: 3, power: 3, hp: 3 }),
  BIGS: card({ id: 'BIGS', arena: 'space', cost: 3, power: 10, hp: 20 }),
  UNIQ: card({ id: 'UNIQ', name: 'Wrecker', arena: 'ground', cost: 3, power: 3, hp: 3, unique: true }),
  NONU: card({ id: 'NONU', name: 'Tech', arena: 'ground', cost: 3, power: 3, hp: 3, unique: false }),
  WRECKER_R: card({ id: 'WRECKER_R', name: 'Wrecker', arena: 'ground', cost: 3, power: 3, hp: 3 }),
  TECH_R: card({ id: 'TECH_R', name: 'Tech', arena: 'ground', cost: 3, power: 3, hp: 3 }),
  SMUG: card({ id: 'SMUG', arena: 'ground', cost: 3, power: 3, hp: 3, keywords: [{ name: 'Smuggle' }] }),
  EV: card({ id: 'EV', type: 'event', cost: 1 }),
  LEADU: card({ id: 'LEADU', type: 'leader', cost: 5, power: 4, hp: 7 }),
  // With the fixture leader's Command and Heroism, no card here pays an aspect penalty.
  ASP_B: card({ id: 'ASP_B', type: 'base', hp: 30, aspects: ['Cunning', 'Aggression', 'Villainy'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const res = (...ids: string[]): ResourceState[] => ids.map(cardId => ({ cardId, exhausted: false }))
const spent = (...ids: string[]): ResourceState[] => ids.map(cardId => ({ cardId, exhausted: true }))

type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}): GameState => state({
  cards: F,
  players: {
    player: player({ resources: ready(8), deck: ['D1', 'D2', 'D3'], base: { cardId: 'ASP_B', damage: 0 }, ...mine }),
    opponent: player({ resources: ready(4), deck: ['E1', 'E2', 'E3'], ...theirs }),
  },
  ...over,
})
const choice = (s: GameState): PendingChoice => {
  const c = s.pendingChoices?.[0]
  if (!c) throw new Error('no pending choice')
  return c
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toEqual([])
const accept = (s: GameState, extra: Partial<Extract<Action, { type: 'acceptChoice' }>> = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const answers = (s: GameState) => legalMoves(s).filter(m => m.type === 'acceptChoice' || m.type === 'skipTrigger')
const canDecline = (s: GameState) => answers(s).some(m => m.type === 'skipTrigger')
const offers = (s: GameState): string[] => { const c = choice(s); return c.kind === 'selectCardThen' ? c.candidates : [] }
const pickCard = (s: GameState, cardId: string) => accept(s, { optionIndex: offers(s).indexOf(cardId) })
const readyOf = (s: GameState, p: PlayerId) => s.players[p].resources.filter(r => !r.exhausted).length
const ids = (s: GameState, p: PlayerId) => s.players[p].resources.map(r => r.cardId)
const playUnit = (s: GameState, cardId: string) => resolve(s, { type: 'playUnit', handIndex: s.players.player.hand.indexOf(cardId) })
const emptyEvents = (): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, leaderLeftPlay: [], played: { player: [], opponent: [] },
})
const toRegroup = (s: GameState) => resolve(resolve(s, { type: 'pass' }), { type: 'pass' })
const toNextRound = (s: GameState) => resolve(resolve(s, { type: 'skipResource' }), { type: 'skipResource' })

describe('resource primitives', () => {
  it("a defeated resource goes to its owner's discard pile, and one an opponent owns goes to theirs", () => {
    const s0 = board({ resources: [{ cardId: 'MINE', exhausted: true }, { cardId: 'THEIRS', exhausted: true, owner: 'opponent' }] })
    let s = defeatResource(s0, 'player', 1)
    expect(ids(s, 'player')).toEqual(['MINE'])
    expect(s.players.opponent.discard).toEqual(['THEIRS'])
    s = defeatResource(s, 'player', 0)
    expect(s.players.player.discard).toEqual(['MINE'])
  })

  it("a returned resource goes to its owner's hand", () => {
    const s = returnResourceToHand(board({ resources: [{ cardId: 'THEIRS', exhausted: false, owner: 'opponent' }] }), 'player', 0)
    expect(s.players.player.resources).toEqual([])
    expect(s.players.opponent.hand).toEqual(['THEIRS'])
  })

  it('a resource leaving the zone is an exhausted one while any is (CR 1.7.4), so the ready count holds', () => {
    const s = defeatResource(board({ resources: [...res('A'), ...spent('B')] }), 'player', 0)
    expect(s.players.player.resources).toEqual([{ cardId: 'B', exhausted: false }])
    expect(s.players.player.discard).toEqual(['A'])
  })

  it('a resource that must be a ready one lowers the ready count whichever card it is', () => {
    const s = defeatResource(board({ resources: [...res('A'), ...spent('B')] }), 'player', 1, { ready: true })
    expect(s.players.player.resources).toEqual([{ cardId: 'A', exhausted: true }])
  })

  it('a card put into play as a resource is exhausted unless the card says ready, and records an owner only where it differs', () => {
    let s = addResource(board({ resources: [] }), 'player', 'X', 'opponent')
    s = addResource(s, 'player', 'Y', 'player', true)
    expect(s.players.player.resources).toEqual([{ cardId: 'X', exhausted: true, owner: 'opponent' }, { cardId: 'Y', exhausted: false }])
  })

  it('a card played out of the resource zone belongs to whoever owns the resource', () => {
    const s = board({ resources: [...res('A'), { cardId: 'B', exhausted: false, owner: 'opponent' }] })
    expect(zoneCardOwner(s, 'player', 'resources', 0)).toBe('player')
    expect(zoneCardOwner(s, 'player', 'resources', 1)).toBe('opponent')
  })
})

describe('Greater Sarlacc (HMW_049): defeating ready resources while playing it, 3 less each', () => {
  it('is playable when defeating ready resources could pay for it: 3 ready resources play a 9-cost unit for nothing', () => {
    expect(legalMoves(board({ hand: ['HMW_049'], resources: ready(3) }))).toContainEqual({ type: 'playUnit', handIndex: 0 })
    // 2 ready: defeating both leaves 3 to pay with none ready; defeating 1 leaves 6 with 1 ready.
    expect(legalMoves(board({ hand: ['HMW_049'], resources: [...ready(2), ...spent('S1', 'S2', 'S3')] }))).not.toContainEqual({ type: 'playUnit', handIndex: 0 })
  })

  it('asks for resources before paying, offers Done once the rest is affordable, and pays what is left', () => {
    const s0 = board({ hand: ['HMW_049'], resources: [...res('A', 'B', 'C', 'D', 'E'), ...spent('X')] })
    let s = playUnit(s0, 'HMW_049')
    expect(choice(s)).toMatchObject({ kind: 'exploit', resources: true, cardId: 'HMW_049', discount: 3, limit: 5 })
    expect(s.players.player.hand).toEqual(['HMW_049'])
    expect(canDecline(s)).toBe(false) // 9 > 5
    s = accept(s, { optionIndex: 0 }) // A: 6 left, 4 ready
    expect(canDecline(s)).toBe(false)
    s = accept(s, { optionIndex: 1 }) // B: 3 left, 3 ready
    expect(canDecline(s)).toBe(true)
    s = skip(s)
    noChoice(s)
    expect(s.players.player.units.map(u => u.cardId)).toContain('HMW_049')
    expect(s.players.player.discard.sort()).toEqual(['A', 'B'])
    expect(s.players.player.resources).toHaveLength(4)
    expect(readyOf(s, 'player')).toBe(0)
  })

  it('may name an exhausted card, which still costs a ready resource', () => {
    let s = playUnit(board({ hand: ['HMW_049'], resources: [...res('A', 'B', 'C'), ...spent('X')] }), 'HMW_049')
    const at = s.players.player.resources.findIndex(r => r.cardId === 'X')
    s = accept(s, { optionIndex: at })
    expect(choice(s)).toMatchObject({ kind: 'exploit', picks: [String(at)] })
    s = accept(accept(s, { optionIndex: 0 }), { optionIndex: 1 })
    noChoice(s)
    expect(s.players.player.discard.sort()).toEqual(['A', 'B', 'X'])
    expect(s.players.player.resources).toEqual([{ cardId: 'C', exhausted: true }])
  })

  it('names each resource on its menu button, since facedown resources are not on the board', () => {
    const s = playUnit(board({ hand: ['HMW_049'], resources: res('G3', 'S3', 'G9') }), 'HMW_049')
    const buttons = answers(s).map(a => describeAction(s, 'player', a))
    expect(buttons).toEqual(['Defeat G3', 'Defeat S3', 'Defeat G9'])
    expect(describeChoiceParts(s, choice(s)).filter(p => typeof p === 'string').join('')).toMatch(/ready resources you control/)
  })

  it('offers nothing to defeat when no resource is ready, so the play pays in full', () => {
    const s = board({ hand: ['HMW_049'], resources: spent('X') })
    expect(legalMoves(s)).not.toContainEqual({ type: 'playUnit', handIndex: 0 })
  })
})

describe('Giant Gorax (HMW_188): with an Endor base, each opponent chooses one', () => {
  const gorax = (mine: Side = {}, theirs: Side = {}) => board({
    base: { cardId: 'HMW_023', damage: 0 }, units: [unit('gx', 'HMW_188')], ...mine,
  }, { units: [unit('e1', 'G9')], hand: ['H1', 'H2'], resources: [...res('R1'), ...spent('R2')], ...theirs })
  const attack = (s: GameState) => resolve(s, { type: 'attack', attackerId: 'gx', target: { kind: 'base' } })

  it('the opponent picks: 3 damage to a unit or base of theirs, chosen by Gorax\'s controller', () => {
    let s = attack(gorax())
    expect(choice(s)).toMatchObject({ kind: 'chooseMode', controller: 'opponent' })
    s = accept(s, { optionIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', controller: 'player', amount: 3, unitTargets: ['e1'], baseTargets: ['opponent'] })
    s = accept(s, { targetInstanceId: 'e1' })
    expect(s.players.opponent.units[0].damage).toBe(3)
  })

  it('or they discard a card and defeat a resource they control, both of their choosing', () => {
    let s = accept(attack(gorax()), { optionIndex: 1 })
    expect(choice(s)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent', count: 1 })
    s = accept(s, { handIndex: 1 })
    expect(s.players.opponent.discard).toEqual(['H2'])
    expect(choice(s)).toMatchObject({ kind: 'selectCardThen', controller: 'opponent', candidates: ['R1', 'R2'] })
    expect(canDecline(s)).toBe(false)
    s = pickCard(s, 'R1')
    expect(s.players.opponent.discard).toEqual(['H2', 'R1'])
    expect(s.players.opponent.resources).toEqual([{ cardId: 'R2', exhausted: false }])
  })

  it('also fires when it is defeated', () => {
    let s = resolve(gorax({ units: [unit('gx', 'HMW_188', { damage: 6 })] }, { units: [unit('e1', 'BIGS', { arena: 'ground' })] }),
      { type: 'attack', attackerId: 'gx', target: { kind: 'unit', instanceId: 'e1' } })
    // On Attack first, then its own defeat in the counter-attack.
    expect(choice(s)).toMatchObject({ kind: 'chooseMode', controller: 'opponent' })
    s = accept(accept(s, { optionIndex: 0 }), { baseTarget: 'opponent' })
    expect(s.players.player.units.some(u => u.instanceId === 'gx')).toBe(false)
    expect(choice(s)).toMatchObject({ kind: 'chooseMode', controller: 'opponent' })
  })

  it('does nothing without an Endor base', () => {
    noChoice(attack(gorax({ base: { cardId: 'TST_B', damage: 0 } })))
  })
})

describe('resources defeated or returned by When Played units', () => {
  it('Elia Kane (SEC_242) looks at 3 enemy resources and may defeat 1; its controller resources their top card ready', () => {
    let s = playUnit(board({ hand: ['SEC_242'] }, { resources: [...res('R1'), ...spent('R2')] }), 'SEC_242')
    expect(choice(s)).toMatchObject({ kind: 'selectCardThen', controller: 'player' })
    expect(offers(s).sort()).toEqual(['R1', 'R2'])
    expect(canDecline(s)).toBe(true)
    s = pickCard(s, 'R2')
    expect(s.players.opponent.discard).toEqual(['R2'])
    expect(s.players.opponent.resources).toEqual([{ cardId: 'R1', exhausted: false }, { cardId: 'E1', exhausted: false }])
  })

  it('Elia Kane sees only 3 of a larger zone', () => {
    const s = playUnit(board({ hand: ['SEC_242'] }, { resources: res('R1', 'R2', 'R3', 'R4', 'R5') }), 'SEC_242')
    expect(offers(s)).toHaveLength(3)
  })

  it('The Marauder (SHD_102) puts a card from your discard pile into play as a resource if it shares a name with a unit you control', () => {
    let s = playUnit(board({ hand: ['SHD_102'], units: [unit('w', 'UNIQ')], discard: ['WRECKER_R', 'TECH_R'] }), 'SHD_102')
    expect(offers(s)).toEqual(['WRECKER_R'])
    s = pickCard(s, 'WRECKER_R')
    expect(s.players.player.discard).toEqual(['TECH_R'])
    expect(s.players.player.resources.at(-1)).toEqual({ cardId: 'WRECKER_R', exhausted: true })
  })

  it('Lando Calrissian (SOR_197) returns up to 2 friendly resources to their owners\' hands', () => {
    let s = playUnit(board({ hand: ['SOR_197'], resources: [...res('A', 'B', 'C', 'D', 'E', 'F'), { cardId: 'T', exhausted: false, owner: 'opponent' }] }), 'SOR_197')
    expect(canDecline(s)).toBe(true)
    s = pickCard(s, 'T')
    expect(s.players.opponent.hand).toEqual(['T'])
    s = pickCard(s, 'A')
    noChoice(s)
    expect(s.players.player.hand).toEqual(['A'])
    expect(s.players.player.resources).toHaveLength(5)
  })

  it('Lando may stop after one', () => {
    let s = playUnit(board({ hand: ['SOR_197'] }), 'SOR_197')
    s = skip(pickCard(s, 'R0'))
    noChoice(s)
    expect(s.players.player.hand).toEqual(['R0'])
  })

  it('Scanning Officer (SHD_114) defeats each revealed Smuggle resource; its controller resources their top card for each', () => {
    const s = playUnit(board({ hand: ['SHD_114'] }, { resources: [...res('SMUG'), ...res('R1')] }), 'SHD_114')
    noChoice(s)
    expect(s.players.opponent.discard).toEqual(['SMUG'])
    expect(ids(s, 'opponent').sort()).toEqual(['E1', 'R1'])
    expect(s.players.opponent.resources.find(r => r.cardId === 'E1')?.exhausted).toBe(true)
  })

  it('Wrecker (SHD_154) may defeat a friendly resource to deal 5 damage to a ground unit', () => {
    let s = playUnit(board({ hand: ['SHD_154'] }, { units: [unit('e', 'G9'), unit('sp', 'S3')] }), 'SHD_154')
    expect(canDecline(s)).toBe(true)
    s = pickCard(s, 'R7')
    expect(s.players.player.discard).toEqual(['R7'])
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 5 })
    expect((choice(s) as Extract<PendingChoice, { kind: 'selectDamageTarget' }>).unitTargets).not.toContain('sp')
    s = accept(s, { targetInstanceId: 'e' })
    expect(s.players.opponent.units.find(u => u.instanceId === 'e')?.damage).toBe(5)
  })

  it('Wrecker declined does nothing', () => {
    const s = skip(playUnit(board({ hand: ['SHD_154'] }, { units: [unit('e', 'G9')] }), 'SHD_154'))
    noChoice(s)
    expect(s.players.opponent.units[0].damage).toBe(0)
  })

  it('Frontier Trader (SHD_214) may return a resource, then may resource the top card of the deck', () => {
    let s = playUnit(board({ hand: ['SHD_214'] }), 'SHD_214')
    s = pickCard(s, 'R0')
    expect(s.players.player.hand).toEqual(['R0'])
    expect(choice(s)).toMatchObject({ kind: 'mayResourceTop' })
    s = accept(s)
    expect(ids(s, 'player')).toContain('D1')
  })
})

describe('When Defeated', () => {
  const killed = (cardId: string, mine: Side = {}) => {
    const s0 = board({ units: [unit('a', 'BIGS', { arena: 'space' })], ...mine }, { units: [unit('v', cardId, { arena: 'space' })] })
    return resolve(s0, { type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'v' } })
  }

  it('Expendable Mercenary (LAW_159) may resource itself from its owner\'s discard pile', () => {
    let s = killed('LAW_159')
    expect(choice(s)).toMatchObject({ controller: 'opponent' })
    s = accept(s)
    expect(s.players.opponent.discard).toEqual([])
    expect(s.players.opponent.resources.at(-1)).toEqual({ cardId: 'LAW_159', exhausted: true })
  })

  it("Expendable Mercenary under a thief's control is resourced by that player, still owned by its owner", () => {
    const s0 = board({ units: [unit('v', 'LAW_159', { owner: 'opponent' })] }, { units: [unit('a', 'BIGS', { arena: 'ground' })] })
    let s = resolve(s0, { type: 'attack', attackerId: 'v', target: { kind: 'unit', instanceId: 'a' } })
    expect(choice(s)).toMatchObject({ controller: 'player' })
    s = accept(s)
    expect(s.players.opponent.discard).toEqual([])
    expect(s.players.player.resources.at(-1)).toEqual({ cardId: 'LAW_159', exhausted: true, owner: 'opponent' })
  })

  it("Emissary's Sheathipede (SEC_215) and Wartime Profiteer (TS26_76) let each opponent ready a resource", () => {
    for (const id of ['SEC_215', 'TS26_76']) {
      let s = killed(id, { resources: spent('A', 'B') })
      expect(choice(s)).toMatchObject({ kind: 'mayPayThen', controller: 'player' })
      s = accept(s)
      expect(readyOf(s, 'player')).toBe(1)
    }
  })
})

describe('Arquitens Assault Cruiser (SHD_122): the unit it defeats becomes its resource', () => {
  it('puts a defeated non-leader unit into play as a resource under your control, owned by its owner', () => {
    const s0 = board({ units: [unit('aq', 'SHD_122')] }, { units: [unit('v', 'S3')] })
    const s = resolve(s0, { type: 'attack', attackerId: 'aq', target: { kind: 'unit', instanceId: 'v' } })
    expect(s.players.opponent.discard).toEqual([])
    expect(s.players.player.resources.at(-1)).toEqual({ cardId: 'S3', exhausted: true, owner: 'opponent' })
  })

  it('does not take a leader unit', () => {
    const s0 = board({ units: [unit('aq', 'SHD_122')] }, { units: [unit('v', 'LEADU', { isLeader: true, arena: 'space' })], leader: { cardId: 'LEADU', deployed: true, epicActionUsed: true, exhausted: false } })
    const s = resolve({ ...s0, cards: { ...F, LEADU: { ...F.LEADU, hp: 3 } } }, { type: 'attack', attackerId: 'aq', target: { kind: 'unit', instanceId: 'v' } })
    expect(s.players.player.resources).toHaveLength(8)
  })

  it("a resource taken this way goes back to its owner's discard pile when it is defeated", () => {
    const s0 = board({ units: [unit('aq', 'SHD_122')] }, { units: [unit('v', 'S3')] })
    let s = resolve(s0, { type: 'attack', attackerId: 'aq', target: { kind: 'unit', instanceId: 'v' } })
    s = defeatResource(s, 'player', s.players.player.resources.length - 1)
    expect(s.players.opponent.discard).toEqual(['S3'])
  })
})

describe('events', () => {
  it('Spark of Hope (SHD_105) resources a unit from your discard pile if it was defeated this phase', () => {
    const s0 = board({ hand: ['SHD_105'], discard: ['G3', 'S3'] }, {}, { phaseEvents: { ...emptyEvents(), defeated: { player: ['S3'], opponent: [] } } })
    let s = resolve(s0, { type: 'playEvent', handIndex: 0 })
    expect(offers(s)).toEqual(['G3', 'S3'])
    s = pickCard(s, 'S3')
    expect(s.players.player.resources.at(-1)).toEqual({ cardId: 'S3', exhausted: true })
    expect(s.players.player.discard).toEqual(['G3', 'SHD_105'])
  })

  it('Spark of Hope does nothing with a unit that was not defeated this phase', () => {
    let s = resolve(board({ hand: ['SHD_105'], discard: ['G3'] }), { type: 'playEvent', handIndex: 0 })
    s = pickCard(s, 'G3')
    expect(s.players.player.discard).toEqual(['G3', 'SHD_105'])
    expect(s.players.player.resources).toHaveLength(8)
  })

  it('Guerilla Insurgency (TWI_177): each player defeats a resource and discards 2, then 4 damage to each ground unit', () => {
    const s0 = board({ hand: ['TWI_177', 'H1', 'H2', 'H3'], units: [unit('g', 'G9'), unit('sp', 'S3')] },
      { hand: ['O1', 'O2'], units: [unit('e', 'G9')], resources: res('Q1', 'Q2') })
    let s = resolve(s0, { type: 'playEvent', handIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'selectCardThen', controller: 'player' })
    s = pickCard(s, 'R7')
    expect(choice(s)).toMatchObject({ kind: 'selectDiscard', controller: 'player', count: 2 })
    s = accept(accept(s, { handIndex: 0 }), { handIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'selectCardThen', controller: 'opponent' })
    s = pickCard(s, 'Q2')
    expect(choice(s)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent', count: 2 })
    s = accept(accept(s, { handIndex: 0 }), { handIndex: 0 })
    noChoice(s)
    expect(s.players.player.discard).toEqual(expect.arrayContaining(['R7', 'H1', 'H2', 'TWI_177']))
    expect(s.players.opponent.discard.sort()).toEqual(['O1', 'O2', 'Q2'])
    expect(s.players.player.units.find(u => u.instanceId === 'g')?.damage).toBe(4)
    expect(s.players.player.units.find(u => u.instanceId === 'sp')?.damage).toBe(0)
    expect(s.players.opponent.units[0].damage).toBe(4)
  })
})

describe('bases', () => {
  it('Citadel Research Center (LAW_029): pay 1, return a friendly resource to its owner\'s hand, resource the top card', () => {
    const s0 = board({ base: { cardId: 'LAW_029', damage: 0 }, resources: res('A', 'B') })
    expect(legalMoves(s0)).toContainEqual({ type: 'useBaseAbility' })
    let s = resolve(s0, { type: 'useBaseAbility' })
    expect(offers(s)).toEqual(['A', 'B'])
    s = pickCard(s, 'B')
    expect(s.players.player.hand).toEqual(['B'])
    // Paying 1 exhausted one of the two; the one returned counts as that exhausted one (CR 1.7.4).
    expect(s.players.player.resources).toEqual([{ cardId: 'A', exhausted: false }, { cardId: 'D1', exhausted: true }])
  })

  it('Citadel Research Center is not offered without a resource to pay', () => {
    expect(legalMoves(board({ base: { cardId: 'LAW_029', damage: 0 }, resources: spent('A') }))).not.toContainEqual({ type: 'useBaseAbility' })
  })

  it('Sundari Palace (TS26_12): for each friendly leader unit, may resource a hand card ready; that many are defeated as the regroup phase starts', () => {
    const s0 = board({
      base: { cardId: 'TS26_12', damage: 0 }, hand: ['H1', 'H2'], resources: res('A', 'B'),
      units: [unit('lu', 'LEADU', { isLeader: true })], leader: { cardId: 'LEADU', deployed: true, epicActionUsed: true, exhausted: false },
    })
    let s = resolve(s0, { type: 'useBaseAbility' })
    expect(choice(s)).toMatchObject({ kind: 'selectHandCardThen' })
    expect(canDecline(s)).toBe(true)
    s = accept(s, { handIndex: 1 })
    noChoice(s)
    expect(s.players.player.resources.at(-1)).toEqual({ cardId: 'H2', exhausted: false })
    s = toRegroup(s)
    expect(choice(s)).toMatchObject({ kind: 'selectCardThen', controller: 'player' })
    expect(offers(s).sort()).toEqual(['A', 'B', 'H2'])
    s = pickCard(s, 'A')
    expect(s.players.player.discard).toEqual(['A'])
    expect(s.players.player.resources).toHaveLength(2)
  })

  it('Sundari Palace is not offered without a friendly leader unit', () => {
    expect(legalMoves(board({ base: { cardId: 'TS26_12', damage: 0 }, hand: ['H1'] }))).not.toContainEqual({ type: 'useBaseAbility' })
  })
})

describe('leaders', () => {
  it('Hunter (SHD_009) front: pay 1, reveal a resource; one sharing a name with a friendly unique unit goes to hand and the top card is resourced', () => {
    const s0 = board({ leader: { cardId: 'SHD_009', deployed: false, epicActionUsed: false, exhausted: false }, units: [unit('w', 'UNIQ'), unit('t', 'NONU')], resources: res('WRECKER_R', 'TECH_R') })
    let s = resolve(s0, { type: 'useLeaderAbility', index: 0 })
    expect(offers(s)).toEqual(['WRECKER_R', 'TECH_R'])
    s = pickCard(s, 'WRECKER_R')
    expect(s.players.player.hand).toEqual(['WRECKER_R'])
    expect(ids(s, 'player')).toEqual(['TECH_R', 'D1'])
    expect(s.players.player.leader.exhausted).toBe(true)
  })

  it('Hunter front: a resource named like a non-unique unit stays', () => {
    const s0 = board({ leader: { cardId: 'SHD_009', deployed: false, epicActionUsed: false, exhausted: false }, units: [unit('t', 'NONU')], resources: res('TECH_R', 'X') })
    const s = pickCard(resolve(s0, { type: 'useLeaderAbility', index: 0 }), 'TECH_R')
    expect(s.players.player.hand).toEqual([])
    expect(ids(s, 'player')).toEqual(['TECH_R', 'X'])
  })

  it('Hunter back: On Attack, may reveal a resource the same way', () => {
    const s0 = board({
      leader: { cardId: 'SHD_009', deployed: true, epicActionUsed: true, exhausted: false },
      units: [unit('h', 'SHD_009', { isLeader: true }), unit('w', 'UNIQ')], resources: res('WRECKER_R', 'X'),
    })
    let s = resolve(s0, { type: 'attack', attackerId: 'h', target: { kind: 'base' } })
    expect(canDecline(s)).toBe(true)
    s = pickCard(s, 'WRECKER_R')
    expect(s.players.player.hand).toEqual(['WRECKER_R'])
  })

  it('Han Solo (SOR_017) front: a hand card becomes a ready resource, and a resource is defeated at the start of the next action phase', () => {
    const s0 = board({ leader: { cardId: 'SOR_017', deployed: false, epicActionUsed: false, exhausted: false }, hand: ['H1'], resources: res('A') })
    let s = resolve(s0, { type: 'useLeaderAbility', index: 0 })
    s = accept(s, { handIndex: 0 })
    expect(s.players.player.resources).toEqual([{ cardId: 'A', exhausted: false }, { cardId: 'H1', exhausted: false }])
    s = toNextRound(toRegroup({ ...s, activePlayer: 'player' }))
    expect(s.phase).toBe('action')
    expect(choice(s)).toMatchObject({ kind: 'selectCardThen', controller: 'player' })
    s = pickCard(s, 'H1')
    expect(s.players.player.discard).toEqual(['H1'])
    // Answering it hands play to the initiative holder, as it would have been before the choice.
    expect(s.activePlayer).toBe(s.initiative)
  })

  it('Han Solo back: On Attack resources the top card of the deck ready, with the same delayed defeat', () => {
    const s0 = board({
      leader: { cardId: 'SOR_017', deployed: true, epicActionUsed: true, exhausted: false },
      units: [unit('h', 'SOR_017', { isLeader: true })], resources: res('A'),
    })
    const s = resolve(s0, { type: 'attack', attackerId: 'h', target: { kind: 'base' } })
    expect(s.players.player.resources).toEqual([{ cardId: 'A', exhausted: false }, { cardId: 'D1', exhausted: false }])
    expect(s.delayedEffects).toEqual([expect.objectContaining({ cardId: 'SOR_017', when: 'actionPhaseStart' })])
  })

  it('Bail Organa (SEC_008) front: once a friendly unit was defeated this phase, pay 1 to swap a resource for the top card', () => {
    const lead = { leader: { cardId: 'SEC_008', deployed: false, epicActionUsed: false, exhausted: false }, resources: res('A', 'B') }
    expect(legalMoves(board(lead)).some(a => a.type === 'useLeaderAbility')).toBe(false)
    const s0 = board(lead, {}, { phaseEvents: { ...emptyEvents(), defeated: { player: ['G3'], opponent: [] } } })
    let s = resolve(s0, { type: 'useLeaderAbility', index: 0 })
    s = pickCard(s, 'A')
    expect(s.players.player.hand).toEqual(['A'])
    expect(ids(s, 'player')).toEqual(['B', 'D1'])
  })

  it('Bail Organa back: playing a card out of your resources heals 1 from your base; a play from hand does not', () => {
    const bail = (pending: PendingChoice[] = [], hand: string[] = []) => board({
      leader: { cardId: 'SEC_008', deployed: true, epicActionUsed: true, exhausted: false }, base: { cardId: 'ASP_B', damage: 3 },
      units: [unit('b', 'SEC_008', { isLeader: true })], resources: [...res('G3'), ...ready(4)], hand,
    }, {}, { pendingChoices: pending })
    const fromResources = accept(bail([{ kind: 'playCardFrom', id: 'c', controller: 'player', zone: 'resources', candidates: [{ index: 0, cardId: 'G3' }] }]), { optionIndex: 0 })
    expect(fromResources.players.player.units.map(u => u.cardId)).toContain('G3')
    expect(fromResources.players.player.base.damage).toBe(2)
    const fromHand = resolve(bail([], ['G3']), { type: 'playUnit', handIndex: 0 })
    expect(fromHand.players.player.base.damage).toBe(3)
  })
})
