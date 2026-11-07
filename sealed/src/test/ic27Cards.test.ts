import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { unitHasKeyword } from '../engine/keywords'
import { defeatUnit } from '../engine/combat'
import { effectiveHp, effectivePower } from '../engine/stats'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { getCardDefinition } from '../engine/abilities'
import { IMPLEMENTED_EVENTS, IMPLEMENTED_UNITS } from '../data/implementedCards'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_EXPERIENCE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PendingChoice, PhaseEvents, UnitState } from '../engine/types'

/** IC27's own units and events that the engine's existing effects express. */
const POOL = poolFor(['IC27'])
const real = (id: string): EngineCard => {
  const number = id.split('_')[1]
  const row = POOL.find(c => String(c.Number).padStart(3, '0') === number)
  if (!row) throw new Error(`${id} is not in the IC27 fixture`)
  return { ...normaliseCard(row), id }
}
const BUILT = ['IC27_022', 'IC27_024', 'IC27_071', 'IC27_079', 'IC27_099', 'IC27_103', 'IC27_146', 'IC27_187', 'IC27_166', 'IC27_168']
const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 3, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(BUILT.map(id => [id, real(id)])),
  PLAIN: src('PLAIN'),
  TOUGH: src('TOUGH', { power: 1, hp: 9 }),
  IMP: src('IMP', { traits: ['IMPERIAL'] }),
  BIG: src('BIG', { cost: 6 }),
}
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState => fixtureUnit(instanceId, cardId, { arena: 'ground', ...over })
type Side = Parameters<typeof player>[0]
const rich = (over: Side = {}) => player({ resources: ready(20), deck: ['PLAIN', 'PLAIN', 'PLAIN'], ...over })
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
type Extra = Partial<Extract<Action, { type: 'acceptChoice' }>>
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
const declinable = (s: GameState) => legalMoves(s).some(m => m.type === 'skipTrigger')
const unitOffers = (s: GameState) =>
  [...new Set(legalMoves(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : [])))].sort()
const play = (s: GameState, cardId: string): GameState => {
  const handIndex = s.players.player.hand.indexOf(cardId)
  return resolve(s, F[cardId].type === 'event' ? { type: 'playEvent', handIndex } : { type: 'playUnit', handIndex })
}
const attackUnit = (s: GameState, attackerId: string, target: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: target } })
const attackBase = (s: GameState, attackerId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' } })
const baseDamage = (s: GameState) => s.players.opponent.base.damage
const readyResources = (s: GameState) => s.players.player.resources.filter(r => !r.exhausted).length
const tokensOn = (s: GameState, id: string, token: string) => U(s, id)!.upgrades.filter(u => u.cardId === token).length
const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, leaderLeftPlay: [], played: { player: [], opponent: [] }, ...over,
})

describe('registration', () => {
  it('registers each card and lists it as built', () => {
    const built = [...IMPLEMENTED_UNITS, ...IMPLEMENTED_EVENTS]
    for (const id of BUILT) {
      expect(getCardDefinition(id), id).toBeTruthy()
      expect(built.some(c => c.id === id), id).toBe(true)
    }
  })
})

describe('IC27_022 Moff Gideon: costs 2 less if a friendly unit was defeated this phase', () => {
  it('costs 2 less after a friendly defeat, and not after an enemy one', () => {
    const full = effectiveCost(board(), 'player', F.IC27_022)
    const after = (defeated: PhaseEvents['defeated']) => effectiveCost(board({}, {}, { phaseEvents: phaseEvents({ defeated }) }), 'player', F.IC27_022)
    expect(after({ player: ['PLAIN'], opponent: [] })).toBe(full - 2)
    expect(after({ player: [], opponent: ['PLAIN'] })).toBe(full)
  })
})

describe('IC27_024 Grand Admiral Thrawn: When Played/On Attack/When Defeated, may give an Experience token and Sentinel for the phase to another friendly unit', () => {
  const given = (s: GameState, id: string) => {
    expect(unitOffers(s)).toEqual([id])
    expect(declinable(s)).toBe(true)
    const done = accept(s, { targetInstanceId: id })
    expect(tokensOn(done, id, TOKEN_EXPERIENCE)).toBe(1)
    expect(unitHasKeyword(done, U(done, id)!, 'Sentinel')).toBe(true)
    return done
  }

  it('When Played: offers another friendly unit only, and may be declined', () => {
    const s = play(board({ hand: ['IC27_024'], units: [unit('f', 'PLAIN')] }, { units: [unit('e', 'PLAIN')] }), 'IC27_024')
    given(s, 'f')
    expect(tokensOn(skip(s), 'f', TOKEN_EXPERIENCE)).toBe(0)
  })

  it('On Attack and When Defeated do the same', () => {
    given(attackBase(board({ units: [unit('t', 'IC27_024'), unit('f', 'PLAIN')] }), 't'), 'f')
    given(defeatUnit(board({ units: [unit('t', 'IC27_024'), unit('f', 'PLAIN')] }), 't'), 'f')
  })

  it('the Sentinel lasts for the phase only', () => {
    const done = given(attackBase(board({ units: [unit('t', 'IC27_024'), unit('f', 'PLAIN')] }), 't'), 'f')
    const regroup = resolve(resolve(done, { type: 'pass' }), { type: 'pass' })
    expect(unitHasKeyword(regroup, U(regroup, 'f')!, 'Sentinel')).toBe(false)
  })
})

describe('IC27_071 Avar Kriss: Raid 1, and Raid 1 more for each other friendly unit', () => {
  it('deals 1 alone, and 1 more for each other friendly unit', () => {
    expect(baseDamage(attackBase(board({ units: [unit('a', 'IC27_071')] }), 'a'))).toBe(1)
    expect(baseDamage(attackBase(board({ units: [unit('a', 'IC27_071'), unit('f', 'PLAIN'), unit('g', 'PLAIN')] }, { units: [unit('e', 'PLAIN')] }), 'a'))).toBe(3)
  })
})

describe('IC27_079 Qui-Gon Jinn: When Played, another friendly unit gets +2/+2 for the phase', () => {
  it('offers another friendly unit only, and is not optional', () => {
    const s = play(board({ hand: ['IC27_079'], units: [unit('f', 'PLAIN')] }, { units: [unit('e', 'PLAIN')] }), 'IC27_079')
    expect(unitOffers(s)).toEqual(['f'])
    expect(declinable(s)).toBe(false)
    const done = accept(s, { targetInstanceId: 'f' })
    expect([effectivePower(done, U(done, 'f')!), effectiveHp(done, U(done, 'f')!)]).toEqual([4, 5])
  })
})

describe('IC27_099 Eighth Brother: When Defeated, may ready an Imperial unit', () => {
  it('offers an exhausted Imperial unit on either side, and may be declined', () => {
    const s = defeatUnit(board({ units: [unit('b', 'IC27_099'), unit('i', 'IMP', { exhausted: true }), unit('p', 'PLAIN', { exhausted: true })] }, { units: [unit('ei', 'IMP', { exhausted: true })] }), 'b')
    expect(unitOffers(s)).toEqual(['ei', 'i'])
    expect(declinable(s)).toBe(true)
    expect(U(accept(s, { targetInstanceId: 'i' }), 'i')!.exhausted).toBe(false)
  })
})

describe('IC27_103 Grand Inquisitor: Raid 3 and Saboteur while damaged', () => {
  it('has neither undamaged, and both once damaged', () => {
    const fresh = board({ units: [unit('g', 'IC27_103')] })
    expect(unitHasKeyword(fresh, U(fresh, 'g')!, 'Saboteur')).toBe(false)
    expect(baseDamage(attackBase(fresh, 'g'))).toBe(3)
    const hurt = board({ units: [unit('g', 'IC27_103', { damage: 1 })] })
    expect(unitHasKeyword(hurt, U(hurt, 'g')!, 'Saboteur')).toBe(true)
    expect(baseDamage(attackBase(hurt, 'g'))).toBe(6)
  })
})

describe('IC27_146 Boba Fett: When Attack Ends, if the defender was defeated, ready 2 resources', () => {
  const spent = () => ready(20).map((r, i) => (i < 5 ? { ...r, exhausted: true } : r))
  it('readies 2 when the defender is defeated, and none when it survives', () => {
    expect(readyResources(attackUnit(board({ units: [unit('b', 'IC27_146')], resources: spent() }, { units: [unit('e', 'PLAIN')] }), 'b', 'e'))).toBe(17)
    expect(readyResources(attackUnit(board({ units: [unit('b', 'IC27_146')], resources: spent() }, { units: [unit('e', 'TOUGH')] }), 'b', 'e'))).toBe(15)
  })
})

describe('IC27_187 Jar Jar Binks: On Attack, discard a card from your deck; +4/+0 for the attack if it costs 6 or more', () => {
  it('gets +4/+0 for a card costing 6, and nothing for a cheaper one', () => {
    const big = attackBase(board({ units: [unit('j', 'IC27_187')], deck: ['BIG', 'PLAIN'] }), 'j')
    expect(big.players.player.discard).toContain('BIG')
    expect(baseDamage(big)).toBe(5)
    expect(baseDamage(attackBase(board({ units: [unit('j', 'IC27_187')], deck: ['PLAIN', 'BIG'] }), 'j'))).toBe(1)
  })
})

describe("IC27_166 I've Got A Bad Feeling: return a non-leader unit to its owner's hand, then give a Shield token to a friendly unit", () => {
  it('returns any non-leader unit, then shields a friendly one', () => {
    const s = play(board({ hand: ['IC27_166'], units: [unit('f', 'PLAIN')] }, { units: [unit('e', 'PLAIN'), unit('el', 'TOUGH', { isLeader: true })] }), 'IC27_166')
    expect(unitOffers(s)).toEqual(['e', 'f'])
    const returned = accept(s, { targetInstanceId: 'e' })
    expect(returned.players.opponent.hand).toEqual(['PLAIN'])
    expect(choice(returned)).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_SHIELD })
    expect(unitOffers(returned)).toEqual(['f'])
    const done = accept(returned, { targetInstanceId: 'f' })
    expect(tokensOn(done, 'f', TOKEN_SHIELD)).toBe(1)
    noChoice(done)
  })
})

describe("IC27_168 Cunning Ploy: look at an opponent's hand and may discard from it, exhaust an enemy unit, then may attack with +3/+0", () => {
  const s = () => play(board({ hand: ['IC27_168'], units: [unit('f', 'PLAIN')] }, { hand: ['PLAIN', 'TOUGH'], deck: ['IMP'], units: [unit('e', 'TOUGH')] }), 'IC27_168')

  it('runs the three parts in order', () => {
    let p = s()
    expect(choice(p)).toMatchObject({ kind: 'lookAtHand', mayDiscard: true, thenDraw: true })
    p = accept(p, { handIndex: 0 })
    expect(p.players.opponent.hand).toEqual(['TOUGH', 'IMP'])
    expect(unitOffers(p)).toEqual(['e'])
    expect(declinable(p)).toBe(false)
    p = accept(p, { targetInstanceId: 'e' })
    expect(U(p, 'e')!.exhausted).toBe(true)
    expect(choice(p).kind).toBe('mayAttackAnyUnit')
    expect(declinable(p)).toBe(true)
    const done = resolve(p, { type: 'attack', attackerId: 'f', choiceId: choice(p).id, target: { kind: 'base' } })
    expect(baseDamage(done)).toBe(5)
  })

  it('a declined discard still exhausts and offers the attack', () => {
    const p = skip(s())
    expect(p.players.opponent.hand).toEqual(['PLAIN', 'TOUGH'])
    expect(unitOffers(p)).toEqual(['e'])
    expect(choice(accept(p, { targetInstanceId: 'e' })).kind).toBe('mayAttackAnyUnit')
  })
})
