import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword, unitKeywordValue } from '../engine/keywords'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { IMPLEMENTED_LEADERS } from '../data/implementedCards'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import { createTokenUnit } from '../engine/effects'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, LeaderState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'

/**
 * Leaders from the other sealed sets, both sides of each, in groups taken whole.
 *
 * The front is used the way the game uses it, through `useLeaderAbility` on an undeployed leader, and the
 * back through the deployed leader unit (an attack for an On Attack, the stat readers for a constant).
 * Each test states what may be chosen as well as what happens, since a filter that lets everything through
 * would still pass a test that only picks the right target.
 *
 * Printed stats, traits and keywords come from the shipped set fixtures, post-correction.
 */

const SHIPPED = [
  // A: simple fronts, On Attack and constant backs
  'SOR_014', 'IBH_53', 'IBH_1', 'SOR_010', 'SOR_005', 'JTL_007', 'JTL_004', 'TWI_015', 'TWI_006', 'TWI_003', 'SEC_015',
  'SOR_011', 'SHD_003', 'SHD_012', 'JTL_010', 'LOF_011', 'LAW_005', 'SOR_002', 'SHD_011', 'LAW_012', 'LOF_004', 'TWI_010',
  // B: attacks, and units entering play
  'TWI_012', 'TWI_014', 'TWI_009', 'SHD_007', 'SOR_012', 'SOR_018', 'SOR_009', 'TS26_7', 'TS26_4', 'LAW_001', 'TS26_2',
]
/** Scoped by the triage but lifted out to the ticket that owns their blocker. */
const LIFTED = [
  'JTL_001', 'JTL_003', 'JTL_011', 'JTL_012', 'JTL_015', 'JTL_017', 'JTL_018', 'LAW_010', 'SOR_008', 'SEC_011', 'TWI_017',
  'SEC_003', 'LOF_001', 'SHD_006', 'SHD_010', 'SEC_001', 'SEC_006', 'LAW_003',
]

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
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  GRD: src('GRD'),
  GRD2: src('GRD2'),
  SPC: src('SPC', { arena: 'space' }),
  WEAK: src('WEAK', { power: 3 }),
  STRONG: src('STRONG', { power: 4 }),
  REB: src('REB', { traits: ['REBEL'] }),
  RES: src('RES', { traits: ['RESISTANCE'] }),
  RES_UPG: card({ id: 'RES_UPG', type: 'upgrade', cost: 1, power: 0, hp: 0, traits: ['RESISTANCE'] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  VEH: src('VEH', { traits: ['VEHICLE'] }),
  DROID: src('DROID', { traits: ['DROID'] }),
  JEDI: src('JEDI', { traits: ['JEDI'] }),
  MANDO: src('MANDO', { traits: ['MANDALORIAN'] }),
  CREATURE: src('CREATURE', { traits: ['CREATURE'] }),
  SPECTRE: src('SPECTRE', { traits: ['SPECTRE'] }),
  HERO: src('HERO', { aspects: ['Heroism'] }),
  VIL_EV: card({ id: 'VIL_EV', type: 'event', cost: 1, aspects: ['Villainy'] }),
  FO_EV: card({ id: 'FO_EV', type: 'event', cost: 1, traits: ['FIRST ORDER'] }),
  EV: card({ id: 'EV', type: 'event', cost: 1 }),
  CHEAP: src('CHEAP', { cost: 3 }),
  PRICEY: src('PRICEY', { cost: 4 }),
  TOUGH: src('TOUGH', { power: 1, hp: 20 }),
  SMALL: src('SMALL', { power: 1, hp: 1 }),
  REB2: src('REB2', { traits: ['REBEL'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
type Side = Parameters<typeof player>[0]
const undeployed = (cardId: string): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })
const deployed = (cardId: string): LeaderState => ({ cardId, deployed: true, epicActionUsed: true, exhausted: false })
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(10), deck: [], ...mine }),
      opponent: player({ resources: ready(10), deck: [], ...theirs }),
    },
    ...over,
  })
/** An undeployed leader `id` on the player's side. */
const front = (id: string, mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  board({ leader: undeployed(id), ...mine }, theirs, over)
/** The deployed leader unit `L` of `id`, plus the player's other units. */
const back = (id: string, mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  board({ leader: deployed(id), ...mine, units: [unit('L', id, { isLeader: true }), ...(mine.units ?? [])] }, theirs, over)
const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, played: { player: [], opponent: [] },
  leaderLeftPlay: [],
  ...over,
})

const moves = (s: GameState): Action[] => legalMoves(s)
/** Whether the undeployed leader's action is on offer. */
const usable = (s: GameState) => moves(s).some(m => m.type === 'useLeaderAbility')
const use = (s: GameState) => {
  expect(usable(s), 'the leader action is offered').toBe(true)
  return resolve(s, { type: 'useLeaderAbility', index: 0 })
}
/** Declare an attack with `attackerId`, on the enemy base or on `target`. */
const attack = (s: GameState, attackerId: string, target?: string) =>
  resolve(s, { type: 'attack', attackerId, target: target ? { kind: 'unit', instanceId: target } : { kind: 'base' } })
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; deckIndex?: number; baseTarget?: PlayerId }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const declinable = (s: GameState) => moves(s).some(m => m.type === 'skipTrigger')
const unitOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : [])))].sort()
const baseOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.baseTarget ? [m.baseTarget] : [])))].sort()
const amountOf = (c: PendingChoice) => ('amount' in c ? c.amount : undefined)
const buffOf = (c: PendingChoice) => (c.kind === 'mayLastingBuff' ? { power: c.power ?? 0, hp: c.hp ?? 0, keywords: c.keywords ?? [] } : undefined)
const baseDamage = (s: GameState, who: PlayerId) => s.players[who].base.damage
const readyCount = (s: GameState, who: PlayerId) => s.players[who].resources.filter(r => !r.exhausted).length
const shields = (s: GameState, id: string) => U(s, id)!.upgrades.filter(u => u.cardId === TOKEN_SHIELD).length

describe('leader coverage', () => {
  it('registers both sides of every shipped leader, and lists each as built on both', () => {
    for (const id of SHIPPED) {
      const def = getCardDefinition(id)
      expect(def?.leaderAbilities, `${id} front`).toBeTruthy()
      expect(IMPLEMENTED_LEADERS.find(l => l.id === id), id).toMatchObject({ front: true, back: true })
    }
  })
  it('leaves the lifted leaders unregistered', () => {
    for (const id of LIFTED) expect(getCardDefinition(id), id).toBeUndefined()
  })
})

// ── A: simple fronts, On Attack and constant backs ────────────────────────────────────────────────

describe('leaders A: damage and bases', () => {
  it('Sabine Wren (SOR_014) deals 1 to each base from the front, and 1 to each enemy base as she attacks', () => {
    const used = use(front('SOR_014'))
    expect([baseDamage(used, 'player'), baseDamage(used, 'opponent')]).toEqual([1, 1])
    expect(used.players.player.leader.exhausted).toBe(true)
    expect(used.activePlayer).toBe('opponent')
    const a = attack(back('SOR_014'), 'L')
    expect(baseDamage(a, 'player')).toBe(0)
    expect(baseDamage(a, 'opponent')).toBe(1 + (F.SOR_014.power ?? 0))
  })

  it('Darth Vader (IBH_53) pays 1 to deal 1 to a base, and deals 2 to a base as he attacks', () => {
    const used = use(front('IBH_53', { units: [unit('g', 'GRD')] }))
    expect(readyCount(used, 'player')).toBe(9)
    expect(amountOf(choice(used))).toBe(1)
    expect(baseOffers(used)).toEqual(['opponent', 'player'])
    expect(unitOffers(used)).toEqual([])
    expect(baseDamage(accept(used, { baseTarget: 'opponent' }), 'opponent')).toBe(1)
    const a = attack(back('IBH_53', {}, { units: [unit('e', 'GRD')] }), 'L', 'e')
    expect(amountOf(choice(a))).toBe(2)
    expect(baseOffers(a)).toEqual(['opponent', 'player'])
    expect(declinable(a)).toBe(false)
  })

  it('Darth Vader (SOR_010) needs a Villainy card played this phase, then deals 1 to a unit and 1 to a base; may deal 2 as he attacks', () => {
    expect(usable(front('SOR_010', { units: [unit('g', 'GRD')] }))).toBe(false)
    const s = front('SOR_010', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }, { phaseEvents: phaseEvents({ played: { player: ['VIL_EV'], opponent: [] } }) })
    const used = use(s)
    expect(amountOf(choice(used))).toBe(1)
    expect(unitOffers(used)).toEqual(['e', 'g'])
    const hit = accept(used, { targetInstanceId: 'e' })
    expect(U(hit, 'e')!.damage).toBe(1)
    expect(baseOffers(hit)).toEqual(['opponent', 'player'])
    expect(baseDamage(accept(hit, { baseTarget: 'opponent' }), 'opponent')).toBe(1)
    const a = attack(back('SOR_010', {}, { units: [unit('e', 'GRD')] }), 'L')
    expect(amountOf(choice(a))).toBe(2)
    expect(unitOffers(a)).toEqual(['L', 'e'])
    expect(declinable(a)).toBe(true)
  })

  it('Captain Phasma (JTL_010) needs a First Order card played this phase for either side', () => {
    const played = { phaseEvents: phaseEvents({ played: { player: ['FO_EV'], opponent: [] } }) }
    expect(usable(front('JTL_010'))).toBe(false)
    const used = use(front('JTL_010', {}, {}, played))
    expect(amountOf(choice(used))).toBe(1)
    expect(baseOffers(used)).toEqual(['opponent', 'player'])
    noChoice(attack(back('JTL_010', {}, { units: [unit('e', 'GRD')] }), 'L', 'e'))
    const a = attack(back('JTL_010', {}, { units: [unit('e', 'GRD')] }, played), 'L', 'e')
    expect(choice(a).kind).toBe('selectUnitThen')
    expect(unitOffers(a)).toEqual(['L', 'e'])
    expect(declinable(a)).toBe(true)
    noChoice(skip(a))
    const hit = accept(a, { targetInstanceId: 'e' })
    expect(U(hit, 'e')!.damage).toBe(1)
    expect(baseOffers(hit)).toEqual(['opponent', 'player'])
    expect(declinable(hit)).toBe(false)
  })

  it('Bo-Katan Kryze (SHD_012) needs a Mandalorian attack this phase for the front; the back may deal 1, and 1 more after another Mandalorian attacked', () => {
    expect(usable(front('SHD_012', { units: [unit('m', 'MANDO')] }))).toBe(false)
    const attacked = { phaseEvents: phaseEvents({ attackedUnits: ['m'] }) }
    const used = use(front('SHD_012', { units: [unit('m', 'MANDO')] }, {}, attacked))
    expect(amountOf(choice(used))).toBe(1)
    const once = attack(back('SHD_012', {}, { units: [unit('e', 'GRD')] }), 'L', 'e')
    expect(choice(once).kind).toBe('selectUnitThen')
    expect(declinable(once)).toBe(true)
    noChoice(accept(once, { targetInstanceId: 'e' }))
    const twice = attack(back('SHD_012', { units: [unit('m', 'MANDO')] }, { units: [unit('e', 'GRD')] }, attacked), 'L', 'e')
    const first = accept(twice, { targetInstanceId: 'e' })
    expect(U(first, 'e')!.damage).toBe(1)
    expect(choice(first).kind).toBe('selectUnitThen')
    expect(declinable(first)).toBe(true)
    expect(U(accept(first, { targetInstanceId: 'e' }), 'e')!.damage).toBeGreaterThanOrEqual(2)
    // Declining the first still offers the second.
    expect(choice(skip(twice)).kind).toBe('selectUnitThen')
  })

  it('Kit Fisto (LOF_011) needs a Jedi attack this phase to deal 2; deployed he gets +1/+0 for each other friendly Jedi', () => {
    expect(usable(front('LOF_011', { units: [unit('j', 'JEDI')] }))).toBe(false)
    const used = use(front('LOF_011', { units: [unit('j', 'JEDI')] }, {}, { phaseEvents: phaseEvents({ attackedUnits: ['j'] }) }))
    expect(readyCount(used, 'player')).toBe(9)
    expect(amountOf(choice(used))).toBe(2)
    const s = back('LOF_011', { units: [unit('j', 'JEDI'), unit('j2', 'JEDI'), unit('g', 'GRD')] })
    expect(effectivePower(s, U(s, 'L')!)).toBe((F.LOF_011.power ?? 0) + 2)
    expect(unitHasKeyword(s, U(s, 'L')!, 'Saboteur')).toBe(true)
  })

  it('Pre Vizsla (TWI_010) deals damage equal to cards drawn this phase; deployed he gains Saboteur with 3 cards in hand and +2/+0 with 6', () => {
    expect(usable(front('TWI_010', { units: [unit('g', 'GRD')] }))).toBe(false)
    const used = use(front('TWI_010', { units: [unit('g', 'GRD')] }, {}, { phaseEvents: phaseEvents({ cardsDrawn: { player: 3 } }) }))
    expect(amountOf(choice(used))).toBe(3)
    const hand = (n: number) => Array.from({ length: n }, () => 'EV')
    const two = back('TWI_010', { hand: hand(2) })
    expect(unitHasKeyword(two, U(two, 'L')!, 'Saboteur')).toBe(false)
    expect(effectivePower(two, U(two, 'L')!)).toBe(F.TWI_010.power)
    const three = back('TWI_010', { hand: hand(3) })
    expect(unitHasKeyword(three, U(three, 'L')!, 'Saboteur')).toBe(true)
    expect(effectivePower(three, U(three, 'L')!)).toBe(F.TWI_010.power)
    const six = back('TWI_010', { hand: hand(6) })
    expect(effectivePower(six, U(six, 'L')!)).toBe((F.TWI_010.power ?? 0) + 2)
  })
})

describe('leaders A: heal, shield, exhaust, ready', () => {
  it('Leia Organa (IBH_1) heals 1 from a damaged friendly unit; deployed she heals 1 from a friendly unit and 1 from another', () => {
    expect(usable(front('IBH_1', { units: [unit('g', 'GRD')] }))).toBe(false)
    const used = use(front('IBH_1', { units: [unit('g', 'GRD', { damage: 2 }), unit('g2', 'GRD')] }, { units: [unit('e', 'GRD', { damage: 1 })] }))
    expect(unitOffers(used)).toEqual(['g'])
    expect(U(accept(used, { targetInstanceId: 'g' }), 'g')!.damage).toBe(1)
    const a = attack(back('IBH_1', { units: [unit('g', 'GRD', { damage: 2 }), unit('g2', 'GRD', { damage: 1 })] }, { units: [unit('e', 'GRD', { damage: 1 })] }), 'L', 'e')
    expect(unitOffers(a)).toEqual(['g', 'g2'])
    const one = accept(a, { targetInstanceId: 'g' })
    expect(U(one, 'g')!.damage).toBe(1)
    expect(unitOffers(one)).toEqual(['g2'])
    expect(U(accept(one, { targetInstanceId: 'g2' }), 'g2')!.damage).toBe(0)
  })

  it('Obi-Wan Kenobi (TWI_003) heals 1 from a unit; deployed he heals 1 and, if he does, deals 1 to a different unit', () => {
    const used = use(front('TWI_003', { units: [unit('g', 'GRD', { damage: 1 })] }, { units: [unit('e', 'GRD')] }))
    expect(unitOffers(used)).toEqual(['g'])
    noChoice(attack(back('TWI_003', {}, { units: [unit('e', 'GRD')] }), 'L', 'e'))
    const a = attack(back('TWI_003', { units: [unit('g', 'GRD', { damage: 1 })] }, { units: [unit('e', 'GRD')] }), 'L', 'e')
    expect(unitOffers(a)).toEqual(['g'])
    const healed = accept(a, { targetInstanceId: 'g' })
    expect(U(healed, 'g')!.damage).toBe(0)
    expect(amountOf(choice(healed))).toBe(1)
    expect(unitOffers(healed)).toEqual(['L', 'e'])
  })

  it('Rose Tico (JTL_004) heals 2 from a Vehicle that attacked this phase; deployed she may heal 2 from a Vehicle', () => {
    const units = [unit('v', 'VEH', { damage: 3 }), unit('v2', 'VEH', { damage: 3 }), unit('g', 'GRD', { damage: 3 })]
    expect(usable(front('JTL_004', { units }))).toBe(false)
    const used = use(front('JTL_004', { units }, {}, { phaseEvents: phaseEvents({ attackedUnits: ['v', 'g'] }) }))
    expect(unitOffers(used)).toEqual(['v'])
    expect(U(accept(used, { targetInstanceId: 'v' }), 'v')!.damage).toBe(1)
    const a = attack(back('JTL_004', { units }, { units: [unit('e', 'GRD')] }), 'L', 'e')
    expect(unitOffers(a)).toEqual(['v', 'v2'])
    expect(declinable(a)).toBe(true)
  })

  it('Iden Versio (SOR_002) heals 1 from her base after an enemy unit was defeated this phase, and deployed whenever one is', () => {
    const hurt = { base: { cardId: 'TST_B', damage: 3 } }
    expect(usable(front('SOR_002', hurt))).toBe(false)
    const used = use(front('SOR_002', hurt, {}, { phaseEvents: phaseEvents({ defeated: { player: [], opponent: ['GRD'] } }) }))
    expect(baseDamage(used, 'player')).toBe(2)
    const s = back('SOR_002', hurt, { units: [unit('e', 'GRD', { damage: 7 })] })
    expect(baseDamage(attack(s, 'L', 'e'), 'player')).toBe(2)
    expect(unitHasKeyword(s, U(s, 'L')!, 'Shielded')).toBe(true)
  })

  it('Luke Skywalker (SOR_005) shields a Heroism unit played this phase; deployed he may shield another unit', () => {
    const units = [unit('h', 'HERO'), unit('h2', 'HERO'), unit('g', 'GRD')]
    expect(usable(front('SOR_005', { units }))).toBe(false)
    const used = use(front('SOR_005', { units }, {}, { phaseEvents: phaseEvents({ enteredPlay: { player: ['h', 'g'], opponent: [] } }) }))
    expect(readyCount(used, 'player')).toBe(9)
    expect(unitOffers(used)).toEqual(['h'])
    expect(shields(accept(used, { targetInstanceId: 'h' }), 'h')).toBe(1)
    const a = attack(back('SOR_005', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'L', 'e')
    expect(unitOffers(a)).toEqual(['e', 'g'])
    expect(declinable(a)).toBe(true)
  })

  it('Kanan Jarrus (LOF_004) shields a Creature or Spectre unit; deployed he gets +2/+2 while you control another', () => {
    const used = use(front('LOF_004', { units: [unit('c', 'CREATURE'), unit('g', 'GRD')] }, { units: [unit('sp', 'SPECTRE')] }))
    expect(unitOffers(used)).toEqual(['c', 'sp'])
    const alone = back('LOF_004')
    expect(effectivePower(alone, U(alone, 'L')!)).toBe(F.LOF_004.power)
    const withOne = back('LOF_004', { units: [unit('sp', 'SPECTRE')] })
    expect(effectivePower(withOne, U(withOne, 'L')!)).toBe((F.LOF_004.power ?? 0) + 2)
    expect(effectiveHp(withOne, U(withOne, 'L')!)).toBe((F.LOF_004.hp ?? 0) + 2)
  })

  it('C-3PO (SEC_015) exhausts a unit while you control an exhausted one; deployed, while you control another exhausted unit, he may', () => {
    expect(usable(front('SEC_015', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }))).toBe(false)
    const used = use(front('SEC_015', { units: [unit('g', 'GRD', { exhausted: true })] }, { units: [unit('e', 'GRD')] }))
    expect(unitOffers(used)).toEqual(['e'])
    expect(declinable(used)).toBe(false)
    expect(U(accept(used, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
    noChoice(attack(back('SEC_015', {}, { units: [unit('e', 'GRD')] }), 'L', 'e'))
    const a = attack(back('SEC_015', { units: [unit('x', 'GRD', { exhausted: true })] }, { units: [unit('e', 'GRD'), unit('e2', 'GRD')] }), 'L', 'e')
    expect(unitOffers(a)).toEqual(['e', 'e2'])
    expect(declinable(a)).toBe(true)
  })

  it('Grand Inquisitor (SOR_011) deals 2 to a friendly unit with 3 or less power and readies it; deployed he may deal 1 to another', () => {
    const units = [unit('w', 'WEAK', { exhausted: true }), unit('s', 'STRONG', { exhausted: true })]
    const used = use(front('SOR_011', { units }, { units: [unit('e', 'WEAK')] }))
    expect(amountOf(choice(used))).toBe(2)
    expect(unitOffers(used)).toEqual(['w'])
    const done = accept(used, { targetInstanceId: 'w' })
    expect(U(done, 'w')).toMatchObject({ damage: 2, exhausted: false })
    const a = attack(back('SOR_011', { units }, { units: [unit('e', 'GRD')] }), 'L', 'e')
    expect(amountOf(choice(a))).toBe(1)
    expect(unitOffers(a)).toEqual(['w'])
    expect(declinable(a)).toBe(true)
  })

  it('Finn (SHD_003) defeats a friendly upgrade and shields its unit; deployed he may', () => {
    expect(usable(front('SHD_003', { units: [unit('g', 'GRD')] }))).toBe(false)
    const units = [unit('g', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })]
    const theirs = { units: [unit('e', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })] }
    const used = use(front('SHD_003', { units }, theirs))
    expect(choice(used)).toMatchObject({ kind: 'selectUpgradeThen', candidates: [{ unitId: 'g', upgradeIndex: 0, cardId: 'UPG' }] })
    const done = accept(used, { optionIndex: 0 })
    expect(U(done, 'g')!.upgrades.map(u => u.cardId)).toEqual([TOKEN_SHIELD])
    const a = attack(back('SHD_003', { units }, theirs), 'L', 'e')
    expect(choice(a).kind).toBe('selectUpgradeThen')
    expect(declinable(a)).toBe(true)
  })
})

describe('leaders A: buffs', () => {
  it('Admiral Holdo (JTL_007) gives +2/+2 to a Resistance unit or a unit with a Resistance upgrade; deployed she may give it to another', () => {
    const units = [unit('r', 'RES'), unit('u', 'GRD', { upgrades: [{ cardId: 'RES_UPG', owner: 'player' }] }), unit('g', 'GRD')]
    const used = use(front('JTL_007', { units }))
    expect(readyCount(used, 'player')).toBe(9)
    expect(unitOffers(used)).toEqual(['r', 'u'])
    expect(buffOf(choice(used))).toMatchObject({ power: 2, hp: 2 })
    const a = attack(back('JTL_007', { units }, { units: [unit('e', 'GRD')] }), 'L', 'e')
    expect(unitOffers(a)).toEqual(['r', 'u'])
    expect(declinable(a)).toBe(true)
  })

  it('General Grievous (TWI_015) gives a Droid Sentinel; deployed he may give a Droid +1/+0 and Sentinel', () => {
    const used = use(front('TWI_015', { units: [unit('d', 'DROID'), unit('g', 'GRD')] }))
    expect(unitOffers(used)).toEqual(['d'])
    expect(buffOf(choice(used))).toMatchObject({ power: 0, keywords: [{ name: 'Sentinel' }] })
    const a = attack(back('TWI_015', { units: [unit('d', 'DROID')] }, { units: [unit('e', 'GRD')] }), 'L', 'e')
    expect(buffOf(choice(a))).toMatchObject({ power: 1, keywords: [{ name: 'Sentinel' }] })
    expect(declinable(a)).toBe(true)
  })

  it('Wat Tambor (TWI_006) gives +2/+2 after a friendly unit was defeated this phase; deployed he may give it to another unit', () => {
    const defeated = { phaseEvents: phaseEvents({ defeated: { player: ['GRD'], opponent: [] } }) }
    expect(usable(front('TWI_006', { units: [unit('g', 'GRD')] }))).toBe(false)
    const used = use(front('TWI_006', { units: [unit('g', 'GRD')] }, {}, defeated))
    expect(buffOf(choice(used))).toMatchObject({ power: 2, hp: 2 })
    noChoice(attack(back('TWI_006', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'L', 'e'))
    const a = attack(back('TWI_006', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }, defeated), 'L', 'e')
    expect(unitOffers(a)).toEqual(['e', 'g'])
    expect(declinable(a)).toBe(true)
  })

  it('Kylo Ren (SHD_011) discards a card to give a unit +2/+0; deployed he gets -1/-0 for each card in hand', () => {
    expect(usable(front('SHD_011', { units: [unit('g', 'GRD')] }))).toBe(false)
    const used = use(front('SHD_011', { hand: ['EV', 'GRD'], units: [unit('g', 'GRD')] }))
    expect(choice(used).kind).toBe('selectDiscard')
    const discarded = accept(used, { handIndex: 0 })
    expect(discarded.players.player.discard).toEqual(['EV'])
    expect(buffOf(choice(discarded))).toMatchObject({ power: 2, hp: 0 })
    const s = back('SHD_011', { hand: ['EV', 'EV'] })
    expect(effectivePower(s, U(s, 'L')!)).toBe((F.SHD_011.power ?? 0) - 2)
  })

  it('Sebulba (LAW_012) discards his deck top to give a friendly unit Raid 1 for this phase; deployed he discards his deck top as he attacks', () => {
    expect(usable(front('LAW_012', { units: [unit('g', 'GRD')] }))).toBe(false)
    const used = use(front('LAW_012', { deck: ['EV', 'GRD'], units: [unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }))
    expect(used.players.player.discard).toEqual(['EV'])
    expect(unitOffers(used)).toEqual(['g'])
    expect(buffOf(choice(used))).toMatchObject({ keywords: [{ name: 'Raid', value: 1 }] })
    const a = attack(back('LAW_012', { deck: ['EV', 'GRD'] }, { units: [unit('e', 'GRD')] }), 'L', 'e')
    expect(a.players.player.discard).toEqual(['EV'])
    expect(unitKeywordValue(a, U(a, 'L')!, 'Raid')).toBe(1)
  })
})

describe('leaders A: searches', () => {
  it('Jyn Erso (LAW_005) searches the top 3 for a card after a friendly Rebel was defeated this phase, from either side', () => {
    const deck = ['EV', 'GRD', 'SPC', 'REB']
    expect(usable(front('LAW_005', { deck }, {}, { phaseEvents: phaseEvents({ defeated: { player: ['GRD'], opponent: [] } }) }))).toBe(false)
    const rebel = { phaseEvents: phaseEvents({ defeated: { player: ['REB'], opponent: [] } }) }
    const used = use(front('LAW_005', { deck }, {}, rebel))
    expect(choice(used)).toMatchObject({ kind: 'searchDraw', revealed: ['EV', 'GRD', 'SPC'], eligibleIndices: [0, 1, 2] })
    const a = attack(back('LAW_005', { deck }, { units: [unit('e', 'GRD')] }, rebel), 'L', 'e')
    expect(choice(a).kind).toBe('searchDraw')
  })
})

// ── B: attacks, and units entering play ───────────────────────────────────────────────────────────

type AttackMove = Extract<Action, { type: 'attack' }>
const attackMoves = (s: GameState) => moves(s).filter((m): m is AttackMove => m.type === 'attack')
const attackers = (s: GameState) => [...new Set(attackMoves(s).map(m => m.attackerId))].sort()
const baseOffered = (s: GameState, attackerId: string) => attackMoves(s).some(m => m.attackerId === attackerId && m.target.kind === 'base')

describe('leaders B: attack with a unit', () => {
  it('Anakin Skywalker (TWI_012) deals 2 to his own base to attack with a unit, +2/+0 against a unit; deployed he gets +1/+0 per 5 damage on your base', () => {
    const s = front('TWI_012', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'TOUGH')] })
    const used = use(s)
    expect(baseDamage(used, 'player')).toBe(2)
    expect(attackers(used)).toEqual(['g'])
    expect(U(attack(used, 'g', 'e'), 'e')!.damage).toBe(4)
    expect(baseDamage(attack(use(s), 'g'), 'opponent')).toBe(2)
    const hurt = back('TWI_012', { base: { cardId: 'TST_B', damage: 10 } })
    expect(effectivePower(hurt, U(hurt, 'L')!)).toBe((F.TWI_012.power ?? 0) + 2)
    expect(unitHasKeyword(hurt, U(hurt, 'L')!, 'Overwhelm')).toBe(true)
  })

  it('Asajj Ventress (TWI_014) attacks with a unit, +1/+0 after an event this phase; deployed, after an event she gets +1/+0 and strikes first', () => {
    const event = { phaseEvents: phaseEvents({ played: { player: ['EV'], opponent: [] } }) }
    const plain = use(front('TWI_014', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'TOUGH')] }))
    expect(U(attack(plain, 'g', 'e'), 'e')!.damage).toBe(2)
    const boosted = use(front('TWI_014', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'TOUGH')] }, event))
    expect(U(attack(boosted, 'g', 'e'), 'e')!.damage).toBe(3)
    expect(U(attack(back('TWI_014', {}, { units: [unit('e', 'SMALL')] }), 'L', 'e'), 'L')!.damage).toBe(1)
    const first = attack(back('TWI_014', {}, { units: [unit('e', 'STRONG', { damage: 7 })] }, event), 'L', 'e')
    expect(U(first, 'L')!.damage).toBe(0)
    // Without the event she trades: the defender's 4 power strikes back at her 4 HP.
    expect(U(attack(back('TWI_014', {}, { units: [unit('e', 'STRONG', { damage: 7 })] }), 'L', 'e'), 'L')).toBeUndefined()
    const s = back('TWI_014', {}, {}, event)
    expect(effectivePower(s, U(s, 'L')!, { attacking: true })).toBe((F.TWI_014.power ?? 0) + 1)
  })

  it('Maul (TWI_009) attacks with a unit that gains Overwhelm; deployed each other friendly unit gains Overwhelm', () => {
    const used = use(front('TWI_009', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'SMALL')] }))
    expect(baseDamage(attack(used, 'g', 'e'), 'opponent')).toBe(1)
    const s = back('TWI_009', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] })
    expect(unitHasKeyword(s, U(s, 'g')!, 'Overwhelm')).toBe(true)
    expect(unitHasKeyword(s, U(s, 'L')!, 'Overwhelm')).toBe(true)
    expect(unitHasKeyword(s, U(s, 'e')!, 'Overwhelm')).toBe(false)
  })

  it('Moff Gideon (SHD_007) attacks with a unit that costs 3 or less, +1/+0 against a unit; deployed those units get +1/+0 and Overwhelm attacking a unit', () => {
    const s = front('SHD_007', { units: [unit('c', 'CHEAP'), unit('p', 'PRICEY')] }, { units: [unit('e', 'TOUGH')] })
    const used = use(s)
    expect(attackers(used)).toEqual(['c'])
    expect(U(attack(used, 'c', 'e'), 'e')!.damage).toBe(3)
    expect(baseDamage(attack(use(s), 'c'), 'opponent')).toBe(2)
    const d = back('SHD_007', { units: [unit('c', 'CHEAP'), unit('p', 'PRICEY')] }, { units: [unit('e', 'TOUGH'), unit('sm', 'SMALL')] })
    expect(U(attack(d, 'c', 'e'), 'e')!.damage).toBe(3)
    expect(U(attack(d, 'p', 'e'), 'e')!.damage).toBe(2)
    expect(baseDamage(attack(d, 'c', 'sm'), 'opponent')).toBe(2)
    expect(baseDamage(attack(d, 'c'), 'opponent')).toBe(2)
    expect(unitHasKeyword(d, U(d, 'L')!, 'Overwhelm')).toBe(true)
  })

  it('IG-88 (SOR_012) attacks with a unit, +1/+0 while you control more units; deployed each other friendly unit gains Raid 1', () => {
    const more = use(front('SOR_012', { units: [unit('g', 'GRD'), unit('g2', 'GRD')] }, { units: [unit('e', 'TOUGH')] }))
    expect(U(attack(more, 'g', 'e'), 'e')!.damage).toBe(3)
    const level = use(front('SOR_012', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'TOUGH')] }))
    expect(U(attack(level, 'g', 'e'), 'e')!.damage).toBe(2)
    const s = back('SOR_012', { units: [unit('g', 'GRD')] })
    expect(unitKeywordValue(s, U(s, 'g')!, 'Raid')).toBe(1)
    expect(unitHasKeyword(s, U(s, 'L')!, 'Raid')).toBe(false)
  })

  it('Jyn Erso (SOR_018) attacks with a unit whose defender gets -1/-0; deployed, every friendly attacker\'s defender does', () => {
    const used = use(front('SOR_018', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'STRONG')] }))
    expect(U(attack(used, 'g', 'e'), 'g')!.damage).toBe(3)
    const s = back('SOR_018', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'STRONG'), unit('e2', 'STRONG')] })
    expect(U(attack(s, 'g', 'e'), 'g')!.damage).toBe(3)
    const theirs = attack({ ...s, activePlayer: 'opponent' }, 'e2', 'g')
    expect(U(theirs, 'e2')!.damage).toBe(2)
  })

  it('Leia Organa (SOR_009) attacks with a Rebel, then may attack with another; deployed, when she completes an attack she may attack with a Rebel', () => {
    const used = use(front('SOR_009', { units: [unit('r', 'REB'), unit('r2', 'REB2'), unit('g', 'GRD')] }))
    expect(attackers(used)).toEqual(['r', 'r2'])
    const first = attack(used, 'r')
    expect(attackers(first)).toEqual(['r2'])
    expect(declinable(first)).toBe(true)
    const a = attack(back('SOR_009', { units: [unit('r', 'REB'), unit('g', 'GRD')] }), 'L')
    expect(attackers(a)).toEqual(['r'])
    expect(declinable(a)).toBe(true)
    expect(unitKeywordValue(a, U(a, 'L')!, 'Raid')).toBe(1)
  })

  it('Asajj Ventress (TS26_7) attacks with a token unit, +1/+0; deployed she gets +2/+0 once a token unit has attacked this phase', () => {
    const used = use(front('TS26_7', { units: [unit('t', 'TOKEN_MANDALORIAN'), unit('g', 'GRD')] }))
    expect(attackers(used)).toEqual(['t'])
    expect(baseDamage(attack(used, 't'), 'opponent')).toBe(3)
    const quiet = back('TS26_7', { units: [unit('t', 'TOKEN_MANDALORIAN')] })
    expect(effectivePower(quiet, U(quiet, 'L')!)).toBe(F.TS26_7.power)
    const s = back('TS26_7', { units: [unit('t', 'TOKEN_MANDALORIAN')] }, {}, { phaseEvents: phaseEvents({ attackedUnits: ['t'] }) })
    expect(effectivePower(s, U(s, 'L')!)).toBe((F.TS26_7.power ?? 0) + 2)
  })

  it('Padmé Amidala (TS26_4) attacks with one of 2 units that entered play, even exhausted, not a base; deployed she may do the same as her attack ends', () => {
    const units = [unit('a', 'GRD', { exhausted: true }), unit('b', 'GRD', { exhausted: true }), unit('g', 'GRD', { exhausted: true })]
    const entered = { phaseEvents: phaseEvents({ enteredPlay: { player: ['a', 'b'], opponent: [] } }) }
    expect(usable(front('TS26_4', { units }, { units: [unit('e', 'TOUGH')] }, { phaseEvents: phaseEvents({ enteredPlay: { player: ['a'], opponent: [] } }) }))).toBe(false)
    const used = use(front('TS26_4', { units }, { units: [unit('e', 'TOUGH')] }, entered))
    expect(attackers(used)).toEqual(['a', 'b'])
    expect(baseOffered(used, 'a')).toBe(false)
    const a = attack(back('TS26_4', { units }, { units: [unit('e', 'TOUGH')] }, entered), 'L', 'e')
    expect(attackers(a)).toEqual(['a', 'b'])
    expect(baseOffered(a, 'a')).toBe(false)
    expect(declinable(a)).toBe(true)
  })

  it('Saw Gerrera (LAW_001) attacks with a unit, +2/+0 and Overwhelm, then defeats it; deployed, if he survives he may do the same with another unit', () => {
    const used = use(front('LAW_001', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'SMALL')] }))
    const hit = attack(used, 'g', 'e')
    expect(baseDamage(hit, 'opponent')).toBe(3)
    expect(U(hit, 'g')).toBeUndefined()
    const a = attack(back('LAW_001', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'TOUGH')] }), 'L', 'e')
    expect(attackers(a)).toEqual(['g'])
    expect(declinable(a)).toBe(true)
    const second = attack(a, 'g')
    expect(baseDamage(second, 'opponent')).toBe(4)
    expect(U(second, 'g')).toBeUndefined()
    const s = back('LAW_001', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'STRONG')] })
    const doomed = { ...s, players: { ...s.players, player: { ...s.players.player, units: s.players.player.units.map(u => (u.instanceId === 'L' ? { ...u, damage: 6 } : u)) } } }
    noChoice(attack(doomed, 'L', 'e'))
  })
})

describe('leaders B: units that entered play', () => {
  it('a deployed leader and a created token count as entering play this phase', () => {
    const s = board({ resources: ready(10) })
    const deployedNow = resolve(s, { type: 'deployLeader' })
    const leaderUnit = deployedNow.players.player.units.find(u => u.isLeader)!
    expect(deployedNow.phaseEvents?.enteredPlay.player).toContain(leaderUnit.instanceId)
    const created = createTokenUnit(s, 'opponent', TOKEN_MANDALORIAN)
    const token = created.players.opponent.units[0]
    expect(created.phaseEvents?.enteredPlay.opponent).toEqual([token.instanceId])
  })

  it('Anakin Skywalker (TS26_2) shields one of 2 units that entered play this phase; deployed he shields another friendly unit that did', () => {
    const units = [unit('a', 'GRD'), unit('b', 'GRD'), unit('g', 'GRD')]
    expect(usable(front('TS26_2', { units }, {}, { phaseEvents: phaseEvents({ enteredPlay: { player: ['a'], opponent: [] } }) }))).toBe(false)
    const entered = { phaseEvents: phaseEvents({ enteredPlay: { player: ['a', 'b'], opponent: [] } }) }
    const used = use(front('TS26_2', { units }, {}, entered))
    expect(unitOffers(used)).toEqual(['a', 'b'])
    const a = attack(back('TS26_2', { units }, { units: [unit('e', 'TOUGH')] }, { phaseEvents: phaseEvents({ enteredPlay: { player: ['a', 'L'], opponent: [] } }) }), 'L', 'e')
    expect(unitOffers(a)).toEqual(['a'])
    expect(declinable(a)).toBe(false)
  })
})
