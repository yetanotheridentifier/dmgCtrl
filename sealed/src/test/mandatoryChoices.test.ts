import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { makeBeamAi } from '../ai/search'
import { BEAM_REPLY_LIMITS } from '../ai/greedyAi'
import { evaluate } from '../ai/evaluate'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EffectContext } from '../engine/abilities'
import type { GameState, PendingChoice, PhaseEvents, UnitState } from '../engine/types'

/**
 * Whether a choice can be declined is a property of the card, not of the kind. A card that prints
 * "may" offers a decline; one that does not must take a legal target, even when the only one is the
 * player's own unit. These kinds are shared by both sorts of card, so each card states which it is.
 */

const F = {
  ...CARDS,
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  STRONG: card({ id: 'STRONG', arena: 'ground', cost: 4, power: 4, hp: 6 }),
  ZERO: card({ id: 'ZERO', arena: 'ground', cost: 1, power: 0, hp: 2 }),
  IMP: card({ id: 'IMP', arena: 'ground', cost: 3, power: 2, hp: 6, traits: ['IMPERIAL'] }),
  KW: card({ id: 'KW', arena: 'ground', cost: 2, power: 2, hp: 6, keywords: [{ name: 'Sentinel' }] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 0, hp: 0 }),
  SOR_078: card({ id: 'SOR_078', type: 'event', cost: 1 }),
}

const upgraded = (id: string, cardId: string, owner: 'player' | 'opponent') => unit(id, cardId, { upgrades: [{ cardId: 'UPG', owner }] })
const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, leaderLeftPlay: [], played: { player: [], opponent: [] },
  ...over,
})
const board = (mine: UnitState[], theirs: UnitState[], over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: player({ units: mine }), opponent: player({ units: theirs }) }, ...over })

/** Run one of a card's registered effects directly, as the player, sourced from the unit `src`. */
const fire = (s: GameState, cardId: string, from: 'abilities' | 'actionAbilities' = 'abilities', index = 0, ctx: Partial<EffectContext> = {}) => {
  const ability = getCardDefinition(cardId)?.[from]?.[index]
  if (!ability) throw new Error(`${cardId} has no ${from}[${index}]`)
  return ability.effect(s, { owner: 'player', cardId, sourceInstanceId: 'src', ...ctx })
}
const raised = (s: GameState, kind: PendingChoice['kind']): PendingChoice => {
  const c = (s.pendingChoices ?? []).find(x => x.kind === kind)
  expect(c, `a ${kind} choice is raised`).toBeDefined()
  return c!
}
const declinable = (s: GameState, c: PendingChoice) => legalMoves(s).some(m => m.type === 'skipTrigger' && m.choiceId === c.id)

type Row = {
  id: string
  text: string
  kind: PendingChoice['kind']
  may: boolean
  s: GameState
  from?: 'abilities' | 'actionAbilities'
  index?: number
  ctx?: Partial<EffectContext>
}

const rows: Row[] = [
  // Printed with "may": a decline is offered.
  { id: 'ASH_004', text: 'Thrawn (deployed) On Attack: you may defeat a non-leader unit', kind: 'selectUnitToDefeat', may: true, s: board([unit('src', 'GRD'), unit('a', 'GRD')], [unit('e', 'GRD')]) },
  { id: 'ASH_043', text: 'Corona Four When Defeated: you may defeat a non-leader unit with 0 power', kind: 'selectUnitToDefeat', may: true, index: 1, s: board([], [unit('z', 'ZERO')]) },
  { id: 'ASH_092', text: 'Foundling Rescue: you may defeat a unit with 2 or less remaining HP', kind: 'selectUnitToDefeat', may: true, s: board([], [unit('z', 'ZERO')]) },
  { id: 'ASH_003', text: 'Baylan Skoll (deployed) On Attack: you may give a lone unit +2/+2 and Sentinel', kind: 'mayLastingBuff', may: true, s: board([unit('a', 'GRD')], []) },
  { id: 'ASH_009', text: 'Ahsoka Tano (deployed) On Attack: you may give a weaker unit +2/+0', kind: 'mayLastingBuff', may: true, s: board([unit('src', 'STRONG')], [unit('e', 'GRD')]) },
  { id: 'ASH_043', text: 'Corona Four On Attack: you may give a unit -2/-0', kind: 'mayLastingBuff', may: true, s: board([], [unit('e', 'GRD')]) },
  { id: 'ASH_056', text: 'Huyang On Attack: you may give an upgraded unit -4/-0', kind: 'mayLastingBuff', may: true, s: board([], [upgraded('e', 'GRD', 'opponent')]) },
  { id: 'ASH_209', text: 'Ezra Bridger On Attack: you may give a unit -3/-0', kind: 'mayLastingBuff', may: true, s: board([upgraded('src', 'GRD', 'player')], [unit('e', 'GRD')]) },
  { id: 'ASH_127', text: 'The Twins: you may give another friendly unit Sentinel', kind: 'mayLastingBuff', may: true, s: board([unit('src', 'GRD'), unit('a', 'GRD')], []) },
  { id: 'ASH_050', text: 'Morgan Elsbeth When Defeated: you may give a unit -2/-2', kind: 'mayLastingBuff', may: true, s: board([], [unit('e', 'GRD')]) },
  { id: 'ASH_016', text: 'Shin Hati (deployed): you may exhaust a cheaper unit', kind: 'mayExhaustUnit', may: true, s: board([unit('src', 'GRD')], [unit('e', 'GRD')]), ctx: { combatDamageToBase: 3 } },
  { id: 'ASH_051', text: 'Reinforcing Light Cruiser: you may exhaust a unit', kind: 'mayExhaustUnit', may: true, s: board([], [unit('e', 'GRD')]) },
  { id: 'ASH_214', text: 'Amnesty Officer: you may exhaust a unit with a keyword', kind: 'mayExhaustUnit', may: true, s: board([], [unit('e', 'KW')]) },
  { id: 'ASH_208', text: 'Sabine Wren: you may exhaust a ground unit', kind: 'mayExhaustUnit', may: true, s: board([], [unit('e', 'GRD')]) },
  { id: 'ASH_039', text: 'Baylan Skoll (unit): you may exhaust a unit', kind: 'mayExhaustUnit', may: true, s: board([], [unit('e', 'GRD')], { phaseEvents: phaseEvents({ upgradesDefeated: ['player'] }) }) },
  { id: 'ASH_042', text: "Jabba the Hutt: you may return an upgrade to its owner's hand", kind: 'selectUpgradeToReturn', may: true, s: board([], [upgraded('e', 'GRD', 'opponent')]) },

  // Printed without "may": no decline.
  { id: 'ASH_067', text: 'Get Lost: defeat an upgraded non-leader unit', kind: 'selectUnitToDefeat', may: false, s: board([], [upgraded('e', 'GRD', 'opponent')]) },
  { id: 'ASH_103', text: 'Long Live the Empire: defeat a friendly Imperial unit', kind: 'selectUnitToDefeat', may: false, s: board([unit('i', 'IMP')], []) },
  { id: 'ASH_247', text: 'One Must Destroy to Create: defeat a friendly non-leader unit', kind: 'selectUnitToDefeat', may: false, s: board([unit('a', 'GRD')], []) },
  { id: 'ASH_188', text: 'Galvanized Leap: ready a unit that was damaged this phase', kind: 'selectUnitToReady', may: false, s: board([unit('a', 'GRD', { exhausted: true })], [], { phaseEvents: phaseEvents({ damagedUnits: ['a'] }) }) },
  { id: 'ASH_200', text: 'Rehabilitation: choose a non-leader unit and take control of it', kind: 'selectUnitToSteal', may: false, s: board([], [unit('e', 'GRD')]) },
  { id: 'ASH_139', text: 'Hold Them Off: choose a friendly unit', kind: 'selectDistributeSource', may: false, s: board([unit('a', 'GRD')], []) },
  { id: 'ASH_109', text: 'T-6 Shuttle 1974 action: give another unit +2/+2', kind: 'mayLastingBuff', may: false, from: 'actionAbilities', s: board([unit('src', 'GRD')], [unit('e', 'GRD')]) },
  { id: 'ASH_136', text: 'Display of Strength: give a unit +3/+3', kind: 'mayLastingBuff', may: false, s: board([], [unit('e', 'GRD')]) },
  { id: 'ASH_115', text: 'The Student Guides the Master: give a friendly unit +1/+0 per weaker friendly unit', kind: 'mayLastingBuff', may: false, s: board([unit('a', 'GRD')], []) },
  { id: 'ASH_232', text: "Full of Surprises: return an upgrade that costs 2 or less to its owner's hand", kind: 'selectUpgradeToReturn', may: false, s: board([], [upgraded('e', 'GRD', 'opponent')]) },
]

describe('a decline is offered exactly where the card prints "may"', () => {
  it.each(rows.map(r => [r.id, r.text, r] as const))('%s %s', (_id, _text, r) => {
    const after = fire(r.s, r.id, r.from, r.index, r.ctx)
    expect(declinable(after, raised(after, r.kind))).toBe(r.may)
  })
})

describe('follow-ups raised while answering a mandatory card stay mandatory', () => {
  it("Mayor's Majordomo (ASH_217): having discarded, it must exhaust a unit", () => {
    const s = state({ cards: F, players: { player: player({ hand: ['GRD'], units: [unit('src', 'GRD')] }), opponent: player({ units: [unit('e', 'GRD')] }) } })
    const asked = fire(s, 'ASH_217', 'actionAbilities')
    const discarded = resolve(asked, { type: 'acceptChoice', choiceId: raised(asked, 'selectDiscard').id, handIndex: 0 })
    expect(declinable(discarded, raised(discarded, 'mayExhaustUnit'))).toBe(false)
  })

  it('Far Far Away (ASH_236): having returned a friendly unit, it must return an enemy unit', () => {
    const asked = fire(board([unit('a', 'GRD')], [unit('e', 'GRD')]), 'ASH_236')
    const returned = resolve(asked, { type: 'acceptChoice', choiceId: raised(asked, 'returnFriendlyUnit').id, targetInstanceId: 'a' })
    expect(declinable(returned, raised(returned, 'selectUnitToReturn'))).toBe(false)
  })
})

describe('each kind is mandatory unless the card marks it optional', () => {
  const s = board([upgraded('a', 'GRD', 'player')], [])
  const base = { id: 'c', controller: 'player' as const }
  const kinds: PendingChoice[] = [
    { ...base, kind: 'selectUnitToDefeat', targets: ['a'] },
    { ...base, kind: 'selectUnitToReady', targets: ['a'] },
    { ...base, kind: 'selectUnitToReturn', targets: ['a'] },
    { ...base, kind: 'selectUnitToSteal', targets: ['a'] },
    { ...base, kind: 'selectDistributeSource', targets: ['a'] },
    { ...base, kind: 'mayLastingBuff', targets: ['a'], power: 1 },
    { ...base, kind: 'mayExhaustUnit', targets: ['a'] },
    { ...base, kind: 'selectUpgradeToReturn', candidates: [{ unitId: 'a', upgradeIndex: 0, cardId: 'UPG' }] },
  ]
  const skips = (c: PendingChoice) => legalMoves({ ...s, pendingChoices: [c] }).filter(m => m.type === 'skipTrigger')

  it.each(kinds.map(c => [c.kind, c] as const))('%s', (_kind, c) => {
    expect(skips(c), 'no decline by default').toHaveLength(0)
    expect(skips({ ...c, optional: true } as PendingChoice), 'a decline when optional').toHaveLength(1)
  })

  it('multiPick keeps its Done: every card using it reads "up to" or "any number", so zero picks is legal', () => {
    expect(skips({ ...base, kind: 'multiPick', targets: ['a'], spec: { mode: 'exhaust', remaining: 2 } })).toHaveLength(1)
  })
})

describe('the AI answers a choice it cannot decline', () => {
  // Vanquish with only our own non-leader unit on the board: the rules make us defeat it.
  const withVanquish = () => state({ cards: F, players: { player: player({ resources: ready(5), hand: ['SOR_078'], units: [unit('a', 'STRONG')] }), opponent: player() } })
  const ai = makeBeamAi(evaluate, { ...BEAM_REPLY_LIMITS, nodes: 200_000 })

  it('defeats its own unit when that is the only legal target', () => {
    const played = resolve(withVanquish(), { type: 'playEvent', handIndex: 0 })
    const c = raised(played, 'selectUnitToDefeat')
    expect(legalMoves(played)).toEqual([{ type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'a' }])
    const chosen = ai(played)
    expect(chosen).toEqual(legalMoves(played)[0])
    const done = resolve(played, chosen!)
    expect(done.players.player.units).toHaveLength(0)
    expect(done.pendingChoices ?? []).toHaveLength(0)
  })

  it('still decides the turn the event could be played, pricing the forced defeat without stalling', () => {
    const s = withVanquish()
    const chosen = ai(s)
    expect(chosen).not.toBeNull()
    expect(legalMoves(s)).toContainEqual(chosen)
  })
})
