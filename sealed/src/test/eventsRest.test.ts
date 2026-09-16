import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState } from '../engine/types'
import { recordBaseDamaged } from '../engine/types'

/**
 * The one-off events, in groups taken whole: deck searches that draw, and events that look at,
 * discard from or draw into a hand (including "choose a player").
 *
 * Each test states what may be chosen as well as what happens, since a filter that lets everything
 * through would still pass a test that only picks the right card.
 */

const ev = (id: string, cost = 1) => card({ id, type: 'event', cost })
const F = {
  ...CARDS,
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 6, aspects: ['Aggression'] }),
  GRD7: card({ id: 'GRD7', arena: 'ground', cost: 7, power: 2, hp: 6 }),
  FORCE: card({ id: 'FORCE', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['FORCE'] }),
  LEAD: card({ id: 'LEAD', type: 'leader', arena: 'ground', cost: 5, power: 4, hp: 7 }),

  // Deck and hand cards
  U_VIG: card({ id: 'U_VIG', cost: 2, aspects: ['Vigilance'] }),
  U_CMD: card({ id: 'U_CMD', cost: 2, aspects: ['Command'] }),
  U_CUN: card({ id: 'U_CUN', cost: 3, aspects: ['Cunning', 'Villainy'] }),
  E_AGG: card({ id: 'E_AGG', type: 'event', cost: 4, aspects: ['Aggression'] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1 }),
  VEH1: card({ id: 'VEH1', cost: 3, traits: ['VEHICLE'] }),
  VEH2: card({ id: 'VEH2', cost: 4, traits: ['VEHICLE', 'FIGHTER'] }),
  VEH_UPG: card({ id: 'VEH_UPG', type: 'upgrade', cost: 2, traits: ['VEHICLE'] }),
  MANDO: card({ id: 'MANDO', cost: 2, traits: ['MANDALORIAN'] }),
  MANDO_EV: card({ id: 'MANDO_EV', type: 'event', cost: 2, traits: ['MANDALORIAN'] }),
  FILL: card({ id: 'FILL', type: 'event', cost: 0 }),

  LAW_166: ev('LAW_166'), SEC_072: ev('SEC_072'), SOR_123: ev('SOR_123'), JTL_128: ev('JTL_128', 2),
  SOR_125: ev('SOR_125', 2), SHD_093: ev('SHD_093', 4), SHD_253: ev('SHD_253', 2),

  SOR_200: ev('SOR_200', 2), LOF_226: ev('LOF_226', 2), JTL_207: ev('JTL_207'), TWI_223: ev('TWI_223'),
  LAW_217: ev('LAW_217', 3), SEC_233: ev('SEC_233', 3), LAW_204: ev('LAW_204'), SHD_244: ev('SHD_244', 3),
  SHD_181: ev('SHD_181', 4), SHD_156: ev('SHD_156', 2), SOR_175: ev('SOR_175', 6), SOR_167: ev('SOR_167'),
  SOR_174: ev('SOR_174', 5), SOR_171: ev('SOR_171', 3),

  SOR_127: ev('SOR_127', 3), SOR_151: ev('SOR_151', 2), LOF_128: ev('LOF_128', 4), SOR_234: ev('SOR_234', 4),
  JTL_129: ev('JTL_129', 4), JTL_131: ev('JTL_131', 7), TWI_176: ev('TWI_176', 6), JTL_173: ev('JTL_173'),
  SEC_130: ev('SEC_130', 4), TWI_099: ev('TWI_099', 2), JTL_144: ev('JTL_144', 3), SOR_092: ev('SOR_092', 5),
  SOR_173: ev('SOR_173', 5), SOR_221: ev('SOR_221', 3),

  // Units for the damage events
  P3: card({ id: 'P3', arena: 'ground', cost: 2, power: 3, hp: 5 }),
  P5: card({ id: 'P5', arena: 'ground', cost: 4, power: 5, hp: 8 }),
  BIG: card({ id: 'BIG', arena: 'ground', cost: 5, power: 1, hp: 20 }),
  SP4: card({ id: 'SP4', arena: 'space', cost: 3, power: 4, hp: 20 }),
  IMP2: card({ id: 'IMP2', arena: 'ground', cost: 2, power: 2, hp: 5, traits: ['IMPERIAL'] }),
  IMP3: card({ id: 'IMP3', arena: 'ground', cost: 3, power: 3, hp: 5, traits: ['IMPERIAL'] }),
  VEHG: card({ id: 'VEHG', arena: 'ground', cost: 3, power: 2, hp: 5, traits: ['VEHICLE'] }),
  VEHS: card({ id: 'VEHS', arena: 'space', cost: 3, power: 4, hp: 20, traits: ['VEHICLE'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: (F as Record<string, EngineCard>)[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)

type Side = Parameters<typeof player>[0]
const board = (eventId: string, mine: Side = {}, theirs: Side = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(20), deck: [], ...mine, hand: [eventId, ...(mine.hand ?? [])] }),
      opponent: player({ deck: [], ...theirs }),
    },
  })
const play = (s: GameState) => resolve(s, { type: 'playEvent', handIndex: 0 })
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
type Extra = { targetInstanceId?: string; deckIndex?: number; optionIndex?: number; handIndex?: number }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const moves = (s: GameState): Action[] => legalMoves(s)
const declinable = (s: GameState) => moves(s).some(m => m.type === 'skipTrigger')
/** The hand indices offered by the current choice, sorted. */
const handOffers = (s: GameState) =>
  moves(s).flatMap(m => (m.type === 'acceptChoice' && m.handIndex !== undefined ? [m.handIndex] : [])).sort()
const revealedOf = (c: PendingChoice): string[] => ('revealed' in c ? c.revealed : [])
const eligibleCards = (c: PendingChoice): string[] => ('eligibleIndices' in c ? c.eligibleIndices.map(i => revealedOf(c)[i]) : [])

// ── Deck searches that draw ─────────────────────────────────────────────────────────────────────

describe('events that search the deck and draw', () => {
  const DECK = ['U_VIG', 'U_CMD', 'E_AGG', 'UPG', 'VEH1', 'MANDO', 'VEH2', 'VEH_UPG', 'U_CUN', 'MANDO_EV', 'FILL']

  it.each([
    ['LAW_166', 'Putting a Team Together: top 8 for a Vigilance, Aggression or Cunning unit', 8, ['U_VIG']],
    ['SEC_072', 'Scour the Archives: top 8 for an upgrade', 8, ['UPG', 'VEH_UPG']],
    ['SOR_123', 'Recruit: top 5 for a unit', 5, ['U_VIG', 'U_CMD', 'VEH1']],
    ['JTL_128', 'Prepare for Takeoff: top 8 for up to 2 Vehicle units', 8, ['VEH1', 'VEH2']],
    ['SOR_125', 'Prepare For Takeoff: top 8 for up to 2 Vehicle units', 8, ['VEH1', 'VEH2']],
    ['SHD_093', 'Remnant Reserves: top 5 for up to 3 units', 5, ['U_VIG', 'U_CMD', 'VEH1']],
    ['SHD_253', 'This Is The Way: top 8 for up to 2 Mandalorian and/or upgrade cards', 8, ['UPG', 'MANDO', 'VEH_UPG']],
  ])('%s %s', (id, _label, depth, eligible) => {
    const c = choice(play(board(id, { deck: DECK })))
    expect(c.kind).toBe('searchDraw')
    expect(revealedOf(c)).toEqual(DECK.slice(0, depth))
    expect(eligibleCards(c)).toEqual(eligible)
  })

  it('Recruit (SOR_123) draws the chosen unit and bottoms the rest', () => {
    const after = accept(play(board('SOR_123', { deck: DECK })), { deckIndex: 1 })
    noChoice(after)
    expect(after.players.player.hand).toEqual(['U_CMD'])
    expect(after.players.player.deck).toEqual([...DECK.slice(5), 'U_VIG', 'E_AGG', 'UPG', 'VEH1'])
    expect(after.players.player.discard).toEqual(['SOR_123'])
  })

  it('Remnant Reserves (SHD_093) draws up to 3 and may stop early', () => {
    let s = play(board('SHD_093', { deck: DECK }))
    s = accept(s, { deckIndex: 0 })
    expect(choice(s).kind).toBe('searchDraw')
    s = accept(s, { deckIndex: 0 })
    expect(declinable(s)).toBe(true)
    s = skip(s)
    noChoice(s)
    expect(s.players.player.hand).toEqual(['U_VIG', 'U_CMD'])
    expect(s.players.player.deck).toHaveLength(DECK.length - 2)
  })

  it('Prepare for Takeoff (JTL_128) stops after two', () => {
    let s = play(board('JTL_128', { deck: DECK }))
    s = accept(s, { deckIndex: eligibleIdx(choice(s), 'VEH1') })
    s = accept(s, { deckIndex: eligibleIdx(choice(s), 'VEH2') })
    noChoice(s)
    expect(s.players.player.hand).toEqual(['VEH1', 'VEH2'])
    expect(s.players.player.deck).toHaveLength(DECK.length - 2)
  })
})
const eligibleIdx = (c: PendingChoice, cardId: string) => revealedOf(c).indexOf(cardId)

// ── Hands ───────────────────────────────────────────────────────────────────────────────────────

describe('events that look at or discard from a hand', () => {
  const HAND = ['U_VIG', 'E_AGG', 'UPG']

  it("Spark of Rebellion (SOR_200) discards any card from the opponent's hand, and must", () => {
    const s = play(board('SOR_200', {}, { hand: HAND }))
    expect(choice(s)).toMatchObject({ kind: 'lookAtHand', controller: 'player', target: 'opponent' })
    expect(handOffers(s)).toEqual([0, 1, 2])
    expect(declinable(s)).toBe(false)
    const after = accept(s, { handIndex: 1 })
    expect(after.players.opponent.hand).toEqual(['U_VIG', 'UPG'])
    expect(after.players.opponent.discard).toEqual(['E_AGG'])
  })

  it('Tip the Scale (LOF_226) discards only a non-unit card', () => {
    const s = play(board('LOF_226', {}, { hand: HAND }))
    expect(handOffers(s)).toEqual([1, 2])
    expect(declinable(s)).toBe(false)
  })

  it('Jam Communications (JTL_207) discards only an event, and is only a look when there is none', () => {
    const s = play(board('JTL_207', {}, { hand: HAND }))
    expect(handOffers(s)).toEqual([1])
    expect(declinable(s)).toBe(false)
    const none = play(board('JTL_207', {}, { hand: ['U_VIG', 'UPG'] }))
    expect(handOffers(none)).toEqual([])
    expect(declinable(none)).toBe(true)
  })

  it('Unmasking the Conspiracy (TWI_223) discards your own card first, then one of theirs', () => {
    let s = play(board('TWI_223', { hand: ['FILL', 'U_CMD'] }, { hand: HAND }))
    expect(choice(s)).toMatchObject({ kind: 'selectDiscard', controller: 'player' })
    expect(declinable(s)).toBe(false)
    s = accept(s, { handIndex: 0 })
    expect(s.players.player.discard).toContain('FILL')
    expect(choice(s)).toMatchObject({ kind: 'lookAtHand', target: 'opponent' })
    expect(declinable(s)).toBe(false)
    s = accept(s, { handIndex: 0 })
    expect(s.players.opponent.discard).toEqual(['U_VIG'])
  })

  it('Unmasking the Conspiracy (TWI_223) does nothing with an empty hand', () => {
    noChoice(play(board('TWI_223', {}, { hand: HAND })))
  })

  it('Hold For Questioning (LAW_217) exhausts an enemy unit and discards a card sharing its aspect', () => {
    let s = play(board('LAW_217', { units: [unit('mine', 'GRD')] }, { units: [unit('e', 'GRD')], hand: HAND }))
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', targets: ['e'] })
    expect(declinable(s)).toBe(false)
    s = accept(s, { targetInstanceId: 'e' })
    expect(U(s, 'e')!.exhausted).toBe(true)
    expect(choice(s)).toMatchObject({ kind: 'lookAtHand', target: 'opponent' })
    // GRD is Aggression: only E_AGG shares it.
    expect(handOffers(s)).toEqual([1])
    expect(declinable(s)).toBe(false)
    s = accept(s, { handIndex: 1 })
    expect(s.players.opponent.discard).toEqual(['E_AGG'])
  })

  it('Hold For Questioning (LAW_217) does nothing more when the unit was already exhausted', () => {
    const s = accept(play(board('LAW_217', {}, { units: [unit('e', 'GRD', { exhausted: true })], hand: HAND })), { targetInstanceId: 'e' })
    noChoice(s)
    expect(s.players.opponent.hand).toEqual(HAND)
  })

  it("Beguile (SEC_233) looks at the hand, then returns an enemy non-leader unit costing 6 or less", () => {
    let s = play(board('SEC_233', { units: [unit('mine', 'GRD')] }, {
      hand: HAND, units: [unit('cheap', 'GRD'), unit('dear', 'GRD7'), unit('L', 'LEAD', { isLeader: true })],
    }))
    expect(choice(s)).toMatchObject({ kind: 'lookAtHand', target: 'opponent' })
    expect(handOffers(s)).toEqual([])
    s = skip(s)
    expect(choice(s)).toMatchObject({ kind: 'selectUnitToReturn', targets: ['cheap'] })
    expect(declinable(s)).toBe(false)
    s = accept(s, { targetInstanceId: 'cheap' })
    expect(U(s, 'cheap')).toBeUndefined()
    expect(s.players.opponent.hand).toEqual([...HAND, 'GRD'])
  })

  it('Every Day, More Lies (LAW_204) makes each player discard a card', () => {
    let s = play(board('LAW_204', { hand: ['FILL'] }, { hand: HAND }))
    const controllers = (s.pendingChoices ?? []).map(c => [c.kind, c.controller])
    expect(controllers).toEqual([['selectDiscard', 'player'], ['selectDiscard', 'opponent']])
    expect(declinable(s)).toBe(false)
    s = accept(s, { handIndex: 0 })
    s = accept(s, { handIndex: 2 })
    noChoice(s)
    expect(s.players.player.discard).toEqual(['LAW_204', 'FILL'])
    expect(s.players.opponent.discard).toEqual(['UPG'])
  })

  it('No Bargain (SHD_244) makes the opponent discard and draws you a card', () => {
    const s = play(board('SHD_244', { deck: ['U_CMD'] }, { hand: HAND }))
    expect(choice(s)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent', count: 1 })
    expect(s.players.player.hand).toEqual(['U_CMD'])
  })

  it('Cripple Authority (SHD_156) draws, and the opponent discards only with more resources', () => {
    const more = play(board('SHD_156', { deck: ['U_CMD'] }, { hand: HAND, resources: ready(21) }))
    expect(more.players.player.hand).toEqual(['U_CMD'])
    expect(choice(more)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent', count: 1 })
    const equal = play(board('SHD_156', { deck: ['U_CMD'] }, { hand: HAND, resources: ready(20) }))
    expect(equal.players.player.hand).toEqual(['U_CMD'])
    noChoice(equal)
  })

  it("Forced Surrender (SOR_175) draws 2, and the opponent discards 2 only if their base was damaged this phase", () => {
    const hit = play(recordBaseDamaged(board('SOR_175', { deck: ['U_CMD', 'U_VIG'] }, { hand: HAND }), 'opponent'))
    expect(hit.players.player.hand).toEqual(['U_CMD', 'U_VIG'])
    expect(choice(hit)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent', count: 2 })
    const unhit = play(board('SOR_175', { deck: ['U_CMD', 'U_VIG'] }, { hand: HAND }))
    expect(unhit.players.player.hand).toEqual(['U_CMD', 'U_VIG'])
    noChoice(unhit)
  })

  it('Smoke and Cinders (SOR_174) makes each player discard all but 2', () => {
    const s = play(board('SOR_174', { hand: ['FILL', 'U_CMD', 'U_VIG', 'UPG'] }, { hand: ['U_VIG', 'E_AGG'] }))
    // The opponent already holds only 2, so only the player discards (the event has left the hand).
    expect((s.pendingChoices ?? []).map(c => [c.kind, c.controller, 'count' in c ? c.count : 0]))
      .toEqual([['selectDiscard', 'player', 2]])
    const done = accept(accept(s, { handIndex: 0 }), { handIndex: 0 })
    noChoice(done)
    expect(done.players.player.hand).toEqual(['U_VIG', 'UPG'])
  })
})

describe('events that choose a player', () => {
  const HAND = ['U_VIG', 'E_AGG', 'UPG']
  const pickPlayer = (s: GameState, who: PlayerId) => {
    const c = choice(s)
    expect(c.kind).toBe('choosePlayerThen')
    // Option 0 is the opponent, option 1 the player choosing.
    expect(moves(s).filter(m => m.type === 'acceptChoice').map(m => (m as { optionIndex?: number }).optionIndex)).toEqual([0, 1])
    expect(declinable(s)).toBe(false)
    return accept(s, { optionIndex: who === 'opponent' ? 0 : 1 })
  }

  it('Mission Briefing (SOR_171) makes the chosen player draw 2', () => {
    const them = pickPlayer(play(board('SOR_171', {}, { deck: ['U_VIG', 'UPG', 'FILL'] })), 'opponent')
    noChoice(them)
    expect(them.players.opponent.hand).toEqual(['U_VIG', 'UPG'])
    const me = pickPlayer(play(board('SOR_171', { deck: ['U_CMD', 'FILL'] })), 'player')
    expect(me.players.player.hand).toEqual(['U_CMD', 'FILL'])
  })

  it('Pillage (SHD_181) makes the chosen player discard 2', () => {
    const them = pickPlayer(play(board('SHD_181', {}, { hand: HAND })), 'opponent')
    expect(choice(them)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent', count: 2 })
    // Holding only one card, you discard the one you have.
    const me = pickPlayer(play(board('SHD_181', { hand: ['FILL'] }, { hand: HAND })), 'player')
    expect(choice(me)).toMatchObject({ kind: 'selectDiscard', controller: 'player', count: 1 })
  })

  it('Force Throw (SOR_167) lets you deal the discarded card\'s cost with a Force unit', () => {
    let s = pickPlayer(play(board('SOR_167', { units: [unit('f', 'FORCE')] }, { hand: HAND, units: [unit('e', 'GRD')] })), 'opponent')
    expect(choice(s)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent', count: 1 })
    s = accept(s, { handIndex: 1 }) // E_AGG costs 4
    const c = choice(s)
    expect(c.controller).toBe('player')
    expect(declinable(s)).toBe(true)
    s = accept(s, { targetInstanceId: 'e' })
    expect(U(s, 'e')!.damage).toBe(4)
  })

  it('Force Throw (SOR_167) deals nothing without a Force unit', () => {
    let s = pickPlayer(play(board('SOR_167', { units: [unit('g', 'GRD')] }, { hand: HAND, units: [unit('e', 'GRD')] })), 'opponent')
    s = accept(s, { handIndex: 1 })
    noChoice(s)
  })
})

// ── Damage read from a unit, and a chosen arena ─────────────────────────────────────────────────

/** The unit targets the current choice offers, sorted. */
const unitOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : [])))].sort()
const dmg = (s: GameState, id: string) => U(s, id)?.damage

describe('events that deal damage read from a unit', () => {
  it('Strike True (SOR_127): a friendly unit deals its power to an enemy unit', () => {
    let s = play(board('SOR_127', { units: [unit('a', 'P3'), unit('b', 'P5')] }, { units: [unit('e', 'BIG')] }))
    expect(unitOffers(s)).toEqual(['a', 'b'])
    expect(declinable(s)).toBe(false)
    s = accept(s, { targetInstanceId: 'b' })
    expect(unitOffers(s)).toEqual(['e'])
    s = accept(s, { targetInstanceId: 'e' })
    noChoice(s)
    expect(dmg(s, 'e')).toBe(5)
  })

  it('Karabast (SOR_151): damage equal to the damage on the friendly unit plus 1', () => {
    let s = play(board('SOR_151', { units: [unit('a', 'P3', { damage: 2 })] }, { units: [unit('e', 'BIG')] }))
    s = accept(accept(s, { targetInstanceId: 'a' }), { targetInstanceId: 'e' })
    expect(dmg(s, 'e')).toBe(3)
  })

  it('Protect the Pod (LOF_128): a friendly non-Vehicle unit deals its remaining HP', () => {
    let s = play(board('LOF_128', { units: [unit('a', 'P5', { damage: 3 }), unit('v', 'VEHG')] }, { units: [unit('e', 'BIG')] }))
    expect(unitOffers(s)).toEqual(['a'])
    s = accept(accept(s, { targetInstanceId: 'a' }), { targetInstanceId: 'e' })
    expect(dmg(s, 'e')).toBe(5)
  })

  it('Maximum Firepower (SOR_234): two friendly Imperial units deal their power to the same unit', () => {
    let s = play(board('SOR_234', { units: [unit('i2', 'IMP2'), unit('i3', 'IMP3'), unit('p', 'P5')] }, { units: [unit('e', 'BIG')] }))
    expect(unitOffers(s)).toEqual(['i2', 'i3'])
    s = accept(s, { targetInstanceId: 'i3' })
    expect(unitOffers(s)).toEqual(['e', 'i2', 'i3', 'p'])
    s = accept(s, { targetInstanceId: 'e' })
    expect(dmg(s, 'e')).toBe(3)
    expect(unitOffers(s)).toEqual(['i2'])
    s = accept(s, { targetInstanceId: 'i2' })
    noChoice(s)
    expect(dmg(s, 'e')).toBe(5)
  })

  it('Focus Fire (JTL_129): each friendly Vehicle in the same arena deals its power to the unit', () => {
    let s = play(board('JTL_129', { units: [unit('v1', 'VEHG'), unit('v2', 'VEHG'), unit('vs', 'VEHS'), unit('p', 'P5')] }, { units: [unit('e', 'BIG')] }))
    expect(declinable(s)).toBe(false)
    s = accept(s, { targetInstanceId: 'e' })
    noChoice(s)
    expect(dmg(s, 'e')).toBe(4)
  })

  it('Caught in the Crossfire (TWI_176): two enemy units in one arena deal their power to each other', () => {
    let s = play(board('TWI_176', { units: [unit('m', 'P5')] }, { units: [unit('x', 'P3'), unit('y', 'P5'), unit('z', 'SP4')] }))
    // The space unit has no partner in its arena.
    expect(unitOffers(s)).toEqual(['x', 'y'])
    s = accept(s, { targetInstanceId: 'x' })
    expect(unitOffers(s)).toEqual(['y'])
    s = accept(s, { targetInstanceId: 'y' })
    noChoice(s)
    // x (3/5) takes 5 and is defeated; y still takes x's 3, dealt at the same time.
    expect(U(s, 'x')).toBeUndefined()
    expect(dmg(s, 'y')).toBe(3)
  })

  it('Fight Fire With Fire (JTL_173): a friendly and an enemy unit in the same arena take 3 each', () => {
    let s = play(board('JTL_173', { units: [unit('m', 'BIG'), unit('ms', 'SP4')] }, { units: [unit('e', 'BIG')] }))
    expect(unitOffers(s)).toEqual(['m'])
    s = accept(s, { targetInstanceId: 'm' })
    expect(unitOffers(s)).toEqual(['e'])
    s = accept(s, { targetInstanceId: 'e' })
    expect([dmg(s, 'm'), dmg(s, 'e')]).toEqual([3, 3])
  })

  it('Ferrix Uprising (SEC_130): twice the units you control in its arena', () => {
    let s = play(board('SEC_130', { units: [unit('a', 'P3'), unit('b', 'P3'), unit('c', 'SP4')] }, { units: [unit('e', 'BIG')] }))
    expect(unitOffers(s)).toEqual(['a', 'b', 'c', 'e'])
    s = accept(s, { targetInstanceId: 'e' })
    expect(dmg(s, 'e')).toBe(4)
  })

  it('Synchronized Strike (TWI_099): an enemy unit takes the units you control in its arena', () => {
    let s = play(board('TWI_099', { units: [unit('a', 'P3'), unit('b', 'P3'), unit('c', 'SP4')] }, { units: [unit('e', 'BIG')] }))
    expect(unitOffers(s)).toEqual(['e'])
    s = accept(s, { targetInstanceId: 'e' })
    expect(dmg(s, 'e')).toBe(2)
  })

  it('No Disintegrations (JTL_144): a non-leader unit is left on 1 HP', () => {
    let s = play(board('JTL_144', {}, { units: [unit('e', 'BIG', { damage: 4 }), unit('L', 'LEAD', { isLeader: true })] }))
    expect(unitOffers(s)).toEqual(['e'])
    s = accept(s, { targetInstanceId: 'e' })
    expect(dmg(s, 'e')).toBe(19)
  })

  it('Overwhelming Barrage (SOR_092): +2/+2, then its power divided among other units', () => {
    let s = play(board('SOR_092', { units: [unit('a', 'P3')] }, { units: [unit('e', 'BIG'), unit('f', 'BIG')] }))
    expect(unitOffers(s)).toEqual(['a'])
    s = accept(s, { targetInstanceId: 'a' })
    const c = choice(s)
    expect(c).toMatchObject({ kind: 'distributeDamage', remaining: 5, total: 5 })
    expect(unitOffers(s)).toEqual(['e', 'f'])
  })
})

describe('events that choose an arena', () => {
  const pickArena = (s: GameState, arena: 'ground' | 'space') => {
    expect(choice(s).kind).toBe('chooseArenaThen')
    expect(declinable(s)).toBe(false)
    return accept(s, { optionIndex: arena === 'ground' ? 0 : 1 })
  }

  it('Bombing Run (SOR_173) deals 3 to each unit in the chosen arena', () => {
    const s = pickArena(play(board('SOR_173', { units: [unit('a', 'BIG'), unit('s', 'SP4')] }, { units: [unit('e', 'BIG')] })), 'ground')
    expect([dmg(s, 'a'), dmg(s, 's'), dmg(s, 'e')]).toEqual([3, 0, 3])
  })

  it('Outmaneuver (SOR_221) exhausts each unit in the chosen arena', () => {
    const s = pickArena(play(board('SOR_221', { units: [unit('a', 'BIG'), unit('s', 'SP4')] }, { units: [unit('e', 'SP4')] })), 'space')
    expect([U(s, 'a')!.exhausted, U(s, 's')!.exhausted, U(s, 'e')!.exhausted]).toEqual([false, true, true])
  })

  it('Turbolaser Salvo (JTL_131): a friendly space unit deals its power to each enemy unit in the arena', () => {
    let s = pickArena(play(board('JTL_131', { units: [unit('sp', 'SP4'), unit('g', 'P5')] }, { units: [unit('e', 'BIG'), unit('f', 'BIG'), unit('es', 'SP4')] })), 'ground')
    expect(unitOffers(s)).toEqual(['sp'])
    s = accept(s, { targetInstanceId: 'sp' })
    expect([dmg(s, 'e'), dmg(s, 'f'), dmg(s, 'es'), dmg(s, 'g')]).toEqual([4, 4, 0, 0])
  })
})
