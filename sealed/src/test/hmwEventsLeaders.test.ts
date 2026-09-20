import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { effectivePower } from '../engine/stats'
import { unitHasKeyword, unitKeywordValue } from '../engine/keywords'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
import { defeatUnit } from '../engine/combat'
import { TOKEN_SHIELD, hasToken } from '../engine/tokenUpgrades'
import { TOKEN_BEAST } from '../engine/tokenUnits'
import { poolFor } from '../bench/setPools'
import { REPRINTS, reprintCanonicalId } from '../data/reprints'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, LeaderState, PendingChoice, PlayerId, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Homeworlds events, leaders and the remaining trigger points.
 *
 * Most of these are registrations over primitives the other sets already built, so what each test
 * pins is the part the card itself decides: who may be chosen, whether the choice may be declined,
 * what condition gates the ability, and what the follow-up step does. The engine additions are named
 * where they are tested: an arena carried on a delayed effect, a generic follow-up on the
 * "play a unit from your hand" choice, and a trigger point for the start of the action phase.
 *
 * Printed stats, traits and keywords come from the shipped HMW fixture, post-correction.
 */

const EVENTS = [
  'HMW_050', 'HMW_054', 'HMW_098', 'HMW_099', 'HMW_101', 'HMW_102', 'HMW_114', 'HMW_149', 'HMW_151',
  'HMW_161', 'HMW_173', 'HMW_192', 'HMW_193', 'HMW_207', 'HMW_217', 'HMW_218', 'HMW_238', 'HMW_239',
  'HMW_253', 'HMW_266', 'HMW_267',
]
const UNITS = ['HMW_041', 'HMW_044', 'HMW_056', 'HMW_064', 'HMW_104', 'HMW_147', 'HMW_170', 'HMW_182', 'HMW_209', 'HMW_210']
const LEADERS = ['HMW_006', 'HMW_007', 'HMW_008', 'HMW_009', 'HMW_018']
const SHIPPED = [...EVENTS, ...UNITS, ...LEADERS]

/** Lifted to #477 by comment: each needs a mechanic no card in this batch supplies. */
const LIFTED = ['HMW_001', 'HMW_005', 'HMW_108', 'HMW_185']

const POOL = poolFor(['HMW'])
const real = (id: string, pool = POOL): EngineCard => {
  const [set, number] = id.split('_')
  const row = pool.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 8, ...over })
const base = (id: string, trait?: string) => card({ id, type: 'base', hp: 30, aspects: ['Vigilance'], traits: trait ? [trait] : [] })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  ...Object.fromEntries(LIFTED.map(id => [id, real(id)])),
  GRD: src('GRD'),
  SPC: src('SPC', { arena: 'space' }),
  BIG: src('BIG', { power: 7 }),
  MID: src('MID', { power: 4 }),
  RAID2: src('RAID2', { keywords: [{ name: 'Raid', value: 2 }] }),
  OVER: src('OVER', { power: 6, keywords: [{ name: 'Overwhelm' }] }),
  CREATURE: src('CREATURE', { traits: ['CREATURE'], cost: 2 }),
  CREATURE5: src('CREATURE5', { traits: ['CREATURE'], cost: 5 }),
  CREATURE6: src('CREATURE6', { traits: ['CREATURE'], cost: 6 }),
  REBEL: src('REBEL', { traits: ['REBEL'] }),
  TUSKEN: src('TUSKEN', { traits: ['TUSKEN'] }),
  EWOK: src('EWOK', { traits: ['EWOK'] }),
  EWOK2: src('EWOK2', { traits: ['EWOK'] }),
  HER: src('HER', { aspects: ['Heroism'] }),
  HER2: src('HER2', { aspects: ['Heroism'] }),
  VIL: src('VIL', { aspects: ['Villainy'] }),
  COST3: src('COST3', { cost: 3 }),
  COST2: src('COST2', { cost: 2 }),
  WEAK: src('WEAK', { power: 3, cost: 4 }),
  STRONG: src('STRONG', { power: 4, cost: 4 }),
  KEEPER: src('KEEPER', { name: 'Keeper of Skara Nal' }),
  LEAD: src('LEAD'),
  COND: card({ id: 'COND', type: 'upgrade', cost: 1, power: 0, hp: 0, traits: ['CONDITION'] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 2, power: 1, hp: 1 }),
  EVT: card({ id: 'EVT', type: 'event', cost: 1 }),
  KASH_B: base('KASH_B', 'KASHYYYK'),
  END_B: base('END_B', 'ENDOR'),
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
      player: player({ resources: ready(10), deck: [], ...mine }),
      opponent: player({ resources: ready(10), deck: [], ...theirs }),
    },
    ...over,
  })
const undeployed = (cardId: string): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })
const deployedLeader = (cardId: string): LeaderState => ({ cardId, deployed: true, epicActionUsed: true, exhausted: false })
/** An undeployed leader `id` on the player's side. */
const front = (id: string, mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  board({ leader: undeployed(id), ...mine }, theirs, over)

const moves = (s: GameState): Action[] => legalMoves(s)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; baseTarget?: PlayerId; deckIndex?: number }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const unitOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : [])))].sort()
const baseOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.baseTarget ? [m.baseTarget] : [])))].sort()
const attackerOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'attack' ? [m.attackerId] : [])))].sort()
const attackTargets = (s: GameState, attackerId: string) =>
  moves(s).flatMap(m => (m.type === 'attack' && m.attackerId === attackerId ? [m.target.kind === 'base' ? 'base' : m.target.instanceId] : [])).sort()
const declinable = (s: GameState) => moves(s).some(m => m.type === 'skipTrigger')
const usable = (s: GameState) => moves(s).some(m => m.type === 'useLeaderAbility')
const useFront = (s: GameState) => resolve(s, { type: 'useLeaderAbility', index: 0 })
const power =(s: GameState, id: string) => effectivePower(s, U(s, id)!)
const attack = (s: GameState, attackerId: string, target?: string) =>
  resolve(s, { type: 'attack', attackerId, target: target ? { kind: 'unit', instanceId: target } : { kind: 'base' } })

/** Play an event from hand, appended so its index is known. */
const playEvent = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState => {
  const p = s.players[who]
  const withCard = { ...s, activePlayer: who, players: { ...s.players, [who]: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playEvent', handIndex: p.hand.length })
}
const self =(s: GameState, cardId: string): string => s.players.player.units.find(u => u.cardId === cardId)!.instanceId
/** Play a Fortify upgrade onto the player's own base. */
const playBaseUpgrade = (s: GameState, cardId: string): GameState => {
  const p = s.players.player
  const withCard = { ...s, activePlayer: 'player' as PlayerId, players: { ...s.players, player: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playBaseUpgrade', handIndex: p.hand.length })
}
const unitAction = (s: GameState) => moves(s).find(m => m.type === 'useAbility')

describe('HMW events, leaders and trigger points: registration', () => {
  // HMW_239 is a reprint: the definition lives on the LOF printing every copy canonicalises to.
  it('registers a definition for every shipped card', () => {
    for (const id of SHIPPED.filter(x => x !== 'HMW_239')) expect(getCardDefinition(id), id).toBeDefined()
  })

  it('leaves the lifted cards unregistered, so the bench still counts them as outstanding', () => {
    for (const id of LIFTED) expect(getCardDefinition(id), id).toBeUndefined()
  })

  it('canonicalises Pounce (HMW_239) onto its LOF printing rather than registering it twice', () => {
    const pounce = REPRINTS.find(r => r.name === 'Pounce')
    expect(pounce?.canonical).toBe('LOF_224')
    expect(pounce?.printings).toContain('HMW_239')
    expect(reprintCanonicalId('HMW_239')).toBe('LOF_224')
    expect(getCardDefinition('LOF_224')).toBeDefined()
    // Same printed card, so the join is safe to make.
    const [hmw, lof] = ['HMW_239', 'LOF_224'].map(id => real(id, id.startsWith('LOF') ? poolFor(['LOF']) : POOL))
    expect([hmw.name, hmw.cost, hmw.type]).toEqual([lof.name, lof.cost, lof.type])
  })
})

describe('HMW events A: attacks and riders', () => {
  it('Log Trap (HMW_149) attacks with a friendly unit, then again with the same unit, which cannot hit a base', () => {
    const s = playEvent(board({ units: [unit('f', 'GRD'), unit('o', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_149')
    expect(attackerOffers(s)).toEqual(['f', 'o'])
    expect(declinable(s)).toBe(false)
    const first = attack(s, 'f', 'e')
    // The second attack is offered to the same unit although it is now exhausted, and has no base.
    expect(attackerOffers(first)).toEqual(['f'])
    expect(U(first, 'f')!.exhausted).toBe(true)
    expect(attackTargets(first, 'f')).toEqual(['e'])
  })

  it('Familiar Strategem (HMW_266) gives the attacker +2/+0 only when it shares a Trait with another friendly unit', () => {
    // The rider is gone by the time the attack has resolved, so it is read from the damage it dealt.
    const shared = playEvent(board({ units: [unit('a', 'EWOK'), unit('b', 'EWOK2')] }, { units: [unit('e', 'GRD')] }), 'HMW_266')
    expect(attackerOffers(shared)).toEqual(['a', 'b'])
    expect(U(attack(shared, 'a', 'e'), 'e')!.damage).toBe(4)
    const alone = playEvent(board({ units: [unit('a', 'EWOK'), unit('b', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_266')
    expect(U(attack(alone, 'a', 'e'), 'e')!.damage).toBe(2)
  })

  it('Nightfall (HMW_193) damages an enemy unit, and only with an Endor base offers the +2/+0 attack', () => {
    const endor = playEvent(board({ base: { cardId: 'END_B', damage: 0 }, units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_193')
    expect(unitOffers(endor)).toEqual(['e'])
    const damaged = accept(endor, { targetInstanceId: 'e' })
    expect(U(damaged, 'e')!.damage).toBe(1)
    expect(attackerOffers(damaged)).toEqual(['f'])
    expect(declinable(damaged)).toBe(true)
    expect(U(attack(damaged, 'f', 'e'), 'e')!.damage).toBe(1 + 4) // the ping, then 2 power + 2

    const elsewhere = playEvent(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_193')
    noChoice(accept(elsewhere, { targetInstanceId: 'e' }))
  })

  it('Low Altitude Combat (HMW_050) moves a space unit to the ground arena, then may attack with a ground unit for +2/+0', () => {
    const s = playEvent(board({ units: [unit('sp', 'SPC'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_050')
    expect(unitOffers(s)).toEqual(['sp'])
    const moved = accept(s, { targetInstanceId: 'sp' })
    expect(U(moved, 'sp')!.arena).toBe('ground')
    expect(attackerOffers(moved)).toEqual(['g', 'sp']) // the moved unit is a ground unit now
    expect(declinable(moved)).toBe(true)
    expect(U(attack(moved, 'g', 'e'), 'e')!.damage).toBe(4)
  })
})

describe('HMW events B: damage, defeat and removal', () => {
  it("Dragon's Might (HMW_102) defeats a non-leader unit with 4 or less power", () => {
    const s = playEvent(board({}, { units: [unit('m', 'MID'), unit('b', 'BIG'), unit('l', 'LEAD', { isLeader: true })] }), 'HMW_102')
    expect(unitOffers(s)).toEqual(['m'])
    expect(declinable(s)).toBe(false)
    expect(U(accept(s, { targetInstanceId: 'm' }), 'm')).toBeUndefined()
  })

  it('Maim (HMW_207) deals 1 damage to a unit and exhausts it', () => {
    const s = playEvent(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_207')
    expect(unitOffers(s)).toEqual(['e', 'f'])
    const done = accept(s, { targetInstanceId: 'e' })
    expect([U(done, 'e')!.damage, U(done, 'e')!.exhausted]).toEqual([1, true])
  })

  it('Exploit Confidence (HMW_238) returns a non-leader unit with 6 or more power to its owner\'s hand', () => {
    const s = playEvent(board({}, { units: [unit('b', 'BIG'), unit('m', 'MID'), unit('l', 'BIG', { isLeader: true })] }), 'HMW_238')
    expect(unitOffers(s)).toEqual(['b'])
    const done = accept(s, { targetInstanceId: 'b' })
    expect(U(done, 'b')).toBeUndefined()
    expect(done.players.opponent.hand).toContain('BIG')
  })

  it('New Tactics (HMW_218) lets the chosen unit\'s OWNER put it on the top or bottom of their deck', () => {
    const s = playEvent(board({}, { units: [unit('e', 'GRD'), unit('l', 'GRD', { isLeader: true })] }), 'HMW_218')
    expect(unitOffers(s)).toEqual(['e'])
    const picked = accept(s, { targetInstanceId: 'e' })
    expect(choice(picked).controller).toBe('opponent')
    const top = accept(picked)
    expect(U(top, 'e')).toBeUndefined()
    expect(top.players.opponent.deck[0]).toBe('GRD')
    expect(skip(picked).players.opponent.deck.at(-1)).toBe('GRD')
  })

  it("Don't Touch Anything (HMW_217) deals 3 damage to a random enemy unit, choosing none of them itself", () => {
    const s = playEvent(board({ units: [unit('f', 'GRD')] }, { units: [unit('a', 'GRD'), unit('b', 'GRD')] }), 'HMW_217')
    noChoice(s)
    const hit = all(s).filter(u => u.damage === 3)
    expect(hit).toHaveLength(1)
    expect(['a', 'b']).toContain(hit[0].instanceId)
    // The seed is advanced, so two copies in a row do not always pick the same unit.
    expect(s.rngSeed).not.toBe(board().rngSeed)
  })

  it('Breach (HMW_114) deals the friendly unit\'s power to an enemy in its arena, spilling to the base only with Overwhelm', () => {
    const plain = playEvent(board({ units: [unit('f', 'BIG')] }, { units: [unit('e', 'GRD', { damage: 6 }), unit('sp', 'SPC')] }), 'HMW_114')
    expect(unitOffers(plain)).toEqual(['f'])
    const targets = accept(plain, { targetInstanceId: 'f' })
    expect(unitOffers(targets)).toEqual(['e']) // the space unit is not in the attacker's arena
    const done = accept(targets, { targetInstanceId: 'e' })
    expect(U(done, 'e')).toBeUndefined()
    expect(done.players.opponent.base.damage).toBe(0)

    const over = playEvent(board({ units: [unit('f', 'OVER')] }, { units: [unit('e', 'GRD', { damage: 6 })] }), 'HMW_114')
    const spilt = accept(accept(over, { targetInstanceId: 'f' }), { targetInstanceId: 'e' })
    expect(spilt.players.opponent.base.damage).toBe(4) // 6 power, 2 remaining HP
  })

  it('Volley Fire (HMW_192) deals damage equal to the chosen friendly unit\'s Raid', () => {
    const s = playEvent(board({ units: [unit('r', 'RAID2'), unit('p', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_192')
    expect(unitOffers(s)).toEqual(['p', 'r'])
    expect(U(accept(accept(s, { targetInstanceId: 'r' }), { targetInstanceId: 'e' }), 'e')!.damage).toBe(2)
  })

  it('Overgrowth (HMW_151) fires only with a Kashyyyk base, and resources itself either way', () => {
    const kash = playEvent(board({ base: { cardId: 'KASH_B', damage: 0 }, units: [unit('f', 'BIG')] }, { units: [unit('e', 'GRD')] }), 'HMW_151')
    expect(unitOffers(kash)).toEqual(['f'])
    const done = accept(accept(kash, { targetInstanceId: 'f' }), { targetInstanceId: 'e' })
    expect(U(done, 'e')!.damage).toBe(7)
    expect(done.players.player.resources.map(r => r.cardId)).toContain('HMW_151')
    expect(done.players.player.discard).not.toContain('HMW_151')

    const other = playEvent(board({ units: [unit('f', 'BIG')] }, { units: [unit('e', 'GRD')] }), 'HMW_151')
    noChoice(other)
    expect(other.players.player.resources.map(r => r.cardId)).toContain('HMW_151')
  })

  it('Seismic Detonation (HMW_054) waits for the start of the next regroup phase, then hits the chosen arena', () => {
    const s = playEvent(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'HMW_054')
    const armed = accept(s, { optionIndex: 0 }) // ground
    expect(armed.delayedEffects?.[0]).toMatchObject({ cardId: 'HMW_054', owner: 'player', when: 'regroupStart', arena: 'ground' })
    expect(all(armed).every(u => u.damage === 0)).toBe(true)
    // The regroup phase begins when both players pass.
    const passed = resolve(resolve({ ...armed, activePlayer: 'player' }, { type: 'pass' }), { type: 'pass' })
    expect(U(passed, 'e')!.damage).toBe(3)
    expect(U(passed, 'sp')!.damage).toBe(0) // wrong arena
    expect(U(passed, 'f')!.damage).toBe(0) // friendly units are not enemies
  })

  it('Forced Pacification (HMW_253) exhausts 2 enemy units for each friendly unit it defeats', () => {
    const s = playEvent(
      board({ units: [unit('f1', 'GRD'), unit('f2', 'GRD')] }, { units: [unit('e1', 'GRD'), unit('e2', 'GRD'), unit('e3', 'GRD')] }),
      'HMW_253')
    expect(unitOffers(s)).toEqual(['f1', 'f2'])
    expect(declinable(s)).toBe(true)
    const one = accept(s, { targetInstanceId: 'f1' })
    expect(U(one, 'f1')).toBeUndefined()
    const stopped = skip(one) // defeat no more
    // Two exhausts, one pick at a time.
    const first = accept(stopped, { targetInstanceId: 'e1' })
    const second = accept(first, { targetInstanceId: 'e2' })
    expect([U(second, 'e1')!.exhausted, U(second, 'e2')!.exhausted, U(second, 'e3')!.exhausted]).toEqual([true, true, false])
    noChoice(second)
  })
})

describe('HMW events C: cards, resources and healing', () => {
  it('Resonate (HMW_098) heals 4 only when a friendly non-leader unit shares a Trait with the friendly leader', () => {
    const leader = undeployed('HMW_018') // The Warrior, Tusken
    const shares = playEvent(board({ leader, base: { cardId: 'TST_B', damage: 9 }, units: [unit('t', 'TUSKEN')] }), 'HMW_098')
    expect(baseOffers(shares)).toEqual(['opponent', 'player'])
    expect(accept(shares, { baseTarget: 'player' }).players.player.base.damage).toBe(5)
    const apart = playEvent(board({ leader, base: { cardId: 'TST_B', damage: 9 }, units: [unit('g', 'GRD')] }), 'HMW_098')
    noChoice(apart)
  })

  it('Trust Yourself (HMW_101) shields a unit, then searches the top 3 for a card to draw', () => {
    const s = playEvent(board({ deck: ['GRD', 'EVT', 'UPG', 'BIG'], units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_101')
    expect(unitOffers(s)).toEqual(['e', 'f'])
    const shielded = accept(s, { targetInstanceId: 'f' })
    expect(hasToken(U(shielded, 'f')!.upgrades, TOKEN_SHIELD)).toBe(true)
    expect(choice(shielded).kind).toBe('searchDraw')
    const drawn = accept(shielded, { deckIndex: 1 })
    expect(drawn.players.player.hand).toContain('EVT')
    expect(drawn.players.player.deck).toHaveLength(3)
  })

  it('Renew (HMW_267) heals 3 from your base and may defeat a Condition upgrade', () => {
    const s = playEvent(board({ base: { cardId: 'TST_B', damage: 8 } }, { units: [unit('e', 'GRD', { upgrades: [{ cardId: 'COND', owner: 'opponent' }, { cardId: 'UPG', owner: 'opponent' }] })] }), 'HMW_267')
    expect(s.players.player.base.damage).toBe(5)
    expect(declinable(s)).toBe(true)
    const done = accept(s, { targetInstanceId: 'e' })
    expect(U(done, 'e')!.upgrades.map(u => u.cardId)).toEqual(['UPG'])
  })

  it('Raze to Ruin (HMW_161) makes each player discard all but 3 cards', () => {
    let s = playEvent(board({ hand: ['GRD', 'BIG', 'MID', 'EVT'] }, { hand: ['GRD', 'BIG', 'MID', 'EVT', 'UPG'] }), 'HMW_161')
    // The event itself left the hand as it was played, so 4 remain for the player: one discard.
    while ((s.pendingChoices?.length ?? 0) > 0) s = accept(s, { handIndex: 0 })
    expect(s.players.player.hand).toHaveLength(3)
    expect(s.players.opponent.hand).toHaveLength(3)
    expect(s.players.opponent.discard).toHaveLength(2)
  })

  it('Rebel Operation (HMW_173) draws 2 and costs 1 less per friendly Rebel unit and leader', () => {
    const spent = (mine: Side) => {
      const s = board({ deck: ['GRD', 'BIG', 'MID'], ...mine })
      const played = playEvent(s, 'HMW_173')
      expect(played.players.player.hand).toEqual(['GRD', 'BIG'])
      return 10 - played.players.player.resources.filter(r => !r.exhausted).length
    }
    const none = spent({ units: [unit('g', 'GRD')] })
    expect(spent({ units: [unit('r', 'REBEL'), unit('g', 'GRD')] })).toBe(none - 1)
    expect(spent({ units: [unit('r', 'REBEL'), unit('r2', 'REBEL')] })).toBe(none - 2)
    // An undeployed Rebel leader counts as well, and a deployed one only once (as a unit).
    expect(spent({ leader: undeployed('HMW_009'), units: [] })).toBe(none - 1)
  })

  it('Always a Bigger Fish (HMW_099) defeats a friendly Creature, then plays a bigger Creature free', () => {
    const s = playEvent(board({ hand: ['CREATURE5', 'CREATURE6', 'GRD'], units: [unit('c', 'CREATURE'), unit('g', 'GRD')] }), 'HMW_099')
    expect(unitOffers(s)).toEqual(['c'])
    const defeated = accept(s, { targetInstanceId: 'c' })
    expect(U(defeated, 'c')).toBeUndefined()
    const play = choice(defeated)
    expect(play.kind).toBe('playUnitFromHand')
    // Creatures only, and at most 2 + 3 = 5 to play: CREATURE6 and GRD are out.
    expect(play.kind === 'playUnitFromHand' && play.candidates.map(c => c.cardId)).toEqual(['CREATURE5'])
    const spent = defeated.players.player.resources.filter(r => !r.exhausted).length
    const played = accept(defeated, { handIndex: play.kind === 'playUnitFromHand' ? play.candidates[0].handIndex : 0 })
    expect(played.players.player.units.some(u => u.cardId === 'CREATURE5')).toBe(true)
    expect(played.players.player.resources.filter(r => !r.exhausted).length).toBe(spent)
  })
})

describe('HMW units: the remaining trigger points', () => {
  it('Scorch (HMW_064) may deal 1 damage to an upgraded unit on attack', () => {
    const s = board({ units: [unit('me', 'HMW_064')] }, { units: [unit('e', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] }), unit('c', 'GRD')] })
    const attacked = attack(s, 'me', 'c')
    expect(unitOffers(attacked)).toEqual(['e'])
    expect(declinable(attacked)).toBe(true)
    expect(U(accept(attacked, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
  })

  it('Corona Squadron X-Wing (HMW_209) may ready a resource on attack', () => {
    const s = board({ resources: [...ready(4), { cardId: 'X', exhausted: true }], units: [unit('me', 'HMW_209')] }, { units: [unit('e', 'SPC')] })
    const attacked = attack(s, 'me', 'e')
    expect(declinable(attacked)).toBe(true)
    expect(accept(attacked).players.player.resources.filter(r => r.exhausted)).toHaveLength(0)
    expect(skip(attacked).players.player.resources.filter(r => r.exhausted)).toHaveLength(1)
  })

  it('Sol (HMW_210) gains Sentinel for the phase when he attacks, and does not have it printed', () => {
    const s = board({ units: [unit('me', 'HMW_210')] }, { units: [unit('e', 'GRD')] })
    expect(F.HMW_210.keywords.map(k => k.name)).toEqual(['Shielded'])
    expect(unitHasKeyword(s, U(s, 'me')!, 'Sentinel')).toBe(false)
    // He attacks the base: at 2 HP a unit's counter-damage would defeat him before the check.
    const attacked = attack(s, 'me')
    expect(unitHasKeyword(attacked, U(attacked, 'me')!, 'Sentinel')).toBe(true)
  })

  it('Arena Nexu (HMW_182) may damage a friendly Creature to ready itself, once each round', () => {
    const s = board({ units: [unit('me', 'HMW_182'), unit('c', 'CREATURE'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] })
    const attacked = attack(s, 'me', 'e')
    expect(unitOffers(attacked)).toEqual(['c', 'me'])
    expect(declinable(attacked)).toBe(true)
    const used = accept(attacked, { targetInstanceId: 'c' })
    expect([U(used, 'c')!.damage, U(used, 'me')!.exhausted]).toEqual([3, false])
    // The second attack this round raises nothing: the turn passed, so hand it back first.
    noChoice(attack({ ...used, activePlayer: 'player' }, 'me', 'e'))
  })

  it('Keeper of Skara Nal (HMW_041) may discard 2 copies of itself for +15/+0 and Overwhelm', () => {
    const two = board({ hand: ['KEEPER', 'KEEPER', 'GRD'], units: [unit('me', 'HMW_041')] }, { units: [unit('e', 'GRD')] })
    const attacked = attack(two, 'me', 'e')
    expect(declinable(attacked)).toBe(true)
    const paid = accept(attacked)
    expect(paid.players.player.hand).toEqual(['GRD'])
    // The buff is spent by the time the attack has resolved, so it is read from what it dealt:
    // 5 power + 15, of which 8 defeats the defender and the Overwhelm spills the other 12 to the base.
    expect(U(paid, 'e')).toBeUndefined()
    expect(paid.players.opponent.base.damage).toBe(12)

    const one = board({ hand: ['KEEPER', 'GRD'], units: [unit('me', 'HMW_041')] }, { units: [unit('e', 'GRD')] })
    noChoice(attack(one, 'me', 'e'))
  })

  it('Ima-Gun Di (HMW_044) may resource a card from hand when behind, and then the top of his deck', () => {
    const behind = board({ hand: ['GRD', 'BIG'], deck: ['MID'], resources: ready(3), units: [unit('me', 'HMW_044')] }, { resources: ready(5) })
    const dead = defeatUnit(behind, 'me')
    expect(declinable(dead)).toBe(true)
    const done = accept(dead, { handIndex: 0 })
    expect(done.players.player.resources.map(r => r.cardId)).toEqual([...ready(3).map(r => r.cardId), 'GRD', 'MID'])
    expect(done.players.player.hand).toEqual(['BIG'])
    expect(done.players.player.deck).toEqual([])

    const level = board({ hand: ['GRD'], deck: ['MID'], resources: ready(5), units: [unit('me', 'HMW_044')] }, { resources: ready(5) })
    noChoice(defeatUnit(level, 'me'))
  })

  it('Yoda (HMW_056) may return himself from the discard to the top of the deck, then heal 2 from a base', () => {
    const s = board({ deck: ['GRD'], units: [unit('me', 'HMW_056')], base: { cardId: 'TST_B', damage: 5 } })
    const dead = defeatUnit(s, 'me')
    expect(dead.players.player.discard).toContain('HMW_056')
    expect(declinable(dead)).toBe(true)
    const taken = accept(dead)
    expect(taken.players.player.deck[0]).toBe('HMW_056')
    expect(taken.players.player.discard).not.toContain('HMW_056')
    expect(baseOffers(taken)).toEqual(['opponent', 'player'])
    expect(accept(taken, { baseTarget: 'player' }).players.player.base.damage).toBe(3)
    // Declining leaves him in the discard and heals nothing.
    const declined = skip(dead)
    expect(declined.players.player.discard).toContain('HMW_056')
    noChoice(declined)
  })

  it('Garnac (HMW_104) has Hidden only while an opponent controls a Unique unit, and may attack again when his attack ends', () => {
    const plain = board({ units: [unit('me', 'HMW_104'), unit('o', 'GRD')] }, { units: [unit('e', 'GRD')] })
    expect(unitHasKeyword(plain, U(plain, 'me')!, 'Hidden')).toBe(false)
    const uniq = board({ units: [unit('me', 'HMW_104'), unit('o', 'GRD')] }, { units: [unit('e', 'HMW_056')] })
    expect(unitHasKeyword(uniq, U(uniq, 'me')!, 'Hidden')).toBe(true)
    const ended = attack(plain, 'me', 'e')
    expect(attackerOffers(ended)).toEqual(['o'])
    expect(declinable(ended)).toBe(true)
  })

  it('Han Solo (HMW_170) exhausts to ready another unit', () => {
    const s = board({ units: [unit('me', 'HMW_170'), unit('o', 'GRD', { exhausted: true }), unit('r', 'GRD')] }, { units: [unit('e', 'GRD', { exhausted: true })] })
    const action = unitAction(s)
    expect(action, 'Han Solo offers his action').toBeDefined()
    const used = resolve(s, action!)
    expect(U(used, 'me')!.exhausted).toBe(true)
    // "Ready ANOTHER unit" is unqualified, so an enemy unit is a legal (if unlikely) target.
    expect(unitOffers(used)).toEqual(['e', 'o'])
    expect(U(accept(used, { targetInstanceId: 'o' }), 'o')!.exhausted).toBe(false)
  })

  it('Beast Lair (HMW_147) fires at the start of the action phase: discard a card to create a Beast', () => {
    const s = playBaseUpgrade(board({ hand: ['GRD'], deck: ['BIG', 'MID', 'COST2', 'COST3'] }, { deck: ['GRD', 'BIG', 'MID'] }), 'HMW_147')
    expect(s.players.player.base.upgrades?.map(u => u.cardId)).toEqual(['HMW_147'])
    // Nothing happens until an action phase starts.
    noChoice(s)
    let advanced = resolve(resolve({ ...s, activePlayer: 'player' }, { type: 'pass' }), { type: 'pass' })
    // Through the regroup phase, declining to resource so the hand still holds a card to discard.
    let guard = 0
    while (advanced.phase !== 'action' && guard++ < 12) {
      const skip = legalMoves(advanced).find(m => m.type === 'skipResource')
      advanced = resolve(advanced, skip ?? legalMoves(advanced)[0])
    }
    expect(advanced.round).toBe(3)
    expect(declinable(advanced)).toBe(true)
    const held = advanced.players.player.hand.length
    const made = accept(advanced, { handIndex: 0 })
    expect(made.players.player.units.map(u => u.cardId)).toEqual([TOKEN_BEAST])
    expect(made.players.player.hand).toHaveLength(held - 1)
    // Declining costs nothing and creates nothing.
    const declined = skip(advanced)
    expect(declined.players.player.units).toEqual([])
    expect(declined.players.player.hand).toHaveLength(held)
  })
})

describe('HMW leaders, both sides', () => {
  it('Omega (HMW_006) attacks with a Heroic unit that gains Grit; deployed, other friendly Heroic units gain Grit', () => {
    const s = front('HMW_006', { units: [unit('h', 'HER', { damage: 3 }), unit('v', 'VIL')] }, { units: [unit('e', 'GRD')] })
    expect(usable(s)).toBe(true)
    const used = useFront(s)
    expect(attackerOffers(used)).toEqual(['h'])
    // Grit is +1/+0 per damage on the unit, and the grant is spent by the time the attack ends,
    // so it is read from the damage the attack dealt: 2 power plus 3 damage carried.
    expect(U(attack(used, 'h', 'e'), 'e')!.damage).toBe(2 + 3)

    const back = board({ leader: deployedLeader('HMW_006'), units: [unit('L', 'HMW_006', { isLeader: true, damage: 2 }), unit('h', 'HER', { damage: 3 }), unit('v', 'VIL', { damage: 3 })] })
    expect(unitHasKeyword(back, U(back, 'h')!, 'Grit')).toBe(true)
    expect(unitHasKeyword(back, U(back, 'v')!, 'Grit')).toBe(false)
    expect(unitHasKeyword(back, U(back, 'L')!, 'Grit')).toBe(false) // "Other" leaves her out
  })

  it('Darth Vader (HMW_007) gives friendly units costing 3 or more Raid 1 from either side, and holds Raid 1 himself deployed', () => {
    const f = front('HMW_007', { units: [unit('c3', 'COST3'), unit('c2', 'COST2')] })
    expect(unitKeywordValue(f, U(f, 'c3')!, 'Raid')).toBe(1)
    expect(unitKeywordValue(f, U(f, 'c2')!, 'Raid')).toBe(0)

    const back = board({ leader: deployedLeader('HMW_007'), units: [unit('L', 'HMW_007', { isLeader: true }), unit('c3', 'COST3'), unit('c2', 'COST2')] })
    expect(unitKeywordValue(back, U(back, 'c3')!, 'Raid')).toBe(1)
    expect(unitKeywordValue(back, U(back, 'c2')!, 'Raid')).toBe(0)
    // His own Raid 1 is printed, and "other" does not stack a second onto himself.
    expect(unitKeywordValue(back, U(back, 'L')!, 'Raid')).toBe(1)
  })

  it('General Grievous (HMW_008) plays 2 units from hand one at a time, paying each cost', () => {
    const s = front('HMW_008', { hand: ['COST2', 'COST3', 'EVT'], resources: ready(6) })
    const used = useFront(s)
    const first = choice(used)
    expect(first.kind).toBe('playUnitFromHand')
    expect(first.kind === 'playUnitFromHand' && first.candidates.map(c => c.cardId).sort()).toEqual(['COST2', 'COST3'])
    const one = accept(used, { handIndex: first.kind === 'playUnitFromHand' ? first.candidates.find(c => c.cardId === 'COST2')!.handIndex : 0 })
    expect(one.players.player.resources.filter(r => !r.exhausted)).toHaveLength(4)
    // The second play is offered from the state after the first was paid for.
    const second = choice(one)
    expect(second.kind === 'playUnitFromHand' && second.candidates.map(c => c.cardId)).toEqual(['COST3'])
    const two = accept(one, { handIndex: second.kind === 'playUnitFromHand' ? second.candidates[0].handIndex : 0 })
    expect(two.players.player.units.map(u => u.cardId).sort()).toEqual(['COST2', 'COST3'])
    noChoice(two)
  })

  it('General Grievous (HMW_008) deployed gets +3/+0 while he controls more units than an opponent', () => {
    const ahead = board({ leader: deployedLeader('HMW_008'), units: [unit('L', 'HMW_008', { isLeader: true }), unit('a', 'GRD')] }, { units: [unit('e', 'GRD')] })
    expect(power(ahead, 'L')).toBe(3 + 3)
    const level = board({ leader: deployedLeader('HMW_008'), units: [unit('L', 'HMW_008', { isLeader: true })] }, { units: [unit('e', 'GRD')] })
    expect(power(level, 'L')).toBe(3)
  })

  it('Chewbacca (HMW_009) attacks with an exhausted unit that cannot hit a base, from either side, and the back once each round', () => {
    const s = front('HMW_009', { units: [unit('x', 'GRD', { exhausted: true })] }, { units: [unit('e', 'GRD')] })
    const used = useFront(s)
    expect(attackerOffers(used)).toEqual(['x'])
    expect(attackTargets(used, 'x')).toEqual(['e'])

    const back = board({ leader: deployedLeader('HMW_009'), units: [unit('L', 'HMW_009', { isLeader: true }), unit('x', 'GRD', { exhausted: true })] }, { units: [unit('e', 'GRD')] })
    const action = unitAction(back)
    expect(action, "Chewbacca's back offers its action").toBeDefined()
    const once = resolve(back, action!)
    expect(attackerOffers(once)).toContain('x')
    const done = attack(once, 'x', 'e')
    expect(unitAction(done)).toBeUndefined()
  })

  it('The Warrior (HMW_018) plays a unit with 3 or less power that gains Ambush; her back has Ambush and Raid 1', () => {
    const s = front('HMW_018', { hand: ['WEAK', 'STRONG'], resources: ready(6) }, { units: [unit('e', 'GRD')] })
    const used = useFront(s)
    const play = choice(used)
    expect(play.kind === 'playUnitFromHand' && play.candidates.map(c => c.cardId)).toEqual(['WEAK'])
    const played = accept(used, { handIndex: play.kind === 'playUnitFromHand' ? play.candidates[0].handIndex : 0 })
    // Ambush: the unit arrives ready and is offered an attack on an enemy unit.
    expect(attackerOffers(played)).toEqual([self(played, 'WEAK')])

    const card = F.HMW_018
    expect(card.keywords.map(k => k.name).sort()).toEqual(['Ambush', 'Raid'])
    expect(card.keywords.find(k => k.name === 'Raid')?.value).toBe(1)
  })
})
