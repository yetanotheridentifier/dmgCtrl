import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { dealDamageToUnit } from '../engine/combat'
import { dealDamageToBase } from '../engine/effects'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { describeAction } from '../utils/describeAction'
import { describeChoiceParts } from '../utils/describeChoice'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { TOKEN_SPY } from '../engine/tokenUnits'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState, UpgradeAttachment } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Replacement effects: "if X would happen, (you may) do Y instead" (CR 7.7.5). A replacement settles as
 * the event it replaces is about to happen, so a "you may" one is asked there and the event waits on the
 * answer: mid-combat for Queen Amidala, mid-defeat for Vice Admiral Rampart. A replaced cost is still
 * paid, and the text after "If you do" still resolves (CR 1.8.10, 8.9.2).
 */

const POOL = poolFor(['SOR', 'SHD', 'SEC', 'HMW', 'LOF'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && Number(c.Number) === Number(number) && (c.VariantType == null || c.VariantType === 'Normal'))
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return { ...normaliseCard(row), id }
}

const SHIPPED = ['SEC_101', 'HMW_060', 'HMW_185', 'SHD_090', 'LOF_206']
const OTHERS = ['HMW_037', 'HMW_216', 'SOR_251', 'SOR_172']
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries([...SHIPPED, ...OTHERS].map(id => [id, real(id)])),
  NABOO: card({ id: 'NABOO', arena: 'ground', cost: 2, power: 2, hp: 4, traits: ['NABOO'] }),
  PLAIN: card({ id: 'PLAIN', arena: 'ground', cost: 2, power: 2, hp: 4, traits: ['TROOPER'] }),
  ENEMY: card({ id: 'ENEMY', arena: 'ground', cost: 3, power: 2, hp: 8 }),
  BIG: card({ id: 'BIG', arena: 'ground', cost: 3, power: 4, hp: 30 }),
  UW: card({ id: 'UW', arena: 'ground', cost: 3, power: 1, hp: 9, traits: ['UNDERWORLD'] }),
  DROID: card({ id: 'DROID', arena: 'ground', cost: 3, power: 1, hp: 7, traits: ['DROID'] }),
  CREATURE: card({ id: 'CREATURE', arena: 'ground', cost: 3, power: 1, hp: 9, traits: ['CREATURE'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}): GameState => state({
  cards: F,
  players: {
    player: player({ resources: ready(10), deck: ['PLAIN', 'PLAIN', 'PLAIN'], ...mine }),
    opponent: player({ resources: ready(10), deck: ['PLAIN', 'PLAIN', 'PLAIN'], ...theirs }),
  },
  ...over,
})
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)
const find = (s: GameState, kind: PendingChoice['kind']) => s.pendingChoices?.find(c => c.kind === kind)
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toEqual([])
const accept = (s: GameState, c: PendingChoice, extra: Partial<Extract<Action, { type: 'acceptChoice' }>> = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: c.id, ...extra })
const skip = (s: GameState, c: PendingChoice) => resolve(s, { type: 'skipTrigger', choiceId: c.id })
const answers = (s: GameState, c: PendingChoice) => legalMoves(s).filter(m => (m.type === 'acceptChoice' || m.type === 'skipTrigger') && m.choiceId === c.id)
const attackUnit = (s: GameState, attackerId: string, targetId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: targetId } })
const on = (cardId: string, owner: PlayerId = 'player'): UpgradeAttachment => ({ cardId, owner })
const fortified = (...cardIds: string[]) => ({ base: { cardId: 'TST_B', damage: 0, upgrades: cardIds.map(id => on(id)) } })
const baseUpgrades = (s: GameState, who: PlayerId = 'player') => (s.players[who].base.upgrades ?? []).map(u => u.cardId)
const withHand = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState => {
  const p = s.players[who]
  return { ...s, activePlayer: who, players: { ...s.players, [who]: { ...p, hand: [...p.hand, cardId] } } }
}
const playEvent = (s: GameState, cardId: string, who: PlayerId = 'player') =>
  resolve(withHand(s, cardId, who), { type: 'playEvent', handIndex: s.players[who].hand.length })
const playUnit = (s: GameState, cardId: string, who: PlayerId = 'player') =>
  resolve(withHand(s, cardId, who), { type: 'playUnit', handIndex: s.players[who].hand.length })

describe('replacement effects: the cards', () => {
  it('registers every card on the ticket', () => {
    for (const id of SHIPPED) expect(getCardDefinition(id), id).toBeDefined()
  })
})

describe('Queen Amidala (SEC_101): defeat a friendly unit sharing a trait to prevent damage to her', () => {
  it('When Played: creates 2 Spy tokens', () => {
    const s = playUnit(board(), 'SEC_101')
    expect(s.players.player.units.filter(u => u.cardId === TOKEN_SPY)).toHaveLength(2)
  })

  const defending = (mine: UnitState[] = [unit('nab', 'NABOO'), unit('plain', 'PLAIN')]) =>
    board({ units: [unit('amid', 'SEC_101'), ...mine] }, { units: [unit('e', 'ENEMY')] }, { activePlayer: 'opponent' })

  it('suspends an attack on her mid-combat, offering only other friendly units that share a trait', () => {
    const s = attackUnit(defending(), 'e', 'amid')
    const offer = find(s, 'mayPreventDamage')!
    expect(offer).toMatchObject({ controller: 'player', targetId: 'amid', amount: 2 })
    expect(s.activePlayer).toBe('player')
    expect(U(s, 'amid')!.damage).toBe(0)
    expect(U(s, 'e')!.damage).toBe(0) // nothing has been dealt yet: the damage step waits on her answer
    const picks = answers(s, offer).flatMap(m => (m.type === 'acceptChoice' ? [m.targetInstanceId] : []))
    expect(picks).toEqual(['nab'])
    expect(answers(s, offer).some(m => m.type === 'skipTrigger')).toBe(true)
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: offer.id, targetInstanceId: 'nab' })).toBe('Defeat NABOO to prevent 2')
    expect(describeChoiceParts(s, offer).filter(p => typeof p === 'string').join('')).toMatch(/shares a Trait with this unit to prevent 2 damage/)
  })

  it('taking it defeats the chosen unit, prevents the damage, and the combat resumes', () => {
    const s = attackUnit(defending(), 'e', 'amid')
    const done = accept(s, find(s, 'mayPreventDamage')!, { targetInstanceId: 'nab' })
    expect(U(done, 'nab')).toBeUndefined()
    expect(done.players.player.discard).toContain('NABOO')
    expect(U(done, 'amid')!.damage).toBe(0)
    expect(U(done, 'e')!.damage).toBe(5) // her counter damage still lands
    noChoice(done)
    expect(done.activePlayer).toBe('player') // the opponent's attack is over and the turn has passed
  })

  it('declining lets the damage through', () => {
    const s = attackUnit(defending(), 'e', 'amid')
    const done = skip(s, find(s, 'mayPreventDamage')!)
    expect(U(done, 'amid')!.damage).toBe(2)
    expect(U(done, 'nab')).toBeDefined()
  })

  it('is not offered with no other friendly unit sharing a trait', () => {
    const s = attackUnit(defending([unit('plain', 'PLAIN')]), 'e', 'amid')
    expect(find(s, 'mayPreventDamage')).toBeUndefined()
    expect(U(s, 'amid')!.damage).toBe(2)
  })

  it('her own Spy tokens share her Official trait', () => {
    const s = attackUnit(defending([unit('spy', TOKEN_SPY)]), 'e', 'amid')
    const offer = find(s, 'mayPreventDamage')!
    expect(accept(s, offer, { targetInstanceId: 'spy' }).players.player.units.map(u => u.instanceId)).toEqual(['amid'])
  })

  it('protects her while she attacks, and her damage to the defender still lands', () => {
    const s = attackUnit(board({ units: [unit('amid', 'SEC_101'), unit('nab', 'NABOO')] }, { units: [unit('e', 'ENEMY')] }), 'amid', 'e')
    const offer = find(s, 'mayPreventDamage')!
    expect(offer).toMatchObject({ targetId: 'amid', amount: 2 })
    const done = accept(s, offer, { targetInstanceId: 'nab' })
    expect(U(done, 'amid')!.damage).toBe(0)
    expect(U(done, 'e')!.damage).toBe(5)
  })

  it('prevents ability damage too', () => {
    const s = dealDamageToUnit(defending(), 'amid', 2, { cardId: 'ENEMY', controller: 'opponent' })
    const offer = find(s, 'mayPreventDamage')!
    expect(U(s, 'amid')!.damage).toBe(0)
    const done = accept(s, offer, { targetInstanceId: 'nab' })
    expect(U(done, 'amid')!.damage).toBe(0)
    expect(U(done, 'nab')).toBeUndefined()
  })
})

describe('Vice Admiral Rampart (HMW_060): defeat him instead of an upgrade on your base', () => {
  const discardUnit = { discard: ['PLAIN'] }

  it('replaces a "[defeat this upgrade]" cost: the upgrade stays, Rampart goes, and the ability still resolves', () => {
    const s0 = board({ ...fortified('HMW_037'), ...discardUnit, units: [unit('ramp', 'HMW_060')] })
    const used = resolve(s0, { type: 'useBaseAbility', cardId: 'HMW_037', index: 0 })
    const offer = find(used, 'mayDefeatInstead')!
    expect(offer).toMatchObject({ controller: 'player', unitId: 'ramp' })
    expect(baseUpgrades(used)).toEqual(['HMW_037'])
    const replaced = accept(used, offer)
    expect(U(replaced, 'ramp')).toBeUndefined()
    expect(replaced.players.player.discard).toContain('HMW_060')
    expect(baseUpgrades(replaced)).toEqual(['HMW_037'])
    // The cost counts as paid, so Bacta Tank's effect still resolves.
    const pick = find(replaced, 'selectCardThen')!
    const done = accept(replaced, pick, { optionIndex: 0 })
    expect(done.players.player.deck[0]).toBe('PLAIN')
  })

  it('declining defeats the upgrade as normal', () => {
    const s0 = board({ ...fortified('HMW_037'), ...discardUnit, units: [unit('ramp', 'HMW_060')] })
    const used = resolve(s0, { type: 'useBaseAbility', cardId: 'HMW_037', index: 0 })
    const declined = skip(used, find(used, 'mayDefeatInstead')!)
    expect(baseUpgrades(declined)).toEqual([])
    expect(declined.players.player.discard).toContain('HMW_037')
    expect(U(declined, 'ramp')).toBeDefined()
  })

  it('"If you do" still reads as done: Insurgent Camp readies the unit and stays on the base', () => {
    const s = playUnit(board({ ...fortified('HMW_216'), units: [unit('ramp', 'HMW_060')] }), 'PLAIN')
    const camp = find(s, 'mayPayThen')!
    const paid = accept(s, camp)
    const offer = find(paid, 'mayDefeatInstead')!
    const done = accept(paid, offer)
    const played = done.players.player.units.find(u => u.cardId === 'PLAIN')!
    expect(played.exhausted).toBe(false)
    expect(baseUpgrades(done)).toEqual(['HMW_216'])
    expect(U(done, 'ramp')).toBeUndefined()
  })

  it("is asked of Rampart's controller when an opponent's card defeats the upgrade", () => {
    const s0 = board({ ...fortified('HMW_216'), units: [unit('ramp', 'HMW_060')] }, {}, { activePlayer: 'opponent' })
    const confiscate = playEvent(s0, 'SOR_251', 'opponent')
    const pick = find(confiscate, 'selectUpgradeToDefeat') ?? confiscate.pendingChoices![0]
    const picked = accept(confiscate, pick, { optionIndex: 0 })
    const offer = find(picked, 'mayDefeatInstead')!
    expect(offer.controller).toBe('player')
    expect(picked.activePlayer).toBe('player')
    const done = accept(picked, offer)
    expect(baseUpgrades(done)).toEqual(['HMW_216'])
    expect(U(done, 'ramp')).toBeUndefined()
    noChoice(done)
    // #696: Confiscate was the opponent's action, so answering the offer ends it and the turn passes.
    expect(picked.pendingResumeActive).toBe('opponent')
    expect(done.activePlayer).toBe('player')
    expect.soft(done.pendingResumeActive).toBeUndefined()
  })

  it("does nothing without Rampart, or for the opponent's base", () => {
    const s0 = board({ ...fortified('HMW_037'), ...discardUnit })
    expect(find(resolve(s0, { type: 'useBaseAbility', cardId: 'HMW_037', index: 0 }), 'mayDefeatInstead')).toBeUndefined()
    const theirs = board({ units: [unit('ramp', 'HMW_060')] }, { base: { cardId: 'TST_B', damage: 0, upgrades: [on('HMW_037', 'opponent')] }, ...discardUnit }, { activePlayer: 'opponent' })
    expect(find(resolve(theirs, { type: 'useBaseAbility', cardId: 'HMW_037', index: 0 }), 'mayDefeatInstead')).toBeUndefined()
  })
})

describe('Ty Yorrick (HMW_185): a friendly ability deals 1 more damage', () => {
  const withTy = (mine: Side = {}, theirs: Side = {}) =>
    board({ units: [unit('ty', 'HMW_185'), unit('mine', 'BIG')], ...mine }, { units: [unit('e', 'BIG')], ...theirs })

  it('adds 1 to a friendly ability dealing damage to an enemy unit', () => {
    const s = playEvent(withTy(), 'SOR_172')
    const done = accept(s, find(s, 'selectDamageTarget')!, { targetInstanceId: 'e' })
    expect(U(done, 'e')!.damage).toBe(5)
  })

  it('does not add to damage a friendly ability deals to a friendly unit', () => {
    const s = playEvent(withTy(), 'SOR_172')
    const done = accept(s, find(s, 'selectDamageTarget')!, { targetInstanceId: 'mine' })
    expect(U(done, 'mine')!.damage).toBe(4)
  })

  it("adds 1 to a friendly ability's damage to the enemy base, not to your own", () => {
    const s = withTy()
    expect(dealDamageToBase(s, 'opponent', 2, { cardId: 'SOR_172', controller: 'player' }).players.opponent.base.damage).toBe(3)
    expect(dealDamageToBase(s, 'player', 2, { cardId: 'SOR_172', controller: 'player' }).players.player.base.damage).toBe(2)
  })

  it("does not add to combat damage, or to an opponent's ability", () => {
    const attacked = attackUnit(withTy(), 'mine', 'e')
    expect(U(attacked, 'e')!.damage).toBe(4)
    const theirs = dealDamageToUnit(withTy(), 'mine', 2, { cardId: 'SOR_172', controller: 'opponent' })
    expect(U(theirs, 'mine')!.damage).toBe(2)
  })

  it('adds 1 per unit to damage divided among units, not 1 per point', () => {
    const s0 = withTy({}, { units: [unit('e', 'BIG'), unit('e2', 'BIG')] })
    let s: GameState = {
      ...s0,
      pendingChoices: [{ kind: 'distributeDamage', id: 'div', controller: 'player', remaining: 3, total: 3, targets: ['e', 'e2'], enemiesOf: 'player', source: { cardId: 'SOR_172', controller: 'player' } }],
    }
    s = accept(s, s.pendingChoices![0], { targetInstanceId: 'e' })
    s = accept(s, s.pendingChoices![0], { targetInstanceId: 'e' })
    s = accept(s, s.pendingChoices![0], { targetInstanceId: 'e2' })
    expect(U(s, 'e')!.damage).toBe(3)
    expect(U(s, 'e2')!.damage).toBe(2)
  })

  it('On Attack: may deal 1 damage to a Creature unit, which her own ability makes 2', () => {
    const s = attackUnit(withTy({}, { units: [unit('e', 'BIG'), unit('c', 'CREATURE')] }), 'ty', 'e')
    const offer = s.pendingChoices![0]
    expect(answers(s, offer).flatMap(m => (m.type === 'acceptChoice' ? [m.targetInstanceId] : []))).toEqual(['c'])
    expect(answers(s, offer).some(m => m.type === 'skipTrigger')).toBe(true)
    const done = accept(s, offer, { targetInstanceId: 'c' })
    expect(U(done, 'c')!.damage).toBe(2)
  })
})

describe('Maul (SHD_090): damage to him during his attack goes to a chosen Underworld unit', () => {
  const maulBoard = (mine: UnitState[] = [unit('uw', 'UW'), unit('plain', 'PLAIN')]) =>
    board({ units: [unit('maul', 'SHD_090'), ...mine] }, { units: [unit('e', 'BIG')] })

  it('On Attack offers only another friendly Underworld unit, and may be declined', () => {
    const s = attackUnit(maulBoard(), 'maul', 'e')
    const offer = s.pendingChoices![0]
    expect(answers(s, offer).flatMap(m => (m.type === 'acceptChoice' ? [m.targetInstanceId] : []))).toEqual(['uw'])
    expect(answers(s, offer).some(m => m.type === 'skipTrigger')).toBe(true)
  })

  it("the defender's combat damage is dealt to the chosen unit instead", () => {
    const s = attackUnit(maulBoard(), 'maul', 'e')
    const done = accept(s, s.pendingChoices![0], { targetInstanceId: 'uw' })
    expect(U(done, 'maul')!.damage).toBe(0)
    expect(U(done, 'uw')!.damage).toBe(4)
    expect(U(done, 'e')!.damage).toBe(7)
  })

  it('declining leaves the damage on Maul', () => {
    const s = attackUnit(maulBoard(), 'maul', 'e')
    const done = skip(s, s.pendingChoices![0])
    expect(U(done, 'maul')!.damage).toBe(4)
    expect(U(done, 'uw')!.damage).toBe(0)
  })

  it('lasts for that attack only', () => {
    const s = attackUnit(maulBoard(), 'maul', 'e')
    const done = accept(s, s.pendingChoices![0], { targetInstanceId: 'uw' })
    const later = dealDamageToUnit(done, 'maul', 2, { cardId: 'SOR_172', controller: 'opponent' })
    expect(U(later, 'maul')!.damage).toBe(2)
    expect(U(later, 'uw')!.damage).toBe(4)
  })

  it('damage to him from a Shielded chosen unit is soaked by that unit\'s Shield', () => {
    const s = attackUnit(maulBoard([unit('uw', 'UW', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })]), 'maul', 'e')
    const done = accept(s, s.pendingChoices![0], { targetInstanceId: 'uw' })
    expect(U(done, 'maul')!.damage).toBe(0)
    expect(U(done, 'uw')!.damage).toBe(0)
    expect(U(done, 'uw')!.upgrades).toEqual([])
  })
})

describe('Babu Frik (LOF_206): a Droid attacks dealing damage equal to its remaining HP', () => {
  const babuBoard = (mine: UnitState[] = [unit('droid', 'DROID', { damage: 2 }), unit('plain', 'PLAIN')]) =>
    board({ units: [unit('babu', 'LOF_206'), ...mine] }, { units: [unit('e', 'BIG')] })
  const use = (s: GameState) => resolve(s, { type: 'useAbility', instanceId: 'babu', cardId: 'LOF_206', index: 0 })

  it('exhausts Babu and offers an attack with a friendly Droid only', () => {
    const s = use(babuBoard())
    expect(U(s, 'babu')!.exhausted).toBe(true)
    const offer = find(s, 'mayAttackAnyUnit')!
    expect(offer).toMatchObject({ attacker: { trait: 'Droid' } })
    const attackers = new Set(legalMoves(s).flatMap(m => (m.type === 'attack' ? [m.attackerId] : [])))
    expect([...attackers]).toEqual(['droid'])
  })

  it('the Droid deals its remaining HP as combat damage, for that attack only', () => {
    const s = use(babuBoard())
    const offer = find(s, 'mayAttackAnyUnit')!
    const done = resolve(s, { type: 'attack', attackerId: 'droid', target: { kind: 'unit', instanceId: 'e' }, choiceId: offer.id })
    expect(U(done, 'e')!.damage).toBe(5) // 7 HP less 2 damage, not its 1 power
    const again = attackUnit({ ...done, activePlayer: 'player', players: { ...done.players, player: { ...done.players.player, units: done.players.player.units.map(u => ({ ...u, exhausted: false })) } } }, 'droid', 'e')
    expect(U(again, 'e')!.damage).toBe(6) // its own power again
  })

  it('is not usable without a friendly Droid that can attack', () => {
    const s = babuBoard([unit('plain', 'PLAIN')])
    expect(legalMoves(s).some(m => m.type === 'useAbility' && m.instanceId === 'babu')).toBe(false)
  })
})
