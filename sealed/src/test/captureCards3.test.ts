import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { defeatUnit } from '../engine/combat'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { unitHasKeyword } from '../engine/keywords'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { getCardDefinition } from '../engine/abilities'
import { IMPLEMENTED_LEADERS, IMPLEMENTED_EVENTS, IMPLEMENTED_UNITS } from '../data/implementedCards'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import { cardsPlayedThisPhase } from '../engine/types'
import type { EngineCard, GameState, LeaderState, PendingChoice, PlayerId, UnitState } from '../engine/types'

/**
 * The last capture cards: each needs a primitive of its own beyond the guardian/target chaining the
 * earlier capture cards share (`captureCards2.test.ts`). A budgeted multi-target capture (Dismantle
 * the Conspiracy, Cad Bane), a loop of guardians each with its own target (Finalizer), a capture
 * landing before an embedded play's own When Played (DJ), a base guardian with a scheduled rescue
 * (Arrest), playing a captured card outright (Dryden Vos), and a Bounty granted to a chosen unit for
 * the phase (Jabba the Hutt, The Client), which both registrations share.
 */
const POOL = poolFor(['SEC', 'TWI', 'SHD'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}
const SHIPPED = ['SEC_106', 'TWI_187', 'SHD_092', 'SEC_018', 'SEC_195', 'SHD_192', 'SHD_006', 'SHD_031', 'SHD_120']
const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 3, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  HP1: src('HP1', { hp: 1 }),
  HP3: src('HP3', { hp: 3 }),
  HP4: src('HP4', { hp: 4 }),
  HP5: src('HP5', { hp: 5 }),
  BIG: src('BIG', { cost: 6, power: 6, hp: 9 }),
  SPC: src('SPC', { arena: 'space' }),
  SPC2: src('SPC2', { arena: 'space' }),
  CHEAP: src('CHEAP', { cost: 2 }),
}
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
type Side = Parameters<typeof player>[0]
const rich = (over: Side = {}) => player({ resources: ready(20), deck: [], ...over })
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })
const undeployed = (cardId: string): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })
const deployedLeader = (cardId: string): LeaderState => ({ cardId, deployed: true, epicActionUsed: true, exhausted: false })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; baseTarget?: PlayerId }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
const targetsOf = (s: GameState) => [...(choice(s) as unknown as { targets: string[] }).targets].sort()
const candidatesOf = (s: GameState) => (choice(s) as unknown as { candidates: unknown[] }).candidates
const declinable = (s: GameState) => legalMoves(s).some(m => m.type === 'skipTrigger')
const capturedBy = (s: GameState, id: string) => (U(s, id)?.captured ?? []).map(c => c.cardId).sort()
const played = (s: GameState, cardId: string) => {
  const handIndex = s.players.player.hand.indexOf(cardId)
  const type = F[cardId].type
  return resolve(s, type === 'event' ? { type: 'playEvent', handIndex } : { type: 'playUnit', handIndex })
}

describe('registration', () => {
  it('registers every card of the last capture wave and lists it as built', () => {
    for (const id of ['SEC_106', 'TWI_187', 'SHD_092', 'SEC_195', 'SHD_192', 'SHD_031']) {
      expect(getCardDefinition(id), id).toBeTruthy()
      expect([...IMPLEMENTED_EVENTS, ...IMPLEMENTED_UNITS].some(c => c.id === id), id).toBe(true)
    }
    for (const id of ['SEC_018', 'SHD_006']) {
      expect(getCardDefinition(id)?.leaderAbilities, id).toBeTruthy()
      expect(IMPLEMENTED_LEADERS.find(l => l.id === id), id).toMatchObject({ front: true, back: true })
    }
  })
})

describe('SEC_106 Dismantle the Conspiracy: a friendly unit captures any number of enemy non-leader units with a total of 7 or less remaining HP', () => {
  const theirs = { units: [unit('a', 'HP3'), unit('b', 'HP4', { damage: 1 }), unit('c', 'HP5'), unit('ldr', 'BIG', { isLeader: true })] }

  it('picks the guardian, then targets one at a time against the shrinking budget, and captures them all once nothing else fits', () => {
    const s = board({ hand: ['SEC_106'], units: [unit('g', 'BIG')] }, theirs)
    const p = played(s, 'SEC_106')
    expect(targetsOf(p)).toEqual(['g'])
    const g = accept(p, { targetInstanceId: 'g' })
    expect(targetsOf(g)).toEqual(['a', 'b', 'c']) // the leader is never offered
    expect(declinable(g)).toBe(true) // "any number": none is legal
    const one = accept(g, { targetInstanceId: 'a' }) // 3 spent, 4 left
    expect(targetsOf(one)).toEqual(['b']) // b has 3 remaining HP; c has 5
    expect(U(one, 'a')).toBeDefined() // nothing is captured until the picks are done
    const two = accept(one, { targetInstanceId: 'b' }) // 6 spent, 1 left: nothing fits
    noChoice(two)
    expect(capturedBy(two, 'g')).toEqual(['HP3', 'HP4'])
    expect(U(two, 'c')).toBeDefined()
  })

  it('captures what was picked when the player stops, and nothing when they stop at once', () => {
    const s = board({ hand: ['SEC_106'], units: [unit('g', 'BIG')] }, theirs)
    const g = accept(played(s, 'SEC_106'), { targetInstanceId: 'g' })
    const stopped = skip(accept(g, { targetInstanceId: 'a' })) // b would still fit
    noChoice(stopped)
    expect(capturedBy(stopped, 'g')).toEqual(['HP3'])
    expect(U(stopped, 'b')).toBeDefined()
    const none = skip(g)
    noChoice(none)
    expect(capturedBy(none, 'g')).toEqual([])
    expect(none.players.opponent.units).toHaveLength(4)
  })
})

describe('TWI_187 Cad Bane: captures up to 3 enemy non-leader units with a total of 8 or less remaining HP; the defending player may rescue for 2 cards', () => {
  it('stops at 3 units even with budget left', () => {
    const s = board({ hand: ['TWI_187'] }, { units: [unit('a', 'HP1'), unit('b', 'HP1'), unit('c', 'HP1'), unit('d', 'HP1')] })
    let next = played(s, 'TWI_187')
    expect(targetsOf(next)).toEqual(['a', 'b', 'c', 'd'])
    next = accept(next, { targetInstanceId: 'a' })
    next = accept(next, { targetInstanceId: 'b' })
    next = accept(next, { targetInstanceId: 'c' })
    noChoice(next)
    const cad = next.players.player.units.find(u => u.cardId === 'TWI_187')!
    expect(capturedBy(next, cad.instanceId)).toEqual(['HP1', 'HP1', 'HP1'])
    expect(U(next, 'd')).toBeDefined()
  })

  it('reads the budget as a total: 5 and 4 do not both fit in 8', () => {
    const s = board({ hand: ['TWI_187'] }, { units: [unit('five', 'HP5'), unit('four', 'HP4')] })
    const one = accept(played(s, 'TWI_187'), { targetInstanceId: 'five' })
    noChoice(one)
    expect(U(one, 'four')).toBeDefined()
  })

  it('on attack the defending player may rescue a card they own guarded by him, and if they do his controller draws 2', () => {
    const cad = unit('cad', 'TWI_187', { captured: [{ cardId: 'CHEAP', owner: 'opponent' }, { cardId: 'HP3', owner: 'player' }] })
    const s = board({ units: [cad], deck: ['HP1', 'HP1', 'HP1'] })
    const attacked = resolve(s, { type: 'attack', attackerId: 'cad', target: { kind: 'base' } })
    const c = choice(attacked)
    expect(c.controller).toBe('opponent')
    expect(candidatesOf(attacked)).toEqual(['CHEAP']) // not the card the player owns
    expect(declinable(attacked)).toBe(true)
    const rescued = accept(attacked, { optionIndex: 0 })
    expect(rescued.players.opponent.units.map(u => u.cardId)).toEqual(['CHEAP'])
    expect(capturedBy(rescued, 'cad')).toEqual(['HP3'])
    expect(rescued.players.player.hand).toHaveLength(2)
    const declined = skip(attacked)
    expect(declined.players.opponent.units).toHaveLength(0)
    expect(declined.players.player.hand).toHaveLength(0)
  })

  it('offers nothing on attack when he guards no card the defending player owns', () => {
    const s = board({ units: [unit('cad', 'TWI_187', { captured: [{ cardId: 'HP3', owner: 'player' }] })] })
    noChoice(resolve(s, { type: 'attack', attackerId: 'cad', target: { kind: 'base' } }))
  })
})

describe('SHD_092 Finalizer: any number of friendly units each capture an enemy non-leader unit in the same arena', () => {
  it('loops guardian then target, in the guardian\'s own arena, never offering a guardian twice', () => {
    const s = board(
      { hand: ['SHD_092'], units: [unit('g', 'BIG'), unit('s1', 'SPC')] },
      { units: [unit('eg', 'HP3'), unit('es', 'SPC2'), unit('ldr', 'BIG', { isLeader: true })] },
    )
    const p = played(s, 'SHD_092')
    const fin = p.players.player.units.find(u => u.cardId === 'SHD_092')!.instanceId
    expect(targetsOf(p)).toEqual([fin, 'g', 's1'].sort())
    expect(declinable(p)).toBe(true)
    const g = accept(p, { targetInstanceId: 'g' })
    expect(targetsOf(g)).toEqual(['eg']) // ground only, never the leader
    expect(declinable(g)).toBe(false)
    const first = accept(g, { targetInstanceId: 'eg' })
    expect(capturedBy(first, 'g')).toEqual(['HP3'])
    expect(targetsOf(first)).toEqual([fin, 's1'].sort()) // g has been used; no ground enemy is left
    const s1 = accept(accept(first, { targetInstanceId: 's1' }), { targetInstanceId: 'es' })
    expect(capturedBy(s1, 's1')).toEqual(['SPC2'])
    noChoice(s1) // nothing left in any arena
  })

  it('stops whenever the player chooses no more units', () => {
    const s = board({ hand: ['SHD_092'], units: [unit('g', 'BIG')] }, { units: [unit('eg', 'HP3')] })
    const done = skip(played(s, 'SHD_092'))
    noChoice(done)
    expect(U(done, 'eg')).toBeDefined()
  })
})

describe('SEC_018 DJ: a friendly unit captures the unit he plays, before its When Played; rescued friendly units enter ready', () => {
  const front = (mine: Side = {}, theirs: Side = {}) => board({ leader: undeployed('SEC_018'), resources: ready(6), ...mine }, theirs)
  const use = (s: GameState) => resolve(s, { type: 'useLeaderAbility', index: 0 })

  it('is offered only with a friendly unit and a unit in hand he can pay for', () => {
    const usable = (s: GameState) => legalMoves(s).some(m => m.type === 'useLeaderAbility')
    expect(usable(front({ hand: ['SHD_120'] }))).toBe(false)
    expect(usable(front({ units: [unit('g', 'BIG')] }))).toBe(false)
    expect(usable(front({ units: [unit('g', 'BIG')], hand: ['SHD_120'] }))).toBe(true)
  })

  it('plays the unit for 1 less, has the chosen unit capture it, and only then resolves its When Played', () => {
    const s = front({ units: [unit('g', 'BIG')], hand: ['SHD_120'] }, { units: [unit('e', 'HP3')] })
    const used = use(s)
    expect(targetsOf(used)).toEqual(['g'])
    const chosen = accept(used, { targetInstanceId: 'g' })
    expect(choice(chosen).kind).toBe('playUnitFromHand')
    const done = accept(chosen, { handIndex: 0 })
    expect(done.players.player.resources.filter(r => r.exhausted)).toHaveLength(effectiveCost(s, 'player', F.SHD_120) - 1)
    expect(capturedBy(done, 'g')).toEqual(['SHD_120'])
    expect(done.players.player.units.map(u => u.cardId)).toEqual(['BIG'])
    expect(cardsPlayedThisPhase(done, 'player')).toContain('SHD_120')
    expect(done.players.player.leader.exhausted).toBe(true)
    // Discerning Veteran's When Played is still owed, raised on a board it has already left: answering
    // it captures nothing, since its capturer is no longer in play.
    expect(choice(done).kind).toBe('selectUnitThen')
    expect(choice(done).source?.cardId).toBe('SHD_120')
    const wp = accept(done, { targetInstanceId: 'e' })
    expect(U(wp, 'e')).toBeDefined()
  })

  it('deployed, a rescued friendly unit enters play ready, and an enemy one still exhausted', () => {
    const s = board(
      { leader: deployedLeader('SEC_018'), units: [unit('dj', 'SEC_018', { isLeader: true }), unit('mine', 'BIG', { captured: [{ cardId: 'HP3', owner: 'opponent' }] })] },
      { units: [unit('guard', 'BIG', { captured: [{ cardId: 'HP4', owner: 'player' }] })] },
    )
    const freed = defeatUnit(defeatUnit(s, 'guard'), 'mine')
    expect(freed.players.player.units.find(u => u.cardId === 'HP4')?.exhausted).toBe(false)
    expect(freed.players.opponent.units.find(u => u.cardId === 'HP3')?.exhausted).toBe(true)
    const withoutDj = defeatUnit(board({}, { units: [unit('guard', 'BIG', { captured: [{ cardId: 'HP4', owner: 'player' }] })] }), 'guard')
    expect(withoutDj.players.player.units.find(u => u.cardId === 'HP4')?.exhausted).toBe(true)
  })
})

describe('SEC_195 Arrest: your base captures an enemy non-leader unit; its owner rescues it as the regroup phase starts', () => {
  it('puts the unit under the base and brings it back at the start of the regroup phase', () => {
    const s = board({ hand: ['SEC_195'] }, { units: [unit('e', 'HP3'), unit('ldr', 'BIG', { isLeader: true })] })
    const p = played(s, 'SEC_195')
    expect(targetsOf(p)).toEqual(['e'])
    const done = accept(p, { targetInstanceId: 'e' })
    expect(U(done, 'e')).toBeUndefined()
    expect(done.players.player.base.captured).toEqual([{ cardId: 'HP3', owner: 'opponent' }])
    const regroup = resolve({ ...done, activePlayer: 'player', consecutivePasses: 1 }, { type: 'pass' })
    expect(regroup.phase).toBe('regroup')
    expect(regroup.players.player.base.captured ?? []).toEqual([])
    expect(regroup.players.opponent.units.map(u => u.cardId)).toContain('HP3')
  })
})

describe('SHD_192 Dryden Vos: may play a captured card guarded by a friendly unit, for free, under your control', () => {
  it('offers only cards under friendly units, and plays the chosen one free and under your control', () => {
    const s = board(
      { hand: ['SHD_192'], units: [unit('g', 'BIG', { captured: [{ cardId: 'HP4', owner: 'opponent' }] })] },
      { units: [unit('eg', 'BIG', { captured: [{ cardId: 'HP3', owner: 'player' }] })] },
    )
    const p = played(s, 'SHD_192')
    expect(choice(p).kind).toBe('playCardFrom')
    expect((candidatesOf(p) as { cardId: string }[]).map(c => c.cardId)).toEqual(['HP4'])
    expect(declinable(p)).toBe(true)
    const paid = p.players.player.resources.filter(r => r.exhausted).length
    const done = accept(p, { optionIndex: 0 })
    const freed = done.players.player.units.find(u => u.cardId === 'HP4')
    expect(freed).toBeDefined()
    expect(freed!.owner).toBe('opponent') // still theirs: defeated into their pile
    expect(capturedBy(done, 'g')).toEqual([])
    expect(done.players.player.resources.filter(r => r.exhausted)).toHaveLength(paid)
    expect(cardsPlayedThisPhase(done, 'player')).toContain('HP4')
    expect(skip(p).players.player.units.map(u => u.cardId)).not.toContain('HP4')
  })

  it('offers nothing when no friendly unit guards a card', () => {
    const s = board({ hand: ['SHD_192'] }, { units: [unit('eg', 'BIG', { captured: [{ cardId: 'HP3', owner: 'player' }] })] })
    noChoice(played(s, 'SHD_192'))
  })
})

describe('A Bounty granted to a chosen unit for the phase (SHD_006 Jabba the Hutt, SHD_031 The Client)', () => {
  it('Jabba\'s front: the chosen unit has a Bounty, and collecting it makes the next unit cost 1 less', () => {
    const s = board({ leader: undeployed('SHD_006'), hand: ['BIG'] }, { units: [unit('e', 'HP3')] })
    const used = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(targetsOf(used)).toEqual(['e'])
    const granted = accept(used, { targetInstanceId: 'e' })
    expect(unitHasKeyword(granted, U(granted, 'e')!, 'Bounty')).toBe(true)
    expect(granted.players.player.leader.exhausted).toBe(true)
    const defeated = defeatUnit(granted, 'e')
    expect(choice(defeated).kind).toBe('mayCollectBounty')
    expect(choice(defeated).controller).toBe('player')
    const collected = accept(defeated)
    expect(effectiveCost(collected, 'player', F.BIG)).toBe(F.BIG.cost - 1)
  })

  it('Jabba\'s back: When Deployed another friendly unit captures an enemy non-leader unit; his Action grants a Bounty worth 2', () => {
    const s = board({ leader: undeployed('SHD_006'), resources: ready(7), units: [unit('g', 'BIG')] }, { units: [unit('e', 'HP3'), unit('ldr', 'BIG', { isLeader: true })] })
    const d = resolve(s, { type: 'deployLeader' })
    const jabba = d.players.player.units.find(u => u.isLeader)!.instanceId
    expect(targetsOf(d)).toEqual(['g']) // "another" friendly unit: not Jabba himself
    const done = accept(accept(d, { targetInstanceId: 'g' }), { targetInstanceId: 'e' })
    expect(capturedBy(done, 'g')).toEqual(['HP3'])

    const back = board(
      { leader: deployedLeader('SHD_006'), hand: ['BIG'], units: [unit('jabba', 'SHD_006', { isLeader: true })] },
      { units: [unit('e', 'HP3')] },
    )
    const used = resolve(back, { type: 'useAbility', instanceId: 'jabba', cardId: 'SHD_006', index: 0 })
    expect(U(used, 'jabba')!.exhausted).toBe(true)
    const collected = accept(defeatUnit(accept(used, { targetInstanceId: 'e' }), 'e'))
    expect(effectiveCost(collected, 'player', F.BIG)).toBe(F.BIG.cost - 2)
    expect(jabba).toBeDefined()
  })

  it('The Client: the chosen unit gains "Bounty - Heal 5 damage from a base" for the phase', () => {
    const s = board(
      { units: [unit('client', 'SHD_031')], base: { cardId: 'TST_B', damage: 8 } },
      { units: [unit('e', 'HP3')] },
    )
    const used = resolve(s, { type: 'useAbility', instanceId: 'client', cardId: 'SHD_031', index: 0 })
    expect(U(used, 'client')!.exhausted).toBe(true)
    const granted = accept(used, { targetInstanceId: 'e' })
    expect(unitHasKeyword(granted, U(granted, 'e')!, 'Bounty')).toBe(true)
    const collecting = accept(defeatUnit(granted, 'e'))
    const healed = accept(collecting, { baseTarget: 'player' })
    expect(healed.players.player.base.damage).toBe(3)
  })

  it('the Bounty is collected on a capture too, and lasts only the phase', () => {
    const s = board(
      { units: [unit('client', 'SHD_031'), unit('g', 'BIG')], base: { cardId: 'TST_B', damage: 8 }, hand: ['SEC_195'] },
      { units: [unit('e', 'HP3')] },
    )
    const granted = accept(resolve(s, { type: 'useAbility', instanceId: 'client', cardId: 'SHD_031', index: 0 }), { targetInstanceId: 'e' })
    const mine = { ...granted, activePlayer: 'player' as const }
    const arrested = accept(played(mine, 'SEC_195'), { targetInstanceId: 'e' })
    expect(choice(arrested).kind).toBe('mayCollectBounty')
    const healed = accept(accept(arrested), { baseTarget: 'player' })
    expect(healed.players.player.base.damage).toBe(3)
    const regroup = resolve({ ...mine, consecutivePasses: 1 }, { type: 'pass' })
    expect(unitHasKeyword(regroup, U(regroup, 'e')!, 'Bounty')).toBe(false)
  })
})
