import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { defeatUnit } from '../engine/combat'
import { createCreditTokens, friendlyCreditTokens, createForceToken, hasForceToken } from '../engine/effects'
import { unitHasKeyword } from '../engine/keywords'
import { TOKEN_EXPERIENCE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { TOKEN_CLONE_TROOPER } from '../engine/tokenUnits'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * The Credit-token cards that needed per-card wiring beyond the token and its payment path: six
 * leaders, a base Epic Action, "any player may use this ability", a reveal-then-play-for-free chain,
 * an exchange of control with a reward, and three cards that grant a Credit ability to a unit.
 */

const POOL = poolFor(['LAW'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const IDS = [
  'LAW_002', 'LAW_006', 'LAW_008', 'LAW_013', 'LAW_015', 'LAW_018', 'LAW_019', 'LAW_156', 'LAW_235',
  'LAW_140', 'LAW_080', 'LAW_092', 'LAW_215', 'LAW_170', 'LAW_225', 'LAW_141', 'LAW_169',
]
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(IDS.map(id => [id, real(id)])),
  // Props
  UW: card({ id: 'UW', arena: 'ground', cost: 2, power: 2, hp: 3, traits: ['Underworld'] }),
  CHEAP: card({ id: 'CHEAP', arena: 'ground', cost: 1, power: 1, hp: 3 }),
  PRICEY: card({ id: 'PRICEY', arena: 'ground', cost: 5, power: 3, hp: 6 }),
  ODD: card({ id: 'ODD', arena: 'ground', cost: 3, power: 1, hp: 1, aspects: ['Cunning'] }),
  EVEN: card({ id: 'EVEN', arena: 'ground', cost: 4, power: 1, hp: 1, aspects: ['Vigilance'] }),
  BIG: card({ id: 'BIG', arena: 'ground', cost: 4, power: 4, hp: 20 }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}): GameState => state({
  cards: F,
  players: {
    player: player({ resources: ready(10), deck: [], ...mine }),
    opponent: player({ resources: ready(10), deck: [], ...theirs }),
  },
})
const leader = (cardId: string, deployed = false) => ({ leader: { cardId, deployed, epicActionUsed: deployed, exhausted: false } })
const leaderUnit = (id: string, cardId: string) => unit(id, cardId, { isLeader: true })

const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const controllerOf = (s: GameState, id: string): PlayerId | undefined =>
  s.players.player.units.some(u => u.instanceId === id) ? 'player' : s.players.opponent.units.some(u => u.instanceId === id) ? 'opponent' : undefined
const credits = (s: GameState, who: PlayerId = 'player') => friendlyCreditTokens(s, who)
const choice = (s: GameState): PendingChoice => {
  const c = s.pendingChoices?.[0]
  if (!c) throw new Error('no pending choice')
  return c
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? [], 'no choice is raised').toHaveLength(0)
type Extra = Partial<Extract<Action, { type: 'acceptChoice' }>>
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const decline = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const playUnit = (s: GameState, handIndex = 0) => resolve(s, { type: 'playUnit', handIndex })
const playEvent = (s: GameState, handIndex = 0) => resolve(s, { type: 'playEvent', handIndex })
const playUpgrade = (s: GameState, targetInstanceId: string, handIndex = 0) => resolve(s, { type: 'playUpgrade', handIndex, targetInstanceId })
const leaderAction =(s: GameState, index = 0) => resolve(s, { type: 'useLeaderAbility', index })
const unitAction =(s: GameState, instanceId: string, cardId: string, index = 0) => resolve(s, { type: 'useAbility', instanceId, cardId, index })
const attackBase = (s: GameState, attackerId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' } })
const attackUnit = (s: GameState, attackerId: string, targetId: string) =>
  resolve(s, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: targetId } })
const targetsOf = (c: PendingChoice): string[] =>
  ('targets' in c ? [...(c.targets as string[])] : 'unitTargets' in c ? [...(c.unitTargets as string[])] : []).sort()
const withCredits = (s: GameState, who: PlayerId, n: number) => createCreditTokens(s, who, n)
const offers = (s: GameState, pred: (a: Action) => boolean) => legalMoves(s).some(pred)
const readyCount = (s: GameState, who: PlayerId = 'player') => s.players[who].resources.filter(r => !r.exhausted).length

// ── Units ─────────────────────────────────────────────────────────────────────────────────────────

describe('LAW_235 Lady Proxima: Action [Exhaust]: create a Credit token', () => {
  it('exhausts her and creates one', () => {
    const s = unitAction(board({ units: [unit('p', 'LAW_235')] }), 'p', 'LAW_235')
    expect(credits(s)).toBe(1)
    expect(U(s, 'p')!.exhausted).toBe(true)
  })
  it('is not offered while she is exhausted', () => {
    const s = board({ units: [unit('p', 'LAW_235', { exhausted: true })] })
    expect(offers(s, a => a.type === 'useAbility' && a.cardId === 'LAW_235')).toBe(false)
  })
})

describe('LAW_156 Hunter For Hire: Action [defeat a friendly Credit token]: take control of this unit; any player may use it', () => {
  const hunterIsTheirs = (playerCredits: number) =>
    withCredits(board({}, { units: [unit('h', 'LAW_156')] }), 'player', playerCredits)
  it('the player who uses it pays with their own Credit token and takes control of it', () => {
    const s = unitAction(hunterIsTheirs(2), 'h', 'LAW_156')
    expect(controllerOf(s, 'h')).toBe('player')
    expect(credits(s)).toBe(1)
  })
  it('is offered to the other player only while they hold a Credit token', () => {
    const offered = (s: GameState) => offers(s, a => a.type === 'useAbility' && a.instanceId === 'h')
    expect(offered(hunterIsTheirs(1))).toBe(true)
    expect(offered(hunterIsTheirs(0))).toBe(false)
  })
  it('is not offered to its own controller, who would gain nothing', () => {
    const s = withCredits(board({ units: [unit('h', 'LAW_156')] }), 'player', 1)
    expect(offers(s, a => a.type === 'useAbility' && a.instanceId === 'h')).toBe(false)
  })
})

describe("LAW_140 Intimidator: return any number of friendly resources to their owners' hands, a Credit token for each", () => {
  // 11 plus 2 for its Villainy aspect penalty.
  const played = () => playUnit(board({ hand: ['LAW_140'], resources: [...ready(13), { cardId: 'THEIRS', exhausted: true, owner: 'opponent' }] }))
  it('offers the resources one at a time, creating a Credit token for each returned', () => {
    let s = played()
    expect(choice(s).kind).toBe('selectCardThen')
    s = accept(s, { optionIndex: 0 })
    expect(credits(s)).toBe(1)
    expect(s.players.player.hand).toEqual(['R0'])
    s = accept(s, { optionIndex: 0 })
    expect(credits(s)).toBe(2)
    expect(s.players.player.resources).toHaveLength(12)
    s = decline(s)
    noChoice(s)
    expect(credits(s)).toBe(2)
  })
  it("returns a resource another player owns to that player's hand", () => {
    let s = played()
    const c = choice(s)
    const at = c.kind === 'selectCardThen' ? c.candidates.indexOf('THEIRS') : -1
    s = accept(s, { optionIndex: at })
    expect(s.players.opponent.hand).toEqual(['THEIRS'])
    expect(credits(s)).toBe(1)
  })
  it('creates nothing when every return is declined', () => {
    const s = decline(played())
    expect(credits(s)).toBe(0)
  })
})

describe('LAW_092 Two-Faced Troig: may have an opponent take control of this unit; if you do, create 2 Credit tokens', () => {
  it('hands itself over and creates two', () => {
    let s = playUnit(board({ hand: ['LAW_092'] }))
    expect(choice(s).kind).toBe('mayPayThen')
    s = accept(s)
    expect(s.players.opponent.units.map(u => u.cardId)).toEqual(['LAW_092'])
    expect(credits(s)).toBe(2)
  })
  it('keeps it and creates nothing on a decline', () => {
    const s = decline(playUnit(board({ hand: ['LAW_092'] })))
    expect(s.players.player.units.map(u => u.cardId)).toEqual(['LAW_092'])
    expect(credits(s)).toBe(0)
  })
})

describe('LAW_080 Luke Skywalker: an opponent chooses one', () => {
  // 7 plus 4 for its Aggression and Cunning aspect penalties.
  const played = () => playUnit(board({ hand: ['LAW_080'], resources: ready(11) }, { units: [unit('e', 'BIG')] }))
  it('the opponent decides', () => {
    expect(choice(played())).toMatchObject({ kind: 'chooseMode', controller: 'opponent' })
  })
  it('first mode: they create a Credit token and Luke readies', () => {
    const s = accept(played(), { optionIndex: 0 })
    expect(credits(s, 'opponent')).toBe(1)
    expect(credits(s, 'player')).toBe(0)
    expect(s.players.player.units.find(u => u.cardId === 'LAW_080')!.exhausted).toBe(false)
  })
  it('second mode: Luke\'s controller may deal 5 damage to a unit', () => {
    let s = accept(played(), { optionIndex: 1 })
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', controller: 'player', amount: 5, optional: true })
    s = accept(s, { targetInstanceId: 'e' })
    expect(U(s, 'e')!.damage).toBe(5)
    expect(credits(s, 'opponent')).toBe(0)
  })
})

describe('LAW_215 Vermillion: When Attack Ends, if it survived, reveal the top card of a deck; a chosen player may play it for free; a different player creates Credit tokens equal to its cost', () => {
  const attacked = (mine: Side = {}, theirs: Side = {}) =>
    attackBase(board({ units: [unit('v', 'LAW_215')], ...mine }, { deck: ['PRICEY', 'CHEAP'], ...theirs }), 'v')
  it('reveals the chosen deck, and the chosen player plays its top card for free', () => {
    let s = attacked()
    expect(choice(s).kind).toBe('choosePlayerThen')
    s = accept(s, { optionIndex: 0 }) // the opponent's deck
    expect(choice(s).kind).toBe('choosePlayerThen')
    s = accept(s, { optionIndex: 1 }) // Vermillion's controller plays it
    expect(choice(s)).toMatchObject({ kind: 'playCardFrom', controller: 'player', free: true })
    const before = readyCount(s)
    s = accept(s, { optionIndex: 0 })
    const played = s.players.player.units.find(u => u.cardId === 'PRICEY')
    expect(played, 'the opponent\'s card is played under the player\'s control').toBeDefined()
    expect(played!.owner).toBe('opponent')
    expect(readyCount(s)).toBe(before)
    expect(s.players.opponent.deck).toEqual(['CHEAP'])
    expect(credits(s, 'opponent'), 'the other player creates Credits equal to its cost').toBe(5)
    expect(credits(s, 'player')).toBe(0)
  })
  it('the opponent may be the one to play the top card of their own deck, and then the controller creates the Credits', () => {
    let s = attacked()
    s = accept(s, { optionIndex: 0 })
    s = accept(s, { optionIndex: 0 }) // the opponent plays it
    expect(choice(s)).toMatchObject({ kind: 'playCardFrom', controller: 'opponent' })
    s = accept(s, { optionIndex: 0 })
    expect(s.players.opponent.units.map(u => u.cardId)).toEqual(['PRICEY'])
    expect(credits(s, 'player')).toBe(5)
  })
  it('creates nothing when the chosen player declines to play it', () => {
    let s = attacked({ deck: ['CHEAP'] })
    s = accept(s, { optionIndex: 1 }) // the controller's own deck
    s = accept(s, { optionIndex: 0 }) // the opponent may play it
    expect(choice(s)).toMatchObject({ kind: 'playCardFrom', controller: 'opponent' })
    s = decline(s)
    expect(credits(s, 'player') + credits(s, 'opponent')).toBe(0)
    expect(s.players.player.deck).toEqual(['CHEAP'])
  })
  it('does nothing when it did not survive the attack', () => {
    const s = attackUnit(board({ units: [unit('v', 'LAW_215', { damage: 6 })] }, { units: [unit('e', 'BIG', { arena: 'space' })], deck: ['CHEAP'] }), 'v', 'e')
    expect(U(s, 'v')).toBeUndefined()
    noChoice(s)
  })
})

// ── Events ────────────────────────────────────────────────────────────────────────────────────────

describe('LAW_170 Double-Cross: exchange control; the player taking the lower-cost unit creates the difference in Credit tokens', () => {
  it('the opponent takes the cheaper friendly unit, so the opponent creates the difference', () => {
    let s = playEvent(board({ hand: ['LAW_170'], units: [unit('m', 'CHEAP')] }, { units: [unit('t', 'PRICEY')] }))
    s = accept(s, { targetInstanceId: 'm' })
    s = accept(s, { targetInstanceId: 't' })
    expect(controllerOf(s, 'm')).toBe('opponent')
    expect(controllerOf(s, 't')).toBe('player')
    expect(credits(s, 'opponent')).toBe(4)
    expect(credits(s, 'player')).toBe(0)
  })
  it('the player takes the cheaper enemy unit, so the player creates the difference', () => {
    let s = playEvent(board({ hand: ['LAW_170'], units: [unit('m', 'PRICEY')] }, { units: [unit('t', 'CHEAP')] }))
    s = accept(s, { targetInstanceId: 'm' })
    s = accept(s, { targetInstanceId: 't' })
    expect(credits(s, 'player')).toBe(4)
    expect(credits(s, 'opponent')).toBe(0)
  })
  it('creates nothing when the costs are equal', () => {
    let s = playEvent(board({ hand: ['LAW_170'], units: [unit('m', 'PRICEY')] }, { units: [unit('t', 'PRICEY')] }))
    s = accept(s, { targetInstanceId: 'm' })
    s = accept(s, { targetInstanceId: 't' })
    expect(controllerOf(s, 't')).toBe('player')
    expect(credits(s, 'player') + credits(s, 'opponent')).toBe(0)
  })
})

describe('LAW_169 Payroll Heist: for this phase, each friendly unit gains "On Attack: Create a Credit token."', () => {
  it('each friendly unit creates one as it attacks', () => {
    let s = playEvent(board({ hand: ['LAW_169'], units: [unit('a', 'CHEAP'), unit('b', 'CHEAP')] }))
    s = attackBase({ ...s, activePlayer: 'player' }, 'a')
    expect(credits(s)).toBe(1)
    s = attackBase({ ...s, activePlayer: 'player' }, 'b')
    expect(credits(s)).toBe(2)
  })
  it('enemy units do not gain it', () => {
    let s = playEvent(board({ hand: ['LAW_169'] }, { units: [unit('e', 'CHEAP')] }))
    s = attackBase({ ...s, activePlayer: 'opponent' }, 'e')
    expect(credits(s, 'opponent')).toBe(0)
  })
})

// ── Upgrades ──────────────────────────────────────────────────────────────────────────────────────

describe('LAW_225 Han\'s Golden Dice: attached unit gains "On Attack: Discard a card from your deck. If its cost is odd, create a Credit token."', () => {
  const diced = (deck: string[]) => playUpgrade(board({ hand: ['LAW_225'], units: [unit('a', 'CHEAP')], deck }), 'a')
  it('creates one when the discarded card costs an odd amount', () => {
    const s = attackBase({ ...diced(['ODD', 'EVEN']), activePlayer: 'player' }, 'a')
    expect(s.players.player.discard).toContain('ODD')
    expect(credits(s)).toBe(1)
  })
  it('creates none for an even cost', () => {
    const s = attackBase({ ...diced(['EVEN', 'ODD']), activePlayer: 'player' }, 'a')
    expect(s.players.player.discard).toContain('EVEN')
    expect(credits(s)).toBe(0)
  })
})

describe('LAW_141 Targeted For Removal: attached unit gains "When Defeated: An opponent creates Credit tokens equal to this unit\'s cost."', () => {
  it('the defeated unit\'s opponent creates Credits equal to its cost', () => {
    let s = playUpgrade(board({ hand: ['LAW_141'] }, { units: [unit('t', 'PRICEY')] }), 't')
    s = defeatUnit(s, 't')
    expect(credits(s, 'player')).toBe(5)
    expect(credits(s, 'opponent')).toBe(0)
  })
})

// ── Leaders ───────────────────────────────────────────────────────────────────────────────────────

describe('LAW_013 Chewbacca', () => {
  it('front: [C=1, Exhaust, defeat a friendly resource]: deal 2 damage to a unit and create a Credit token', () => {
    let s = leaderAction(board({ ...leader('LAW_013'), resources: ready(3) }, { units: [unit('e', 'BIG')] }))
    expect(s.players.player.leader.exhausted).toBe(true)
    expect(readyCount(s)).toBe(2)
    expect(choice(s)).toMatchObject({ kind: 'selectCardThen' })
    expect(choice(s)).not.toHaveProperty('optional')
    s = accept(s, { optionIndex: 0 })
    expect(s.players.player.resources).toHaveLength(2)
    expect(credits(s)).toBe(1)
    s = accept(s, { targetInstanceId: 'e' })
    expect(U(s, 'e')!.damage).toBe(2)
  })
  it('front: is not offered without the resource to pay and the one to defeat', () => {
    expect(offers(board({ ...leader('LAW_013'), resources: [] }), a => a.type === 'useLeaderAbility')).toBe(false)
  })
  it('back: On Attack, may defeat a friendly resource; if you do, deal 2 damage to a unit and create a Credit token', () => {
    let s = attackBase(board({ ...leader('LAW_013', true), units: [leaderUnit('c', 'LAW_013')] }, { units: [unit('e', 'BIG')] }), 'c')
    expect(choice(s)).toMatchObject({ kind: 'selectCardThen', optional: true })
    s = accept(s, { optionIndex: 0 })
    expect(s.players.player.resources).toHaveLength(9)
    expect(credits(s)).toBe(1)
    s = accept(s, { targetInstanceId: 'e' })
    expect(U(s, 'e')!.damage).toBe(2)
  })
  it('back: declining defeats nothing and creates nothing', () => {
    const s = decline(attackBase(board({ ...leader('LAW_013', true), units: [leaderUnit('c', 'LAW_013')] }), 'c'))
    expect(s.players.player.resources).toHaveLength(10)
    expect(credits(s)).toBe(0)
  })
})

describe('LAW_008 Director Krennic', () => {
  it('front: [Exhaust, defeat a friendly unit]: create a Credit token', () => {
    let s = leaderAction(board({ ...leader('LAW_008'), units: [unit('f', 'CHEAP')] }))
    expect(targetsOf(choice(s))).toEqual(['f'])
    s = accept(s, { targetInstanceId: 'f' })
    expect(U(s, 'f')).toBeUndefined()
    expect(credits(s)).toBe(1)
  })
  it('front: is not offered without a friendly unit to defeat', () => {
    expect(offers(board(leader('LAW_008')), a => a.type === 'useLeaderAbility')).toBe(false)
  })
  it('back: When Deployed, another friendly unit deals damage equal to its power to an enemy unit', () => {
    let s = resolve(board({ ...leader('LAW_008'), units: [unit('f', 'PRICEY')] }, { units: [unit('e', 'BIG')] }), { type: 'deployLeader' })
    expect(targetsOf(choice(s))).toEqual(['f'])
    s = accept(s, { targetInstanceId: 'f' })
    s = accept(s, { targetInstanceId: 'e' })
    expect(U(s, 'e')!.damage).toBe(3)
  })
})

describe('LAW_015 Jabba the Hutt', () => {
  it("front: [C=1, Exhaust, return a friendly Underworld unit to its owner's hand]: create a Credit token", () => {
    let s = leaderAction(board({ ...leader('LAW_015'), units: [unit('u', 'UW'), unit('n', 'CHEAP')] }))
    expect(readyCount(s)).toBe(9)
    expect(targetsOf(choice(s))).toEqual(['u'])
    s = accept(s, { targetInstanceId: 'u' })
    expect(s.players.player.hand).toEqual(['UW'])
    expect(credits(s)).toBe(1)
  })
  it('front: is not offered without a friendly Underworld unit', () => {
    expect(offers(board({ ...leader('LAW_015'), units: [unit('n', 'CHEAP')] }), a => a.type === 'useLeaderAbility')).toBe(false)
  })
  const jabbaBack = (credit: number, hand = ['UW', 'CHEAP']) =>
    withCredits(board({ ...leader('LAW_015', true), units: [leaderUnit('j', 'LAW_015')], hand }, { units: [unit('e', 'CHEAP')] }), 'player', credit)
  it('back: Action: play an Underworld unit from your hand; a Credit defeated while paying gives it Ambush for this phase', () => {
    let s = unitAction(jabbaBack(1), 'j', 'LAW_015')
    expect(choice(s)).toMatchObject({ kind: 'selectHandCardThen', handIndices: [0] })
    s = accept(s, { handIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'exploit', credit: true })
    s = accept(s, { optionIndex: 0 })
    const played = s.players.player.units.find(u => u.cardId === 'UW')!
    expect(credits(s)).toBe(0)
    expect(readyCount(s), 'the Credit paid 1 of its 2').toBe(9)
    expect(unitHasKeyword(s, played, 'Ambush')).toBe(true)
  })
  it('back: paid without a Credit, the unit does not gain Ambush', () => {
    let s = unitAction(jabbaBack(1), 'j', 'LAW_015')
    s = accept(s, { handIndex: 0 })
    s = decline(s) // pay in full, keeping the Credit
    const played = s.players.player.units.find(u => u.cardId === 'UW')!
    expect(credits(s)).toBe(1)
    expect(readyCount(s)).toBe(8)
    expect(unitHasKeyword(s, played, 'Ambush')).toBe(false)
  })
  it('back: with no Credit held the unit is still played, paying its cost', () => {
    let s = unitAction(jabbaBack(0), 'j', 'LAW_015')
    s = accept(s, { handIndex: 0 })
    if (s.pendingChoices?.[0]?.kind === 'exploit') s = decline(s)
    expect(s.players.player.units.map(u => u.cardId)).toContain('UW')
    expect(readyCount(s)).toBe(8)
  })
  it('back: is not offered without an Underworld unit in hand', () => {
    expect(offers(jabbaBack(1, ['CHEAP']), a => a.type === 'useAbility' && a.instanceId === 'j')).toBe(false)
  })
})

describe('LAW_018 Lando Calrissian', () => {
  const front = (deck: string[], who: PlayerId = 'player') =>
    leaderAction(board({ ...leader('LAW_018'), ...(who === 'player' ? { deck } : {}) }, who === 'opponent' ? { deck } : {}))
  const aspectIndex = (s: GameState, aspect: string) => {
    const c = choice(s)
    return c.kind === 'chooseMode' ? c.modes.indexOf(aspect) : -1
  }
  it('front: [C=1, Exhaust]: choose an aspect, discard the top of a deck; a match creates a Credit token', () => {
    let s = front(['ODD', 'EVEN'])
    expect(readyCount(s)).toBe(9)
    expect(choice(s).kind).toBe('chooseMode')
    s = accept(s, { optionIndex: aspectIndex(s, 'Cunning') })
    expect(choice(s).kind).toBe('choosePlayerThen')
    s = accept(s, { optionIndex: 1 }) // the player's own deck
    expect(s.players.player.discard).toEqual(['ODD'])
    expect(credits(s)).toBe(1)
  })
  it('front: a miss creates nothing', () => {
    let s = front(['ODD'])
    s = accept(s, { optionIndex: aspectIndex(s, 'Vigilance') })
    s = accept(s, { optionIndex: 1 })
    expect(s.players.player.discard).toEqual(['ODD'])
    expect(credits(s)).toBe(0)
  })
  it("front: may discard from the opponent's deck", () => {
    let s = front(['EVEN'], 'opponent')
    s = accept(s, { optionIndex: aspectIndex(s, 'Vigilance') })
    s = accept(s, { optionIndex: 0 })
    expect(s.players.opponent.discard).toEqual(['EVEN'])
    expect(credits(s)).toBe(1)
  })
  it('back: When Deployed, may defeat a friendly Credit token; if you do, create 3', () => {
    let s = withCredits(board(leader('LAW_018')), 'player', 1)
    s = resolve(s, { type: 'deployLeader' })
    expect(choice(s).kind).toBe('mayPayThen')
    s = accept(s)
    expect(credits(s)).toBe(3)
  })
  it('back: offers nothing without a Credit token', () => {
    noChoice(resolve(board(leader('LAW_018')), { type: 'deployLeader' }))
  })
})

describe('LAW_002 Tobias Beckett', () => {
  it('front: [Exhaust]: choose a friendly unit, an opponent takes control of it, and you create a Credit token', () => {
    let s = leaderAction(board({ ...leader('LAW_002'), units: [unit('f', 'CHEAP')] }))
    expect(targetsOf(choice(s))).toEqual(['f'])
    s = accept(s, { targetInstanceId: 'f' })
    expect(controllerOf(s, 'f')).toBe('opponent')
    expect(U(s, 'f')!.owner).toBe('player')
    expect(credits(s)).toBe(1)
  })
  it('front: a leader unit changing control is defeated instead, and no Credit is created', () => {
    let s = leaderAction(board({ ...leader('LAW_002'), units: [leaderUnit('l', 'TST_L')] }))
    s = accept(s, { targetInstanceId: 'l' })
    expect(U(s, 'l')).toBeUndefined()
    expect(credits(s)).toBe(0)
  })
  it("back: When Deployed, defeat any number of units you own but don't control; for each, create a Credit token and draw a card", () => {
    const theirs = { units: [unit('m1', 'CHEAP', { owner: 'player' as PlayerId }), unit('m2', 'PRICEY', { owner: 'player' as PlayerId }), unit('e', 'BIG')] }
    let s = resolve(board({ ...leader('LAW_002'), deck: ['ODD', 'EVEN', 'BIG'] }, theirs), { type: 'deployLeader' })
    expect(targetsOf(choice(s))).toEqual(['m1', 'm2'])
    s = accept(s, { targetInstanceId: 'm1' })
    expect(targetsOf(choice(s))).toEqual(['m2'])
    s = accept(s, { targetInstanceId: 'm2' })
    noChoice(s)
    expect(U(s, 'm1')).toBeUndefined()
    expect(U(s, 'm2')).toBeUndefined()
    expect(credits(s)).toBe(2)
    expect(s.players.player.hand).toEqual(['ODD', 'EVEN'])
  })
  it('back: may stop early', () => {
    const theirs = { units: [unit('m1', 'CHEAP', { owner: 'player' as PlayerId })] }
    const s = decline(resolve(board({ ...leader('LAW_002'), deck: ['ODD'] }, theirs), { type: 'deployLeader' }))
    expect(U(s, 'm1')).toBeDefined()
    expect(credits(s)).toBe(0)
  })
})

describe('LAW_006 Vel Sartha', () => {
  it('front: [Exhaust]: give an Experience token to a unit; an opponent creates a Credit token', () => {
    let s = leaderAction(board({ ...leader('LAW_006'), units: [unit('f', 'CHEAP')] }))
    expect(credits(s, 'opponent')).toBe(1)
    s = accept(s, { targetInstanceId: 'f' })
    expect(U(s, 'f')!.upgrades.map(u => u.cardId)).toEqual([TOKEN_EXPERIENCE])
  })
  it('back: On Attack, may give an Experience token to a unit; if you do, an opponent creates a Credit token', () => {
    let s = attackBase(board({ ...leader('LAW_006', true), units: [leaderUnit('v', 'LAW_006'), unit('f', 'CHEAP')] }), 'v')
    s = accept(s, { targetInstanceId: 'f' })
    expect(U(s, 'f')!.upgrades.map(u => u.cardId)).toEqual([TOKEN_EXPERIENCE])
    expect(credits(s, 'opponent')).toBe(1)
  })
  it('back: declining gives nothing and creates nothing', () => {
    const s = decline(attackBase(board({ ...leader('LAW_006', true), units: [leaderUnit('v', 'LAW_006'), unit('f', 'CHEAP')] }), 'v'))
    expect(U(s, 'f')!.upgrades).toEqual([])
    expect(credits(s, 'opponent')).toBe(0)
  })
})

// ── Base ──────────────────────────────────────────────────────────────────────────────────────────

describe('LAW_019 Alliance Outpost: Epic Action [defeat a friendly token]: give an Experience or Shield token to a unit, or create a Credit token', () => {
  const outpost = (mine: Side = {}) => board({ base: { cardId: 'LAW_019', damage: 0 }, ...mine })
  const outpostAction =(s: GameState) => resolve(s, { type: 'useBaseAbility' })
  const modeIndex = (s: GameState, mode: string) => {
    const c = choice(s)
    return c.kind === 'chooseMode' ? c.modes.indexOf(mode) : -1
  }
  it('is not offered without a friendly token of any kind', () => {
    expect(offers(outpost({ units: [unit('f', 'CHEAP')] }), a => a.type === 'useBaseAbility')).toBe(false)
  })
  it('a Credit token pays for it, and it can give an Experience token to a unit', () => {
    let s = outpostAction(withCredits(outpost({ units: [unit('f', 'CHEAP')] }), 'player', 1))
    // A Credit is the only friendly token, so it is defeated without asking which.
    expect(credits(s)).toBe(0)
    s = accept(s, { optionIndex: modeIndex(s, 'experience') })
    s = accept(s, { targetInstanceId: 'f' })
    expect(U(s, 'f')!.upgrades.map(u => u.cardId)).toEqual([TOKEN_EXPERIENCE])
    expect(s.players.player.base.epicActionUsed).toBe(true)
  })
  it('a token upgrade on a unit pays for it, and it can create a Credit token', () => {
    let s = outpostAction(outpost({ units: [unit('f', 'CHEAP', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })] }))
    expect(choice(s).kind).toBe('selectUpgradeThen')
    s = accept(s, { optionIndex: 0 })
    expect(U(s, 'f')!.upgrades).toEqual([])
    s = accept(s, { optionIndex: modeIndex(s, 'credit') })
    expect(credits(s)).toBe(1)
  })
  it('a token unit pays for it, and it can give a Shield token to a unit', () => {
    let s = outpostAction(outpost({ units: [unit('t', TOKEN_CLONE_TROOPER), unit('f', 'CHEAP')] }))
    expect(targetsOf(choice(s))).toEqual(['t'])
    s = accept(s, { targetInstanceId: 't' })
    expect(U(s, 't')).toBeUndefined()
    s = accept(s, { optionIndex: modeIndex(s, 'shield') })
    s = accept(s, { targetInstanceId: 'f' })
    expect(U(s, 'f')!.upgrades.map(u => u.cardId)).toEqual([TOKEN_SHIELD])
  })
  it('the Force token pays for it; with no unit in play, the Credit token is the only reward', () => {
    const s = outpostAction(createForceToken(outpost(), 'player'))
    expect(hasForceToken(s, 'player')).toBe(false)
    noChoice(s)
    expect(credits(s)).toBe(1)
  })
  it('with several kinds of token, it asks which kind first', () => {
    let s = withCredits(outpost({ units: [unit('t', TOKEN_CLONE_TROOPER)] }), 'player', 1)
    s = outpostAction(s)
    const c = choice(s)
    expect(c.kind).toBe('chooseMode')
    expect(c.kind === 'chooseMode' ? [...c.modes].sort() : []).toEqual(['defeatCredit', 'defeatUnit'])
    s = accept(s, { optionIndex: modeIndex(s, 'defeatCredit') })
    expect(credits(s)).toBe(0)
    expect(U(s, 't')).toBeDefined()
  })
  it("an enemy-owned token upgrade on a friendly unit is not a friendly token", () => {
    const s = outpost({ units: [unit('f', 'CHEAP', { upgrades: [{ cardId: TOKEN_EXPERIENCE, owner: 'opponent' }] })] })
    expect(offers(s, a => a.type === 'useBaseAbility')).toBe(false)
  })
})
