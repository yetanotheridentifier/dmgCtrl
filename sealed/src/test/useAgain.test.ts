import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { defeatUnit } from '../engine/combat'
import { normaliseCard } from '../engine/cardDb'
import { TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
import { clearLastingEffects } from '../engine/types'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, LeaderState, PendingChoice, UnitState } from '../engine/types'

/**
 * Using a triggered ability a second time. The engine announces each ability it resolves
 * (`whenAbilityUsed`, with the ability's handle in `ctx.usedAbility`), and the cards here react to the
 * announcement by running that same ability again: Grand Admiral Thrawn ("When Defeated"), Enfys Nest
 * ("On Attack"), Qui-Gon Jinn's Aethersprite (the next "When Played" this phase). Shadow Caster and
 * Fire Across the Galaxy run abilities again without reacting to a use.
 *
 * Every replay is checked against the board the first run left (a second draw takes the next card, a
 * second Experience token stacks), and a replayed ability that asks something asks it again.
 */

const SHIPPED = ['JTL_002', 'LAW_014', 'JTL_169', 'LOF_197', 'LAW_256']
/** The abilities being used again: draws, a damage choice, and Spectre units for Fire Across the Galaxy. */
const USED = ['LOF_059', 'SHD_164', 'LAW_107', 'LAW_055', 'LAW_045']

const POOL = poolFor(['LAW', 'SEC', 'LOF', 'JTL', 'TWI', 'SHD', 'SOR', 'TS26', 'IBH'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries([...SHIPPED, ...USED].map(id => [id, real(id)])),
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 8 }),
  SPC: card({ id: 'SPC', arena: 'space', cost: 2, power: 2, hp: 8 }),
  A: card({ id: 'A', type: 'event', cost: 1 }),
  B: card({ id: 'B', type: 'event', cost: 1 }),
  C: card({ id: 'C', type: 'event', cost: 1 }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
const exp = (s: GameState, id: string) => U(s, id)?.upgrades.filter(a => a.cardId === TOKEN_EXPERIENCE).length ?? 0

const front = (cardId: string, exhausted = false): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted })
const deployed = (cardId: string): LeaderState => ({ cardId, deployed: true, epicActionUsed: true, exhausted: false })
const leaderUnit = (cardId: string) => unit('ldr', cardId, { isLeader: true })

type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(10), deck: ['A', 'B', 'C'], ...mine }),
      opponent: player({ resources: ready(10), deck: ['A', 'B', 'C'], ...theirs }),
    },
  })

const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const accept = (s: GameState, extra: { targetInstanceId?: string; optionIndex?: number } = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toEqual([])
const attack = (s: GameState, attackerId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' } })
/** Answer a "which goes first" question by naming the ability of `cardId`. */
const first = (s: GameState, cardId: string) => {
  const c = choice(s)
  if (c.kind !== 'chooseNextTrigger') return s
  return accept(s, { optionIndex: c.candidates.findIndex(x => x.cardId === cardId) })
}

describe('JTL_002 Grand Admiral Thrawn: use a "When Defeated" ability again', () => {
  it('front: after the ability resolves, may exhaust the leader to use it again, which reads the board the first run left', () => {
    const s = board({ leader: front('JTL_002'), units: [unit('wd', 'LOF_059')] })
    const killed = defeatUnit(s, 'wd')
    expect(killed.players.player.hand).toEqual(['A']) // the first run has resolved before the offer
    expect(choice(killed)).toMatchObject({ kind: 'mayPayThen', controller: 'player', cost: 0 })
    const again = accept(killed)
    expect(again.players.player.hand).toEqual(['A', 'B'])
    expect(again.players.player.leader.exhausted).toBe(true)
    noChoice(again)
  })

  it('front: declining leaves the leader ready and the ability used once', () => {
    const declined = skip(defeatUnit(board({ leader: front('JTL_002'), units: [unit('wd', 'LOF_059')] }), 'wd'))
    expect(declined.players.player.hand).toEqual(['A'])
    expect(declined.players.player.leader.exhausted).toBe(false)
    noChoice(declined)
  })

  it('front: an exhausted leader is not offered, nor is an opponent\'s "When Defeated" ability', () => {
    noChoice(defeatUnit(board({ leader: front('JTL_002', true), units: [unit('wd', 'LOF_059')] }), 'wd'))
    const theirs = defeatUnit(board({ leader: front('JTL_002') }, { units: [unit('wd', 'LOF_059')] }), 'wd')
    expect(theirs.players.opponent.hand).toEqual(['A'])
    noChoice(theirs)
  })

  it('front: does not hear an "On Attack" ability', () => {
    const swung = attack(board({ leader: front('JTL_002'), units: [unit('me', 'LAW_107')] }), 'me')
    expect(swung.players.player.hand).toEqual(['A'])
    noChoice(swung)
  })

  it('a replayed ability raises its own choice again', () => {
    const s = board({ leader: front('JTL_002'), units: [unit('wd', 'SHD_164'), unit('t', 'GRD')] })
    const killed = defeatUnit(s, 'wd')
    expect(choice(killed).kind).not.toBe('mayPayThen') // Rhokai's own target comes first
    const hit = accept(killed, { targetInstanceId: 't' })
    expect(U(hit, 't')?.damage).toBe(1)
    expect(choice(hit)).toMatchObject({ kind: 'mayPayThen' })
    const again = accept(hit)
    expect(choice(again).kind).not.toBe('mayPayThen') // asked again, not resolved silently
    const twice = accept(again, { targetInstanceId: 't' })
    expect(U(twice, 't')?.damage).toBe(2)
    noChoice(twice)
  })

  it('back: no exhaust, but only once each round', () => {
    const s = board({ leader: deployed('JTL_002'), units: [leaderUnit('JTL_002'), unit('wd', 'LOF_059'), unit('wd2', 'LOF_059')] })
    const again = accept(defeatUnit(s, 'wd'))
    expect(again.players.player.hand).toEqual(['A', 'B'])
    expect(U(again, 'ldr')?.exhausted).toBe(false)
    const second = defeatUnit(again, 'wd2')
    expect(second.players.player.hand).toEqual(['A', 'B', 'C'])
    noChoice(second)
  })
})

describe('LAW_014 Enfys Nest: use an "On Attack" ability again', () => {
  it('front: may pay 2 and exhaust the leader to use it again', () => {
    const swung = attack(board({ leader: front('LAW_014'), units: [unit('me', 'LAW_107')] }), 'me')
    expect(swung.players.player.hand).toEqual(['A'])
    expect(choice(swung)).toMatchObject({ kind: 'mayPayThen', controller: 'player', cost: 2 })
    const again = accept(swung)
    expect(again.players.player.hand).toEqual(['A', 'B'])
    expect(again.players.player.leader.exhausted).toBe(true)
    expect(again.players.player.resources.filter(r => r.exhausted)).toHaveLength(2)
  })

  it('front: does not hear a "When Defeated" ability', () => {
    noChoice(defeatUnit(board({ leader: front('LAW_014'), units: [unit('wd', 'LOF_059')] }), 'wd'))
  })

  it('back: free, but only once each round', () => {
    const s = board({ leader: deployed('LAW_014'), units: [leaderUnit('LAW_014'), unit('me', 'LAW_107'), unit('me2', 'LAW_107')] })
    const swung = attack(s, 'me')
    expect(choice(swung)).toMatchObject({ kind: 'mayPayThen', cost: 0 })
    const again = accept(swung)
    expect(again.players.player.hand).toEqual(['A', 'B'])
    const second = attack({ ...again, activePlayer: 'player' }, 'me2')
    expect(second.players.player.hand).toEqual(['A', 'B', 'C'])
    noChoice(second)
  })
})

describe('JTL_169 Shadow Caster: use all of a defeated friendly unit\'s "When Defeated" abilities again', () => {
  it('may use them again when a friendly unit is defeated', () => {
    const s = board({ units: [unit('sc', 'JTL_169'), unit('wd', 'LOF_059')] })
    let next = first(defeatUnit(s, 'wd'), 'LOF_059')
    expect(choice(next)).toMatchObject({ kind: 'mayPayThen', controller: 'player', cost: 0 })
    next = accept(next)
    expect(next.players.player.hand).toEqual(['A', 'B'])
    noChoice(next)
  })

  it('a replayed ability raises its own choice again', () => {
    const s = board({ units: [unit('sc', 'JTL_169'), unit('wd', 'SHD_164'), unit('t', 'GRD')] })
    let next = first(defeatUnit(s, 'wd'), 'SHD_164')
    next = accept(next, { targetInstanceId: 't' })
    next = accept(next) // Shadow Caster: use it again
    expect(choice(next).kind).not.toBe('mayPayThen')
    next = accept(next, { targetInstanceId: 't' })
    expect(U(next, 't')?.damage).toBe(2)
  })

  it('does not react to an enemy unit, or to a unit with no "When Defeated" ability', () => {
    const theirs = defeatUnit(board({ units: [unit('sc', 'JTL_169')] }, { units: [unit('wd', 'LOF_059')] }), 'wd')
    expect(theirs.players.player.hand).toEqual([])
    noChoice(theirs)
    noChoice(defeatUnit(board({ units: [unit('sc', 'JTL_169'), unit('g', 'GRD')] }), 'g'))
  })
})

describe('LOF_197 Qui-Gon Jinn\'s Aethersprite: the next "When Played" this phase may be used again', () => {
  const swung = () => attack(board({ units: [unit('qg', 'LOF_197', { arena: 'space' })], hand: ['LAW_055', 'LAW_055'] }), 'qg')

  it('the next "When Played" ability may be used again, once', () => {
    let next = resolve({ ...swung(), activePlayer: 'player' }, { type: 'playUnit', handIndex: 0 })
    const chopper = next.players.player.units.find(u => u.cardId === 'LAW_055')!.instanceId
    // Aethersprite is Cunning, so Chopper gives himself 2 Experience tokens each time.
    expect(exp(next, chopper)).toBe(2)
    expect(choice(next)).toMatchObject({ kind: 'mayPayThen', controller: 'player', cost: 0 })
    next = accept(next)
    expect(exp(next, chopper)).toBe(4)
    noChoice(next)
    // Only the next time: a second "When Played" is not offered.
    const again = resolve({ ...next, activePlayer: 'player' }, { type: 'playUnit', handIndex: 0 })
    noChoice(again)
  })

  it('lasts only for the phase', () => {
    let next = clearLastingEffects(swung())
    next = resolve({ ...next, activePlayer: 'player' }, { type: 'playUnit', handIndex: 0 })
    noChoice(next)
  })

  it('a "When Played" before the attack is not offered', () => {
    const s = board({ units: [unit('qg', 'LOF_197', { arena: 'space' })], hand: ['LAW_055'] })
    noChoice(resolve(s, { type: 'playUnit', handIndex: 0 }))
  })
})

describe('LAW_256 Fire Across the Galaxy: use any number of "When Played" abilities on friendly Spectre units', () => {
  const s = () => board(
    { hand: ['LAW_256'], units: [unit('chop', 'LAW_055'), unit('zeb', 'LAW_045'), unit('g', 'GRD')] },
    { units: [unit('ezra', 'LAW_055'), unit('t', 'GRD')] },
  )

  it('offers each friendly Spectre unit with a "When Played" ability, one at a time, until none is left', () => {
    let next = resolve(s(), { type: 'playEvent', handIndex: 0 })
    expect(choice(next)).toMatchObject({ kind: 'selectUnitThen', optional: true })
    expect([...(choice(next) as { targets: string[] }).targets].sort()).toEqual(['chop', 'zeb'])
    next = accept(next, { targetInstanceId: 'chop' })
    expect(exp(next, 'chop')).toBe(1)
    expect((choice(next) as { targets: string[] }).targets).toEqual(['zeb'])
    next = accept(next, { targetInstanceId: 'zeb' })
    // Zeb's own "you may deal 3 damage to a ground unit" is asked, then nothing is left to offer.
    expect(choice(next).kind).not.toBe('selectUnitThen')
    next = accept(next, { targetInstanceId: 't' })
    expect(U(next, 't')?.damage).toBe(3)
    noChoice(next)
  })

  it('stops when the player is done', () => {
    let next = resolve(s(), { type: 'playEvent', handIndex: 0 })
    next = skip(next)
    expect(exp(next, 'chop')).toBe(0)
    noChoice(next)
  })
})
