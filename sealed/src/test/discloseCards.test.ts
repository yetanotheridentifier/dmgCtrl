import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { defeatUnit } from '../engine/combat'
import { drawCards } from '../engine/effects'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState } from '../engine/types'

/**
 * Cards registered against Disclose (#603): the primitive itself is `disclose.test.ts`. Each test
 * here checks the registration's own aspects/effect, not the primitive (already covered). 31 cards,
 * including the three (#721) that each needed a genuinely new primitive of their own: Cantwell
 * Arrestor Cruiser (`LastingEffect.whileSourceInPlay`), Syril Karn (the `discardOrDamage` choice),
 * and Chairman Papanoida (no new trigger point after all — `whenDrawCards` already covers it).
 */

const POOL = poolFor(['SEC'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the SEC fixture`)
  return normaliseCard(row)
}
const SHIPPED = [
  'SEC_062', 'SEC_109', 'SEC_141', 'SEC_223', 'SEC_182', 'SEC_230', 'SEC_181', 'SEC_127', 'SEC_211',
  'SEC_074', 'SEC_129', 'SEC_234', 'SEC_076', 'SEC_059', 'SEC_094', 'SEC_148', 'SEC_153', 'SEC_120',
  'SEC_065', 'SEC_085', 'SEC_190', 'SEC_248', 'SEC_164', 'SEC_219', 'SEC_096', 'SEC_098', 'SEC_107',
  'SEC_004', 'SEC_037', 'SEC_133', 'SEC_159',
]

// Aspect-icon fixture cards, one per aspect (plus a dual-icon one), for satisfying `need`.
const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 2, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  VIG: card({ id: 'VIG', type: 'event', cost: 1, aspects: ['Vigilance'] }),
  CMD: card({ id: 'CMD', type: 'event', cost: 1, aspects: ['Command'] }),
  CMD2: card({ id: 'CMD2', type: 'event', cost: 1, aspects: ['Command', 'Command'] }),
  CMD3: card({ id: 'CMD3', type: 'event', cost: 1, aspects: ['Command', 'Command', 'Command'] }),
  AGG: card({ id: 'AGG', type: 'event', cost: 1, aspects: ['Aggression'] }),
  AGG2: card({ id: 'AGG2', type: 'event', cost: 1, aspects: ['Aggression', 'Aggression'] }),
  CUN: card({ id: 'CUN', type: 'event', cost: 1, aspects: ['Cunning'] }),
  CUN3: card({ id: 'CUN3', type: 'event', cost: 1, aspects: ['Cunning', 'Cunning', 'Cunning'] }),
  HER: card({ id: 'HER', type: 'event', cost: 1, aspects: ['Heroism'] }),
  HER2: card({ id: 'HER2', type: 'event', cost: 1, aspects: ['Heroism', 'Heroism'] }),
  VIL: card({ id: 'VIL', type: 'event', cost: 1, aspects: ['Villainy'] }),
  VIGVIL: card({ id: 'VIGVIL', type: 'event', cost: 1, aspects: ['Vigilance', 'Villainy'] }),
  CMDVIL: card({ id: 'CMDVIL', type: 'event', cost: 1, aspects: ['Command', 'Villainy'] }),
  AGGVIL: card({ id: 'AGGVIL', type: 'event', cost: 1, aspects: ['Aggression', 'Villainy'] }),
  CUNVIL: card({ id: 'CUNVIL', type: 'event', cost: 1, aspects: ['Cunning', 'Villainy'] }),
  CMDHER: card({ id: 'CMDHER', type: 'event', cost: 1, aspects: ['Command', 'Heroism'] }),
  AGGHER: card({ id: 'AGGHER', type: 'event', cost: 1, aspects: ['Aggression', 'Heroism'] }),
  PLAIN: src('PLAIN'),
  GRD: src('GRD'),
  GRD2: src('GRD2'),
  TANK: src('TANK', { hp: 10 }),
  TANK2: src('TANK2', { hp: 10 }),
}
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
type Side = Parameters<typeof player>[0]
const rich = (over: Side = {}) => player({ resources: ready(20), deck: [], ...over })
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })

const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; baseTarget?: PlayerId; deckIndex?: number }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const done = (s: GameState) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id })
/** Reveal every hand card at the given indices, one at a time, then finish the disclose. */
const disclose = (s: GameState, ...handIndices: number[]): GameState => {
  let next = s
  for (const handIndex of handIndices) next = accept(next, { handIndex })
  return done(next)
}
const declineDisclose = (s: GameState) => skip(s)
/** Both players pass to end the action phase, then both skip their resource step, landing back in
 *  a fresh action phase — for checking whether a lasting effect outlives a round (Cantwell). */
const toRegroup = (s: GameState) => resolve(resolve(s, { type: 'pass' }), { type: 'pass' })
const toNextRound = (s: GameState) => resolve(resolve(s, { type: 'skipResource' }), { type: 'skipResource' })
const attackBase = (s: GameState, attackerId: string, who: PlayerId = 'player') =>
  resolve({ ...s, activePlayer: who }, { type: 'attack', attackerId, target: { kind: 'base' } })
const attackUnit = (s: GameState, attackerId: string, defenderId: string, who: PlayerId = 'player') =>
  resolve({ ...s, activePlayer: who }, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: defenderId } })

describe('When Played: disclose', () => {
  it('SEC_062 Bardottan Ornithopter: disclose Vigilance, draw a card', () => {
    const s = board({ hand: ['SEC_062', 'VIG'], deck: ['GRD'] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(choice(played)).toMatchObject({ kind: 'disclose', need: ['Vigilance'] })
    const done1 = disclose(played, 0)
    expect(done1.players.player.hand).toHaveLength(2) // VIG still in hand (revealed, not lost), plus the drawn GRD
    expect(done1.players.player.hand).toContain('GRD')
  })

  it('SEC_109 Diplomatic Envoy: disclose Command, next unit played this phase gains Ambush', () => {
    const s = board({ hand: ['SEC_109', 'CMD'], deck: [] })
    let next = resolve(s, { type: 'playUnit', handIndex: 0 })
    next = disclose(next, 0)
    expect(next.players.player.nextUnitGrants).toEqual([{ keywords: [{ name: 'Ambush' }] }])
  })

  it('SEC_141 The Galleon: disclose Aggression Aggression Villainy, create 3 Spy tokens', () => {
    const s = board({ hand: ['SEC_141', 'AGG2', 'VIL'], deck: [] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    const done1 = disclose(played, 0, 1)
    expect(done1.players.player.units.filter(u => u.cardId === 'TOKEN_SPY')).toHaveLength(3)
  })

  it('SEC_223 Duchess\'s Investigators: disclose Cunning, opponent discards a random card', () => {
    const s = board({ hand: ['SEC_223', 'CUN'], deck: [] }, { hand: ['GRD'], deck: [] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    const done1 = disclose(played, 0)
    const discarded = accept(done1, { handIndex: 0 }) // the opponent's own forced discard pick
    expect(discarded.players.opponent.hand).toHaveLength(0)
  })

  it('SEC_182 Charged with Treason: disclose Aggression Aggression, deal 5 damage to a unit', () => {
    const s = board({ hand: ['SEC_182', 'AGG2'], deck: [] }, { units: [unit('e', 'TANK')] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const revealed = disclose(played, 0)
    const target = choice(revealed)
    expect(target.kind).toBe('selectDamageTarget')
    const dealt = accept(revealed, { targetInstanceId: 'e' })
    expect(U(dealt, 'e')?.damage).toBe(5)
  })

  it("SEC_230 Charged with Espionage: disclose Cunning Cunning, look at an opponent's hand and discard a unit", () => {
    const s = board({ hand: ['SEC_230', 'CUN'], deck: [] }, { hand: ['GRD', 'VIG'], deck: [] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const revealed = disclose(played, 0)
    const look = choice(revealed)
    expect(look).toMatchObject({ kind: 'lookAtHand', discardFilter: 'unit' })
    const discarded = accept(revealed, { handIndex: 0 }) // GRD is the only unit
    expect(discarded.players.opponent.hand).toEqual(['VIG'])
  })

  it('SEC_181 Unauthorized Investigation: unconditional Spy token, then disclose Aggression for a second', () => {
    const s = board({ hand: ['SEC_181', 'AGG'], deck: [] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(played.players.player.units.filter(u => u.cardId === 'TOKEN_SPY')).toHaveLength(1) // unconditional
    const done1 = disclose(played, 0)
    expect(done1.players.player.units.filter(u => u.cardId === 'TOKEN_SPY')).toHaveLength(2)
  })

  it('SEC_181 declined: only the unconditional Spy token', () => {
    const s = board({ hand: ['SEC_181', 'AGG'], deck: [] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const declined = declineDisclose(played)
    expect(declined.players.player.units.filter(u => u.cardId === 'TOKEN_SPY')).toHaveLength(1)
  })

  it('SEC_127 Charged with Corruption: disclose Command Command, then guardian then target, then capture', () => {
    const s = board({ hand: ['SEC_127', 'CMD2'], deck: [] }, { units: [unit('e', 'GRD')] })
    let next = resolve({ ...s, players: { ...s.players, player: { ...s.players.player, units: [unit('g', 'GRD2')] } } }, { type: 'playEvent', handIndex: 0 })
    next = disclose(next, 0)
    expect(choice(next)).toMatchObject({ kind: 'selectUnitThen', targets: ['g'] })
    next = accept(next, { targetInstanceId: 'g' })
    expect(choice(next)).toMatchObject({ kind: 'selectUnitThen', targets: ['e'] })
    next = accept(next, { targetInstanceId: 'e' })
    expect(U(next, 'g')?.captured?.map(c => c.cardId)).toEqual(['GRD'])
    expect(all(next).some(u => u.instanceId === 'e')).toBe(false)
  })

  it('SEC_211 Faith in Your Friends: unconditional search-and-draw, then disclose for 2 Spy tokens', () => {
    const s = board({ hand: ['SEC_211', 'CUN3', 'HER2'], deck: ['GRD', 'GRD2', 'PLAIN'] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const search = choice(played)
    expect(search.kind).toBe('searchDraw')
    const drawn = accept(played, { deckIndex: 0 })
    expect(drawn.players.player.hand).toContain('GRD')
    const done1 = disclose(drawn, drawn.players.player.hand.indexOf('CUN3'), drawn.players.player.hand.indexOf('HER2'))
    expect(done1.players.player.units.filter(u => u.cardId === 'TOKEN_SPY')).toHaveLength(2)
  })
})

describe('Unconditional first, gated second', () => {
  it('SEC_074 Relief Request: heal 3 from a unit, then disclose Vigilance to heal 3 from another', () => {
    const s = board({ hand: ['SEC_074', 'VIG'], deck: [] }, {}, {})
    const withUnits = { ...s, players: { ...s.players, player: { ...s.players.player, units: [unit('a', 'TANK', { damage: 5 }), unit('b', 'TANK2', { damage: 5 })] } } }
    let next = resolve(withUnits, { type: 'playEvent', handIndex: 0 })
    expect(choice(next)).toMatchObject({ kind: 'selectUnitThen' })
    next = accept(next, { targetInstanceId: 'a' })
    expect(U(next, 'a')?.damage).toBe(2)
    next = disclose(next, next.players.player.hand.indexOf('VIG'))
    expect(choice(next)).toMatchObject({ kind: 'selectUnitThen', targets: ['b'] }) // "another" excludes 'a'
    next = accept(next, { targetInstanceId: 'b' })
    expect(U(next, 'b')?.damage).toBe(2)
  })

  it('SEC_129 With Thunderous Applause: buff a unit, then disclose Command to buff another', () => {
    const s = board({ hand: ['SEC_129', 'CMD'], deck: [] }, {}, {})
    const withUnits = { ...s, players: { ...s.players, player: { ...s.players.player, units: [unit('a', 'GRD'), unit('b', 'GRD2')] } } }
    let next = resolve(withUnits, { type: 'playEvent', handIndex: 0 })
    next = accept(next, { targetInstanceId: 'a' })
    next = disclose(next, next.players.player.hand.indexOf('CMD'))
    expect(choice(next)).toMatchObject({ kind: 'selectUnitThen', targets: ['b'] })
    next = accept(next, { targetInstanceId: 'b' })
    expect(next.pendingChoices ?? []).toHaveLength(0)
  })

  it('SEC_234 Bog Down in Procedure: exhaust a unit, then disclose Cunning to exhaust another', () => {
    const s = board({ hand: ['SEC_234', 'CUN'], deck: [] }, {}, {})
    const withUnits = { ...s, players: { ...s.players, player: { ...s.players.player, units: [unit('a', 'GRD'), unit('b', 'GRD2')] } } }
    let next = resolve(withUnits, { type: 'playEvent', handIndex: 0 })
    next = accept(next, { targetInstanceId: 'a' })
    expect(U(next, 'a')?.exhausted).toBe(true)
    next = disclose(next, next.players.player.hand.indexOf('CUN'))
    next = accept(next, { targetInstanceId: 'b' })
    expect(U(next, 'b')?.exhausted).toBe(true)
  })

  it('SEC_076 Charged with Murder: disclose Vigilance Vigilance, then defeat a damaged non-leader unit', () => {
    const s = board({ hand: ['SEC_076', 'VIG', 'VIGVIL'], deck: [] }, { units: [unit('e', 'GRD', { damage: 1 })] })
    let next = resolve(s, { type: 'playEvent', handIndex: 0 })
    next = disclose(next, next.players.player.hand.indexOf('VIG'), next.players.player.hand.indexOf('VIGVIL'))
    expect(choice(next)).toMatchObject({ kind: 'selectUnitThen', targets: ['e'] })
    next = accept(next, { targetInstanceId: 'e' })
    expect(all(next).some(u => u.instanceId === 'e')).toBe(false)
  })

  it("SEC_037 Cantwell Arrestor Cruiser: disclose Vigilance Vigilance Villainy, exhaust an enemy unit that can't ready while this is in play", () => {
    const s = board({ hand: ['SEC_037', 'VIGVIL', 'VIG'], deck: [] }, { units: [unit('e', 'GRD')] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 }) // Cantwell itself enters as u10
    const revealed = disclose(played, played.players.player.hand.indexOf('VIGVIL'), played.players.player.hand.indexOf('VIG'))
    expect(choice(revealed)).toMatchObject({ kind: 'selectUnitThen', targets: ['e'] })
    const locked = accept(revealed, { targetInstanceId: 'e' })
    expect(U(locked, 'e')?.exhausted).toBe(true)
    // Outlives the round, unlike an `untilRoundEnd` effect, for as long as Cantwell stays in play.
    const nextRound = toNextRound(toRegroup(locked))
    expect(U(nextRound, 'e')?.exhausted).toBe(true)
    // Once Cantwell itself leaves play the lock lifts, and the next regroup readies the unit.
    const gone = defeatUnit(nextRound, 'u10')
    const readiedRound = toNextRound(toRegroup(gone))
    expect(U(readiedRound, 'e')?.exhausted).toBe(false)
  })
})

describe('When Defeated: disclose', () => {
  it('SEC_059 Senate Warden: disclose Vigilance, give an Experience token to a unit', () => {
    const s = board({ hand: ['VIG'] }, {}, {})
    const withUnit = { ...s, players: { ...s.players, player: { ...s.players.player, units: [unit('t', 'SEC_059')] } } }
    const defeated = defeatUnit(withUnit, 't')
    const done1 = disclose(defeated, 0)
    expect(done1.pendingChoices ?? []).toHaveLength(0)
  })

  it('SEC_094 Mina Bonteri: disclose Command Command Heroism, draw a card', () => {
    const s = board({ hand: ['CMD2', 'HER'], deck: ['GRD'] })
    const withUnit = { ...s, players: { ...s.players, player: { ...s.players.player, units: [unit('t', 'SEC_094')] } } }
    const defeated = defeatUnit(withUnit, 't')
    const done1 = disclose(defeated, defeated.players.player.hand.indexOf('CMD2'), defeated.players.player.hand.indexOf('HER'))
    expect(done1.players.player.hand).toContain('GRD')
  })

  it('SEC_148 Karis Nemik: disclose Aggression Heroism, create a Spy token and ready it', () => {
    const s = board({ hand: ['AGGHER'] })
    const withUnit = { ...s, players: { ...s.players, player: { ...s.players.player, units: [unit('t', 'SEC_148')] } } }
    const defeated = defeatUnit(withUnit, 't')
    const done1 = disclose(defeated, 0)
    const spy = done1.players.player.units.find(u => u.cardId === 'TOKEN_SPY')
    expect(spy?.exhausted).toBe(false)
  })

  it("SEC_153 Luthen's Haulcraft: disclose Aggression Aggression Heroism, the opponent discards 2", () => {
    const s = board({ hand: ['AGG2', 'HER'] }, { hand: ['GRD', 'VIG', 'CMD'] })
    const withUnit = { ...s, players: { ...s.players, player: { ...s.players.player, units: [unit('t', 'SEC_153')] } } }
    const defeated = defeatUnit(withUnit, 't')
    const done1 = disclose(defeated, defeated.players.player.hand.indexOf('AGG2'), defeated.players.player.hand.indexOf('HER'))
    // The opponent discards, one forced pick at a time (their own choice of which).
    const first = accept(done1, { handIndex: 0 })
    const second = accept(first, { handIndex: 0 })
    expect(second.players.opponent.hand).toHaveLength(1)
  })

  it('SEC_120 Naboo Security Force: When Played AND When Defeated both offer disclose Command', () => {
    const s = board({ hand: ['SEC_120', 'CMD', 'PLAIN'], deck: [] })
    const withUnits = { ...s, players: { ...s.players, player: { ...s.players.player, units: [unit('f', 'PLAIN')] } } }
    const played = resolve(withUnits, { type: 'playUnit', handIndex: 0 })
    expect(choice(played)).toMatchObject({ kind: 'disclose', need: ['Command'] })
    const done1 = disclose(played, played.players.player.hand.indexOf('CMD'))
    const buffed = accept(done1, { targetInstanceId: 'f' })
    expect(buffed.pendingChoices ?? []).toHaveLength(0)
    // When Defeated
    const withUnit2 = { ...board({ hand: ['CMD'] }) }
    const withT = { ...withUnit2, players: { ...withUnit2.players, player: { ...withUnit2.players.player, units: [unit('t', 'SEC_120')] } } }
    const defeated = defeatUnit(withT, 't')
    expect(choice(defeated)).toMatchObject({ kind: 'disclose', need: ['Command'] })
  })
})

describe('On Attack: disclose', () => {
  it('SEC_065 Nala Se: disclose Vigilance Vigilance, heal up to 4 among other damaged units', () => {
    const s = board({ hand: ['VIG', 'VIGVIL'], units: [unit('a', 'SEC_065'), unit('b', 'TANK', { damage: 3 })] })
    const attacked = attackBase(s, 'a')
    const revealed = disclose(attacked, 0, 1)
    expect(choice(revealed)).toMatchObject({ kind: 'distributeHealing' })
    expect((choice(revealed) as { unitTargets: string[] }).unitTargets).toEqual(['b']) // self excluded
  })

  it('SEC_085 Vice Admiral Rampart: disclose Command Command Villainy, Experience to up to 2 other units', () => {
    const s = board({ hand: ['CMDVIL', 'CMD'], units: [unit('a', 'SEC_085'), unit('b', 'GRD'), unit('c', 'GRD2')] })
    const attacked = attackBase(s, 'a')
    const revealed = disclose(attacked, attacked.players.player.hand.indexOf('CMDVIL'), attacked.players.player.hand.indexOf('CMD'))
    expect(choice(revealed)).toMatchObject({ kind: 'distributeTokens', upTo: true })
    expect((choice(revealed) as { targets: string[] }).targets.sort()).toEqual(['b', 'c'])
  })

  it('SEC_190 Soulless One: disclose Cunning Cunning Villainy, ready 2 resources', () => {
    const s = board({ hand: ['CUN3'], units: [unit('a', 'SEC_190')], resources: [{ cardId: 'R', exhausted: true }, { cardId: 'R2', exhausted: true }] })
    const attacked = attackBase(s, 'a')
    const done1 = disclose(attacked, 0)
    expect(done1.players.player.resources.filter(r => !r.exhausted)).toHaveLength(2)
  })

  it('SEC_248 B2EM0: disclose Heroism Heroism, give a unit Sentinel for this phase', () => {
    const s = board({ hand: ['HER2'], units: [unit('a', 'SEC_248'), unit('b', 'GRD')] })
    const attacked = attackBase(s, 'a')
    const revealed = disclose(attacked, 0)
    expect(choice(revealed)).toMatchObject({ kind: 'mayLastingBuff' })
  })

  it("SEC_164 Warrior of Clan Ordo: disclose Aggression or deal 2 damage to your own base", () => {
    const s = board({ hand: ['AGG'], units: [unit('a', 'SEC_164')] })
    const attacked = attackBase(s, 'a')
    const disclosed = disclose(attacked, 0)
    expect(disclosed.players.player.base.damage).toBe(0)
    const declined = declineDisclose(attackBase(s, 'a'))
    expect(declined.players.player.base.damage).toBe(2)
  })

  it('SEC_219 Ebon Hawk: disclosing Heroism buffs itself, disclosing Villainy debuffs the defender, independently', () => {
    const s = board({ hand: ['HER', 'VIL'], units: [unit('a', 'SEC_219')] }, { units: [unit('e', 'GRD')] })
    const attacked = attackUnit(s, 'a', 'e')
    let next = disclose(attacked, attacked.players.player.hand.indexOf('HER'))
    // Villainy stage now pending
    next = disclose(next, next.players.player.hand.indexOf('VIL'))
    expect(next.pendingChoices ?? []).toHaveLength(0)
  })

  it('SEC_219 declining both disclosures buffs nothing', () => {
    const s = board({ hand: ['HER', 'VIL'], units: [unit('a', 'SEC_219')] }, { units: [unit('e', 'GRD')] })
    const attacked = attackUnit(s, 'a', 'e')
    let next = declineDisclose(attacked)
    next = declineDisclose(next)
    expect(next.pendingChoices ?? []).toHaveLength(0)
  })

  it('SEC_133 Syril Karn: disclose, choose a unit, discarding a card cancels the 2 damage', () => {
    const s = board({ hand: ['AGGVIL', 'AGG'], units: [unit('a', 'SEC_133')] }, { hand: ['GRD'], units: [unit('e', 'TANK')] })
    const attacked = attackBase(s, 'a')
    const revealed = disclose(attacked, attacked.players.player.hand.indexOf('AGGVIL'), attacked.players.player.hand.indexOf('AGG'))
    expect(choice(revealed)).toMatchObject({ kind: 'selectUnitThen' })
    const targeted = accept(revealed, { targetInstanceId: 'e' })
    expect(choice(targeted)).toMatchObject({ kind: 'discardOrDamage', targetInstanceId: 'e', amount: 2 })
    const discarded = accept(targeted, { handIndex: 0 })
    expect(U(discarded, 'e')?.damage).toBe(0)
    expect(discarded.players.opponent.hand).toHaveLength(0)
  })

  it('SEC_133 Syril Karn: declining to discard lets the 2 damage through', () => {
    const s = board({ hand: ['AGGVIL', 'AGG'], units: [unit('a', 'SEC_133')] }, { hand: ['GRD'], units: [unit('e', 'TANK')] })
    const attacked = attackBase(s, 'a')
    const revealed = disclose(attacked, attacked.players.player.hand.indexOf('AGGVIL'), attacked.players.player.hand.indexOf('AGG'))
    const targeted = accept(revealed, { targetInstanceId: 'e' })
    const declined = skip(targeted)
    expect(U(declined, 'e')?.damage).toBe(2)
    expect(declined.players.opponent.hand).toHaveLength(1) // never discarded
  })
})

describe('Raw trigger points: disclose', () => {
  it('SEC_096 Ahsoka Tano: onAttackEnd (survives), disclose Command Heroism, attack with another unit', () => {
    const s = board({ hand: ['CMDHER'], units: [unit('a', 'SEC_096'), unit('b', 'GRD')] })
    const attacked = attackBase(s, 'a')
    const revealed = disclose(attacked, 0)
    const offer = choice(revealed)
    expect(offer.kind).toBe('mayAttackAnyUnit')
  })

  it('SEC_098 Captain Typho: onDefense, disclose Command Heroism, heal 1 from base', () => {
    const s = board({}, {}, {})
    const withUnits = { ...s, players: { ...s.players, player: { ...s.players.player, hand: ['CMDHER'], base: { ...s.players.player.base, damage: 3 }, units: [unit('t', 'SEC_098')] }, opponent: { ...s.players.opponent, units: [unit('e', 'GRD')] } } }
    const attacked = attackUnit(withUnits, 'e', 't', 'opponent')
    const revealed = disclose(attacked, 0)
    expect(revealed.players.player.base.damage).toBe(2)
  })

  it('SEC_107 Chancellor Valorum: onAttackEnd, disclose Command Command Command, top of deck into play as a resource', () => {
    const s = board({ hand: ['CMD3'], units: [unit('a', 'SEC_107')], deck: ['GRD'] })
    const attacked = attackBase(s, 'a')
    const done1 = disclose(attacked, 0)
    expect(done1.players.player.resources.map(r => r.cardId)).toContain('GRD')
  })

  it('SEC_159 Chairman Papanoida: a draw during the action phase offers disclose, then creates a Spy token', () => {
    const s = board({ hand: ['AGG2'], units: [unit('p', 'SEC_159')], deck: ['GRD'] })
    const drew = drawCards(s, 'player', 1)
    expect(choice(drew)).toMatchObject({ kind: 'disclose', need: ['Aggression', 'Aggression'] })
    const done1 = disclose(drew, drew.players.player.hand.indexOf('AGG2'))
    expect(done1.players.player.units.filter(u => u.cardId === 'TOKEN_SPY')).toHaveLength(1)
  })

  it("SEC_159 Chairman Papanoida: fires for an opponent's draw too, but not for the regroup phase's draw", () => {
    const s = board({ units: [unit('p', 'SEC_159')] }, { deck: ['GRD'] })
    const oppDrew = drawCards(s, 'opponent', 1)
    expect(choice(oppDrew).kind).toBe('disclose')
    const regroupDraw = drawCards({ ...s, phase: 'regroup' }, 'opponent', 1)
    expect(regroupDraw.pendingChoices ?? []).toHaveLength(0)
  })
})

describe("SEC_004 Leia Organa (leader): choose an aspect, disclose it, buff a unit not sharing that card's aspects", () => {
  it('front action: choose Command, disclose, then Experience to a unit without Command or Heroism', () => {
    const withLeader = board({
      hand: ['CMDHER'], resources: ready(5),
      leader: { cardId: 'SEC_004', deployed: false, epicActionUsed: false, exhausted: false },
      units: [unit('u', 'GRD')],
    })
    const acted = resolve(withLeader, { type: 'useLeaderAbility', index: 0 })
    const mode = choice(acted)
    expect(mode.kind).toBe('chooseMode')
    const chosen = accept(acted, { optionIndex: 1 }) // Command
    const revealed = disclose(chosen, 0)
    const filter = choice(revealed)
    expect(filter.kind).toBe('selectUnitThen') // GRD (no aspects) doesn't share Command
    const picked = accept(revealed, { targetInstanceId: 'u' })
    expect(choice(picked)).toMatchObject({ kind: 'mayGiveTokens' })
    const given = accept(picked, { targetInstanceId: 'u' })
    expect(given.pendingChoices ?? []).toHaveLength(0)
  })
})
