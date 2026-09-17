import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
import { TOKEN_EXPERIENCE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Cards that grant Experience tokens, in groups taken whole.
 *
 * An Experience token is a +1/+1 upgrade that an ability attaches (CR 3.7.2): the token machinery,
 * the stats pipeline and the `mayGiveTokens` choice already carried Shield and Advantage, so these
 * cards are registrations over primitives that exist. What the tests pin is therefore the cards: how
 * many tokens, on which unit, who chooses, and which units may be chosen. A filter that let
 * everything through would still pass a test that only checked the token landed, so each test states
 * the offer as well as the outcome.
 *
 * Printed stats, traits and keywords come from the shipped set fixtures, post-correction.
 */

const SHIPPED = [
  // A: tokens on the unit itself
  'LAW_037', 'LAW_055', 'LOF_092', 'SHD_096', 'LAW_147', 'SEC_089', 'SEC_035', 'SOR_191', 'LAW_034', 'TS26_77',
  'LAW_231', 'JTL_096',
]
/** Registered elsewhere; used here to play a unit for free, so "no resources were paid" can be reached. */
const GALACTIC_AMBITION = 'SOR_235'
/** Scoped by the triage but lifted out to the ticket that owns their blocker. */
const LIFTED = ['SHD_075', 'SHD_140']

const POOL = poolFor(['LAW', 'SEC', 'LOF', 'JTL', 'TWI', 'SHD', 'SOR', 'TS26', 'IBH'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 8, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries([...SHIPPED, GALACTIC_AMBITION].map(id => [id, real(id)])),
  GRD: src('GRD'),
  GRD2: src('GRD2'),
  SPC: src('SPC', { arena: 'space' }),
  CUN: src('CUN', { aspects: ['Cunning'] }),
  VIG: src('VIG', { aspects: ['Vigilance'] }),
  AGG: src('AGG', { aspects: ['Aggression'] }),
  CMD: src('CMD', { aspects: ['Command'] }),
  HER: src('HER', { aspects: ['Heroism'] }),
  VIL: src('VIL', { aspects: ['Villainy'] }),
  TWO_ASPECT: src('TWO_ASPECT', { aspects: ['Command', 'Heroism'] }),
  JEDI: src('JEDI', { traits: ['JEDI'] }),
  EV: card({ id: 'EV', type: 'event', cost: 1 }),
  FREE_EV: card({ id: 'FREE_EV', type: 'event', cost: 0 }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
/** How many Experience tokens the unit `id` carries. */
const exp = (s: GameState, id: string): number => (U(s, id)?.upgrades ?? []).filter(u => u.cardId === TOKEN_EXPERIENCE).length
const shields = (s: GameState, id: string): number => (U(s, id)?.upgrades ?? []).filter(u => u.cardId === TOKEN_SHIELD).length

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
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; deckIndex?: number; baseTarget?: PlayerId; cardName?: string }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const unitOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : [])))].sort()
const declinable = (s: GameState) => moves(s).some(m => m.type === 'skipTrigger')
const readyCount = (s: GameState, who: PlayerId) => s.players[who].resources.filter(r => !r.exhausted).length

/**
 * Play `cardId` from hand through the real play door, so the cost is paid and "When Played" fires
 * exactly as it does in a game. The played unit is the last one on the player's board.
 */
const play = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState => {
  const p = s.players[who]
  // A play passes the turn, so the active player is set here rather than assumed from the last action.
  const withCard = { ...s, activePlayer: who, players: { ...s.players, [who]: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playUnit', handIndex: p.hand.length })
}
/** The instance id of the unit `who` played last (the one `play` just put down). */
const last = (s: GameState, who: PlayerId = 'player'): string => s.players[who].units[s.players[who].units.length - 1].instanceId
/** Declare an attack with `attackerId`, on the enemy base or on `target`. */
const attack = (s: GameState, attackerId: string, target?: string) =>
  resolve(s, { type: 'attack', attackerId, target: target ? { kind: 'unit', instanceId: target } : { kind: 'base' } })

describe('Experience tokens: the scope', () => {
  it('registers an ability for every shipped card and none for the lifted ones', () => {
    for (const id of SHIPPED) expect(getCardDefinition(id), id).toBeDefined()
    for (const id of LIFTED) expect(getCardDefinition(id), id).toBeUndefined()
  })

  it('an Experience token is a +1/+1 upgrade that stacks', () => {
    const s = board({ units: [unit('a', 'GRD')] })
    const one = accept({ ...s, pendingChoices: [{ kind: 'mayGiveTokens', id: 'x', controller: 'player', token: TOKEN_EXPERIENCE, count: 2, targets: ['a'] }] }, { targetInstanceId: 'a' })
    expect(exp(one, 'a')).toBe(2)
  })
})

describe('Experience tokens, A: tokens on the unit itself', () => {
  it('Han Solo (LAW_037) gives an Experience token to himself on attack', () => {
    // He is a 1/1, so he attacks the base: the ability is about attacking, not about surviving.
    const done = attack(board({ units: [unit('han', 'LAW_037')] }), 'han')
    expect(exp(done, 'han')).toBe(1)
  })

  it('Chopper (LAW_055) gives himself one Experience token, or two with a Cunning or Vigilance unit', () => {
    const alone = play(board(), 'LAW_055')
    expect(exp(alone, last(alone))).toBe(1)
    for (const friend of ['CUN', 'VIG']) {
      const withFriend = play(board({ units: [unit('f', friend)] }), 'LAW_055')
      expect(exp(withFriend, last(withFriend)), friend).toBe(2)
    }
    const wrongAspect = play(board({ units: [unit('f', 'AGG')] }), 'LAW_055')
    expect(exp(wrongAspect, last(wrongAspect))).toBe(1)
  })

  it('Point Rain Reclaimer (LOF_092) may take an Experience token only while you control a Jedi unit', () => {
    const noJedi = play(board({ units: [unit('f', 'GRD')] }), 'LOF_092')
    noChoice(noJedi)
    expect(exp(noJedi, last(noJedi))).toBe(0)
    const withJedi = play(board({ units: [unit('j', 'JEDI')] }), 'LOF_092')
    const self = last(withJedi)
    expect(choice(withJedi)).toMatchObject({ kind: 'mayGiveTokens', optional: true, targets: [self] })
    expect(exp(accept(withJedi, { targetInstanceId: self }), self)).toBe(1)
    expect(exp(skip(withJedi), self)).toBe(0)
  })

  it('Maz Kanata (SHD_096) gives herself an Experience token each time another friendly unit is played', () => {
    const s = board({ units: [unit('maz', 'SHD_096')] })
    const one = play(s, 'GRD')
    expect(exp(one, 'maz')).toBe(1)
    expect(exp(play(one, 'GRD2'), 'maz')).toBe(2)
    // An enemy play is not "you play another unit".
    expect(exp(play(s, 'GRD', 'opponent'), 'maz')).toBe(0)
  })

  it('Jaunty Light Freighter (LAW_147) takes an Experience token per different aspect among units you control', () => {
    // Its own printed aspects count: it is a unit you control by the time the ability resolves.
    const own = play(board(), 'LAW_147')
    const ownAspects = new Set(F['LAW_147'].aspects)
    expect(exp(own, last(own))).toBe(ownAspects.size)
    const wide = play(board({ units: [unit('a', 'TWO_ASPECT'), unit('b', 'VIL'), unit('c', 'CMD')] }), 'LAW_147')
    const aspects = new Set([...F['LAW_147'].aspects, 'Command', 'Heroism', 'Villainy'])
    expect(exp(wide, last(wide))).toBe(aspects.size)
  })

  it('PreMor Personnel Carrier (SEC_089) takes an Experience token per friendly ground unit', () => {
    const s = play(board({ units: [unit('g', 'GRD'), unit('g2', 'GRD2'), unit('s', 'SPC')] }, { units: [unit('e', 'GRD')] }), 'SEC_089')
    // Two friendly ground units. The Carrier itself is a space unit, and neither the friendly space
    // unit nor the enemy ground unit is one you control in the ground arena.
    expect(exp(s, last(s))).toBe(2)
    expect(exp(play(board(), 'SEC_089'), last(play(board(), 'SEC_089')))).toBe(0)
  })

  it('Darth Sion (SEC_035) takes an Experience token per enemy unit defeated this phase, and returns to hand at 7 power', () => {
    const none = play(board(), 'SEC_035')
    expect(exp(none, last(none))).toBe(0)
    const two = play(board({}, {}, { phaseEvents: phaseEvents({ defeated: { player: ['GRD'], opponent: ['GRD', 'GRD2'] } }) }), 'SEC_035')
    expect(exp(two, last(two))).toBe(2)
  })

  it('Vanguard Ace (SOR_191) takes an Experience token per other card you played this phase', () => {
    const first = play(board(), 'SOR_191')
    expect(exp(first, last(first))).toBe(0)
    const third = play(board({}, {}, { phaseEvents: phaseEvents({ played: { player: ['EV', 'GRD'], opponent: ['GRD2'] } }) }), 'SOR_191')
    expect(exp(third, last(third))).toBe(2)
  })

  it('Chewbacca (LAW_034) takes an Experience token and heals 3 when his attack defeats the defender', () => {
    // A 4/4 with Overwhelm. The defender starts on 7 of its 8 HP, so his 4 power defeats it and the
    // 2 it deals back leaves him on 3 before the heal.
    const killed = attack(board({ units: [unit('chew', 'LAW_034', { damage: 1 })] }, { units: [unit('e', 'GRD', { damage: 7 })] }), 'chew', 'e')
    expect(U(killed, 'e')).toBeUndefined()
    expect(exp(killed, 'chew')).toBe(1)
    expect(U(killed, 'chew')!.damage).toBe(0)
    // The defender surviving grants nothing.
    const survived = attack(board({ units: [unit('chew', 'LAW_034', { damage: 1 })] }, { units: [unit('e', 'GRD')] }), 'chew', 'e')
    expect(exp(survived, 'chew')).toBe(0)
    expect(U(survived, 'chew')!.damage).toBe(3)
  })

  it('Deployed Droideka (TS26_77) may pay 2 for an Experience token and a Shield token', () => {
    // No enemy on the board, so Ambush raises nothing and the pay choice is the only one.
    const s = play(board(), 'TS26_77')
    const self = last(s)
    const paid = accept(s)
    expect(exp(paid, self)).toBe(1)
    expect(shields(paid, self)).toBe(1)
    expect(readyCount(paid, 'player')).toBe(readyCount(s, 'player') - 2)
    const declined = skip(s)
    expect(exp(declined, self)).toBe(0)
    expect(shields(declined, self)).toBe(0)
  })

  it('Weequay Pirate (LAW_231) takes an Experience token only when no resources were paid for it', () => {
    const paid = play(board(), 'LAW_231')
    expect(exp(paid, last(paid))).toBe(0)
    expect(readyCount(paid, 'player')).toBeLessThan(10)
    // Galactic Ambition plays a non-Heroism unit for free: nothing is exhausted for the Pirate itself.
    const s = board({ hand: ['LAW_231'] })
    const event = resolve({ ...s, players: { ...s.players, player: { ...s.players.player, hand: [...s.players.player.hand, GALACTIC_AMBITION] } } }, { type: 'playEvent', handIndex: 1 })
    expect(choice(event)).toMatchObject({ kind: 'playUnitFromHand' })
    const free = accept(event, { handIndex: 0 })
    expect(exp(free, last(free))).toBe(1)
  })

  it('Blue Leader (JTL_096) may pay 2 to move to the ground arena with 2 Experience tokens', () => {
    const s = play(board(), 'JTL_096')
    const self = last(s)
    expect(U(s, self)!.arena).toBe('space')
    // Ambush offers its attack first (no enemy here, so only the pay choice is raised).
    const moved = accept(s)
    expect(U(moved, self)!.arena).toBe('ground')
    expect(exp(moved, self)).toBe(2)
    const declined = skip(s)
    expect(U(declined, self)!.arena).toBe('space')
    expect(exp(declined, self)).toBe(0)
  })
})

/** Kept referenced while groups land one at a time. */
void unitOffers
void declinable
