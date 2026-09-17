import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
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
/** Scoped by the triage but lifted out to the ticket that owns their blocker. */
const LIFTED = ['LAW_020', 'LAW_021', 'LAW_022', 'LAW_024', 'LAW_025', 'LAW_027', 'LAW_028', 'LAW_030', 'TS26_12']

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
  ...Object.fromEntries(GROUP_A.map(id => [id, real(id)])),
  LAW_163: real('LAW_163'), // The Sarlacc of Carkoon, the card Great Pit of Carkoon searches for
  GRD: src('GRD'),
  GRD2: src('GRD2'),
  BIG: src('BIG', { cost: 6, power: 5 }),
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
  it('registers a base ability for every shipped base and none for the lifted ones', () => {
    for (const id of GROUP_A) expect(getCardDefinition(id)?.baseAbilities, id).toBeTruthy()
    for (const id of LIFTED) expect(getCardDefinition(id), id).toBeUndefined()
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
