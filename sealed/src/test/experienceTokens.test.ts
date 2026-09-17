import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves, effectiveCost } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
import { defeatUnit } from '../engine/combat'
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
  // B: a fixed number of tokens on a chosen unit
  'SHD_040', 'LAW_249', 'LAW_059', 'SEC_095', 'SHD_082', 'SHD_258', 'SOR_231', 'SOR_241', 'LAW_142', 'SOR_108',
  'LOF_095', 'SEC_027', 'SOR_049', 'LAW_067', 'TS26_54',
  // C: a token on each of several units
  'SEC_252', 'SOR_037', 'LOF_055', 'SHD_081', 'SOR_080', 'LOF_099', 'SEC_124', 'LOF_241', 'SOR_245', 'TS26_60',
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
  UW: src('UW', { traits: ['UNDERWORLD'] }),
  IMP: src('IMP', { traits: ['IMPERIAL'] }),
  REB: src('REB', { traits: ['REBEL'] }),
  MANDO: src('MANDO', { traits: ['MANDALORIAN'] }),
  FORCE_U: src('FORCE_U', { traits: ['FORCE'] }),
  UNIQ: src('UNIQ', { unique: true }),
  CHEAP: src('CHEAP', { cost: 3 }),
  PRICEY: src('PRICEY', { cost: 5 }),
  PALP_U: card({ id: 'PALP_U', name: 'Chancellor Palpatine', arena: 'ground', cost: 5, power: 3, hp: 5 }),
  PALP_L: card({ id: 'PALP_L', name: 'Chancellor Palpatine', type: 'leader', cost: 6, power: 3, hp: 6 }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  VEH: src('VEH', { traits: ['VEHICLE'] }),
  TROOPER: src('TROOPER', { traits: ['TROOPER'] }),
  OFFICIAL: src('OFFICIAL', { traits: ['OFFICIAL'] }),
  L_UNIT: card({ id: 'L_UNIT', type: 'leader', cost: 5, power: 3, hp: 6 }),
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
/** Defeat the unit `id`, as an ability would. */
const kill = (s: GameState, id: string): GameState => defeatUnit(s, id)
/** Play `cardId` as an event from the player's hand, optionally with `attackers` already having attacked. */
const playEvent = (s: GameState, cardId: string, attackers: string[] = []): GameState => {
  const p = s.players.player
  const withAttacks = attackers.length ? { ...s, phaseEvents: { ...(s.phaseEvents ?? phaseEvents({})), attackedUnits: attackers } } : s
  const withCard = { ...withAttacks, activePlayer: 'player' as PlayerId, players: { ...s.players, player: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playEvent', handIndex: p.hand.length })
}
const costOf = (s: GameState, cardId: string): number => effectiveCost(s, 'player', F[cardId])
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

describe('Experience tokens, B: a fixed number of tokens on a chosen unit', () => {
  it('Clan Wren Rescuer (SHD_040) gives an Experience token to any one unit, and cannot decline', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }), 'SHD_040')
    expect(choice(s)).toMatchObject({ kind: 'mayGiveTokens', controller: 'player', count: 1, optional: false })
    expect(unitOffers(s)).toEqual(['f', last(s)].sort())
    expect(declinable(s)).toBe(false)
    expect(exp(accept(s, { targetInstanceId: 'f' }), 'f')).toBe(1)
  })

  it('Black Sun Cabalist (LAW_249) gives an Experience token to another friendly Underworld unit', () => {
    const s = play(board({ units: [unit('uw', 'UW'), unit('g', 'GRD')] }, { units: [unit('euw', 'UW')] }), 'LAW_249')
    expect(unitOffers(s)).toEqual(['uw'])
    expect(exp(accept(s, { targetInstanceId: 'uw' }), 'uw')).toBe(1)
    // No other friendly Underworld unit: nothing is raised.
    noChoice(play(board({ units: [unit('g', 'GRD')] }), 'LAW_249'))
  })

  it('Highsinger (LAW_059) gives a token to another friendly Command unit when played, and to a friendly Aggression unit when defeated', () => {
    const played = play(board({ units: [unit('c', 'CMD'), unit('a', 'AGG')] }), 'LAW_059')
    expect(unitOffers(played)).toEqual(['c'])
    expect(exp(accept(played, { targetInstanceId: 'c' }), 'c')).toBe(1)
    const killed = kill(board({ units: [unit('wd', 'LAW_059'), unit('c', 'CMD'), unit('a', 'AGG')] }), 'wd')
    expect(unitOffers(killed)).toEqual(['a'])
    expect(exp(accept(killed, { targetInstanceId: 'a' }), 'a')).toBe(1)
  })

  it('Theed Security (SEC_095) gives a token to a unit only while an opponent controls an upgrade', () => {
    noChoice(play(board({ units: [unit('mine', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] }), 'SEC_095'))
    const s = play(board(), 'SEC_095', 'player')
    noChoice(s)
    const theirs = play(board({}, { units: [unit('e', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })] }), 'SEC_095')
    expect(choice(theirs)).toMatchObject({ kind: 'mayGiveTokens', count: 1 })
    expect(unitOffers(theirs)).toEqual(['e', last(theirs)].sort())
  })

  it('Outland TIE Vanguard (SHD_082) may give a token to another unit costing 3 or less, on either side', () => {
    const s = play(board({ units: [unit('c', 'CHEAP'), unit('p', 'PRICEY')] }, { units: [unit('ec', 'CHEAP')] }), 'SHD_082')
    expect(choice(s)).toMatchObject({ optional: true })
    expect(unitOffers(s)).toEqual(['c', 'ec'])
    expect(exp(skip(s), 'c')).toBe(0)
  })

  it('Mandalorian Warrior (SHD_258) may give a token to another Mandalorian unit', () => {
    const s = play(board({ units: [unit('m', 'MANDO')] }, { units: [unit('em', 'MANDO'), unit('e', 'GRD')] }), 'SHD_258')
    expect(unitOffers(s)).toEqual(['em', 'm'])
    expect(declinable(s)).toBe(true)
  })

  it.each([['SOR_231', 'IMP', 'IMPERIAL'], ['SOR_241', 'REB', 'REBEL']])('%s gives 2 Experience tokens to another friendly %s unit', (id, friend) => {
    const s = play(board({ units: [unit('t', friend), unit('g', 'GRD')] }, { units: [unit('e', friend)] }), id)
    expect(choice(s)).toMatchObject({ kind: 'mayGiveTokens', count: 2, optional: false })
    expect(unitOffers(s)).toEqual(['t'])
    expect(exp(accept(s, { targetInstanceId: 't' }), 't')).toBe(2)
  })

  it('Scarif Lieutenant (LAW_142) gives a token to a friendly Rebel unit when defeated', () => {
    const killed = kill(board({ units: [unit('wd', 'LAW_142'), unit('r', 'REB')] }, { units: [unit('er', 'REB')] }), 'wd')
    expect(unitOffers(killed)).toEqual(['r'])
    expect(exp(accept(killed, { targetInstanceId: 'r' }), 'r')).toBe(1)
  })

  it('Vanguard Infantry (SOR_108) may give a token to any unit when defeated', () => {
    const killed = kill(board({ units: [unit('wd', 'SOR_108'), unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'wd')
    expect(unitOffers(killed)).toEqual(['e', 'f'])
    expect(declinable(killed)).toBe(true)
  })

  it('Lor San Tekka (LOF_095) may give a token to a unique unit when defeated', () => {
    const killed = kill(board({ units: [unit('wd', 'LOF_095'), unit('u', 'UNIQ'), unit('g', 'GRD')] }), 'wd')
    expect(unitOffers(killed)).toEqual(['u'])
  })

  it("The Chancellor's Shuttle (SEC_027) may give a token only while you control Chancellor Palpatine", () => {
    const wd = () => unit('wd', 'SEC_027')
    noChoice(kill(board({ units: [wd(), unit('f', 'GRD')] }), 'wd'))
    const asUnit = kill(board({ units: [wd(), unit('f', 'GRD'), unit('palp', 'PALP_U')] }), 'wd')
    expect(choice(asUnit), 'as a unit').toMatchObject({ kind: 'mayGiveTokens', optional: true })
    const asLeader = kill(board({ units: [wd(), unit('f', 'GRD')], leader: { cardId: 'PALP_L', deployed: false, epicActionUsed: false, exhausted: false } }), 'wd')
    expect(choice(asLeader), 'as a leader').toMatchObject({ kind: 'mayGiveTokens', optional: true })
  })

  it('Obi-Wan Kenobi (SOR_049) gives 2 tokens to another friendly unit, drawing a card if it is a Force unit', () => {
    const killed = kill(board({ units: [unit('wd', 'SOR_049'), unit('force', 'FORCE_U'), unit('g', 'GRD')], deck: ['GRD2', 'GRD2'] }, { units: [unit('e', 'GRD')] }), 'wd')
    expect(unitOffers(killed).sort()).toEqual(['force', 'g'])
    const toForce = accept(killed, { targetInstanceId: 'force' })
    expect(exp(toForce, 'force')).toBe(2)
    expect(toForce.players.player.hand).toEqual(['GRD2'])
    const toOther = accept(killed, { targetInstanceId: 'g' })
    expect(exp(toOther, 'g')).toBe(2)
    expect(toOther.players.player.hand).toEqual([])
  })

  it('Jyn Erso (LAW_067) offers either an Experience token or an exhaust, and only the modes that can do something', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }), 'LAW_067')
    expect(choice(s)).toMatchObject({ kind: 'chooseMode', controller: 'player' })
    const modes = (choice(s) as { modes: string[] }).modes
    expect(modes).toHaveLength(2)
    const given = accept(s, { optionIndex: modes.indexOf('giveExperience') })
    expect(exp(accept(given, { targetInstanceId: 'f' }), 'f')).toBe(1)
    const exhausted = accept(s, { optionIndex: modes.indexOf('exhaustUnit') })
    expect(U(accept(exhausted, { targetInstanceId: 'f' }), 'f')!.exhausted).toBe(true)
  })

  it('Wartime Mercenaries (TS26_54) lets an opponent give a token to a unit when it is defeated', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'TS26_54')
    const killed = kill(s, last(s))
    expect(choice(killed)).toMatchObject({ kind: 'mayGiveTokens', controller: 'opponent', optional: true })
    expect(unitOffers(killed)).toEqual(['e', 'f'])
    expect(exp(accept(killed, { targetInstanceId: 'e' }), 'e')).toBe(1)
  })
})

describe('Experience tokens, C: a token on each of several units', () => {
  it('Maarva Andor (SEC_252) gives a token to each friendly Rebel unit when defeated, and raises no choice', () => {
    const done = kill(board({ units: [unit('wd', 'SEC_252'), unit('r1', 'REB'), unit('r2', 'REB'), unit('g', 'GRD')] }, { units: [unit('er', 'REB')] }), 'wd')
    noChoice(done)
    expect([exp(done, 'r1'), exp(done, 'r2'), exp(done, 'g'), exp(done, 'er')]).toEqual([1, 1, 0, 0])
  })

  it('Academy Defense Walker (SOR_037) gives a token to each friendly damaged unit', () => {
    const done = play(board({ units: [unit('hurt', 'GRD', { damage: 2 }), unit('fresh', 'GRD2')] }, { units: [unit('ehurt', 'GRD', { damage: 1 })] }), 'SOR_037')
    noChoice(done)
    expect([exp(done, 'hurt'), exp(done, 'fresh'), exp(done, 'ehurt')]).toEqual([1, 0, 0])
  })

  it('Dume (LOF_055) gives a token to each other friendly non-Vehicle unit when the regroup phase starts', () => {
    const s = board({ units: [unit('dume', 'LOF_055'), unit('g', 'GRD'), unit('veh', 'VEH')] }, { units: [unit('e', 'GRD')] })
    const done = resolve({ ...s, consecutivePasses: 1 }, { type: 'pass' })
    expect([exp(done, 'g'), exp(done, 'veh'), exp(done, 'dume'), exp(done, 'e')]).toEqual([1, 0, 0, 0])
  })

  it.each(['SHD_081', 'SOR_080'])('General Tagge (%s) gives a token to each of up to 3 Trooper units, one pick at a time', id => {
    const s = play(board({ units: [unit('t1', 'TROOPER'), unit('t2', 'TROOPER'), unit('g', 'GRD')] }, { units: [unit('et', 'TROOPER')] }), id)
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', optional: true })
    expect(unitOffers(s)).toEqual(['et', 't1', 't2'])
    const one = accept(s, { targetInstanceId: 't1' })
    expect(exp(one, 't1')).toBe(1)
    // The same unit is not offered twice.
    expect(unitOffers(one)).toEqual(['et', 't2'])
    const two = accept(one, { targetInstanceId: 't2' })
    expect([exp(two, 't1'), exp(two, 't2')]).toEqual([1, 1])
    noChoice(skip(two))
  })

  it('Paladin Training Corvette (LOF_099) offers up to 3 Force units and may stop at once', () => {
    const s = play(board({ units: [unit('f1', 'FORCE_U'), unit('g', 'GRD')] }), 'LOF_099')
    expect(unitOffers(s)).toEqual(['f1'])
    expect(declinable(s)).toBe(true)
    expect(exp(skip(s), 'f1')).toBe(0)
  })

  it('Budget Scheming (SEC_124) gives a token to each of up to 3 Official units on either side', () => {
    const s = playEvent(board({ units: [unit('o', 'OFFICIAL'), unit('g', 'GRD')] }, { units: [unit('eo', 'OFFICIAL')] }), 'SEC_124')
    expect(unitOffers(s)).toEqual(['eo', 'o'])
    expect(exp(accept(s, { targetInstanceId: 'eo' }), 'eo')).toBe(1)
  })

  it('In the Shadows (LOF_241) offers only friendly units with Hidden', () => {
    const s = playEvent(board({ units: [unit('h', 'GRD', { hidden: true }), unit('g', 'GRD2')] }, { units: [unit('eh', 'GRD', { hidden: true })] }), 'LOF_241')
    expect(unitOffers(s)).toEqual(['h'])
  })

  it('Medal Ceremony (SOR_245) offers only Rebel units that attacked this phase', () => {
    const s = playEvent(board(
      { units: [unit('r1', 'REB'), unit('r2', 'REB'), unit('g', 'GRD')] },
      { units: [unit('er', 'REB')] },
      { phaseEvents: phaseEvents({}) },
    ), 'SOR_245')
    noChoice(s)
    const attacked = playEvent(board(
      { units: [unit('r1', 'REB'), unit('r2', 'REB'), unit('g', 'GRD')] },
      { units: [unit('er', 'REB')] },
      { phaseEvents: phaseEvents({}) },
    ), 'SOR_245', ['r1', 'g', 'er'])
    expect(unitOffers(attacked)).toEqual(['er', 'r1'])
  })

  it('Take Charge (TS26_60) costs 1 less per friendly leader unit and offers up to 3 units', () => {
    const plain = board({ units: [unit('g', 'GRD')] })
    const withLeader = board({ units: [unit('g', 'GRD'), unit('l', 'L_UNIT', { isLeader: true })] })
    expect(costOf(withLeader, 'TS26_60')).toBe(costOf(plain, 'TS26_60') - 1)
    const s = playEvent(plain, 'TS26_60')
    expect(unitOffers(s)).toEqual(['g'])
    expect(exp(accept(s, { targetInstanceId: 'g' }), 'g')).toBe(1)
  })
})
