import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { effectivePower, effectiveHp } from '../engine/stats'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
import { defeatUnit } from '../engine/combat'
import { TOKEN_CARDS, TOKEN_SHIELD, TOKEN_WEAKNESS } from '../engine/tokenUpgrades'
import { TOKEN_BEAST } from '../engine/tokenUnits'
import { evaluate } from '../ai/evaluate'
import { triage } from '../bench/triage'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Weakness tokens, and the Homeworlds cards that give them.
 *
 * A Weakness token is a token upgrade printed -1/-1 with the Condition trait and no text (the publisher's
 * card list; the comprehensive rules predate it). It is therefore the Experience token with the signs
 * flipped: the stats pipeline reads the -1/-1 off the token card like any upgrade, and a unit whose HP
 * that takes to 0 is defeated by the state-based sweep that closes every action. What the tests pin
 * beyond the token itself is the cards: who chooses, which units qualify, how many, and on what condition.
 */

const SHIPPED = [
  // Weakness is their only blocker
  'HMW_002', 'HMW_003', 'HMW_015', 'HMW_040', 'HMW_059', 'HMW_065', 'HMW_071', 'HMW_087', 'HMW_097', 'HMW_100',
  'HMW_110', 'HMW_196', 'HMW_197', 'HMW_200', 'HMW_231', 'HMW_240', 'HMW_242', 'HMW_248',
  // Weakness plus something the engine already has: Beast tokens, a compound trigger, a one-off trigger
  'HMW_062', 'HMW_067', 'HMW_199', 'HMW_202', 'HMW_237',
]
/** Scoped by the ticket, but lifted out to the ticket that owns its other blocker (play from discard). */
const LIFTED = ['HMW_109']

const POOL = poolFor(['HMW'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 8, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  GRD: src('GRD'),
  SPC: src('SPC', { arena: 'space' }),
  ONE: src('ONE', { power: 3, hp: 1 }),
  UNIQ: src('UNIQ', { unique: true }),
  CHEAP: src('CHEAP', { cost: 3 }),
  PRICEY: src('PRICEY', { cost: 4 }),
  DROID: src('DROID', { traits: ['DROID'] }),
  VEHICLE: src('VEHICLE', { traits: ['VEHICLE'] }),
  UW: src('UW', { cost: 3, traits: ['UNDERWORLD'] }),
  FR: src('FR', { cost: 3, traits: ['FRINGE'] }),
  PLAIN: src('PLAIN', { cost: 3 }),
  VIL: src('VIL', { aspects: ['Villainy'] }),
  HER: src('HER', { aspects: ['Heroism'] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 0, hp: 0 }),
  // Bases with a planet trait, and a plain one, all of one aspect so no aspect penalty differs between them.
  TAT_B: card({ id: 'TAT_B', type: 'base', hp: 30, aspects: ['Vigilance'], traits: ['TATOOINE'] }),
  NAB_B: card({ id: 'NAB_B', type: 'base', hp: 30, aspects: ['Vigilance'], traits: ['NABOO'] }),
}

const W = { cardId: TOKEN_WEAKNESS, owner: 'opponent' as PlayerId }
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
const weakness = (s: GameState, id: string): number => U(s, id)?.upgrades.filter(u => u.cardId === TOKEN_WEAKNESS).length ?? 0
const count = (s: GameState, who: PlayerId, token: string): number => s.players[who].units.filter(u => u.cardId === token).length

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
const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, played: { player: [], opponent: [] },
  leaderLeftPlay: [],
  ...over,
})

const moves = (s: GameState): Action[] => legalMoves(s)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const unitOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : [])))].sort()
const declinable = (s: GameState) => moves(s).some(m => m.type === 'skipTrigger')
const readyCount = (s: GameState, who: PlayerId) => s.players[who].resources.filter(r => !r.exhausted).length

const play = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState => {
  const p = s.players[who]
  const withCard = { ...s, activePlayer: who, players: { ...s.players, [who]: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playUnit', handIndex: p.hand.length })
}
const lastPlayed = (s: GameState, cardId: string): string => s.players.player.units.find(u => u.cardId === cardId)!.instanceId
const playEvent = (s: GameState, cardId: string): GameState => {
  const p = s.players.player
  const withCard = { ...s, activePlayer: 'player' as PlayerId, players: { ...s.players, player: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playEvent', handIndex: p.hand.length })
}
const playUpgrade = (s: GameState, cardId: string, target: string): GameState => {
  const p = s.players.player
  const withCard = { ...s, activePlayer: 'player' as PlayerId, players: { ...s.players, player: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playUpgrade', handIndex: p.hand.length, targetInstanceId: target })
}
const kill = (s: GameState, id: string): GameState => defeatUnit(s, id)
const attack = (s: GameState, attackerId: string, target?: string) =>
  resolve(s, { type: 'attack', attackerId, target: target ? { kind: 'unit', instanceId: target } : { kind: 'base' } })
const undeployedLeader = (cardId: string) => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })
const deployedLeader = (cardId: string) => ({ cardId, deployed: true, epicActionUsed: true, exhausted: false })
const front = (id: string, mine: Side = {}, theirs: Side = {}) => board({ leader: undeployedLeader(id), ...mine }, theirs)
const back = (id: string, mine: Side = {}, theirs: Side = {}) =>
  board({ leader: deployedLeader(id), ...mine, units: [unit('L', id, { isLeader: true }), ...(mine.units ?? [])] }, theirs)
const usable = (s: GameState) => moves(s).some(m => m.type === 'useLeaderAbility')
const useFront = (s: GameState) => resolve(s, { type: 'useLeaderAbility', index: 0 })
const useBack = (s: GameState, id: string) => resolve(s, { type: 'useAbility', instanceId: 'L', cardId: id, index: 0 })
const handOffers = (s: GameState) => {
  const c = choice(s)
  return c.kind === 'playUnitFromHand' ? c.candidates.map(x => x.cardId) : undefined
}

describe('Weakness tokens: the token', () => {
  it('registers an ability for every shipped card and none for the lifted one', () => {
    for (const id of SHIPPED) expect(getCardDefinition(id), id).toBeDefined()
    for (const id of LIFTED) expect(getCardDefinition(id), id).toBeUndefined()
  })

  it('is the printed token upgrade: Weakness, -1/-1, the Condition trait, no text', () => {
    const c = TOKEN_CARDS[TOKEN_WEAKNESS]
    expect([c.name, c.type, c.power, c.hp, c.traits.join(','), c.keywords.length]).toEqual(['Weakness', 'token', -1, -1, 'Condition', 0])
  })

  it('gives the unit -1/-1 for each token, and power never drops below 0', () => {
    const s = board({}, { units: [unit('e', 'GRD', { upgrades: [W, W] }), unit('z', 'GRD', { upgrades: [W, W, W] })] })
    expect([effectivePower(s, U(s, 'e')!), effectiveHp(s, U(s, 'e')!)]).toEqual([0, 6])
    expect(effectivePower(s, U(s, 'z')!)).toBe(0)
  })

  it('defeats a unit it takes to 0 HP, and the token ceases to exist rather than going to a discard pile', () => {
    const s = accept(play(board({}, { units: [unit('e', 'ONE')] }), 'HMW_197'), { targetInstanceId: 'e' })
    expect(U(s, 'e')).toBeUndefined()
    expect(s.players.opponent.discard).toEqual(['ONE'])
  })

  it('is valued by the AI through the stats it takes away: an enemy carrying one is better for us', () => {
    const plain = board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] })
    const weakened = board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD', { upgrades: [W] })] })
    expect(evaluate(weakened, 'player')).toBeGreaterThan(evaluate(plain, 'player'))
  })

  it('no longer blocks a card in the triage', () => {
    const r = triage([{ Set: 'HMW', Number: '197', Name: 'Cid Scaleback', Type: 'Unit', FrontText: 'When Played: An opponent chooses a unit they control. Give a Weakness token to it.' }])
    expect(r.triaged[0].blockers).toEqual([])
  })
})

describe('Weakness tokens, A: a token on a chosen unit', () => {
  it('Cid Scaleback (HMW_197): an opponent chooses a unit they control, and it gets the token', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD'), unit('e2', 'GRD')] }), 'HMW_197')
    expect(choice(s).controller).toBe('opponent')
    expect(unitOffers(s)).toEqual(['e', 'e2'])
    expect(declinable(s)).toBe(false)
    expect(weakness(accept(s, { targetInstanceId: 'e2' }), 'e2')).toBe(1)
    noChoice(play(board({ units: [unit('f', 'GRD')] }), 'HMW_197'))
  })

  it('Clone X Assassin (HMW_059) may give a token to any unit when defeated', () => {
    const s = kill(board({ units: [unit('a', 'HMW_059'), unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'a')
    expect(unitOffers(s)).toEqual(['e', 'f'])
    expect(declinable(s)).toBe(true)
    expect(weakness(accept(s, { targetInstanceId: 'e' }), 'e')).toBe(1)
  })

  it('Venomous Wyyyshokk (HMW_087) may give a token to a damaged unit when defeated', () => {
    const s = kill(board({ units: [unit('a', 'HMW_087'), unit('f', 'GRD', { damage: 1 })] }, { units: [unit('e', 'GRD'), unit('d', 'GRD', { damage: 2 })] }), 'a')
    expect(unitOffers(s)).toEqual(['d', 'f'])
    expect(declinable(s)).toBe(true)
  })

  it('Clone of the Zillo Beast (HMW_065) gives other friendly units -2/-2, and may give a token on attack', () => {
    const s = board({ units: [unit('z', 'HMW_065'), unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] })
    expect([effectivePower(s, U(s, 'f')!), effectiveHp(s, U(s, 'f')!)]).toEqual([0, 6])
    expect([effectivePower(s, U(s, 'e')!), effectiveHp(s, U(s, 'e')!)]).toEqual([2, 8])
    expect([effectivePower(s, U(s, 'z')!), effectiveHp(s, U(s, 'z')!)]).toEqual([6, 6])
    const a = attack(s, 'z')
    expect(declinable(a)).toBe(true)
    expect(weakness(accept(a, { targetInstanceId: 'e' }), 'e')).toBe(1)
  })

  it('Dire Prowess (HMW_097) may give a token to a unit as it is played', () => {
    const s = playUpgrade(board({ units: [unit('h', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_097', 'h')
    expect(unitOffers(s)).toEqual(['e', 'h'])
    expect(declinable(s)).toBe(true)
    expect(weakness(accept(s, { targetInstanceId: 'e' }), 'e')).toBe(1)
  })

  it('Occupation Officer (HMW_242) may give a token only while you control 6 or more resources', () => {
    noChoice(play(board({ resources: ready(5) }, { units: [unit('e', 'GRD')] }), 'HMW_242'))
    const s = play(board({ resources: ready(6) }, { units: [unit('e', 'GRD')] }), 'HMW_242')
    expect(declinable(s)).toBe(true)
    expect(weakness(accept(s, { targetInstanceId: 'e' }), 'e')).toBe(1)
  })

  it("Talzin's Shuttle (HMW_040) may give 2 tokens to a unit only if an opponent played 2 or more cards this phase", () => {
    const one = { phaseEvents: phaseEvents({ played: { player: [], opponent: ['GRD'] } }) }
    noChoice(play(board({}, { units: [unit('e', 'GRD')] }, one), 'HMW_040'))
    const two = { phaseEvents: phaseEvents({ played: { player: [], opponent: ['GRD', 'GRD'] } }) }
    const s = play(board({}, { units: [unit('e', 'GRD')] }, two), 'HMW_040')
    expect(declinable(s)).toBe(true)
    expect(weakness(accept(s, { targetInstanceId: 'e' }), 'e')).toBe(2)
  })

  it('Torrent (HMW_100) gives a token to a unit, or 2 while you control a Naboo base', () => {
    const s = playEvent(board({}, { units: [unit('e', 'GRD')] }), 'HMW_100')
    expect(declinable(s)).toBe(false)
    expect(weakness(accept(s, { targetInstanceId: 'e' }), 'e')).toBe(1)
    const naboo = playEvent(board({ base: { cardId: 'NAB_B', damage: 0 } }, { units: [unit('e', 'GRD')] }), 'HMW_100')
    expect(weakness(accept(naboo, { targetInstanceId: 'e' }), 'e')).toBe(2)
  })

  it('Dragonboat Freighter (HMW_231) may give a token to a unit, and exhausts it if it is unique', () => {
    const s = play(board({}, { units: [unit('u', 'UNIQ'), unit('e', 'GRD')] }), 'HMW_231')
    expect(declinable(s)).toBe(true)
    const unique = accept(s, { targetInstanceId: 'u' })
    expect([weakness(unique, 'u'), U(unique, 'u')!.exhausted]).toEqual([1, true])
    const plain = accept(s, { targetInstanceId: 'e' })
    expect([weakness(plain, 'e'), U(plain, 'e')!.exhausted]).toEqual([1, false])
  })

  it('Inferno Squad (HMW_202) may deal 1 damage to a unit and give a token to it, when played and when defeated', () => {
    const s = play(board({}, { units: [unit('e', 'GRD')] }), 'HMW_202')
    expect(declinable(s)).toBe(true)
    const hit = accept(s, { targetInstanceId: 'e' })
    expect([U(hit, 'e')!.damage, weakness(hit, 'e')]).toEqual([1, 1])
    const d = kill(board({ units: [unit('i', 'HMW_202')] }, { units: [unit('e', 'GRD')] }), 'i')
    const again = accept(d, { targetInstanceId: 'e' })
    expect([U(again, 'e')!.damage, weakness(again, 'e')]).toEqual([1, 1])
  })

  it('Inferno Squad (HMW_202) still gives the token when a Shield prevents the damage', () => {
    const s = accept(play(board({}, { units: [unit('e', 'GRD', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })] }), 'HMW_202'), { targetInstanceId: 'e' })
    expect([U(s, 'e')!.damage, weakness(s, 'e')]).toEqual([0, 1])
  })

  it('Qimir (HMW_196) may discard the top card of his deck when defeated, and if it is not Villainy gives an enemy unit a token', () => {
    const s = kill(board({ units: [unit('q', 'HMW_196'), unit('f', 'GRD')], deck: ['HER', 'VIL'] }, { units: [unit('e', 'GRD')] }), 'q')
    expect(declinable(s)).toBe(true)
    const milled = accept(s)
    expect(milled.players.player.deck).toEqual(['VIL'])
    expect(milled.players.player.discard).toContain('HER')
    expect(unitOffers(milled)).toEqual(['e'])
    expect(weakness(accept(milled, { targetInstanceId: 'e' }), 'e')).toBe(1)
    const villain = accept(kill(board({ units: [unit('q', 'HMW_196')], deck: ['VIL'] }, { units: [unit('e', 'GRD')] }), 'q'))
    expect(villain.players.player.discard).toContain('VIL')
    noChoice(villain)
  })
})

describe('Weakness tokens, B: tokens on several units, or on a unit that attacks', () => {
  it('Ravage (HMW_071) distributes up to 3 tokens among any units, stopping at any point', () => {
    const s = playEvent(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD'), unit('o', 'ONE')] }), 'HMW_071')
    expect(unitOffers(s)).toEqual(['e', 'f', 'o'])
    expect(declinable(s)).toBe(true)
    const twice = accept(accept(s, { targetInstanceId: 'e' }), { targetInstanceId: 'e' })
    expect(weakness(twice, 'e')).toBe(2)
    const done = accept(twice, { targetInstanceId: 'f' })
    expect(weakness(done, 'f')).toBe(1)
    noChoice(done)
    expect(weakness(skip(accept(s, { targetInstanceId: 'e' })), 'e')).toBe(1)
  })

  it('Ravage (HMW_071) stops offering a unit its tokens have already defeated', () => {
    const s = accept(playEvent(board({}, { units: [unit('e', 'GRD'), unit('o', 'ONE')] }), 'HMW_071'), { targetInstanceId: 'o' })
    expect(U(s, 'o')).toBeUndefined()
    expect(unitOffers(s)).toEqual(['e'])
  })

  it('Sandstorm (HMW_240) gives a token to each exhausted enemy unit in the chosen arena, and costs 1 less with a Tatooine base', () => {
    const theirs = { units: [unit('x', 'GRD', { exhausted: true }), unit('r', 'GRD'), unit('xs', 'SPC', { exhausted: true })] }
    const mine = { units: [unit('f', 'GRD', { exhausted: true })] }
    const s = playEvent(board(mine, theirs), 'HMW_240')
    const ground = accept(s, { optionIndex: 0 })
    expect(['x', 'r', 'xs', 'f'].map(id => weakness(ground, id))).toEqual([1, 0, 0, 0])
    const space = accept(s, { optionIndex: 1 })
    expect(['x', 'r', 'xs', 'f'].map(id => weakness(space, id))).toEqual([0, 0, 1, 0])
    const plainCost = 10 - readyCount(s, 'player')
    const tatooine = playEvent(board({ ...mine, base: { cardId: 'TAT_B', damage: 0 } }, theirs), 'HMW_240')
    expect(10 - readyCount(tatooine, 'player')).toBe(plainCost - 1)
  })

  it('Defoliator Tank (HMW_248) may pay 2 on attack to give 2 tokens to a defender that is not a Droid or Vehicle', () => {
    const s = attack(board({ units: [unit('a', 'HMW_248')] }, { units: [unit('e', 'GRD')] }), 'a', 'e')
    expect(declinable(s)).toBe(true)
    const paid = accept(s)
    expect(weakness(paid, 'e')).toBe(2)
    expect(readyCount(paid, 'player')).toBe(8)
    for (const id of ['DROID', 'VEHICLE']) noChoice(attack(board({ units: [unit('a', 'HMW_248')] }, { units: [unit('e', id)] }), 'a', 'e'))
    noChoice(attack(board({ units: [unit('a', 'HMW_248')] }), 'a'))
  })

  it('The Great Progenitor (HMW_067) may give itself a token as its attack ends, then creates a Beast for each token on it', () => {
    const s = attack(board({ units: [unit('a', 'HMW_067')] }), 'a')
    expect(declinable(s)).toBe(true)
    const once = accept(s)
    expect([weakness(once, 'a'), count(once, 'player', TOKEN_BEAST)]).toEqual([1, 1])
    const again = accept(attack(board({ units: [unit('a', 'HMW_067', { upgrades: [W] })] }), 'a'))
    expect([weakness(again, 'a'), count(again, 'player', TOKEN_BEAST)]).toEqual([2, 2])
    expect(count(skip(s), 'player', TOKEN_BEAST)).toBe(0)
  })
})

describe('Weakness tokens, C: control and reading the token', () => {
  it('Emperor Palpatine (HMW_110) may take control of an enemy non-leader unit that costs 3 or less for good, giving it 2 tokens', () => {
    const s = play(board({}, { units: [unit('c', 'CHEAP'), unit('p', 'PRICEY')] }), 'HMW_110')
    expect(unitOffers(s)).toEqual(['c'])
    expect(declinable(s)).toBe(true)
    const taken = accept(s, { targetInstanceId: 'c' })
    const c = taken.players.player.units.find(u => u.instanceId === 'c')!
    expect([weakness(taken, 'c'), c.controlUntil]).toEqual([2, 'permanent'])
  })

  it('Rish Loo (HMW_200) takes control of an enemy non-leader unit with a Weakness token until the regroup phase', () => {
    const s = play(board({ units: [unit('f', 'GRD', { upgrades: [W] })] }, { units: [unit('w', 'GRD', { upgrades: [W] }), unit('e', 'GRD')] }), 'HMW_200')
    expect(unitOffers(s)).toEqual(['w'])
    expect(declinable(s)).toBe(false)
    const taken = accept(s, { targetInstanceId: 'w' })
    const w = taken.players.player.units.find(u => u.instanceId === 'w')!
    expect([w.owner, w.controlUntil]).toEqual(['opponent', undefined])
    noChoice(play(board({}, { units: [unit('e', 'GRD')] }), 'HMW_200'))
  })

  it('Nuvo Vindi (HMW_062) may give a token when played, and again once each round when a weakened enemy unit is defeated', () => {
    const played = play(board({}, { units: [unit('e', 'GRD')] }), 'HMW_062')
    expect(declinable(played)).toBe(true)
    expect(weakness(accept(played, { targetInstanceId: 'e' }), 'e')).toBe(1)
    const s = board({ units: [unit('n', 'HMW_062')] }, { units: [unit('w', 'GRD', { upgrades: [W] }), unit('w2', 'GRD', { upgrades: [W] }), unit('e', 'GRD')] })
    noChoice(kill(s, 'e'))
    const first = kill(s, 'w')
    expect(declinable(first)).toBe(true)
    const given = accept(first, { targetInstanceId: 'e' })
    expect(weakness(given, 'e')).toBe(1)
    noChoice(kill(given, 'w2'))
    // Declining does not use it up. (Declining also ends the action and passes the turn, so the offer
    // is read off the raised choice rather than the active player's moves.)
    const again = choice(kill(skip(first), 'w2'))
    expect([again.kind, again.controller]).toEqual(['selectUnitThen', 'player'])
  })

  it('Geonosian Picador (HMW_199) creates a Beast, then gives a token to a friendly unit', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_199')
    const beast = s.players.player.units.find(u => u.cardId === TOKEN_BEAST)!.instanceId
    expect(unitOffers(s)).toEqual([beast, 'f', lastPlayed(s, 'HMW_199')].sort())
    expect(declinable(s)).toBe(false)
    expect(weakness(accept(s, { targetInstanceId: beast }), beast)).toBe(1)
  })

  it('Easy Prey (HMW_237) creates a Beast, and an opponent creates a Beast with a token on it', () => {
    const s = playEvent(board(), 'HMW_237')
    expect(count(s, 'player', TOKEN_BEAST)).toBe(1)
    expect(s.players.player.units[0].upgrades).toEqual([])
    const theirs = s.players.opponent.units
    expect(theirs.map(u => [u.cardId, u.upgrades.map(x => x.cardId)])).toEqual([[TOKEN_BEAST, [TOKEN_WEAKNESS]]])
    expect(effectivePower(s, theirs[0])).toBe(2)
  })
})

describe('Weakness tokens, D: leaders', () => {
  it('Maz Kanata (HMW_002) plays a Fringe or Underworld unit for 1 less and gives it a token; deployed the same with no exhaust', () => {
    const used = useFront(front('HMW_002', { hand: ['UW', 'FR', 'PLAIN'] }))
    expect(handOffers(used)).toEqual(['UW', 'FR'])
    const next = accept(used, { handIndex: 0 })
    const played = next.players.player.units.find(u => u.cardId === 'UW')!
    expect(weakness(next, played.instanceId)).toBe(1)
    expect(readyCount(next, 'player')).toBe(8)
    expect(usable(front('HMW_002', { hand: ['PLAIN'] }))).toBe(false)
    expect(handOffers(useBack(back('HMW_002', { hand: ['FR', 'PLAIN'] }), 'HMW_002'))).toEqual(['FR'])
  })

  it('Doctor Hemlock (HMW_003) pays 1 to give a token to a unit without one; deployed he may give one on attack', () => {
    const s = front('HMW_003', { units: [unit('f', 'GRD')] }, { units: [unit('w', 'GRD', { upgrades: [W] }), unit('e', 'GRD')] })
    const used = useFront(s)
    expect(unitOffers(used)).toEqual(['e', 'f'])
    expect(declinable(used)).toBe(false)
    const given = accept(used, { targetInstanceId: 'e' })
    expect(weakness(given, 'e')).toBe(1)
    expect(readyCount(given, 'player')).toBe(9)
    expect(given.players.player.leader.exhausted).toBe(true)
    expect(usable(front('HMW_003', {}, { units: [unit('w', 'GRD', { upgrades: [W] })] }))).toBe(false)
    const a = attack(back('HMW_003', {}, { units: [unit('w', 'GRD', { upgrades: [W] })] }), 'L')
    expect(declinable(a)).toBe(true)
    expect(weakness(accept(a, { targetInstanceId: 'w' }), 'w')).toBe(2)
  })

  it('Bossk (HMW_015) heals 1 damage from a damaged enemy unit and gives it a token; deployed he may deal 2 damage to a unit with a token upgrade', () => {
    const s = front('HMW_015', { units: [unit('f', 'GRD', { damage: 2 })] }, { units: [unit('d', 'GRD', { damage: 2 }), unit('e', 'GRD')] })
    const used = useFront(s)
    expect(unitOffers(used)).toEqual(['d'])
    const done = accept(used, { targetInstanceId: 'd' })
    expect([U(done, 'd')!.damage, weakness(done, 'd')]).toEqual([1, 1])
    expect(usable(front('HMW_015', {}, { units: [unit('e', 'GRD')] }))).toBe(false)
    const theirs = { units: [
      unit('sh', 'GRD', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] }),
      unit('w', 'GRD', { upgrades: [W] }),
      unit('c', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] }),
      unit('e', 'GRD'),
    ] }
    const a = attack(back('HMW_015', {}, theirs), 'L')
    expect(unitOffers(a)).toEqual(['sh', 'w'])
    expect(declinable(a)).toBe(true)
    expect(U(accept(a, { targetInstanceId: 'w' }), 'w')!.damage).toBe(2)
  })
})
