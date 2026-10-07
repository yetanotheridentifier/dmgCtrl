import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { unitHasTrait } from '../engine/keywords'
import { effectiveHp, effectivePower } from '../engine/stats'
import { defeatUnit } from '../engine/combat'
import { defeatUpgradeAt, returnUnitToHand } from '../engine/effects'
import { initGame } from '../engine/initGame'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { getCardDefinition } from '../engine/abilities'
import { IMPLEMENTED_BASES, IMPLEMENTED_EVENTS, IMPLEMENTED_LEADERS, IMPLEMENTED_UNITS, IMPLEMENTED_UPGRADES } from '../data/implementedCards'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_BATTLE_DROID, TOKEN_CLONE_TROOPER } from '../engine/tokenUnits'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, LeaderState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'

/**
 * The last flagged one-offs that each needed a larger piece of engine: an upgrade's own When Defeated
 * (Roger Roger), an alternative to paying an event's cost (Bamboozle), a second regroup phase (Max
 * Rebo), the defender striking first (The Stranger), a choice as the first action phase starts
 * (Nabat Village), a leader that flips instead of deploying (Chancellor Palpatine), units paying
 * costs as resources (Vuutun Palaa), a unit entering play as a copy of another (Clone) and an attack
 * on two units at once (Darth Maul).
 */
const POOL = poolFor(['SOR', 'SHD', 'TWI', 'LOF', 'SEC', 'LAW', 'JTL'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}
const SHIPPED = ['TWI_069', 'SOR_199', 'LAW_072', 'LAW_086', 'JTL_028', 'TWI_017', 'SEC_122', 'TWI_116', 'TWI_135', 'TWI_144', 'TWI_097']
const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 3, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  PLAIN: src('PLAIN'),
  P3: src('P3', { power: 3, hp: 3 }),
  P2H4: src('P2H4', { power: 2, hp: 4 }),
  BIG: src('BIG', { cost: 5, power: 5, hp: 9, traits: ['Trooper'] }),
  SENT: src('SENT', { power: 1, hp: 2, keywords: [{ name: 'Sentinel' }] }),
  SENT2: src('SENT2', { power: 1, hp: 2, keywords: [{ name: 'Sentinel' }] }),
  SPC: src('SPC', { arena: 'space' }),
  VEH: src('VEH', { traits: ['Vehicle'] }),
  DROID: src('DROID', { traits: ['Droid'] }),
  C3: src('C3', { cost: 3 }),
  HERO: src('HERO', { aspects: ['Heroism'] }),
  VILL: src('VILL', { aspects: ['Villainy'] }),
  CUN: card({ id: 'CUN', type: 'event', cost: 3, aspects: ['Cunning'] }),
  CUNU: src('CUNU', { aspects: ['Cunning'] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
}
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
type Side = Parameters<typeof player>[0]
const deck = ['PLAIN', 'PLAIN', 'PLAIN', 'PLAIN', 'PLAIN', 'PLAIN', 'PLAIN', 'PLAIN']
const rich = (over: Side = {}) => player({ resources: ready(20), deck, ...over })
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })
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
const targetsOf = (s: GameState) => [...((choice(s) as unknown as { targets?: string[]; unitTargets?: string[] }).targets ?? (choice(s) as unknown as { unitTargets: string[] }).unitTargets)].sort()
const play = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState => {
  const handIndex = s.players[who].hand.indexOf(cardId)
  expect(handIndex, `${cardId} in ${who}'s hand`).toBeGreaterThanOrEqual(0)
  return resolve(s, F[cardId].type === 'event' ? { type: 'playEvent', handIndex } : { type: 'playUnit', handIndex })
}
const attackUnit = (s: GameState, attackerId: string, target: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: target } })
const attackBase = (s: GameState, attackerId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' } })
const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, leaderLeftPlay: [], played: { player: [], opponent: [] }, ...over,
})
const leader = (cardId: string, over: Partial<LeaderState> = {}): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false, ...over })
const readyResources = (s: GameState, who: PlayerId = 'player') => s.players[who].resources.filter(r => !r.exhausted).length

describe('registration', () => {
  it('registers each card and lists it as built', () => {
    for (const id of ['TWI_069', 'SOR_199', 'LAW_072', 'LAW_086', 'JTL_028', 'SEC_122', 'TWI_116', 'TWI_135']) {
      expect(getCardDefinition(id), id).toBeTruthy()
      expect([...IMPLEMENTED_EVENTS, ...IMPLEMENTED_UNITS, ...IMPLEMENTED_UPGRADES, ...IMPLEMENTED_BASES].some(c => c.id === id), id).toBe(true)
    }
    expect(getCardDefinition('TWI_017')?.leaderAbilities).toBeTruthy()
    expect(IMPLEMENTED_LEADERS.find(l => l.id === 'TWI_017')).toMatchObject({ front: true, back: true })
  })
})

describe('TWI_069 Roger Roger: When Defeated, attach this upgrade to a friendly Battle Droid token', () => {
  const withRoger = (droids: UnitState[]) => board({ units: [unit('host', 'PLAIN', { upgrades: [{ cardId: 'TWI_069', owner: 'player' }] }), ...droids] })

  it('moves from the discard pile onto a Battle Droid token when its host is defeated', () => {
    const s = defeatUnit(withRoger([unit('bd', TOKEN_BATTLE_DROID), unit('bd2', TOKEN_BATTLE_DROID)]), 'host')
    expect(targetsOf(s)).toEqual(['bd', 'bd2'])
    const done = accept(s, { targetInstanceId: 'bd2' })
    expect(U(done, 'bd2')!.upgrades.map(u => u.cardId)).toEqual(['TWI_069'])
    expect(done.players.player.discard).toEqual(['PLAIN'])
  })

  it('does the same when the upgrade alone is defeated', () => {
    const s = defeatUpgradeAt(withRoger([unit('bd', TOKEN_BATTLE_DROID)]), 'host', 0)
    const done = accept(s, { targetInstanceId: 'bd' })
    expect(U(done, 'bd')!.upgrades.map(u => u.cardId)).toEqual(['TWI_069'])
    expect(U(done, 'host')!.upgrades).toEqual([])
    expect(done.players.player.discard).toEqual([])
  })

  it('stays in the discard pile with no friendly Battle Droid token, and fires nothing while attached to a host that survives', () => {
    const s = defeatUnit(board({ units: [unit('host', 'PLAIN', { upgrades: [{ cardId: 'TWI_069', owner: 'player' }] })] }, { units: [unit('ebd', TOKEN_BATTLE_DROID)] }), 'host')
    noChoice(s)
    expect(s.players.player.discard).toContain('TWI_069')
  })
})

describe('SOR_199 Bamboozle: discard a Cunning card instead of paying; exhaust a unit and return each upgrade on it', () => {
  const target = unit('e', 'BIG', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }, { cardId: TOKEN_SHIELD, owner: 'opponent' }] })

  it('is playable with no resources by discarding a Cunning card', () => {
    const s = board({ hand: ['SOR_199', 'CUN', 'PLAIN'], resources: [] }, { units: [target] })
    expect(legalMoves(s).some(m => m.type === 'playEvent' && m.handIndex === 0)).toBe(true)
    const p = play(s, 'SOR_199')
    expect(legalMoves(p).some(m => m.type === 'skipTrigger')).toBe(false) // it cannot be paid for, so the discard is not optional
    const discarded = accept(p, { optionIndex: 0 })
    expect(discarded.players.player.hand).toEqual(['PLAIN'])
    expect(discarded.players.player.discard.sort()).toEqual(['CUN', 'SOR_199'])
    const done = accept(discarded, { targetInstanceId: 'e' })
    expect(U(done, 'e')!.exhausted).toBe(true)
    expect(U(done, 'e')!.upgrades).toEqual([])
    expect(done.players.opponent.hand).toEqual(['UPG'])
  })

  it('may still be paid for as usual, keeping the Cunning card', () => {
    const s = board({ hand: ['SOR_199', 'CUN'], resources: ready(4) }, { units: [target] })
    const paid = skip(play(s, 'SOR_199'))
    expect(paid.players.player.hand).toEqual(['CUN'])
    expect(readyResources(paid)).toBe(0) // 2 plus the Cunning penalty
    expect(choice(paid).kind).not.toBe('selectCardThen')
  })

  it('is not playable with neither the resources nor a Cunning card, and never discards itself', () => {
    expect(legalMoves(board({ hand: ['SOR_199', 'PLAIN'], resources: [] }, { units: [target] })).some(m => m.type === 'playEvent')).toBe(false)
    expect(legalMoves(board({ hand: ['SOR_199', 'SOR_199'], resources: [] }, { units: [target] })).some(m => m.type === 'playEvent')).toBe(true) // the other copy
    expect(legalMoves(board({ hand: ['SOR_199'], resources: [] }, { units: [target] })).some(m => m.type === 'playEvent')).toBe(false)
  })
})

describe('LAW_072 Max Rebo: an additional regroup phase after the first each round', () => {
  const toRegroup = (s: GameState) => resolve(resolve(s, { type: 'pass' }), { type: 'pass' })
  const resourceNothing = (s: GameState) => resolve(resolve(s, { type: 'skipResource' }), { type: 'skipResource' })

  it('runs a second regroup phase, drawing again, before the next action phase', () => {
    const s = board({ units: [unit('max', 'LAW_072')], hand: [] }, { hand: [] })
    const first = toRegroup(s)
    expect(first.phase).toBe('regroup')
    expect(first.players.player.hand).toHaveLength(2)
    const second = resourceNothing(first)
    expect(second.phase).toBe('regroup')
    expect(second.players.player.hand).toHaveLength(4)
    expect(second.players.opponent.hand).toHaveLength(4)
    const next = resourceNothing(second)
    expect(next.phase).toBe('action')
    expect(next.round).toBe(s.round + 1)
  })

  it('runs one regroup phase without him', () => {
    const next = resourceNothing(toRegroup(board({ hand: [] }, { hand: [] })))
    expect(next.phase).toBe('action')
    expect(next.players.player.hand).toHaveLength(2)
  })
})

describe('LAW_086 The Stranger: while attacking, you may have the defending unit deal combat damage first', () => {
  it('lets the defender strike first, so Grit adds the damage it took', () => {
    const s = board({ units: [unit('st', 'LAW_086')] }, { units: [unit('e', 'P3')] })
    const asked = attackUnit(s, 'st', 'e')
    const done = accept(asked)
    expect(U(done, 'st')!.damage).toBe(3)
    expect(U(done, 'e')).toBeUndefined() // 1 power plus 3 from Grit
  })

  it('deals damage at the same time when declined', () => {
    const s = board({ units: [unit('st', 'LAW_086')] }, { units: [unit('e', 'P3')] })
    const done = skip(attackUnit(s, 'st', 'e'))
    expect(U(done, 'st')!.damage).toBe(3)
    expect(U(done, 'e')!.damage).toBe(1)
  })

  it('deals no damage at all when the defender\'s strike defeats him, and asks nothing when attacking a base', () => {
    const s = board({ units: [unit('st', 'LAW_086', { damage: 5 })] }, { units: [unit('e', 'P3')] })
    const done = accept(attackUnit(s, 'st', 'e'))
    expect(U(done, 'st')).toBeUndefined()
    expect(U(done, 'e')!.damage).toBe(0)
    noChoice(attackBase(board({ units: [unit('st', 'LAW_086')] }), 'st'))
  })
})

describe('JTL_028 Nabat Village: 3 more starting cards, no mulligan, and 3 cards to the bottom as the first action phase starts', () => {
  const nabatDeck = { name: 'nabat', leader: 'TWI_017', base: 'JTL_028', cards: [{ id: 'PLAIN', count: 20 }] }
  const plainDeck = { name: 'plain', leader: 'TWI_017', base: 'TST_B', cards: [{ id: 'PLAIN', count: 20 }] }

  it('deals 9 cards and offers no mulligan', () => {
    const s = initGame(nabatDeck, plainDeck, F, { firstPlayer: 'player', shuffle: x => [...x], rngSeed: 1 })
    expect(s.players.player.hand).toHaveLength(9)
    expect(s.players.opponent.hand).toHaveLength(6)
    expect(legalMoves(s)).toEqual([{ type: 'keepHand' }])
  })

  it('puts 3 cards from the hand on the bottom of the deck, in the order chosen, before the first action', () => {
    const s = board({ base: { cardId: 'JTL_028', damage: 0 }, hand: ['A1', 'A2', 'A3', 'A4'], deck: ['D1'], resources: ready(2) },
      { hand: ['PLAIN'], resources: ready(1) },
      { phase: 'setup', setupStage: 'resource', round: 1, activePlayer: 'opponent', cards: { ...F, A1: src('A1'), A2: src('A2'), A3: src('A3'), A4: src('A4'), D1: src('D1') } })
    let next = resolve(s, { type: 'setupResource', handIndex: 0 })
    expect(next.phase).toBe('action')
    expect(next.activePlayer).toBe('player')
    next = accept(next, { optionIndex: 2 }) // A3
    next = accept(next, { optionIndex: 0 }) // A1
    next = accept(next, { optionIndex: 1 }) // A4 (the hand is now A2, A4)
    noChoice(next)
    expect(next.players.player.hand).toEqual(['A2'])
    expect(next.players.player.deck).toEqual(['D1', 'A3', 'A1', 'A4'])
    expect(next.activePlayer).toBe('player') // the initiative holder takes the first action
  })
})

describe('TWI_017 Chancellor Palpatine // Darth Sidious: a leader that flips instead of deploying', () => {
  const pal = (over: Partial<LeaderState> = {}, mine: Side = {}, extra: Partial<GameState> = {}) =>
    board({ leader: leader('TWI_017', over), base: { cardId: 'TST_B', damage: 5 }, ...mine }, {}, extra)
  const leaderMoves = (s: GameState) => legalMoves(s).filter((m): m is Extract<Action, { type: 'useLeaderAbility' }> => m.type === 'useLeaderAbility')

  it('never deploys', () => {
    expect(legalMoves(pal()).some(m => m.type === 'deployLeader')).toBe(false)
  })

  it('front: after a friendly Heroism unit is defeated, draws, heals 2 from the base and flips', () => {
    expect(leaderMoves(pal())).toEqual([])
    const s = pal({}, {}, { phaseEvents: phaseEvents({ defeated: { player: ['HERO'], opponent: [] } }) })
    const [move] = leaderMoves(s)
    const done = resolve(s, move)
    expect(done.players.player.hand).toHaveLength(1)
    expect(done.players.player.base.damage).toBe(3)
    expect(done.players.player.leader.flipped).toBe(true)
    expect(done.players.player.leader.exhausted).toBe(true)
  })

  it('back: after playing a Villainy card, creates a Clone Trooper, deals 2 to the enemy base and flips back', () => {
    expect(leaderMoves(pal({ flipped: true }))).toEqual([])
    const s = pal({ flipped: true }, {}, { phaseEvents: phaseEvents({ played: { player: ['VILL'], opponent: [] } }) })
    const [move] = leaderMoves(s)
    const done = resolve(s, move)
    expect(done.players.player.units.map(u => u.cardId)).toEqual([TOKEN_CLONE_TROOPER])
    expect(done.players.opponent.base.damage).toBe(2)
    expect(done.players.player.leader.flipped).toBe(false)
  })

  it('provides Heroism face up and Villainy flipped, Cunning on both', () => {
    expect(effectiveCost(pal(), 'player', F.HERO)).toBe(2)
    expect(effectiveCost(pal(), 'player', F.VILL)).toBe(4)
    expect(effectiveCost(pal({ flipped: true }), 'player', F.HERO)).toBe(4)
    expect(effectiveCost(pal({ flipped: true }), 'player', F.VILL)).toBe(2)
    expect(effectiveCost(pal({ flipped: true }), 'player', F.CUNU)).toBe(2)
  })
})

describe('SEC_122 Vuutun Palaa: costs 1 less per friendly Droid unit, and Droids may be exhausted to pay costs', () => {
  it('costs 1 less for each friendly Droid unit', () => {
    const s = board({ units: [unit('d1', 'DROID'), unit('d2', 'DROID')] }, { units: [unit('e', 'DROID')] })
    expect(effectiveCost(s, 'player', F.SEC_122)).toBe(7)
  })

  it('pays with ready friendly Droid units as well as resources', () => {
    const s = board({ units: [unit('v', 'SEC_122'), unit('d1', 'DROID'), unit('d2', 'DROID'), unit('d3', 'DROID', { exhausted: true })], hand: ['C3'], resources: ready(1) })
    expect(legalMoves(s).some(m => m.type === 'playUnit')).toBe(true)
    let p = play(s, 'C3')
    const picks = legalMoves(p).filter(m => m.type === 'acceptChoice').map(m => (m as { targetInstanceId?: string }).targetInstanceId).sort()
    expect(picks).toEqual(['d1', 'd2'])
    p = accept(p, { targetInstanceId: 'd1' })
    p = accept(p, { targetInstanceId: 'd2' })
    expect(U(p, 'd1')!.exhausted).toBe(true)
    expect(U(p, 'd2')!.exhausted).toBe(true)
    expect(readyResources(p)).toBe(0)
    expect(p.players.player.units.some(u => u.cardId === 'C3')).toBe(true)
  })

  it('offers no Droid payment without him', () => {
    const s = board({ units: [unit('d1', 'DROID'), unit('d2', 'DROID')], hand: ['C3'], resources: ready(1) })
    expect(legalMoves(s).some(m => m.type === 'playUnit')).toBe(false)
  })
})

describe('TWI_116 Clone: may enter play as a copy of a non-leader, non-Vehicle unit, gaining the Clone trait', () => {
  const theirs: Side = { units: [unit('e', 'BIG'), unit('v', 'VEH'), unit('l', 'P3', { isLeader: true })] }

  it('offers the non-leader, non-Vehicle units on both sides, and enters with the copied printed attributes', () => {
    const s = board({ hand: ['TWI_116'], units: [unit('m', 'PLAIN')] }, theirs)
    const p = play(s, 'TWI_116')
    expect(targetsOf(p)).toEqual(['e', 'm'])
    const done = accept(p, { targetInstanceId: 'e' })
    const clone = done.players.player.units.find(u => u.instanceId !== 'm')!
    expect(clone.cardId).toBe('BIG')
    expect(effectivePower(done, clone)).toBe(5)
    expect(effectiveHp(done, clone)).toBe(9)
    expect(unitHasTrait(done, clone, 'Clone')).toBe(true)
    expect(unitHasTrait(done, clone, 'Trooper')).toBe(true)
  })

  it('goes to the discard pile, or the hand, as the Clone card', () => {
    const s = accept(play(board({ hand: ['TWI_116'] }, theirs), 'TWI_116'), { targetInstanceId: 'e' })
    const id = s.players.player.units[0].instanceId
    expect(defeatUnit(s, id).players.player.discard).toEqual(['TWI_116'])
    expect(returnUnitToHand(s, id).players.player.hand).toEqual(['TWI_116'])
  })

  it("fires the copied unit's When Played, and is not unique", () => {
    const s = board({ hand: ['TWI_116'], units: [unit('rex', 'TWI_097')] })
    let done = accept(play(s, 'TWI_116'), { targetInstanceId: 'rex' })
    while ((done.pendingChoices ?? []).length > 0) done = accept(done)
    expect(done.players.player.units.filter(u => u.cardId === 'TWI_097')).toHaveLength(2) // no unique-rule defeat
    expect(done.players.player.units.filter(u => u.cardId === TOKEN_CLONE_TROOPER)).toHaveLength(2)
  })

  it('is a 0/0 that is defeated when it copies nothing', () => {
    const done = skip(play(board({ hand: ['TWI_116'] }, theirs), 'TWI_116'))
    expect(done.players.player.units).toEqual([])
    expect(done.players.player.discard).toEqual(['TWI_116'])
  })
})

describe('TWI_135 Darth Maul: may attack 2 units instead of 1', () => {
  it('attacks a second unit, dealing his damage to both and taking theirs together', () => {
    const s = board({ units: [unit('maul', 'TWI_135')] }, { units: [unit('a', 'P3'), unit('b', 'P2H4'), unit('s', 'SPC')] })
    const asked = attackUnit(s, 'maul', 'a')
    expect(targetsOf(asked)).toEqual(['b'])
    const done = accept(asked, { targetInstanceId: 'b' })
    expect(U(done, 'a')).toBeUndefined()
    expect(U(done, 'b')).toBeUndefined()
    expect(U(done, 'maul')!.damage).toBe(5)
  })

  it('attacks one unit when the second is declined, and asks nothing attacking a base', () => {
    const s = board({ units: [unit('maul', 'TWI_135')] }, { units: [unit('a', 'P3'), unit('b', 'P2H4')] })
    const done = skip(attackUnit(s, 'maul', 'a'))
    expect(U(done, 'b')!.damage).toBe(0)
    expect(U(done, 'maul')!.damage).toBe(3)
    noChoice(attackBase(board({ units: [unit('maul', 'TWI_135')] }, { units: [unit('a', 'P3')] }), 'maul'))
  })

  it('may add only another Sentinel while the defending player has one', () => {
    const s = board({ units: [unit('maul', 'TWI_135')] }, { units: [unit('s1', 'SENT'), unit('s2', 'SENT2'), unit('n', 'PLAIN')] })
    expect(targetsOf(attackUnit(s, 'maul', 's1'))).toEqual(['s2'])
    const one = board({ units: [unit('maul', 'TWI_135')] }, { units: [unit('s1', 'SENT'), unit('n', 'PLAIN')] })
    noChoice(attackUnit(one, 'maul', 's1'))
  })
})
