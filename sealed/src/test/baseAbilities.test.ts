import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
import { unitHasKeyword } from '../engine/keywords'
import { effectivePower, effectiveHp } from '../engine/stats'
import { initGame } from '../engine/initGame'
import { parseProtectThePod, minimumDeckSize } from '../utils/parseProtectThePod'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState } from '../engine/types'

/**
 * Bases with an ability. A base is never played and never leaves play, so its ability hangs off the
 * base card in the player's base zone: an Epic Action its controller may take once per game, a
 * constant aura over units in play, or a change to how the game is set up.
 *
 * Each test states what may be chosen as well as what happens, since a filter that let everything
 * through would still pass a test that only picks the right target. Printed text and stats come from
 * the shipped set fixtures.
 */

/** A: Epic Actions that pick a target, a card or a pile. */
const GROUP_A = ['SOR_019', 'SOR_025', 'SOR_028', 'LAW_023', 'LAW_026']
/** B: Epic Actions that play a unit, or repeat for each friendly leader unit. */
const GROUP_B = ['SOR_022', 'TS26_10', 'TS26_11']
/** C: constants — an aura over units in play, and the two that change how the game is set up. */
const GROUP_C = ['TWI_019', 'TWI_028', 'JTL_021', 'JTL_024', 'JTL_025']
/** D: the eight LAW bases that play a card of any type from hand, waiving one of four penalties. */
const GROUP_D = ['LAW_020', 'LAW_021', 'LAW_022', 'LAW_024', 'LAW_025', 'LAW_027', 'LAW_028', 'LAW_030']

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
  ...Object.fromEntries([...GROUP_A, ...GROUP_B, ...GROUP_C, ...GROUP_D].map(id => [id, real(id)])),
  // Two unprovided icons of the four the LAW bases name, so waiving exactly one is visible, and one
  // icon they do not name, so the waiver is shown to be selective rather than blanket.
  TWOICON: card({ id: 'TWOICON', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, aspects: ['Aggression', 'Cunning'] }),
  VILLAIN: card({ id: 'VILLAIN', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, aspects: ['Villainy'] }),
  HEROEV: card({ id: 'HEROEV', type: 'event', cost: 1, aspects: ['Command'] }),
  LAW_163: real('LAW_163'), // The Sarlacc of Carkoon, the card Great Pit of Carkoon searches for
  GRD: src('GRD'),
  GRD2: src('GRD2'),
  BIG: src('BIG', { cost: 6, power: 5 }),
  PRICEY: src('PRICEY', { cost: 7 }),
  EV: card({ id: 'EV', type: 'event', cost: 1 }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
type Side = Parameters<typeof player>[0]
/** A board whose player's base is `baseId`; both sides hold resources so nothing is gated on cost. */
const board = (baseId: string, mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(10), deck: [], base: { cardId: baseId, damage: 0 }, ...mine }),
      opponent: player({ resources: ready(10), deck: [], ...theirs }),
    },
    ...over,
  })

const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; deckIndex?: number; baseTarget?: PlayerId }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const targetsOf = (c: PendingChoice): string[] => ('targets' in c ? c.targets : 'unitTargets' in c ? c.unitTargets : []) as string[]
/** True when the base's Epic Action is on offer to the active player. */
const offered = (s: GameState): boolean => legalMoves(s).some(m => m.type === 'useBaseAbility')
const useBase = (s: GameState) => resolve(s, { type: 'useBaseAbility' })

describe('base abilities: the scope', () => {
  it('registers a base ability for every shipped base', () => {
    for (const id of [...GROUP_A, ...GROUP_B, ...GROUP_C, ...GROUP_D]) expect(getCardDefinition(id)?.baseAbilities, id).toBeTruthy()
  })
})

/**
 * D: "Epic Action: Play a card from your hand, ignoring 1 of its Vigilance, Command, Aggression, or
 * Cunning aspect penalties." Eight bases print exactly this, so it is one registration repeated and
 * the behaviour is tested once per group with each base checked to carry it.
 *
 * Waiving "1 of" four named penalties needs no pick from the player: each aspect penalty is a flat 2
 * resources (CR 8.1), so whichever of the four is forgiven the card costs the same 2 less. A card
 * with two of them unprovided still pays for the second.
 */
describe('base Epic Actions, D: play a card from hand, waiving one aspect penalty', () => {
  // The player's leader provides Command + Heroism; each base below provides its own one icon.
  // `useBase` is deliberately not called in the loop: the lint rule for React hooks reads any
  // `use…` call inside one as a hook, so the action is taken inline here.
  it.each(GROUP_D)('%s offers the same play', id => {
    const s = board(id, { hand: ['TWOICON'] })
    expect(offered(s)).toBe(true)
    expect(choice(resolve(s, { type: 'useBaseAbility' }))).toMatchObject({ kind: 'playCardFrom', zone: 'hand' })
  })

  it('plays the card 2 cheaper, waiving one of the four penalties and no more', () => {
    // TWOICON costs 1 with Aggression and Cunning both unprovided: 1 + 2 + 2 = 5, one waived = 3.
    const s = board('LAW_020', { hand: ['TWOICON'], resources: ready(3) })
    const done = accept(useBase(s), { optionIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'TWOICON')).toBe(true)
    expect(done.players.player.resources.filter(r => !r.exhausted)).toHaveLength(0)
  })

  it('waives none of a penalty the card does not name', () => {
    // VILLAIN costs 1 + 2 for its unprovided Villainy, which is not one of the four.
    const s = board('LAW_020', { hand: ['VILLAIN'], resources: ready(3) })
    const done = accept(useBase(s), { optionIndex: 0 })
    expect(done.players.player.resources.filter(r => !r.exhausted), '3 − 3').toHaveLength(0)
  })

  it('plays a card of any type, an event included', () => {
    const s = board('LAW_025', { hand: ['HEROEV'] })
    const done = accept(useBase(s), { optionIndex: 0 })
    expect(done.players.player.discard).toContain('HEROEV')
  })

  it('is not offered with an empty hand, and spends the once-a-game Epic Action', () => {
    expect(offered(board('LAW_020', { hand: [] }))).toBe(false)
    const done = accept(useBase(board('LAW_020', { hand: ['TWOICON'] })), { optionIndex: 0 })
    expect(done.players.player.base.epicActionUsed).toBe(true)
  })
})

describe('base Epic Actions, A: targets, cards and piles', () => {
  it('Security Complex (SOR_019) gives a Shield token to a non-leader unit of either player', () => {
    const s = board('SOR_019', { units: [unit('mine', 'GRD')] }, { units: [unit('theirs', 'GRD2'), unit('boss', 'GRD', { isLeader: true })] })
    expect(offered(s)).toBe(true)
    const raised = useBase(s)
    expect(choice(raised)).toMatchObject({ kind: 'mayGiveTokens', controller: 'player' })
    expect(targetsOf(choice(raised)).sort()).toEqual(['mine', 'theirs'])
    const done = accept(raised, { targetInstanceId: 'theirs' })
    expect(done.players.opponent.units.find(u => u.instanceId === 'theirs')!.upgrades).toHaveLength(1)
  })

  it('Security Complex is not offered when every unit in play is a leader unit', () => {
    expect(offered(board('SOR_019', { units: [unit('boss', 'GRD', { isLeader: true })] }))).toBe(false)
  })

  it('Tarkintown (SOR_025) deals 3 damage to a damaged non-leader unit', () => {
    const s = board('SOR_025',
      { units: [unit('hurt', 'GRD', { damage: 1 }), unit('whole', 'GRD2')] },
      { units: [unit('theirHurt', 'GRD', { damage: 2 }), unit('boss', 'GRD', { isLeader: true, damage: 3 })] })
    const raised = useBase(s)
    expect(choice(raised)).toMatchObject({ kind: 'selectDamageTarget', amount: 3, baseTargets: [] })
    expect(targetsOf(choice(raised)).sort()).toEqual(['hurt', 'theirHurt'])
    const done = accept(raised, { targetInstanceId: 'theirHurt' })
    expect(done.players.opponent.units.find(u => u.instanceId === 'theirHurt')!.damage).toBe(5)
  })

  it('Tarkintown is not offered when no damaged non-leader unit is in play', () => {
    expect(offered(board('SOR_025', { units: [unit('whole', 'GRD')] }))).toBe(false)
  })

  it('Jedha City (SOR_028) gives a non-leader unit -4/-0 for this phase', () => {
    const s = board('SOR_028', { units: [unit('mine', 'GRD')] }, { units: [unit('boss', 'GRD', { isLeader: true })] })
    const raised = useBase(s)
    expect(choice(raised)).toMatchObject({ kind: 'mayLastingBuff', power: -4, targets: ['mine'] })
    const done = accept(raised, { targetInstanceId: 'mine' })
    expect(done.lastingEffects?.some(e => e.targetInstanceId === 'mine' && e.power === -4)).toBe(true)
  })

  it('Great Pit of Carkoon (LAW_023) discards a unit from hand to draw The Sarlacc of Carkoon', () => {
    const s = board('LAW_023', { hand: ['EV', 'GRD'], deck: ['GRD2', 'LAW_163', 'BIG'] })
    expect(offered(s)).toBe(true)
    const cost = useBase(s)
    // The cost picks a unit from hand: the event is not a legal way to pay it.
    expect(choice(cost)).toMatchObject({ kind: 'selectHandCardThen', controller: 'player', handIndices: [1] })
    const searching = accept(cost, { handIndex: 1 })
    expect(searching.players.player.discard).toEqual(['GRD'])
    expect(choice(searching)).toMatchObject({ kind: 'searchDraw', revealed: ['GRD2', 'LAW_163', 'BIG'], eligibleIndices: [1] })
    const done = accept(searching, { deckIndex: 1 })
    expect(done.players.player.hand).toEqual(['EV', 'LAW_163'])
    expect(done.players.player.deck).toEqual(['GRD2', 'BIG'])
  })

  it('Great Pit of Carkoon is not offered with no unit in hand', () => {
    expect(offered(board('LAW_023', { hand: ['EV'], deck: ['LAW_163'] }))).toBe(false)
  })

  it('Shipbreaking Yard (LAW_026) discards 3 from the deck and may return one to the top', () => {
    const s = board('LAW_026', { deck: ['GRD', 'GRD2', 'EV', 'BIG'] })
    const raised = useBase(s)
    expect(raised.players.player.discard).toEqual(['GRD', 'GRD2', 'EV'])
    expect(raised.players.player.deck).toEqual(['BIG'])
    expect(choice(raised)).toMatchObject({ kind: 'selectCardThen', controller: 'player', candidates: ['GRD', 'GRD2', 'EV'], optional: true })
    const returned = accept(raised, { optionIndex: 1 })
    expect(returned.players.player.deck).toEqual(['GRD2', 'BIG'])
    expect(returned.players.player.discard).toEqual(['GRD', 'EV'])
    // Declining leaves all three in the discard pile.
    expect(skip(raised).players.player.discard).toEqual(['GRD', 'GRD2', 'EV'])
  })
})

describe('base Epic Actions, B: playing a unit, and once for each friendly leader unit', () => {
  it('Energy Conversion Lab (SOR_022) plays a unit costing 6 or less, which gains Ambush', () => {
    const s = board('SOR_022', { hand: ['BIG', 'PRICEY', 'EV'] }, { units: [unit('theirs', 'GRD2')] })
    expect(offered(s)).toBe(true)
    const raised = useBase(s)
    // The 7-cost unit and the event are not candidates.
    expect(choice(raised)).toMatchObject({ kind: 'playUnitFromHand', candidates: [{ handIndex: 0, cardId: 'BIG' }], costDelta: 0 })
    const done = accept(raised, { handIndex: 0 })
    const played = done.players.player.units.find(u => u.cardId === 'BIG')!
    expect(unitHasKeyword(done, played, 'Ambush')).toBe(true)
  })

  it('Energy Conversion Lab is not offered with no affordable unit of 6 or less in hand', () => {
    expect(offered(board('SOR_022', { hand: ['PRICEY', 'EV'] }))).toBe(false)
  })

  it("Dooku's Palace (TS26_10) plays a unit for 1 less for each friendly leader unit", () => {
    const withLeaders = (n: number) => board('TS26_10', {
      hand: ['BIG'],
      resources: ready(10),
      units: Array.from({ length: n }, (_, i) => unit(`boss${i}`, 'GRD', { isLeader: true })),
    })
    expect(choice(useBase(withLeaders(0)))).toMatchObject({ kind: 'playUnitFromHand', costDelta: 0 })
    expect(choice(useBase(withLeaders(1)))).toMatchObject({ kind: 'playUnitFromHand', costDelta: -1 })
    const done = accept(useBase(withLeaders(2)), { handIndex: 0 })
    // BIG costs 6, so two leader units make it 4.
    expect(done.players.player.resources.filter(r => r.exhausted)).toHaveLength(4)
  })

  it("Executioner's Arena (TS26_11) may deal 2 damage to a unit for each friendly leader unit", () => {
    const s = board('TS26_11', { units: [unit('boss', 'GRD', { isLeader: true })] }, { units: [unit('theirs', 'GRD2')] })
    const raised = useBase(s)
    expect(choice(raised)).toMatchObject({ kind: 'selectUnitThen', controller: 'player', optional: true })
    expect(targetsOf(choice(raised)).sort()).toEqual(['boss', 'theirs'])
    const done = accept(raised, { targetInstanceId: 'theirs' })
    expect(done.players.opponent.units.find(u => u.instanceId === 'theirs')!.damage).toBe(2)
    expect(done.pendingChoices ?? []).toHaveLength(0)
    expect(skip(raised).players.opponent.units[0].damage).toBe(0)
  })

  it("Executioner's Arena asks again for a second leader unit, re-reading what is in play", () => {
    const s = board('TS26_11',
      { units: [unit('boss', 'GRD', { isLeader: true }), unit('boss2', 'GRD', { isLeader: true })] },
      { units: [unit('frail', 'GRD2', { damage: 7 })] })
    const first = accept(useBase(s), { targetInstanceId: 'frail' })
    // The first 2 damage defeated it, so the second offer no longer names it.
    expect(first.players.opponent.units).toHaveLength(0)
    expect(targetsOf(choice(first)).sort()).toEqual(['boss', 'boss2'])
  })

  it("Executioner's Arena is not offered without a friendly leader unit", () => {
    expect(offered(board('TS26_11', {}, { units: [unit('theirs', 'GRD2')] }))).toBe(false)
  })
})

describe('base constants, C: auras and setup', () => {
  const printed = (cardId: string) => ({ power: F[cardId].power ?? 0, hp: F[cardId].hp ?? 0 })
  const auraBoard = (baseId: string) => board(baseId,
    { units: [unit('boss', 'GRD', { isLeader: true }), unit('mine', 'GRD2')] },
    { units: [unit('theirBoss', 'GRD', { isLeader: true })] })

  it('Pau City (TWI_019) gives each leader unit its controller has +0/+1', () => {
    const s = auraBoard('TWI_019')
    const mine = s.players.player.units
    expect(effectiveHp(s, mine[0])).toBe(printed('GRD').hp + 1)
    expect(effectivePower(s, mine[0])).toBe(printed('GRD').power)
    expect(effectiveHp(s, mine[1])).toBe(printed('GRD2').hp) // not a leader unit
    expect(effectiveHp(s, s.players.opponent.units[0])).toBe(printed('GRD').hp) // the enemy leader unit is not "yours"
  })

  it('Petranaki Arena (TWI_028) gives each leader unit its controller has +1/+0', () => {
    const s = auraBoard('TWI_028')
    const mine = s.players.player.units
    expect(effectivePower(s, mine[0])).toBe(printed('GRD').power + 1)
    expect(effectiveHp(s, mine[0])).toBe(printed('GRD').hp)
    expect(effectivePower(s, mine[1])).toBe(printed('GRD2').power)
    expect(effectivePower(s, s.players.opponent.units[0])).toBe(printed('GRD').power)
  })

  it('Colossus (JTL_021) draws 1 less card in its controller\'s starting hand, and only theirs', () => {
    const deckOf = (base: string) => ({ name: base, leader: 'TST_L', base, cards: [{ id: 'GRD', count: 30 }] })
    const s = initGame(deckOf('JTL_021'), deckOf('TST_B'), F, { firstPlayer: 'player', shuffle: <T,>(a: T[]) => a })
    expect(s.players.player.hand).toHaveLength(5)
    expect(s.players.player.deck).toHaveLength(25)
    expect(s.players.opponent.hand).toHaveLength(6)
  })

  it('Data Vault (JTL_024) raises its deck minimum by 10, and Thermal Oscillator (JTL_025) lowers it by 5', () => {
    expect(minimumDeckSize('TST_B')).toBe(30)
    expect(minimumDeckSize('JTL_024')).toBe(40)
    expect(minimumDeckSize('JTL_025')).toBe(25)
  })

  it('a deck is only as short as its base allows', () => {
    const deckJson = (base: string, count: number) => JSON.stringify({ leader: 'SOR_010', base, deck: [{ id: 'SOR_100', count }] })
    expect(parseProtectThePod(deckJson('JTL_024', 30))).toEqual({ ok: false, error: 'too-few-cards' })
    expect(parseProtectThePod(deckJson('JTL_024', 40)).ok).toBe(true)
    expect(parseProtectThePod(deckJson('JTL_025', 25)).ok).toBe(true)
    expect(parseProtectThePod(deckJson('JTL_025', 24))).toEqual({ ok: false, error: 'too-few-cards' })
  })
})

describe('an Epic Action on a base', () => {
  const withUnit = () => board('SOR_025', { units: [unit('hurt', 'GRD', { damage: 1 })] })

  it('can be used only once each game, and passes the turn like any other action', () => {
    const used = accept(useBase(withUnit()), { targetInstanceId: 'hurt' })
    expect(used.players.player.base.epicActionUsed).toBe(true)
    expect(offered({ ...used, activePlayer: 'player' })).toBe(false)
    expect(used.activePlayer).toBe('opponent')
  })

  it('belongs to its own controller: the opponent is never offered it', () => {
    const s = { ...withUnit(), activePlayer: 'opponent' as PlayerId }
    expect(offered(s)).toBe(false)
  })

  it('is not offered outside the action phase', () => {
    expect(offered({ ...withUnit(), phase: 'regroup' })).toBe(false)
  })
})
