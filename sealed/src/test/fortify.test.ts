import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves, effectiveCost } from '../engine/legalMoves'
import { effectivePower } from '../engine/stats'
import { unitKeywordValue, unitHasKeyword } from '../engine/keywords'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
import { defeatUnit } from '../engine/combat'
import { createTokenUnit, dealDamageToBase, releaseCaptured } from '../engine/effects'
import { TOKEN_BATTLE_DROID } from '../engine/tokenUnits'
import { evaluate } from '../ai/evaluate'
import { triage } from '../bench/triage'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState, UpgradeAttachment } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Fortify: upgrades attached to a base, and the Homeworlds cards that play or read them.
 *
 * Fortify's reminder text is the whole rule: "Attach this to your base, not a unit." (the publisher's card
 * list; the comprehensive rules predate it). So a Fortify upgrade is played onto its player's own base and
 * never onto a unit. What it does there is the ability printed on it, most often "Attached base gains: ...",
 * which makes the upgrade's ability the base's: a constant, a triggered ability or an action, belonging to
 * the base's controller.
 */

const SHIPPED = [
  'HMW_004', 'HMW_037', 'HMW_061', 'HMW_066', 'HMW_070', 'HMW_081', 'HMW_095', 'HMW_112', 'HMW_113', 'HMW_126',
  'HMW_160', 'HMW_172', 'HMW_205', 'HMW_206', 'HMW_260', 'HMW_270', 'HMW_271',
  // Touched by the ticket for a one-off trigger head, which ships with them.
  'HMW_171', 'HMW_216',
]
// Beast Lair (HMW_147) is covered in `hmwEventsLeaders.test.ts`, and Vice Admiral Rampart (HMW_060), who
// stands in for a base upgrade's defeat, in `replacementEffects.test.ts`.

/**
 * Cards from other sets that pick an upgrade, for whether they see one on a base: "an upgrade" and "a
 * friendly upgrade" do; "an upgrade on a unit", "attached to a unit" and "on a friendly unit" do not.
 */
const PICKERS = [
  'SOR_251', // Confiscate: "Defeat an upgrade."
  'SOR_162', // Disabling Fang Fighter: "You may defeat an upgrade."
  'ASH_246', // Exploit Advantage: "Defeat a friendly upgrade. If you do, draw 2 cards."
  'SEC_200', // Junior Senator: "You may return an upgrade that costs 3 or less to its owner's hand."
  'ASH_042', // Jabba the Hutt: "You may return an upgrade to its owner's hand. If it's returned to your hand, you may play it for free."
  'JTL_175', // System Shock: "Defeat a non-leader upgrade attached to a unit."
  'ASH_090', // Reforge: "Defeat an upgrade on a friendly unit."
  'SHD_077', // Evidence of the Crime: "Take control of an upgrade ... and attach it to an eligible unit"
  'LOF_248', // Jocasta Nu: "attach a friendly upgrade on a friendly unit to a different eligible unit"
]

const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = poolFor([set]).find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 8, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries([...SHIPPED, ...PICKERS].map(id => [id, real(id)])),
  GRD: src('GRD'),
  SPC: src('SPC', { arena: 'space' }),
  BIG: src('BIG', { power: 4 }),
  VEH: src('VEH', { traits: ['VEHICLE'] }),
  AGG: src('AGG', { aspects: ['Aggression'] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1, aspects: ['Aggression'] }),
  // A Vigilance/Villainy base, so Tarkin's own cards carry no penalty and others do.
  VIL_B: card({ id: 'VIL_B', type: 'base', hp: 30, aspects: ['Vigilance'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
const on = (cardId: string, owner: PlayerId = 'player'): UpgradeAttachment => ({ cardId, owner })
const fortified = (...cardIds: string[]) => ({ base: { cardId: 'TST_B', damage: 0, upgrades: cardIds.map(id => on(id)) } })
const theirFortified = (...cardIds: string[]) => ({ base: { cardId: 'TST_B', damage: 0, upgrades: cardIds.map(id => on(id, 'opponent')) } })
const baseUpgrades = (s: GameState, who: PlayerId = 'player') => (s.players[who].base.upgrades ?? []).map(u => u.cardId)

type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(10), deck: ['GRD', 'GRD', 'GRD', 'GRD', 'GRD'], ...mine }),
      opponent: player({ resources: ready(10), deck: ['GRD', 'GRD', 'GRD', 'GRD', 'GRD'], ...theirs }),
    },
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
const unitOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : [])))].sort()
const declinable = (s: GameState) => moves(s).some(m => m.type === 'skipTrigger')
const readyCount = (s: GameState, who: PlayerId) => s.players[who].resources.filter(r => !r.exhausted).length

const withHand = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState => {
  const p = s.players[who]
  return { ...s, activePlayer: who, players: { ...s.players, [who]: { ...p, hand: [...p.hand, cardId] } } }
}
const fortify = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState =>
  resolve(withHand(s, cardId, who), { type: 'playBaseUpgrade', handIndex: s.players[who].hand.length })
const play = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState =>
  resolve(withHand(s, cardId, who), { type: 'playUnit', handIndex: s.players[who].hand.length })
const playEvent = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState =>
  resolve(withHand(s, cardId, who), { type: 'playEvent', handIndex: s.players[who].hand.length })
/** An upgrade on each unit and on each base: the player's unit `m` and base, the opponent's unit `t` and base. */
const mixed = (mine: Side = {}) => board(
  { units: [unit('m', 'GRD', { upgrades: [on('UPG')] })], ...fortified('HMW_113'), ...mine },
  { units: [unit('t', 'GRD', { upgrades: [on('UPG', 'opponent')] })], ...theirFortified('HMW_271') },
)
/** The card ids an upgrade pick offers, sorted. */
const offered = (s: GameState): string[] => (choice(s) as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId).sort()
const useBase = (s: GameState, cardId: string, index = 0) => resolve(s, { type: 'useBaseAbility', cardId, index })
const baseActionOffered = (s: GameState, cardId: string) => moves(s).some(m => m.type === 'useBaseAbility' && m.cardId === cardId)
/** Both players pass: the action phase ends and the regroup phase starts. */
const toRegroup = (s: GameState): GameState => resolve({ ...s, consecutivePasses: 1 }, { type: 'pass' })

describe('Fortify: the mechanic', () => {
  it('registers every shipped card', () => {
    for (const id of SHIPPED) expect(getCardDefinition(id), id).toBeDefined()
  })

  it('plays a Fortify upgrade onto your own base and never onto a unit', () => {
    const s = withHand(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_271')
    const offered = moves(s).filter(m => 'handIndex' in m && m.handIndex === 0 && m.type !== 'resourceCard')
    expect(offered).toEqual([{ type: 'playBaseUpgrade', handIndex: 0 }])
  })

  it('pays its cost with the aspect penalty, leaves the hand, attaches to the base and passes the turn', () => {
    // Dark Sanctum costs 3 and is Vigilance/Villainy: the test leader and base provide Vigilance only.
    const s = fortify(board(), 'HMW_070')
    expect(readyCount(s, 'player')).toBe(10 - 5)
    expect(s.players.player.hand).toEqual([])
    expect(s.players.player.base.upgrades).toEqual([on('HMW_070')])
    expect(s.activePlayer).toBe('opponent')
  })

  it('is not offered when it cannot be paid for', () => {
    const s = withHand(board({ resources: ready(2) }), 'HMW_271')
    expect(moves(s).some(m => m.type === 'playBaseUpgrade')).toBe(false)
  })

  it('does not strip the keywords a base upgrade hands to units from the card, but keeps them off the card itself', () => {
    expect(F.HMW_112.keywords.map(k => k.name)).toEqual(['Fortify'])
    expect(F.HMW_126.keywords.map(k => k.name)).toEqual(['Fortify'])
    expect(F.HMW_066.keywords.map(k => k.name)).toEqual(['Shielded'])
  })

  it('is valued by the AI through what its constant does to units', () => {
    const plain = board({ units: [unit('s', 'SPC')] })
    const padded = board({ units: [unit('s', 'SPC')], ...fortified('HMW_271') })
    expect(evaluate(padded, 'player')).toBeGreaterThan(evaluate(plain, 'player'))
  })

  it('no longer blocks a card in the triage', () => {
    const r = triage([
      { Set: 'HMW', Number: '70', Name: 'Dark Sanctum', Type: 'Upgrade', Keywords: ['Fortify'], FrontText: 'Fortify (Attach this to your base, not a unit.)\nAttached base gains: "When the regroup phase starts: Draw a card and deal 2 damage to this base."' },
      { Set: 'HMW', Number: '61', Name: 'Director Krennic', Type: 'Unit', FrontText: 'On Attack: If your base is upgraded, draw a card.' },
    ])
    expect(r.triaged.map(t => t.blockers)).toEqual([[], []])
  })
})

describe('Fortify: constants on the base', () => {
  it('Landing Pad (HMW_271): friendly space units get +1/+0, and nothing else does', () => {
    const s = board({ units: [unit('s', 'SPC'), unit('g', 'GRD')], ...fortified('HMW_271') }, { units: [unit('e', 'SPC')] })
    expect(['s', 'g', 'e'].map(id => effectivePower(s, U(s, id)!))).toEqual([3, 2, 2])
  })

  it('Military Academy (HMW_112): friendly units gain Overwhelm', () => {
    const s = board({ units: [unit('g', 'GRD')], ...fortified('HMW_112') }, { units: [unit('e', 'GRD')] })
    expect([unitHasKeyword(s, U(s, 'g')!, 'Overwhelm'), unitHasKeyword(s, U(s, 'e')!, 'Overwhelm')]).toEqual([true, false])
  })

  it('Verdant Fortress (HMW_126): friendly units gain Raid 1', () => {
    const s = board({ units: [unit('g', 'GRD')], ...fortified('HMW_126') }, { units: [unit('e', 'GRD')] })
    expect([unitKeywordValue(s, U(s, 'g')!, 'Raid'), unitKeywordValue(s, U(s, 'e')!, 'Raid')]).toEqual([1, 0])
  })

  it('Alliance Shield Generator (HMW_081): prevents 5 or more damage to its base, then is defeated and draws a card', () => {
    const s = board(fortified('HMW_081'))
    const hit = dealDamageToBase(s, 'player', 5)
    expect(hit.players.player.base.damage).toBe(0)
    expect(baseUpgrades(hit)).toEqual([])
    expect(hit.players.player.discard).toEqual(['HMW_081'])
    expect(hit.players.player.hand).toHaveLength(1)
    expect(dealDamageToBase(s, 'player', 4).players.player.base.damage).toBe(4)
  })
})

describe('Fortify: cards that read a base upgrade', () => {
  it('Director Krennic (HMW_061) draws on attack only while your base is upgraded', () => {
    const attack = (s: GameState) => resolve(s, { type: 'attack', attackerId: 'k', target: { kind: 'base' } })
    expect(attack(board({ units: [unit('k', 'HMW_061')], ...fortified('HMW_271') })).players.player.hand).toHaveLength(1)
    expect(attack(board({ units: [unit('k', 'HMW_061')] })).players.player.hand).toHaveLength(0)
  })

  it('Carrion Spike (HMW_066) gets +1/+0 and Restore 1 for each upgrade on your base', () => {
    // Not Landing Pad: Carrion Spike is a space unit, so that one would add its own +1/+0.
    const two = board({ units: [unit('c', 'HMW_066')], ...fortified('HMW_113', 'HMW_070') })
    expect([effectivePower(two, U(two, 'c')!), unitKeywordValue(two, U(two, 'c')!, 'Restore')]).toEqual([5, 2])
    const none = board({ units: [unit('c', 'HMW_066')] })
    expect([effectivePower(none, U(none, 'c')!), unitKeywordValue(none, U(none, 'c')!, 'Restore')]).toEqual([3, 0])
  })

  it('Queen Amidala (HMW_260) costs 2 less while you control an upgraded base', () => {
    expect(effectiveCost(board(fortified('HMW_271')), 'player', F.HMW_260)).toBe(2)
    expect(effectiveCost(board(), 'player', F.HMW_260)).toBe(4)
  })

  it('Wild Space Wanderer (HMW_270) may defeat an upgrade on a base, which goes to its owner\'s discard pile', () => {
    const s = play(board({}, theirFortified('HMW_271')), 'HMW_270')
    expect(declinable(s)).toBe(true)
    const done = accept(s, { optionIndex: 0 })
    expect(baseUpgrades(done, 'opponent')).toEqual([])
    expect(done.players.opponent.discard).toEqual(['HMW_271'])
    noChoice(play(board(), 'HMW_270'))
  })

  it('Wild Space Wanderer (HMW_270) offers the upgrades on both bases and none on a unit', () => {
    expect(offered(play(mixed(), 'HMW_270'))).toEqual(['HMW_113', 'HMW_271'])
  })

  it('Grand Moff Tarkin (HMW_004) ignores the aspect penalties on Fortify upgrades, on either side', () => {
    const lead = { cardId: 'HMW_004', deployed: false, epicActionUsed: false, exhausted: false }
    // Heavy Ion Cannon is Aggression/Heroism; an ordinary Aggression upgrade still pays its penalty.
    expect(effectiveCost(board({ leader: lead }), 'player', F.HMW_172)).toBe(3)
    expect(effectiveCost(board({ leader: lead }), 'player', F.UPG)).toBe(3)
    const deployed = board({ leader: { ...lead, deployed: true }, units: [unit('L', 'HMW_004', { isLeader: true })] })
    expect(effectiveCost(deployed, 'player', F.HMW_172)).toBe(3)
  })

  it('Grand Moff Tarkin (HMW_004), deployed, may defeat a base with 10 or less remaining HP as the regroup phase starts', () => {
    const lead = { cardId: 'HMW_004', deployed: true, epicActionUsed: true, exhausted: false }
    const s = toRegroup(board({ leader: lead, units: [unit('L', 'HMW_004', { isLeader: true })] }, { base: { cardId: 'TST_B', damage: 20 } }))
    expect(declinable(s)).toBe(true)
    expect(accept(s).winner).toBe('player')
    const far = toRegroup(board({ leader: lead, units: [unit('L', 'HMW_004', { isLeader: true })] }, { base: { cardId: 'TST_B', damage: 19 } }))
    expect(far.pendingChoices?.some(c => c.controller === 'player' && c.kind === 'mayPayThen') ?? false).toBe(false)
  })
})

describe('Fortify: effects that pick an upgrade see one on a base', () => {
  // The CR predates Fortify and puts no limit on "an upgrade", so an upgrade on a base is one; a card
  // that says where the upgrade is ("on a unit", "attached to a unit", "on a friendly unit") excludes it.
  const pickIndex = (s: GameState, cardId: string) => (choice(s) as { candidates: { cardId: string }[] }).candidates.findIndex(c => c.cardId === cardId)

  it('Confiscate (SOR_251) offers every upgrade, both bases\' included, and defeats the one on a base to its owner\'s discard pile', () => {
    const s = playEvent(mixed(), 'SOR_251')
    expect(offered(s)).toEqual(['HMW_113', 'HMW_271', 'UPG', 'UPG'])
    // The AI chooses from the legal moves, so a base upgrade is one of its options too.
    expect(moves(s).filter(m => m.type === 'acceptChoice')).toHaveLength(4)
    const done = accept(s, { optionIndex: pickIndex(s, 'HMW_271') })
    expect(baseUpgrades(done, 'opponent')).toEqual([])
    expect(done.players.opponent.discard).toEqual(['HMW_271'])
    expect(U(done, 't')!.upgrades).toHaveLength(1)
  })

  it('Disabling Fang Fighter (SOR_162) may defeat an upgrade on a base', () => {
    const s = play(mixed(), 'SOR_162')
    expect(offered(s)).toEqual(['HMW_113', 'HMW_271', 'UPG', 'UPG'])
    expect(baseUpgrades(accept(s, { optionIndex: pickIndex(s, 'HMW_113') }))).toEqual([])
  })

  it('Exploit Advantage (ASH_246) offers a friendly upgrade on your base, not one on theirs', () => {
    const s = playEvent(mixed(), 'ASH_246')
    expect(offered(s)).toEqual(['HMW_113', 'UPG'])
    const done = accept(s, { optionIndex: pickIndex(s, 'HMW_113') })
    expect(baseUpgrades(done)).toEqual([])
    expect(done.players.player.discard).toContain('HMW_113')
    expect(done.players.player.hand).toHaveLength(2)
  })

  it('Junior Senator (SEC_200) may return an upgrade on a base to its owner\'s hand', () => {
    const s = play(mixed(), 'SEC_200')
    expect(offered(s)).toContain('HMW_271')
    const done = accept(s, { optionIndex: pickIndex(s, 'HMW_271') })
    expect(baseUpgrades(done, 'opponent')).toEqual([])
    expect(done.players.opponent.hand).toEqual(['HMW_271'])
  })

  it('Jabba the Hutt (ASH_042) may return your base upgrade and play it again for free, back onto your base', () => {
    const s = play(mixed(), 'ASH_042')
    const back = accept(s, { optionIndex: pickIndex(s, 'HMW_113') })
    expect(baseUpgrades(back)).toEqual([])
    const replayed = accept(back, { targetInstanceId: 'm' })
    expect(baseUpgrades(replayed)).toEqual(['HMW_113'])
    expect(U(replayed, 'm')!.upgrades.map(u => u.cardId)).toEqual(['UPG'])
    expect(readyCount(replayed, 'player')).toBe(readyCount(back, 'player'))
  })

  it.each([
    ['System Shock (JTL_175), "attached to a unit"', 'JTL_175', ['UPG', 'UPG']],
    ['Reforge (ASH_090), "on a friendly unit"', 'ASH_090', ['UPG']],
    ['Evidence of the Crime (SHD_077), attached to a unit', 'SHD_077', ['UPG', 'UPG']],
  ])('%s never offers a base upgrade', (_name, cardId, expected) => {
    expect(offered(playEvent(mixed(), cardId))).toEqual(expected)
  })

  it('Jocasta Nu (LOF_248), "a friendly upgrade on a friendly unit", never offers a base upgrade', () => {
    const s = play(mixed({ units: [unit('m', 'GRD', { upgrades: [on('UPG')] }), unit('m2', 'GRD')] }), 'LOF_248')
    expect(offered(s)).toEqual(['UPG'])
  })
})

describe('Fortify: triggered abilities on the base', () => {
  it('Dark Sanctum (HMW_070): as the regroup phase starts, draw a card and deal 2 damage to this base', () => {
    const s = toRegroup(board(fortified('HMW_070')))
    expect(s.players.player.hand).toHaveLength(3) // two for the regroup, one for the Sanctum
    expect(s.players.player.base.damage).toBe(2)
    expect(s.players.opponent.base.damage).toBe(0)
  })

  it('Noxious Refinery (HMW_160): deals 1 damage to an enemy unit when the top card is Aggression', () => {
    const agg = toRegroup(board({ ...fortified('HMW_160'), units: [unit('f', 'GRD')], deck: ['GRD', 'GRD', 'AGG', 'GRD'] }, { units: [unit('e', 'GRD')] }))
    expect(choice(agg).controller).toBe('player')
    expect(unitOffers(agg)).toEqual(['e'])
    expect(U(accept(agg, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
    const not = toRegroup(board({ ...fortified('HMW_160'), deck: ['GRD', 'GRD', 'GRD', 'AGG'] }, { units: [unit('e', 'GRD')] }))
    expect(not.pendingChoices?.some(c => c.kind === 'selectDamageTarget') ?? false).toBe(false)
  })

  it('Sinister War Memorial (HMW_113): heals 1 from this base when a friendly unit is defeated', () => {
    const s = board({ ...fortified('HMW_113'), base: { cardId: 'TST_B', damage: 5, upgrades: [on('HMW_113')] }, units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] })
    expect(defeatUnit(s, 'f').players.player.base.damage).toBe(4)
    expect(defeatUnit(s, 'e').players.player.base.damage).toBe(5)
  })

  it('The Tarkin Doctrine (HMW_206): exhausts an enemy unit when you play a Fortification upgrade', () => {
    const s = fortify(board({ ...fortified('HMW_206') }, { units: [unit('e', 'GRD'), unit('e2', 'GRD')] }), 'HMW_271')
    expect(unitOffers(s)).toEqual(['e', 'e2'])
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
  })

  it('The Tarkin Doctrine (HMW_206): gives an enemy unit -3/-0 as it is played, only if you control Grand Moff Tarkin', () => {
    const lead = { cardId: 'HMW_004', deployed: false, epicActionUsed: false, exhausted: false }
    const s = fortify(board({ leader: lead }, { units: [unit('e', 'BIG')] }), 'HMW_206')
    expect(effectivePower(accept(s, { targetInstanceId: 'e' }), U(s, 'e')!)).toBe(1)
    noChoice(fortify(board({}, { units: [unit('e', 'BIG')] }), 'HMW_206'))
  })

  it('Insurgent Camp (HMW_216): may be defeated to ready a unit you play with 3 or less power', () => {
    const s = play(board(fortified('HMW_216')), 'GRD')
    expect(declinable(s)).toBe(true)
    const done = accept(s)
    expect(done.players.player.units[0].exhausted).toBe(false)
    expect(baseUpgrades(done)).toEqual([])
    expect(done.players.player.discard).toEqual(['HMW_216'])
    noChoice(play(board(fortified('HMW_216')), 'BIG'))
    noChoice(play(board({}, theirFortified('HMW_216')), 'GRD'))
  })

  it('Trap Field (HMW_171): may be defeated to deal 3 damage to a non-leader ground unit entering play, either side\'s', () => {
    const theirs = play(board({}, theirFortified('HMW_171')), 'GRD')
    expect(choice(theirs).controller).toBe('opponent')
    const hit = accept(theirs)
    expect(hit.players.player.units[0].damage).toBe(3)
    expect(baseUpgrades(hit, 'opponent')).toEqual([])
    expect(choice(play(board(fortified('HMW_171')), 'GRD')).controller).toBe('player')
    expect(choice(createTokenUnit(board(fortified('HMW_171')), 'opponent', TOKEN_BATTLE_DROID)).controller).toBe('player')
    // Entering play covers every route in, not just a play or a create: a rescued captured unit too.
    expect(choice(releaseCaptured(board(fortified('HMW_171')), [{ cardId: 'GRD', owner: 'opponent' }])).controller).toBe('player')
    noChoice(play(board({}, theirFortified('HMW_171')), 'SPC'))
  })
})

describe('Fortify: When Played and actions', () => {
  it('Bacta Tank (HMW_037): heals up to 3 from a non-Vehicle unit as it is played', () => {
    const s = fortify(board({ units: [unit('f', 'GRD', { damage: 4 }), unit('v', 'VEH', { damage: 4 })] }), 'HMW_037')
    expect(unitOffers(s)).toEqual(['f'])
    expect(U(accept(s, { targetInstanceId: 'f' }), 'f')!.damage).toBe(1)
  })

  it('Bacta Tank (HMW_037): defeat it to put a non-Vehicle unit from your discard pile on top of your deck', () => {
    const s = board({ ...fortified('HMW_037'), discard: ['VEH', 'GRD'] })
    expect(baseActionOffered(s, 'HMW_037')).toBe(true)
    const used = useBase(s, 'HMW_037')
    expect(baseUpgrades(used)).toEqual([])
    const c = choice(used)
    expect(c.kind === 'selectCardThen' && c.candidates).toEqual(['GRD'])
    const done = accept(used, { optionIndex: 0 })
    expect(done.players.player.deck[0]).toBe('GRD')
    expect(done.players.player.discard.sort()).toEqual(['HMW_037', 'VEH'])
    expect(baseActionOffered(board({ ...fortified('HMW_037'), discard: ['VEH'] }), 'HMW_037')).toBe(false)
  })

  it('Carbonite Chamber (HMW_095): defeat it to keep a non-Vehicle unit from readying in the next regroup phase', () => {
    const s = board({ ...fortified('HMW_095'), units: [unit('f', 'GRD', { exhausted: true })] }, { units: [unit('e', 'GRD', { exhausted: true }), unit('v', 'VEH', { exhausted: true })] })
    const used = useBase(s, 'HMW_095')
    expect(baseUpgrades(used)).toEqual([])
    expect(unitOffers(used)).toEqual(['e', 'f'])
    let next = toRegroup(accept(used, { targetInstanceId: 'e' }))
    next = resolve(next, { type: 'skipResource' })
    next = resolve(next, { type: 'skipResource' })
    expect(next.phase).toBe('action')
    expect([U(next, 'e')!.exhausted, U(next, 'f')!.exhausted, U(next, 'v')!.exhausted]).toEqual([true, false, false])
  })

  it('Heavy Ion Cannon (HMW_172): draws as it is played, then discard a card to deal 2 damage to a unit, once each phase', () => {
    const played = fortify(board({}, { units: [unit('e', 'GRD')] }), 'HMW_172')
    expect(played.players.player.hand).toHaveLength(1)
    const s = board({ ...fortified('HMW_172'), hand: ['GRD', 'SPC'] }, { units: [unit('e', 'GRD')] })
    const used = useBase(s, 'HMW_172')
    expect(choice(used).kind).toBe('selectDiscard')
    const discarded = accept(used, { handIndex: 0 })
    expect(discarded.players.player.discard).toEqual(['GRD'])
    const hit = accept(discarded, { targetInstanceId: 'e' })
    expect(U(hit, 'e')!.damage).toBe(2)
    expect(baseActionOffered({ ...hit, activePlayer: 'player' }, 'HMW_172')).toBe(false)
    expect(baseActionOffered(board({ ...fortified('HMW_172') }, { units: [unit('e', 'GRD')] }), 'HMW_172')).toBe(false)
  })

  it('Intelligence Agency (HMW_205): looks at an opponent\'s hand, may discard from it, and they draw', () => {
    const s = fortify(board({}, { hand: ['GRD', 'SPC'] }), 'HMW_205')
    const c = choice(s)
    expect(c.kind === 'lookAtHand' && [c.target, c.mayDiscard, c.thenDraw]).toEqual(['opponent', true, true])
  })
})
