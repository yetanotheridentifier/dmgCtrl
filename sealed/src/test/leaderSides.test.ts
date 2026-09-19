import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
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
import { createTokenUnit, dealDamageToBase, giveToken } from '../engine/effects'
import { dealDamageToUnit, defeatUnit } from '../engine/combat'
import { baseDamageThisPhase, tokenCreatedThisPhase } from '../engine/types'
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
  // C: plays from hand
  'LOF_010', 'JTL_005', 'SHD_016', 'SHD_013', 'SOR_003', 'SEC_007', 'LOF_005',
  // D: When Deployed
  'LAW_004', 'LOF_012', 'TWI_013', 'TWI_004', 'SHD_002', 'SOR_006', 'SHD_015', 'JTL_014',
  // E: constant abilities on the leader side
  'SOR_001', 'SHD_001', 'LAW_009', 'SEC_009', 'TWI_001', 'TS26_5',
  // F: one small engine addition each
  'SEC_005', 'SEC_010', 'LAW_011', 'LAW_016', 'SOR_013', 'SOR_004', 'TS26_6', 'SEC_002',
]
/**
 * Scoped by the triage but lifted out to the ticket that owns their blocker. LAW_010 and SOR_008 were
 * lifted to Experience tokens and SEC_011 to token units, which have since shipped, so they are built and
 * covered there instead.
 */
const LIFTED = [
  'JTL_001', 'JTL_003', 'JTL_011', 'JTL_012', 'JTL_015', 'JTL_017', 'JTL_018', 'TWI_017',
  'SEC_003', 'LOF_001', 'SHD_006', 'SHD_010', 'SEC_001', 'SEC_006', 'LAW_003', 'LAW_017', 'SEC_012',
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
  CAP: src('CAP', { arena: 'space', cost: 5, traits: ['CAPITAL SHIP'] }),
  SIX: card({ id: 'SIX', type: 'event', cost: 6 }),
  HUGE: src('HUGE', { cost: 5 }),
  SIXU: src('SIXU', { cost: 6 }),
  SENT: src('SENT', { keywords: [{ name: 'Sentinel' }] }),
  SENT2: src('SENT2', { keywords: [{ name: 'Sentinel' }] }),
  FORCE_EV: card({ id: 'FORCE_EV', type: 'event', cost: 1, traits: ['FORCE'] }),
  FORCE_UNIT: src('FORCE_UNIT', { traits: ['FORCE'] }),
  AGG: src('AGG', { aspects: ['Aggression'] }),
  HERO_AGG: src('HERO_AGG', { aspects: ['Aggression', 'Heroism'] }),
  OFF: src('OFF', { traits: ['OFFICIAL'] }),
  OFF_AGG: src('OFF_AGG', { traits: ['OFFICIAL'], aspects: ['Aggression'] }),
  OFF_VIL: src('OFF_VIL', { traits: ['OFFICIAL'], aspects: ['Aggression', 'Villainy'] }),
  CLONE: src('CLONE', { traits: ['CLONE'] }),
  CLONE_AGG: src('CLONE_AGG', { traits: ['CLONE'], aspects: ['Aggression'] }),
  EV3: card({ id: 'EV3', type: 'event', cost: 3 }),
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

// ── C: plays from hand ────────────────────────────────────────────────────────────────────────────

const handOffers = (s: GameState) => {
  const c = choice(s)
  return c.kind === 'playUnitFromHand' ? c.candidates.map(x => x.cardId) : c.kind === 'selectHandCardThen' ? c.handIndices : undefined
}
/** Play the hand card at `handIndex` through the raised play choice; returns the state and the new unit. */
const playFrom = (s: GameState, handIndex: number) => {
  const next = accept(s, { handIndex })
  return { next, played: next.players.player.units[next.players.player.units.length - 1] }
}
const useBack = (s: GameState, id: string) => resolve(s, { type: 'useAbility', instanceId: 'L', cardId: id, index: 0 })

describe('leaders C: play a unit from hand', () => {
  it('Third Sister (LOF_010) plays a unit that gains Hidden; deployed, as she attacks, the next unit you play gains Hidden', () => {
    expect(usable(front('LOF_010', { hand: ['EV'] }))).toBe(false)
    const used = use(front('LOF_010', { hand: ['GRD', 'EV'] }))
    expect(handOffers(used)).toEqual(['GRD'])
    const { next, played } = playFrom(used, 0)
    expect(unitHasKeyword(next, played, 'Hidden')).toBe(true)
    expect(readyCount(next, 'player')).toBe(8)
    const a = attack(back('LOF_010', {}, { units: [unit('e', 'TOUGH')] }), 'L', 'e')
    expect(a.players.player.nextUnitGrants).toEqual([{ keywords: [{ name: 'Hidden' }] }])
  })

  it('Admiral Piett (JTL_005) plays a Capital Ship unit for 1 less; deployed each Capital Ship unit you play costs 2 less', () => {
    const hand = ['CAP', 'GRD']
    const used = use(front('JTL_005', { hand }))
    expect(handOffers(used)).toEqual(['CAP'])
    expect(readyCount(playFrom(used, 0).next, 'player')).toBe(6)
    const s = back('JTL_005', { hand })
    expect(effectiveCost(s, 'player', F.CAP)).toBe(3)
    expect(effectiveCost(s, 'player', F.GRD)).toBe(2)
  })

  it('Fennec Shand (SHD_016) pays 1 to play a unit that costs 4 or less, which gains Ambush; deployed the same action costs nothing and needs no exhaust', () => {
    const hand = ['CHEAP', 'CAP']
    const used = use(front('SHD_016', { hand }, { units: [unit('e', 'TOUGH')] }))
    expect(readyCount(used, 'player')).toBe(9)
    expect(handOffers(used)).toEqual(['CHEAP'])
    const { next } = playFrom(used, 0)
    expect(choice(next).kind).toBe('ambush')
    const s = back('SHD_016', { hand, units: [] }, { units: [unit('e', 'TOUGH')] })
    const exhaustedLeader = { ...s, players: { ...s.players, player: { ...s.players.player, units: s.players.player.units.map(u => ({ ...u, exhausted: true })) } } }
    const acted = useBack(exhaustedLeader, 'SHD_016')
    expect(handOffers(acted)).toEqual(['CHEAP'])
    expect(unitHasKeyword(s, U(s, 'L')!, 'Saboteur')).toBe(true)
  })

  it('Han Solo (SHD_013) plays a unit for 1 less and deals 2 damage to it; deployed the same with no exhaust', () => {
    const used = use(front('SHD_013', { hand: ['GRD'] }))
    const { next, played } = playFrom(used, 0)
    expect(readyCount(next, 'player')).toBe(9)
    expect(played.damage).toBe(2)
    expect(handOffers(useBack(back('SHD_013', { hand: ['GRD'] }), 'SHD_013'))).toEqual(['GRD'])
  })

  it('Chewbacca (SOR_003) plays a unit that costs 3 or less, which gains Sentinel for this phase; deployed he has Grit and Sentinel', () => {
    const used = use(front('SOR_003', { hand: ['PRICEY', 'CHEAP'] }))
    expect(handOffers(used)).toEqual(['CHEAP'])
    const { next, played } = playFrom(used, 1)
    expect(unitHasKeyword(next, played, 'Sentinel')).toBe(true)
    const s = back('SOR_003')
    expect(['Grit', 'Sentinel'].map(k => unitHasKeyword(s, U(s, 'L')!, k))).toEqual([true, true])
  })

  it('Dryden Vos (SEC_007) discards a card that costs 6 or more to play a unit that costs 5 or less with Ambush; deployed he discards any card to play any unit with Ambush', () => {
    expect(usable(front('SEC_007', { hand: ['CHEAP', 'CAP'] }))).toBe(false)
    const used = use(front('SEC_007', { hand: ['CHEAP', 'SIX', 'HUGE', 'SIXU'] }))
    expect(handOffers(used)).toEqual([1, 3])
    const discarded = accept(used, { handIndex: 1 })
    expect(discarded.players.player.discard).toEqual(['SIX'])
    expect(handOffers(discarded)).toEqual(['CHEAP', 'HUGE'])
    const { next, played } = playFrom(discarded, 0)
    expect(unitHasKeyword(next, played, 'Ambush')).toBe(true)
    const acted = useBack(back('SEC_007', { hand: ['HUGE', 'EV'] }), 'SEC_007')
    expect(handOffers(acted)).toEqual([0, 1])
    const tossed = accept(acted, { handIndex: 1 })
    expect(handOffers(tossed)).toEqual(['HUGE'])
    const s = back('SEC_007')
    expect(['Overwhelm', 'Ambush'].map(k => unitHasKeyword(s, U(s, 'L')!, k))).toEqual([true, false])
  })

  it('Morgan Elsbeth (LOF_005) plays, for 1 less, a unit sharing a keyword with a friendly unit that attacked; deployed, as she attacks, the next such unit costs 1 less', () => {
    const attacked = { phaseEvents: phaseEvents({ attackedUnits: ['s', 'g'] }) }
    expect(usable(front('LOF_005', { hand: ['SENT2'], units: [unit('s', 'SENT')] }))).toBe(false)
    const used = use(front('LOF_005', { hand: ['GRD', 'SENT2'], units: [unit('s', 'SENT'), unit('g', 'GRD')] }, {}, attacked))
    expect(unitOffers(used)).toEqual(['s'])
    const chosen = accept(used, { targetInstanceId: 's' })
    expect(handOffers(chosen)).toEqual(['SENT2'])
    expect(choice(chosen)).toMatchObject({ costDelta: -1 })
    const a = attack(back('LOF_005', { hand: ['GRD', 'SENT2'], units: [unit('s', 'SENT')] }, { units: [unit('e', 'TOUGH')] }), 'L', 'e')
    expect(effectiveCost(a, 'player', F.SENT2)).toBe(1)
    expect(effectiveCost(a, 'player', F.GRD)).toBe(2)
    const alone = attack(back('LOF_005', { hand: ['SENT2'] }, { units: [unit('e', 'TOUGH')] }), 'L', 'e')
    expect(effectiveCost(alone, 'player', F.SENT2)).toBe(2)
  })
})

// ── D: When Deployed ──────────────────────────────────────────────────────────────────────────────

const deploy = (s: GameState) => resolve(s, { type: 'deployLeader' })
/** The leader unit a deploy put on the board. */
const leaderOf = (s: GameState) => s.players.player.units.find(u => u.isLeader)!
const cardOptions = (s: GameState) => { const c = choice(s); return c.kind === 'selectCardThen' ? c.candidates : undefined }

describe('leaders D: When Deployed', () => {
  it('Aurra Sing (LAW_004) defeats a non-leader unit with 1 or less remaining HP; deploying, she may defeat one with 5 or less', () => {
    const theirs = { units: [unit('e1', 'GRD', { damage: 7 }), unit('e3', 'GRD', { damage: 3 }), unit('e6', 'GRD')] }
    const used = use(front('LAW_004', {}, theirs))
    expect(unitOffers(used)).toEqual(['e1'])
    expect(declinable(used)).toBe(false)
    const d = deploy(front('LAW_004', {}, theirs))
    expect(choice(d).kind).toBe('selectUnitToDefeat')
    expect(unitOffers(d)).toEqual(['e1', 'e3'])
    expect(declinable(d)).toBe(true)
    expect(d.activePlayer).toBe('player')
    const done = accept(d, { targetInstanceId: 'e3' })
    expect(U(done, 'e3')).toBeUndefined()
    expect(done.activePlayer).toBe('opponent')
  })

  it('Rey (LOF_012) deals 1 after a non-unit Force card this phase; deploying, she may discard her hand to draw 2', () => {
    expect(usable(front('LOF_012', { units: [unit('g', 'GRD')] }, {}, { phaseEvents: phaseEvents({ played: { player: ['FORCE_UNIT'], opponent: [] } }) }))).toBe(false)
    const used = use(front('LOF_012', { units: [unit('g', 'GRD')] }, {}, { phaseEvents: phaseEvents({ played: { player: ['FORCE_EV'], opponent: [] } }) }))
    expect(amountOf(choice(used))).toBe(1)
    noChoice(deploy(front('LOF_012', { deck: ['SPC', 'CHEAP'] })))
    const d = deploy(front('LOF_012', { hand: ['EV', 'GRD'], deck: ['SPC', 'CHEAP', 'PRICEY'] }))
    expect(choice(d).kind).toBe('mayPayThen')
    const done = accept(d)
    expect(done.players.player.discard).toEqual(['EV', 'GRD'])
    expect(done.players.player.hand).toEqual(['SPC', 'CHEAP'])
    expect(skip(d).players.player.hand).toEqual(['EV', 'GRD'])
  })

  it('Mace Windu (TWI_013) deals 1 to a damaged enemy unit and 1 more at 5 damage; deploying, 2 to each damaged enemy unit', () => {
    const theirs = { units: [unit('e4', 'GRD', { damage: 4 }), unit('e1', 'GRD', { damage: 1 }), unit('clean', 'GRD')] }
    const used = use(front('TWI_013', { units: [unit('g', 'GRD', { damage: 1 })] }, theirs))
    expect(unitOffers(used)).toEqual(['e1', 'e4'])
    expect(U(accept(used, { targetInstanceId: 'e4' }), 'e4')!.damage).toBe(6)
    expect(U(accept(used, { targetInstanceId: 'e1' }), 'e1')!.damage).toBe(2)
    const d = deploy(front('TWI_013', { units: [unit('g', 'GRD', { damage: 1 })] }, theirs))
    expect([U(d, 'e4')!.damage, U(d, 'e1')!.damage, U(d, 'clean')!.damage, U(d, 'g')!.damage]).toEqual([6, 3, 0, 1])
  })

  it('Yoda (TWI_004) draws after a unit left play this phase, then puts a hand card on the top or bottom; deploying, he may mill a card to defeat a cheaper enemy', () => {
    expect(usable(front('TWI_004', { deck: ['EV'] }))).toBe(false)
    const left = { phaseEvents: phaseEvents({ leftPlay: { player: [], opponent: ['GRD'] } }) }
    const used = use(front('TWI_004', { hand: ['SPC'], deck: ['EV', 'CHEAP'] }, {}, left))
    expect(used.players.player.hand).toEqual(['SPC', 'EV'])
    expect(handOffers(used)).toEqual([0, 1])
    const picked = accept(used, { handIndex: 0 })
    expect(choice(picked).kind).toBe('mayPayThen')
    expect(accept(picked).players.player.deck).toEqual(['SPC', 'CHEAP'])
    expect(skip(picked).players.player.deck).toEqual(['CHEAP', 'SPC'])
    const theirs = { units: [unit('c', 'CHEAP'), unit('p', 'PRICEY')] }
    const d = deploy(front('TWI_004', { deck: ['CHEAP', 'EV'] }, theirs))
    expect(choice(d).kind).toBe('mayPayThen')
    const milled = accept(d)
    expect(milled.players.player.discard).toEqual(['CHEAP'])
    expect(unitOffers(milled)).toEqual(['c'])
    expect(declinable(milled)).toBe(false)
    const s = back('TWI_004')
    expect(unitKeywordValue(s, U(s, 'L')!, 'Restore')).toBe(2)
  })

  it("Qi'ra (SHD_002) deals 2 to a friendly unit then shields it; deploying, she heals every unit then deals each half its remaining HP", () => {
    const used = use(front('SHD_002', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }))
    expect(unitOffers(used)).toEqual(['g'])
    const done = accept(used, { targetInstanceId: 'g' })
    expect(U(done, 'g')!.damage).toBe(2)
    expect(shields(done, 'g')).toBe(1)
    const d = deploy(front('SHD_002', { units: [unit('g', 'GRD', { damage: 3 })] }, { units: [unit('e', 'SMALL'), unit('t', 'TOUGH', { damage: 5 })] }))
    expect([U(d, 'g')!.damage, U(d, 't')!.damage, leaderOf(d).damage]).toEqual([4, 10, Math.floor((F.SHD_002.hp ?? 0) / 2)])
    expect(U(d, 'e')!.damage).toBe(0)
  })

  it('Emperor Palpatine (SOR_006) defeats a friendly unit to deal 1 and draw; deploying he takes a damaged non-leader unit; attacking he may defeat another to do it again', () => {
    const used = use(front('SOR_006', { units: [unit('g', 'GRD')], deck: ['EV'] }, { units: [unit('e', 'GRD')] }))
    expect(unitOffers(used)).toEqual(['g'])
    const paid = accept(used, { targetInstanceId: 'g' })
    expect(U(paid, 'g')).toBeUndefined()
    expect(paid.players.player.hand).toEqual(['EV'])
    expect(unitOffers(paid)).toEqual(['e'])
    const d = deploy(front('SOR_006', {}, { units: [unit('e', 'GRD', { damage: 1 }), unit('clean', 'GRD')] }))
    expect(unitOffers(d)).toEqual(['e'])
    const taken = accept(d, { targetInstanceId: 'e' })
    expect(taken.players.player.units.map(u => u.instanceId)).toContain('e')
    const a = attack(back('SOR_006', { units: [unit('g', 'GRD')], deck: ['EV'] }, { units: [unit('x', 'TOUGH')] }), 'L', 'x')
    expect(unitOffers(a)).toEqual(['g'])
    expect(declinable(a)).toBe(true)
  })

  it('Doctor Aphra (SHD_015) mills a card as the regroup phase starts; deployed she gets +3/+0 with 5 different costs in her discard, and deploying returns 1 of 3 chosen cards at random', () => {
    const s = front('SHD_015', { deck: ['EV', 'GRD', 'SPC', 'CHEAP'] }, {}, { consecutivePasses: 1 })
    const regroup = resolve(s, { type: 'pass' })
    expect(regroup.phase).toBe('regroup')
    expect(regroup.players.player.discard).toHaveLength(1)
    expect(regroup.players.opponent.discard).toHaveLength(0)
    const costs = back('SHD_015', { discard: ['SMALL', 'GRD', 'CHEAP', 'PRICEY', 'HUGE', 'SIXU'] })
    expect(effectivePower(costs, U(costs, 'L')!)).toBe((F.SHD_015.power ?? 0) + 3)
    const fewer = back('SHD_015', { discard: ['GRD', 'CHEAP', 'PRICEY', 'HUGE'] })
    expect(effectivePower(fewer, U(fewer, 'L')!)).toBe(F.SHD_015.power)
    noChoice(deploy(front('SHD_015', { discard: ['GRD', 'GRD', 'SPC'] })))
    const d = deploy(front('SHD_015', { discard: ['GRD', 'GRD', 'SPC', 'EV'] }))
    expect(cardOptions(d)).toEqual(['GRD', 'SPC', 'EV'])
    const one = accept(d, { optionIndex: 0 })
    expect(cardOptions(one)).toEqual(['SPC', 'EV'])
    const two = accept(one, { optionIndex: 0 })
    const three = accept(two, { optionIndex: 0 })
    noChoice(three)
    expect(three.players.player.hand).toHaveLength(1)
    expect(['GRD', 'SPC', 'EV']).toContain(three.players.player.hand[0])
    expect(three.players.player.discard).toHaveLength(3)
  })

  it('Admiral Trench (JTL_014) discards a card that costs 3 or more to draw; deploying, an opponent discards 2 of his top 4 and he draws 1 of the rest', () => {
    const used = use(front('JTL_014', { hand: ['EV', 'CHEAP'], deck: ['SPC'] }))
    expect(handOffers(used)).toEqual([1])
    const drew = accept(used, { handIndex: 1 })
    expect(drew.players.player.discard).toEqual(['CHEAP'])
    expect(drew.players.player.hand).toEqual(['EV', 'SPC'])
    const d = deploy(front('JTL_014', { deck: ['EV', 'GRD', 'SPC', 'CHEAP', 'PRICEY'] }))
    expect(choice(d).controller).toBe('opponent')
    expect(d.activePlayer).toBe('opponent')
    expect(cardOptions(d)).toEqual(['EV', 'GRD', 'SPC', 'CHEAP'])
    const first = accept(d, { optionIndex: 0 })
    expect(cardOptions(first)).toEqual(['GRD', 'SPC', 'CHEAP'])
    const second = accept(first, { optionIndex: 0 })
    expect(choice(second).controller).toBe('player')
    expect(cardOptions(second)).toEqual(['SPC', 'CHEAP'])
    const done = accept(second, { optionIndex: 1 })
    expect(done.players.player.hand).toEqual(['CHEAP'])
    expect(done.players.player.discard).toEqual(['EV', 'GRD', 'SPC'])
    expect(done.players.player.deck).toEqual(['PRICEY'])
    expect(done.activePlayer).toBe('opponent')
  })
})

// ── E: constant abilities on the leader side ──────────────────────────────────────────────────────

describe('leaders E: constant abilities while undeployed', () => {
  it('Director Krennic (SOR_001) gives each friendly damaged unit +1/+0 from either side', () => {
    const s = front('SOR_001', { units: [unit('d', 'GRD', { damage: 1 }), unit('g', 'GRD')] }, { units: [unit('e', 'GRD', { damage: 1 })] })
    expect([effectivePower(s, U(s, 'd')!), effectivePower(s, U(s, 'g')!), effectivePower(s, U(s, 'e')!)]).toEqual([3, 2, 2])
    const d = back('SOR_001', { units: [unit('g', 'GRD', { damage: 1 })] })
    const hurt = { ...d, players: { ...d.players, player: { ...d.players.player, units: d.players.player.units.map(u => ({ ...u, damage: 1 })) } } }
    expect(effectivePower(hurt, U(hurt, 'L')!)).toBe((F.SOR_001.power ?? 0) + 1)
    expect(effectivePower(hurt, U(hurt, 'g')!)).toBe(3)
    expect(unitKeywordValue(hurt, U(hurt, 'L')!, 'Restore')).toBe(2)
  })

  it('Gar Saxon (SHD_001) gives each friendly upgraded unit +1/+0; deployed each also gains a When Defeated that may return one of its upgrades', () => {
    const upgraded = unit('u', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })
    const s = front('SHD_001', { units: [upgraded, unit('g', 'GRD')] })
    expect([effectivePower(s, U(s, 'u')!), effectivePower(s, U(s, 'g')!)]).toEqual([4, 2])
    const d = back('SHD_001', { units: [upgraded] })
    expect(effectivePower(d, U(d, 'u')!)).toBe(4)
    const dead = defeatUnit(d, 'u')
    expect(dead.players.player.discard).toEqual(['GRD', 'UPG'])
    expect(cardOptions(dead)).toEqual(['UPG'])
    expect(declinable(dead)).toBe(true)
    expect(accept(dead, { optionIndex: 0 }).players.player.hand).toEqual(['UPG'])
    noChoice(defeatUnit(front('SHD_001', { units: [upgraded] }), 'u'))
  })

  it('Hera Syndulla (LAW_009) waives the aspect penalty on Heroism units while you control 2 or more units, from either side', () => {
    const one = front('LAW_009', { units: [unit('g', 'GRD')] })
    expect(effectiveCost(one, 'player', F.HERO_AGG)).toBe(4)
    const two = front('LAW_009', { units: [unit('g', 'GRD'), unit('g2', 'GRD')] })
    expect(effectiveCost(two, 'player', F.HERO_AGG)).toBe(2)
    expect(effectiveCost(two, 'player', F.AGG)).toBe(4)
    const d = back('LAW_009', { units: [unit('g', 'GRD')] })
    expect(effectiveCost(d, 'player', F.HERO_AGG)).toBe(2)
  })

  it('Mon Mothma (SEC_009) waives the penalty on non-Villainy Official units and gives other friendly Officials +0/+1, from either side', () => {
    const s = front('SEC_009', { units: [unit('o', 'OFF')] }, { units: [unit('eo', 'OFF')] })
    expect(effectiveCost(s, 'player', F.OFF_AGG)).toBe(2)
    expect(effectiveCost(s, 'player', F.OFF_VIL)).toBe(6)
    expect([effectiveHp(s, U(s, 'o')!), effectiveHp(s, U(s, 'eo')!)]).toEqual([9, 8])
    const d = back('SEC_009', { units: [unit('o', 'OFF')] })
    expect(effectiveHp(d, U(d, 'o')!)).toBe(9)
    expect(effectiveHp(d, U(d, 'L')!)).toBe(F.SEC_009.hp)
    expect(effectiveCost(d, 'player', F.OFF_AGG)).toBe(2)
  })

  it('Nala Se (TWI_001) waives the penalty on Clone units; deployed each friendly Clone heals 2 from your base when defeated', () => {
    const s = front('TWI_001')
    expect(effectiveCost(s, 'player', F.CLONE_AGG)).toBe(2)
    expect(effectiveCost(s, 'player', F.AGG)).toBe(4)
    const hurt = { base: { cardId: 'TST_B', damage: 5 } }
    expect(baseDamage(defeatUnit(back('TWI_001', { ...hurt, units: [unit('c', 'CLONE')] }), 'c'), 'player')).toBe(3)
    expect(baseDamage(defeatUnit(back('TWI_001', { ...hurt, units: [unit('g', 'GRD')] }), 'g'), 'player')).toBe(5)
    expect(baseDamage(defeatUnit(front('TWI_001', { ...hurt, units: [unit('c', 'CLONE')] }), 'c'), 'player')).toBe(5)
    expect(effectiveCost(back('TWI_001'), 'player', F.CLONE_AGG)).toBe(2)
  })

  it('Savage Opress (TS26_5) gives each friendly unit with the most power Overwhelm; deployed he has Raid 3 and Overwhelm and each other friendly unit gains Overwhelm', () => {
    const s = front('TS26_5', { units: [unit('big', 'STRONG'), unit('g', 'GRD')] }, { units: [unit('e', 'SMALL'), unit('e2', 'SMALL')] })
    expect(baseDamage(attack(s, 'big', 'e'), 'opponent')).toBe(3)
    expect(baseDamage(attack(s, 'g', 'e2'), 'opponent')).toBe(0)
    const d = back('TS26_5', { units: [unit('g', 'GRD')] })
    expect(unitKeywordValue(d, U(d, 'L')!, 'Raid')).toBe(3)
    expect(['L', 'g'].map(id => unitHasKeyword(d, U(d, id)!, 'Overwhelm'))).toEqual([true, true])
  })
})

// ── F: one small engine addition each ─────────────────────────────────────────────────────────────

describe('leaders F: cards that needed a small engine addition', () => {
  it('Satine Kryze (SEC_005) heals up to 2 from a unit and deals that much to her base; deployed she has Restore 4', () => {
    const s = front('SEC_005', { units: [unit('g', 'GRD', { damage: 3 }), unit('h', 'GRD', { damage: 1 }), unit('x', 'GRD')] })
    const used = use(s)
    expect(unitOffers(used)).toEqual(['g', 'h'])
    const big = accept(used, { targetInstanceId: 'g' })
    expect([U(big, 'g')!.damage, baseDamage(big, 'player')]).toEqual([1, 2])
    const small = accept(use(s), { targetInstanceId: 'h' })
    expect([U(small, 'h')!.damage, baseDamage(small, 'player')]).toEqual([0, 1])
    const d = back('SEC_005')
    expect(unitKeywordValue(d, U(d, 'L')!, 'Restore')).toBe(4)
  })

  it('Dedra Meero (SEC_010) makes an enemy unit\'s controller take 2 damage on it or let her draw; deployed she has Raid 2 with more cards in hand', () => {
    const used = use(front('SEC_010', { deck: ['EV'] }, { units: [unit('e', 'GRD')] }))
    expect(unitOffers(used)).toEqual(['e'])
    const asked = accept(used, { targetInstanceId: 'e' })
    expect(choice(asked)).toMatchObject({ kind: 'mayPayThen', controller: 'opponent' })
    expect(asked.activePlayer).toBe('opponent')
    expect(U(accept(asked), 'e')!.damage).toBe(2)
    const refused = skip(asked)
    expect(refused.players.player.hand).toEqual(['EV'])
    expect(U(refused, 'e')!.damage).toBe(0)
    const more = back('SEC_010', { hand: ['EV', 'EV'] }, { hand: ['EV'] })
    expect(unitKeywordValue(more, U(more, 'L')!, 'Raid')).toBe(2)
    const level = back('SEC_010', { hand: ['EV'] }, { hand: ['EV'] })
    expect(unitHasKeyword(level, U(level, 'L')!, 'Raid')).toBe(false)
  })

  it('Darth Vader (LAW_011) discards a card to deal 1 to a unit or base; attacking he discards any number and deals that much', () => {
    expect(usable(front('LAW_011', { units: [unit('g', 'GRD')] }))).toBe(false)
    const used = use(front('LAW_011', { hand: ['EV'] }))
    const paid = accept(used, { handIndex: 0 })
    expect(amountOf(choice(paid))).toBe(1)
    expect(baseOffers(paid)).toEqual(['opponent', 'player'])
    const a = attack(back('LAW_011', { hand: ['EV', 'GRD'] }, { units: [unit('e', 'TOUGH')] }), 'L', 'e')
    expect(cardOptions(a)).toEqual(['EV', 'GRD'])
    expect(declinable(a)).toBe(true)
    noChoice(skip(a))
    const one = accept(a, { optionIndex: 0 })
    expect(cardOptions(one)).toEqual(['GRD'])
    const oneDone = skip(one)
    expect(amountOf(choice(oneDone))).toBe(1)
    const both = accept(one, { optionIndex: 0 })
    expect(both.players.player.discard).toEqual(['EV', 'GRD'])
    expect(amountOf(choice(both))).toBe(2)
    expect(unitOffers(both)).toEqual(['L', 'e'])
  })

  it('a created token, a given token and a Shielded entry each count as creating a token this phase', () => {
    const s = board({ units: [unit('g', 'GRD')] })
    expect(tokenCreatedThisPhase(s, 'player')).toBe(false)
    expect(tokenCreatedThisPhase(giveToken(s, 'g', TOKEN_SHIELD), 'player')).toBe(true)
    expect(tokenCreatedThisPhase(createTokenUnit(s, 'opponent', TOKEN_MANDALORIAN), 'opponent')).toBe(true)
  })

  it('The Client (LAW_016) exhausts an enemy unit once you created a token this phase, from either side', () => {
    const created = { phaseEvents: phaseEvents({ tokensCreated: ['player'] }) }
    expect(usable(front('LAW_016', {}, { units: [unit('e', 'GRD')] }))).toBe(false)
    const used = use(front('LAW_016', {}, { units: [unit('e', 'GRD'), unit('x', 'GRD', { exhausted: true })] }, created))
    expect(unitOffers(used)).toEqual(['e'])
    expect(declinable(used)).toBe(false)
    noChoice(attack(back('LAW_016', {}, { units: [unit('e', 'TOUGH'), unit('e2', 'GRD')] }), 'L', 'e'))
    const a = attack(back('LAW_016', {}, { units: [unit('e', 'TOUGH'), unit('e2', 'GRD'), unit('x', 'GRD', { exhausted: true })] }, created), 'L', 'e')
    expect(unitOffers(a)).toEqual(['e', 'e2'])
    expect(declinable(a)).toBe(false)
  })

  it("Cassian Andor (SOR_013) draws after 3 damage to an enemy base this phase; deployed, dealing damage to an enemy base he may draw, once each round", () => {
    expect(usable(front('SOR_013', { deck: ['EV'] }, {}, { phaseEvents: phaseEvents({ baseDamageTaken: { opponent: 2 } }) }))).toBe(false)
    const used = use(front('SOR_013', { deck: ['EV'] }, {}, { phaseEvents: phaseEvents({ baseDamageTaken: { opponent: 3 } }) }))
    expect(readyCount(used, 'player')).toBe(9)
    expect(used.players.player.hand).toEqual(['EV'])
    const a = attack(back('SOR_013', { deck: ['EV', 'GRD'] }), 'L')
    expect(choice(a).kind).toBe('mayPayThen')
    const drew = accept(a)
    expect(drew.players.player.hand).toEqual(['EV'])
    noChoice(dealDamageToBase({ ...drew, activePlayer: 'player' }, 'opponent', 1))
    expect(baseDamageThisPhase(drew, 'opponent')).toBe(F.SOR_013.power)
  })

  it('Chirrut Îmwe (SOR_004) gives a unit +0/+2 for this phase; deployed he survives no remaining HP until the regroup phase', () => {
    const used = use(front('SOR_004', { units: [unit('g', 'GRD')] }))
    expect(buffOf(choice(used))).toMatchObject({ power: 0, hp: 2 })
    const hurt = dealDamageToUnit(back('SOR_004', {}, {}, { consecutivePasses: 1 }), 'L', 20)
    expect(U(hurt, 'L')).toBeDefined()
    const regroup = resolve(hurt, { type: 'pass' })
    expect(regroup.phase).toBe('regroup')
    expect(U(regroup, 'L')).toBeUndefined()
  })

  it('Rex (TS26_6) readies an exhausted enemy unit so the next event costs 1 less; deployed he may do it as he attacks, for 2 less', () => {
    expect(usable(front('TS26_6', {}, { units: [unit('e', 'GRD')] }))).toBe(false)
    const used = use(front('TS26_6', { hand: ['EV3', 'GRD'] }, { units: [unit('e', 'GRD', { exhausted: true })] }))
    expect(unitOffers(used)).toEqual(['e'])
    const readied = accept(used, { targetInstanceId: 'e' })
    expect(U(readied, 'e')!.exhausted).toBe(false)
    expect(effectiveCost(readied, 'player', F.EV3)).toBe(2)
    expect(effectiveCost(readied, 'player', F.GRD)).toBe(2)
    const played = resolve({ ...readied, activePlayer: 'player' }, { type: 'playEvent', handIndex: 0 })
    expect(played.players.player.nextUnitGrants).toBeUndefined()
    const a = attack(back('TS26_6', {}, { units: [unit('e', 'TOUGH'), unit('x', 'GRD', { exhausted: true })] }), 'L', 'e')
    expect(unitOffers(a)).toEqual(['x'])
    expect(declinable(a)).toBe(true)
    expect(effectiveCost(accept(a, { targetInstanceId: 'x' }), 'player', F.EV3)).toBe(1)
  })

  it('Jabba the Hutt (SEC_002) has a damaged friendly unit deal 1, or 2 with 3 damage, to an enemy; deployed another friendly unit that survives damage may deal that much, once each round', () => {
    const s = front('SEC_002', { units: [unit('d3', 'GRD', { damage: 3 }), unit('d1', 'GRD', { damage: 1 }), unit('x', 'GRD')] }, { units: [unit('e', 'TOUGH')] })
    const used = use(s)
    expect(unitOffers(used)).toEqual(['d1', 'd3'])
    const hard = accept(used, { targetInstanceId: 'd3' })
    expect(unitOffers(hard)).toEqual(['e'])
    expect(U(accept(hard, { targetInstanceId: 'e' }), 'e')!.damage).toBe(2)
    expect(U(accept(accept(use(s), { targetInstanceId: 'd1' }), { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
    const d = back('SEC_002', { units: [unit('g', 'GRD')] }, { units: [unit('e', 'TOUGH')] })
    const hit = dealDamageToUnit(d, 'g', 3)
    expect(unitOffers(hit)).toEqual(['e'])
    expect(declinable(hit)).toBe(true)
    const dealt = accept(hit, { targetInstanceId: 'e' })
    expect(U(dealt, 'e')!.damage).toBe(3)
    noChoice(dealDamageToUnit(dealt, 'g', 1))
    noChoice(dealDamageToUnit(d, 'L', 1))
    expect(choice(dealDamageToUnit(skip(hit), 'g', 1)).kind).toBe('selectUnitThen')
  })
})
