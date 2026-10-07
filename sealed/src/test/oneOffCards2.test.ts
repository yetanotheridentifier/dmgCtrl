import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { cardHasTrait, unitHasTrait } from '../engine/keywords'
import { defeatUpgradeAt } from '../engine/effects'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { getCardDefinition } from '../engine/abilities'
import { IMPLEMENTED_EVENTS, IMPLEMENTED_UNITS, IMPLEMENTED_UPGRADES } from '../data/implementedCards'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, LeaderState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'

/**
 * The last flagged one-offs, each a card whose mechanic no other ticket owned. This file holds the
 * ones the engine could express with a small addition each: a control change tied to an upgrade
 * (Traitorous), traits granted to other cards wherever they are (Malakili, Mythosaur), a defeat read
 * off the phase's base damagers (Retaliation), an additional cost on the opponent's events (Saw
 * Gerrera), a "next card" discount that reaches every card type (Bendu), a constraint on the
 * opponent's next action (Give In to Your Anger), modes that may not repeat (Poe Dameron), a
 * first-action play restriction with a regroup win check (Confidence in Victory) and the amount paid
 * for a card (Lux Bonteri).
 */
const POOL = poolFor(['SOR', 'SHD', 'TWI', 'LOF', 'SEC', 'LAW', 'JTL'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}
const SHIPPED = ['SOR_122', 'LAW_212', 'LOF_073', 'SEC_077', 'SOR_153', 'SOR_056', 'SHD_144', 'SHD_153', 'SEC_145', 'TWI_210']
const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 3, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  C3: src('C3', { cost: 3 }),
  C4: src('C4', { cost: 4 }),
  BIG: src('BIG', { cost: 5, power: 5, hp: 9 }),
  SPC: src('SPC', { arena: 'space' }),
  CRT: src('CRT', { traits: ['Creature'] }),
  CRT_EV: card({ id: 'CRT_EV', type: 'event', cost: 1, traits: ['Creature'] }),
  PLAIN: src('PLAIN'),
  HERO: src('HERO', { aspects: ['Heroism'] }),
  VILL: src('VILL', { aspects: ['Villainy'] }),
  EV1: card({ id: 'EV1', type: 'event', cost: 1 }),
  EV0: card({ id: 'EV0', type: 'event', cost: 0 }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 3, power: 1, hp: 1 }),
  LDR: card({ id: 'LDR', type: 'leader', cost: 5, power: 4, hp: 6 }),
}
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
type Side = Parameters<typeof player>[0]
const rich = (over: Side = {}) => player({ resources: ready(20), deck: ['PLAIN', 'PLAIN', 'PLAIN', 'PLAIN', 'PLAIN', 'PLAIN'], ...over })
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)
const controllerOf = (s: GameState, id: string): PlayerId | undefined =>
  s.players.player.units.some(u => u.instanceId === id) ? 'player' : s.players.opponent.units.some(u => u.instanceId === id) ? 'opponent' : undefined
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; baseTarget?: PlayerId }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
const targetsOf = (s: GameState) => [...((choice(s) as unknown as { targets?: string[]; unitTargets?: string[] }).targets ?? (choice(s) as unknown as { unitTargets: string[] }).unitTargets)].sort()
const modesOf = (s: GameState) => (choice(s) as Extract<PendingChoice, { kind: 'chooseMode' }>).modes
/** Pick the mode whose key or label mentions `word`. */
const mode = (s: GameState, word: string) => {
  const c = choice(s) as Extract<PendingChoice, { kind: 'chooseMode' }>
  expect(c.kind).toBe('chooseMode')
  const i = c.modes.findIndex((m, n) => `${m} ${c.labels?.[n] ?? ''}`.toLowerCase().includes(word))
  expect(i, `a mode mentioning ${word} in ${c.modes.join(', ')}`).toBeGreaterThanOrEqual(0)
  return accept(s, { optionIndex: i })
}
const play = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState => {
  const handIndex = s.players[who].hand.indexOf(cardId)
  expect(handIndex, `${cardId} in ${who}'s hand`).toBeGreaterThanOrEqual(0)
  const type = F[cardId].type
  return resolve(s, type === 'event' ? { type: 'playEvent', handIndex } : { type: 'playUnit', handIndex })
}
const attackBase = (s: GameState, attackerId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' } })
const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, leaderLeftPlay: [], played: { player: [], opponent: [] }, ...over,
})
const deployedLeader = (cardId: string): LeaderState => ({ cardId, deployed: true, epicActionUsed: true, exhausted: false })
const isMove = (moves: Action[], m: Partial<Action>) => moves.some(x => Object.entries(m).every(([k, v]) => JSON.stringify((x as Record<string, unknown>)[k]) === JSON.stringify(v)))

describe('registration', () => {
  it('registers each card and lists it as built', () => {
    for (const id of SHIPPED) {
      expect(getCardDefinition(id), id).toBeTruthy()
      expect([...IMPLEMENTED_EVENTS, ...IMPLEMENTED_UNITS, ...IMPLEMENTED_UPGRADES].some(c => c.id === id), id).toBe(true)
    }
  })
})

describe('SOR_122 Traitorous: takes control of a non-leader unit that costs 3 or less while attached', () => {
  const steal = (target: UnitState) => {
    const s = board({ hand: ['SOR_122'] }, { units: [target] })
    return resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: target.instanceId })
  }

  it('takes control of an enemy unit that costs 3 or less as it attaches', () => {
    const s = steal(unit('e', 'C3'))
    expect(controllerOf(s, 'e')).toBe('player')
    expect(U(s, 'e')!.owner).toBe('opponent')
    expect(U(s, 'e')!.upgrades.map(u => u.cardId)).toEqual(['SOR_122'])
  })

  it('leaves a unit that costs 4 or more, and a leader unit, where they are', () => {
    expect(controllerOf(steal(unit('e', 'C4')), 'e')).toBe('opponent')
    expect(controllerOf(steal(unit('e', 'C3', { isLeader: true })), 'e')).toBe('opponent')
  })

  it("hands the unit back to its owner once the upgrade leaves it", () => {
    const stolen = steal(unit('e', 'C3'))
    expect(stolen.activePlayer).toBe('opponent')
    const gone = defeatUpgradeAt(stolen, 'e', 0)
    const swept = resolve(gone, { type: 'pass' }) // control is settled once per action
    expect(controllerOf(swept, 'e')).toBe('opponent')
    expect(U(swept, 'e')!.owner).toBeUndefined()
  })

  it('keeps the unit past the regroup phase while the upgrade stays on it', () => {
    const stolen = steal(unit('e', 'C3'))
    const regroup = resolve(resolve(stolen, { type: 'pass' }), { type: 'pass' })
    expect(regroup.phase).toBe('regroup')
    expect(controllerOf(regroup, 'e')).toBe('player')
  })
})

describe('LAW_212 Malakili: friendly Creature units, and Creature units you own out of play, gain Underworld', () => {
  it('gives a friendly Creature unit Underworld, and no enemy or non-Creature unit', () => {
    const s = board({ units: [unit('m', 'LAW_212'), unit('c', 'CRT'), unit('p', 'PLAIN')] }, { units: [unit('e', 'CRT')] })
    expect(unitHasTrait(s, U(s, 'c')!, 'Underworld')).toBe(true)
    expect(unitHasTrait(s, U(s, 'p')!, 'Underworld')).toBe(false)
    expect(unitHasTrait(s, U(s, 'e')!, 'Underworld')).toBe(false)
  })

  it('reaches a Creature unit card in its owner\'s hand, deck or discard pile, and only while Malakili is in play', () => {
    const s = board({ units: [unit('m', 'LAW_212')], hand: ['CRT'] })
    expect(cardHasTrait(s, 'CRT', 'Underworld', 'player')).toBe(true)
    expect(cardHasTrait(s, 'CRT', 'Underworld', 'opponent')).toBe(false) // a copy the opponent owns
    expect(cardHasTrait(s, 'CRT_EV', 'Underworld', 'player')).toBe(false) // a Creature event is not a unit
    expect(cardHasTrait(board({ hand: ['CRT'] }), 'CRT', 'Underworld', 'player')).toBe(false)
  })
})

describe('LOF_073 Mythosaur: friendly leaders gain the Mandalorian trait', () => {
  it('reaches the leader in the base zone and a deployed leader unit, on its own side only', () => {
    const s = board({ units: [unit('m', 'LOF_073')] }, { leader: { cardId: 'LDR', deployed: false, epicActionUsed: false, exhausted: false } })
    expect(cardHasTrait(s, 'TST_L', 'Mandalorian', 'player')).toBe(true)
    expect(cardHasTrait(s, 'LDR', 'Mandalorian', 'opponent')).toBe(false)
    const deployed = board({ leader: deployedLeader('LDR'), units: [unit('m', 'LOF_073'), unit('l', 'LDR', { isLeader: true })] })
    expect(unitHasTrait(deployed, U(deployed, 'l')!, 'Mandalorian')).toBe(true)
    expect(cardHasTrait(board(), 'TST_L', 'Mandalorian', 'player')).toBe(false)
  })
})

describe('SEC_077 Retaliation: defeat a unit that dealt damage to a base this phase', () => {
  it('offers only the units that damaged a base this phase, on either side', () => {
    const s = board({ hand: ['SEC_077'], units: [unit('mine', 'PLAIN')] }, { units: [unit('hit', 'BIG'), unit('idle', 'BIG')] },
      { phaseEvents: phaseEvents({ baseDamagers: ['hit', 'mine'] }) })
    const p = play(s, 'SEC_077')
    expect(targetsOf(p)).toEqual(['hit', 'mine'])
    const done = accept(p, { targetInstanceId: 'hit' })
    expect(U(done, 'hit')).toBeUndefined()
    expect(U(done, 'idle')).toBeDefined()
  })

  it('does nothing when no unit has damaged a base', () => {
    const s = board({ hand: ['SEC_077'] }, { units: [unit('idle', 'BIG')] })
    const p = play(s, 'SEC_077')
    noChoice(p)
    expect(U(p, 'idle')).toBeDefined()
  })
})

describe('SOR_153 Saw Gerrera: each opponent deals 2 damage to their own base as an additional cost to play an event', () => {
  it('charges the opponent 2 base damage per event they play, and not his controller', () => {
    const s = board({ units: [unit('saw', 'SOR_153')], hand: ['EV0'] }, { hand: ['EV1'] }, { activePlayer: 'opponent' })
    const theirs = play(s, 'EV1', 'opponent')
    expect(theirs.players.opponent.base.damage).toBe(2)
    const mine = play(theirs, 'EV0')
    expect(mine.players.player.base.damage).toBe(0)
  })

  it('stacks with a second copy, and charges nothing for a unit', () => {
    const two = board({ units: [unit('a', 'SOR_153'), unit('b', 'SOR_153')] }, { hand: ['EV1', 'PLAIN'] }, { activePlayer: 'opponent' })
    expect(play(two, 'EV1', 'opponent').players.opponent.base.damage).toBe(4)
    expect(play(two, 'PLAIN', 'opponent').players.opponent.base.damage).toBe(0)
  })
})

describe('SOR_056 Bendu: On Attack, the next non-Heroism, non-Villainy card you play this phase costs 2 less', () => {
  const attacked = attackBase(board({ units: [unit('b', 'SOR_056')] }), 'b')

  it('discounts the next neutral unit, event or upgrade by 2, and no Heroism or Villainy card', () => {
    expect(effectiveCost(attacked, 'player', F.PLAIN)).toBe(0)
    expect(effectiveCost(attacked, 'player', F.EV1)).toBe(0)
    expect(effectiveCost(attacked, 'player', F.UPG, attacked.players.player.units[0])).toBe(1)
    expect(effectiveCost(attacked, 'player', F.HERO)).toBe(2)
    expect(effectiveCost(attacked, 'player', F.VILL)).toBe(4) // printed 2 plus the Villainy penalty
  })

  it('is spent by the first matching card, including an upgrade, and not by a Heroism card', () => {
    const s = { ...attacked, activePlayer: 'player' as PlayerId, players: { ...attacked.players, player: { ...attacked.players.player, hand: ['HERO', 'UPG', 'PLAIN'] } } }
    const hero = play(s, 'HERO')
    expect(effectiveCost(hero, 'player', F.PLAIN)).toBe(0) // still waiting
    const upg = resolve({ ...hero, activePlayer: 'player' }, { type: 'playUpgrade', handIndex: hero.players.player.hand.indexOf('UPG'), targetInstanceId: 'b' })
    expect(effectiveCost(upg, 'player', F.PLAIN)).toBe(2) // the upgrade took it
  })
})

describe('SHD_144 Give In to Your Anger: deal 1 damage to an enemy unit; its controller\'s next action must be an attack with it, on a unit if able', () => {
  const angered = (mine: Side, theirs: Side) => {
    const s = board({ hand: ['SHD_144'], ...mine }, theirs)
    const p = play(s, 'SHD_144')
    expect(targetsOf(p)).toEqual((theirs?.units ?? []).map(u => u.instanceId).sort())
    return accept(p, { targetInstanceId: 'e' })
  }

  it('deals the damage and limits the next action to attacks by that unit on units', () => {
    const s = angered({ units: [unit('m', 'BIG')] }, { units: [unit('e', 'PLAIN'), unit('o', 'PLAIN')], hand: ['EV1'] })
    expect(U(s, 'e')!.damage).toBe(1)
    expect(s.activePlayer).toBe('opponent')
    const moves = legalMoves(s)
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.every(m => m.type === 'attack' && m.attackerId === 'e' && m.target.kind === 'unit')).toBe(true)
    // After that one action the opponent plays as normal.
    const after = resolve(resolve(s, moves[0]), { type: 'pass' })
    expect(after.activePlayer).toBe('opponent')
    expect(isMove(legalMoves(after), { type: 'pass' })).toBe(true)
  })

  it('lets the unit attack the base when there is no unit it can attack', () => {
    const s = angered({}, { units: [unit('e', 'PLAIN')] })
    const moves = legalMoves(s)
    expect(moves).toEqual([{ type: 'attack', attackerId: 'e', target: { kind: 'base' } }])
  })

  it('leaves the opponent free when the unit is unable to attack', () => {
    const s = angered({ units: [unit('m', 'BIG')] }, { units: [unit('e', 'PLAIN', { exhausted: true })] })
    expect(isMove(legalMoves(s), { type: 'pass' })).toBe(true)
  })
})

describe('SHD_153 Poe Dameron: On Attack, discard up to 3 cards and choose a different option for each', () => {
  const poe = (hand: string[], theirs: Side = {}) => attackBase(board({ units: [unit('poe', 'SHD_153')], hand }, theirs), 'poe')

  it('takes a different option for each card discarded', () => {
    const theirs: Side = { units: [unit('e', 'BIG', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })], hand: ['PLAIN'] }
    let s = poe(['PLAIN', 'EV1', 'HERO'], theirs)
    s = accept(s, { optionIndex: 0 }) // discard one
    s = accept(s, { optionIndex: 0 }) // and a second
    s = skip(s) // stop at two
    expect(s.players.player.hand).toEqual(['HERO'])
    expect(s.players.player.discard).toHaveLength(2)
    expect(modesOf(s)).toHaveLength(3)
    s = mode(s, 'upgrade')
    s = accept(s, { optionIndex: 0 }) // the upgrade on it
    expect(U(s, 'e')!.upgrades).toHaveLength(0)
    expect(modesOf(s)).toHaveLength(2) // defeating an upgrade is not offered twice
    s = mode(s, 'discard')
    const answered = s.pendingChoices?.[0]?.controller === 'opponent' ? accept(s, { handIndex: 0, optionIndex: 0 }) : s
    expect(answered.players.opponent.hand).toEqual([])
  })

  it('asks for nothing more after the third card, and nothing at all when none is discarded', () => {
    let s = poe(['PLAIN', 'EV1', 'HERO', 'VILL'])
    s = accept(accept(accept(s, { optionIndex: 0 }), { optionIndex: 0 }), { optionIndex: 0 })
    expect(s.players.player.hand).toEqual(['VILL'])
    expect(choice(s).kind).toBe('chooseMode')
    const none = skip(poe(['PLAIN']))
    expect(none.players.player.hand).toEqual(['PLAIN'])
    noChoice(none)
  })
})

describe('SEC_145 Confidence in Victory: play only as your first action; win at the regroup phase if you alone control units in the chosen arena', () => {
  const playable = (s: GameState) => legalMoves(s).some(m => m.type === 'playEvent')

  it('is playable as the first action of each player in the phase, and not after', () => {
    const s = board({ hand: ['SEC_145', 'PLAIN'] }, { hand: ['SEC_145'] })
    expect(playable(s)).toBe(true)
    const acted = play(s, 'PLAIN') // the player's first action
    expect(acted.activePlayer).toBe('opponent')
    expect(playable(acted)).toBe(true) // the opponent's first action is still to come
    const back = resolve(acted, { type: 'pass' })
    expect(back.activePlayer).toBe('player')
    expect(playable(back)).toBe(false)
  })

  it('wins the game at the start of the regroup phase when only you control units in that arena', () => {
    const s = board({ hand: ['SEC_145'], units: [unit('m', 'PLAIN')] }, { units: [unit('s', 'SPC')] })
    const chose = accept(play(s, 'SEC_145'), { optionIndex: 0 }) // ground
    const regroup = resolve(resolve(chose, { type: 'pass' }), { type: 'pass' })
    expect(regroup.winner).toBe('player')
  })

  it('does not win when the opponent also controls a unit there, or you control none', () => {
    const contested = board({ hand: ['SEC_145'], units: [unit('m', 'PLAIN')] }, { units: [unit('e', 'PLAIN')] })
    const a = accept(play(contested, 'SEC_145'), { optionIndex: 0 })
    expect(resolve(resolve(a, { type: 'pass' }), { type: 'pass' }).winner).toBeNull()
    const empty = board({ hand: ['SEC_145'], units: [unit('m', 'PLAIN')] })
    const b = accept(play(empty, 'SEC_145'), { optionIndex: 1 }) // space, where nobody has a unit
    expect(resolve(resolve(b, { type: 'pass' }), { type: 'pass' }).winner).toBeNull()
  })
})

describe('TWI_210 Lux Bonteri: when an opponent plays a card paying less than its cost, ready or exhaust a unit', () => {
  const lux = (theirs: Side) => board({ units: [unit('lux', 'TWI_210', { exhausted: true }), unit('m', 'PLAIN')] }, { units: [unit('e', 'PLAIN')], ...theirs }, { activePlayer: 'opponent' })

  it('triggers on a discounted play, and lets her controller exhaust or ready a unit', () => {
    const s = play(lux({ hand: ['C3'], nextUnitGrants: [{ costDelta: -1 }] }), 'C3', 'opponent')
    expect(s.activePlayer).toBe('player')
    const exhausted = accept(mode(s, 'exhaust'), { targetInstanceId: 'e' })
    expect(U(exhausted, 'e')!.exhausted).toBe(true)
    const s2 = play(lux({ hand: ['C3'], nextUnitGrants: [{ costDelta: -1 }] }), 'C3', 'opponent')
    const readied = accept(mode(s2, 'ready'), { targetInstanceId: 'lux' })
    expect(U(readied, 'lux')!.exhausted).toBe(false)
  })

  it("ignores a play at full cost, a free play of a 0-cost card, and her controller's own discounted play", () => {
    noChoice(play(lux({ hand: ['C3'] }), 'C3', 'opponent'))
    noChoice(play(lux({ hand: ['EV0'] }), 'EV0', 'opponent'))
    const mine = board({ units: [unit('lux', 'TWI_210')], hand: ['C3'], nextUnitGrants: [{ costDelta: -1 }] })
    noChoice(play(mine, 'C3'))
  })
})
