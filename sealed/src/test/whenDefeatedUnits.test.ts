import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectiveCost } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword } from '../engine/keywords'
import { defeatUnit } from '../engine/combat'
import { normaliseCard } from '../engine/cardDb'
import { hasToken, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'

/**
 * Units with a "When Defeated" ability, in groups taken whole: simple targets, draws and base damage;
 * abilities in two steps or with a choice of modes; and the few that change what is played next or carry
 * a constant ability alongside.
 *
 * The unit has left play by the time its ability resolves, so each test defeats it the way an ability
 * does (`defeatUnit`) and then answers what it raises. Each test states what may be chosen as well as what
 * happens, since a filter that lets everything through would still pass a test that only picks the right
 * target. Printed stats, traits and keywords come from the shipped set fixtures, post-correction.
 */

const SHIPPED = [
  // A: targets, draws and base damage
  'LAW_189', 'TWI_131', 'LAW_097', 'IBH_15', 'JTL_033', 'LOF_059', 'JTL_063', 'SHD_164', 'SEC_263', 'LOF_235', 'SEC_154',
  'SOR_226', 'SEC_221', 'SOR_060', 'LOF_064', 'JTL_060', 'TWI_104', 'JTL_040', 'JTL_220', 'TWI_148', 'IBH_82', 'SOR_163',
  'LOF_057', 'SHD_157', 'LOF_213', 'JTL_071',
  // B: two steps, or a choice of modes
  'SEC_136', 'SEC_207', 'SOR_204', 'SOR_045', 'SOR_145', 'LOF_200', 'TS26_39', 'SHD_085', 'SOR_083',
  // C: the next unit played, and a constant ability alongside
  'SEC_261', 'LOF_180', 'JTL_104',
]
/** Not When Defeated itself, but reads it: the first unit played each round that has one costs less. */
const KRENNIC = 'JTL_032'
/** Scoped by the triage but lifted out to the ticket that owns their blocker. */
const LIFTED = ['JTL_221']

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
  ...Object.fromEntries([...SHIPPED, KRENNIC].map(id => [id, real(id)])),
  GRD: src('GRD'),
  GRD2: src('GRD2'),
  SPC: src('SPC', { arena: 'space' }),
  CHEAP_SPC: src('CHEAP_SPC', { arena: 'space', cost: 3 }),
  PRICEY: src('PRICEY', { cost: 5 }),
  BIG: src('BIG', { cost: 6, power: 5 }),
  WEAK: src('WEAK', { power: 2 }),
  STRONG: src('STRONG', { power: 3 }),
  VIL: src('VIL', { aspects: ['Villainy'] }),
  VIG: src('VIG', { aspects: ['Vigilance'] }),
  VEH: src('VEH', { traits: ['VEHICLE'] }),
  TROOPER: src('TROOPER', { traits: ['TROOPER'] }),
  FORCE_U: src('FORCE_U', { traits: ['FORCE'] }),
  EV: card({ id: 'EV', type: 'event', cost: 1, traits: ['FORCE'] }),
  OFFICIAL: src('OFFICIAL', { traits: ['OFFICIAL'] }),
  RES: src('RES', { traits: ['RESISTANCE'] }),
  RES_UPG: card({ id: 'RES_UPG', type: 'upgrade', cost: 1, power: 0, hp: 0, traits: ['RESISTANCE'] }),
  RES_L: card({ id: 'RES_L', type: 'leader', cost: 6, power: 4, hp: 6, traits: ['RESISTANCE'] }),
  L_UNIT: card({ id: 'L_UNIT', type: 'leader', cost: 5, power: 1, hp: 6 }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
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

const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; deckIndex?: number; baseTarget?: PlayerId }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const targetsOf = (c: PendingChoice): string[] => ('targets' in c ? c.targets : 'unitTargets' in c ? c.unitTargets : []) as string[]
/** Defeat the unit `id`, as an ability would. */
const kill = (s: GameState, id = 'wd') => defeatUnit(s, id)

describe('When Defeated units: the scope', () => {
  it('registers a When Defeated ability for every shipped card and none for the lifted ones', () => {
    for (const id of SHIPPED) expect(getCardDefinition(id)?.abilities?.some(a => a.trigger === 'whenDefeated'), id).toBe(true)
    for (const id of LIFTED) expect(getCardDefinition(id), id).toBeUndefined()
  })
})

describe('When Defeated units, A: targets, draws and base damage', () => {
  it.each(['LAW_189', 'TWI_131'])('%s deals 2 damage to a base of either player', id => {
    const c = choice(kill(board({ units: [unit('wd', id)] }, { units: [unit('e', 'GRD')] })))
    expect(c).toMatchObject({ kind: 'selectDamageTarget', controller: 'player', amount: 2, unitTargets: [], baseTargets: ['player', 'opponent'] })
    const done = accept(kill(board({ units: [unit('wd', id)] })), { baseTarget: 'opponent' })
    expect(done.players.opponent.base.damage).toBe(2)
  })

  it.each(['LAW_097', 'IBH_15'])('%s heals 2 damage from its own base', id => {
    const done = kill(board({ units: [unit('wd', id)], base: { cardId: 'TST_B', damage: 5 } }, { base: { cardId: 'TST_B', damage: 5 } }))
    noChoice(done)
    expect(done.players.player.base.damage).toBe(3)
    expect(done.players.opponent.base.damage).toBe(5)
  })

  it('Onyx Squadron Brute (JTL_033) heals 2 damage from a base of either player', () => {
    const s = kill(board({ units: [unit('wd', 'JTL_033')], base: { cardId: 'TST_B', damage: 4 } }, { base: { cardId: 'TST_B', damage: 4 } }))
    expect(choice(s)).toMatchObject({ kind: 'selectHealTarget', amount: 2, unitTargets: [], baseTargets: ['player', 'opponent'] })
    expect(accept(s, { baseTarget: 'player' }).players.player.base.damage).toBe(2)
  })

  it('Nightsister Warrior (LOF_059) draws a card', () => {
    const done = kill(board({ units: [unit('wd', 'LOF_059')], deck: ['GRD', 'GRD2'] }))
    noChoice(done)
    expect(done.players.player.hand).toEqual(['GRD'])
  })

  it('Landing Shuttle (JTL_063) may draw a card', () => {
    const s = kill(board({ units: [unit('wd', 'JTL_063')], deck: ['GRD', 'GRD2'] }))
    expect(choice(s)).toMatchObject({ controller: 'player' })
    expect(accept(s).players.player.hand).toEqual(['GRD'])
    expect(skip(s).players.player.hand).toEqual([])
  })

  it('Rhokai Gunship (SHD_164) deals 1 damage to a unit or a base', () => {
    const s = kill(board({ units: [unit('wd', 'SHD_164'), unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }))
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 1, baseTargets: ['player', 'opponent'] })
    expect(targetsOf(choice(s)).sort()).toEqual(['e', 'f'])
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
  })

  it('Assassin Probe (SEC_263) deals 1 damage to each exhausted enemy ground unit', () => {
    const done = kill(board(
      { units: [unit('wd', 'SEC_263'), unit('f', 'GRD', { exhausted: true })] },
      { units: [unit('ex', 'GRD', { exhausted: true }), unit('rd', 'GRD'), unit('sp', 'SPC', { exhausted: true })] },
    ))
    noChoice(done)
    expect([U(done, 'ex')!.damage, U(done, 'rd')!.damage, U(done, 'sp')!.damage, U(done, 'f')!.damage]).toEqual([1, 0, 0, 0])
  })

  it('HK-87 Assassin Droid (LOF_235) deals 2 damage to each ground unit on both sides', () => {
    const done = kill(board({ units: [unit('wd', 'LOF_235'), unit('f', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }))
    expect([U(done, 'f')!.damage, U(done, 'e')!.damage, U(done, 'sp')!.damage]).toEqual([2, 2, 0])
  })

  it('Inner Rim Coalition (SEC_154) may ready a unit that costs 5 or less', () => {
    const s = kill(board({ units: [unit('wd', 'SEC_154'), unit('p', 'PRICEY', { exhausted: true }), unit('b', 'BIG', { exhausted: true })] }, { units: [unit('e', 'GRD', { exhausted: true })] }))
    expect(choice(s)).toMatchObject({ kind: 'selectUnitToReady', optional: true })
    expect(targetsOf(choice(s)).sort()).toEqual(['e', 'p'])
    expect(U(accept(s, { targetInstanceId: 'p' }), 'p')!.exhausted).toBe(false)
  })

  it('Admiral Motti (SOR_226) may ready a Villainy unit', () => {
    const s = kill(board({ units: [unit('wd', 'SOR_226'), unit('v', 'VIL', { exhausted: true }), unit('g', 'GRD', { exhausted: true })] }))
    expect(choice(s)).toMatchObject({ kind: 'selectUnitToReady', optional: true, targets: ['v'] })
  })

  it('Unruly Astromech (SEC_221) exhausts an enemy unit, which is not optional', () => {
    const s = kill(board({ units: [unit('wd', 'SEC_221'), unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }))
    expect(choice(s)).toMatchObject({ kind: 'mayExhaustUnit', targets: ['e'] })
    expect((choice(s) as { optional?: boolean }).optional).toBeFalsy()
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
  })

  it('Distant Patroller (SOR_060) may give a Shield token to a Vigilance unit', () => {
    const s = kill(board({ units: [unit('wd', 'SOR_060'), unit('v', 'VIG'), unit('g', 'GRD')] }))
    expect(choice(s)).toMatchObject({ kind: 'mayGiveTokens', optional: true, targets: ['v'] })
    expect(hasToken(U(accept(s, { targetInstanceId: 'v' }), 'v')!.upgrades, TOKEN_SHIELD)).toBe(true)
  })

  it('Tauntaun (LOF_064) may give a Shield token to a damaged non-Vehicle unit', () => {
    const s = kill(board({ units: [unit('wd', 'LOF_064'), unit('hurt', 'GRD', { damage: 1 }), unit('fresh', 'GRD'), unit('veh', 'VEH', { damage: 1 })] }))
    expect(choice(s)).toMatchObject({ kind: 'mayGiveTokens', optional: true, targets: ['hurt'] })
  })

  it('Desperate Commando (JTL_060) may give a unit -1/-1 for this phase', () => {
    const s = kill(board({ units: [unit('wd', 'JTL_060'), unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }))
    expect(choice(s)).toMatchObject({ kind: 'mayLastingBuff', optional: true, power: -1, hp: -1 })
    expect(targetsOf(choice(s)).sort()).toEqual(['e', 'f'])
    const done = accept(s, { targetInstanceId: 'e' })
    expect([effectivePower(done, U(done, 'e')!), effectiveHp(done, U(done, 'e')!)]).toEqual([1, 7])
  })

  it('Obedient Vanguard (TWI_104) may give a Trooper unit +2/+2 for this phase', () => {
    const s = kill(board({ units: [unit('wd', 'TWI_104'), unit('t', 'TROOPER'), unit('g', 'GRD')] }))
    expect(choice(s)).toMatchObject({ kind: 'mayLastingBuff', optional: true, power: 2, hp: 2, targets: ['t'] })
  })

  it('Fleet Interdictor (JTL_040) may defeat a space unit that costs 3 or less', () => {
    const s = kill(board({ units: [unit('wd', 'JTL_040')] }, { units: [unit('c', 'CHEAP_SPC'), unit('sp', 'SPC', { }), unit('g', 'GRD')] }, { cards: { ...F, SPC: src('SPC', { arena: 'space', cost: 4 }) } }))
    expect(choice(s)).toMatchObject({ kind: 'selectUnitToDefeat', optional: true, targets: ['c'] })
    expect(U(accept(s, { targetInstanceId: 'c' }), 'c')).toBeUndefined()
  })

  it('Skyway Cloud Car (JTL_220) may return a non-leader unit with 2 or less power to its owner\'s hand', () => {
    const s = kill(board({ units: [unit('wd', 'JTL_220')] }, { units: [unit('w', 'WEAK'), unit('st', 'STRONG'), unit('l', 'L_UNIT', { isLeader: true })] }))
    expect(choice(s)).toMatchObject({ kind: 'selectUnitToReturn', optional: true, targets: ['w'] })
    expect(accept(s, { targetInstanceId: 'w' }).players.opponent.hand).toEqual(['WEAK'])
  })

  it.each(['TWI_148', 'IBH_82'])('%s makes the opponent discard a card, which the opponent chooses', id => {
    const s = kill(board({ units: [unit('wd', id)] }, { hand: ['GRD', 'GRD2'] }))
    expect(choice(s)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent', count: 1 })
    expect(accept(s, { handIndex: 1 }).players.opponent.hand).toEqual(['GRD'])
    noChoice(kill(board({ units: [unit('wd', id)] })))
  })

  it('Star Wing Scout (SOR_163) draws 2 cards only with the initiative', () => {
    const deck = ['GRD', 'GRD2', 'SPC']
    expect(kill(board({ units: [unit('wd', 'SOR_163')], deck })).players.player.hand).toEqual(['GRD', 'GRD2'])
    expect(kill(board({ units: [unit('wd', 'SOR_163')], deck }, {}, { initiative: 'opponent' })).players.player.hand).toEqual([])
  })

  it('Owen Lars (LOF_057) searches the top 5 for a Force unit', () => {
    const s = kill(board({ units: [unit('wd', 'LOF_057')], deck: ['GRD', 'EV', 'FORCE_U', 'GRD2', 'SPC', 'FORCE_U'] }))
    expect(choice(s)).toMatchObject({ kind: 'searchDraw', revealed: ['GRD', 'EV', 'FORCE_U', 'GRD2', 'SPC'], eligibleIndices: [2] })
    expect(accept(s, { deckIndex: 2 }).players.player.hand).toEqual(['FORCE_U'])
  })

  it('Bo-Katan Kryze (SHD_157) draws a card for each player whose base has 15 or more damage', () => {
    const deck = ['GRD', 'GRD2', 'SPC']
    const hurt = { cardId: 'TST_B', damage: 15 }
    expect(kill(board({ units: [unit('wd', 'SHD_157')], deck, base: hurt }, { base: hurt })).players.player.hand).toHaveLength(2)
    expect(kill(board({ units: [unit('wd', 'SHD_157')], deck }, { base: hurt })).players.player.hand).toHaveLength(1)
    expect(kill(board({ units: [unit('wd', 'SHD_157')], deck, base: { cardId: 'TST_B', damage: 14 } })).players.player.hand).toHaveLength(0)
  })

  it('The Legacy Run (LOF_213) deals 6 damage divided among enemy units', () => {
    const s = kill(board({ units: [unit('wd', 'LOF_213'), unit('f', 'GRD')] }, { units: [unit('e', 'GRD'), unit('e2', 'SPC')] }))
    expect(choice(s)).toMatchObject({ kind: 'distributeDamage', controller: 'player', remaining: 6, total: 6 })
    expect(targetsOf(choice(s)).sort()).toEqual(['e', 'e2'])
  })

  it('CR90 Relief Runner (JTL_071) heals up to 3 damage from a unit or a base', () => {
    const s = kill(board({ units: [unit('wd', 'JTL_071'), unit('f', 'GRD', { damage: 4 })], base: { cardId: 'TST_B', damage: 5 } }))
    expect(choice(s)).toMatchObject({ kind: 'selectHealTarget', amount: 3, baseTargets: ['player', 'opponent'] })
    expect(targetsOf(choice(s))).toContain('f')
    expect(U(accept(s, { targetInstanceId: 'f' }), 'f')!.damage).toBe(1)
  })

  it("an opponent's When Defeated defeated in the player's attack hands the choice to the opponent, then the turn passes", () => {
    const s = board({ units: [unit('big', 'BIG')] }, { units: [unit('wd', 'SEC_221', { damage: 1 }), unit('other', 'GRD')] })
    const hit = resolve(s, { type: 'attack', attackerId: 'big', target: { kind: 'unit', instanceId: 'wd' } })
    expect(U(hit, 'wd')).toBeUndefined()
    expect(choice(hit)).toMatchObject({ kind: 'mayExhaustUnit', controller: 'opponent', targets: ['big'] })
    expect(hit.activePlayer).toBe('opponent')
    const done = accept(hit, { targetInstanceId: 'big' })
    expect(U(done, 'big')!.exhausted).toBe(true)
    noChoice(done)
    expect(done.activePlayer).toBe('opponent') // the attack was the player's action, so the turn passes
  })
})

describe('When Defeated units, B: two steps, or a choice of modes', () => {
  it('Arihnda Pryce (SEC_136) may defeat another friendly unit; if she does, she deals 4 damage to each enemy base', () => {
    const s = kill(board({ units: [unit('wd', 'SEC_136'), unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }))
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', optional: true, targets: ['f'] })
    const done = accept(s, { targetInstanceId: 'f' })
    expect(U(done, 'f')).toBeUndefined()
    expect(done.players.opponent.base.damage).toBe(4)
    expect(skip(s).players.opponent.base.damage).toBe(0)
  })

  it('Lightmaker (SEC_207) exhausts each enemy unit in the arena chosen', () => {
    const s = kill(board({ units: [unit('wd', 'SEC_207'), unit('f', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }))
    expect(choice(s)).toMatchObject({ kind: 'chooseArenaThen', controller: 'player' })
    const ground = accept(s, { optionIndex: 0 })
    expect([U(ground, 'e')!.exhausted, U(ground, 'sp')!.exhausted, U(ground, 'f')!.exhausted]).toEqual([true, false, false])
    const space = accept(s, { optionIndex: 1 })
    expect([U(space, 'e')!.exhausted, U(space, 'sp')!.exhausted]).toEqual([false, true])
  })

  it("Greedo (SOR_204) may discard a card from his deck; if it isn't a unit, he deals 2 damage to a ground unit", () => {
    const withEvent = kill(board({ units: [unit('wd', 'SOR_204')], deck: ['EV', 'GRD'] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }))
    expect(choice(withEvent)).toMatchObject({ kind: 'mayPayThen', cost: 0 })
    const milled = accept(withEvent)
    expect(milled.players.player.discard).toContain('EV')
    expect(choice(milled)).toMatchObject({ kind: 'selectDamageTarget', amount: 2, unitTargets: ['e'] })
    const withUnit = accept(kill(board({ units: [unit('wd', 'SOR_204')], deck: ['GRD', 'EV'] }, { units: [unit('e', 'GRD')] })))
    expect(withUnit.players.player.discard).toContain('GRD')
    noChoice(withUnit)
    expect(skip(withEvent).players.player.deck).toEqual(['EV', 'GRD'])
  })

  it('Yoda (SOR_045) has any number of players each draw a card', () => {
    const deckFor = { deck: ['GRD', 'GRD2'] }
    const s = kill(board({ units: [unit('wd', 'SOR_045')], ...deckFor }, deckFor))
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', controller: 'player', cost: 0 })
    const both = accept(accept(s))
    expect([both.players.player.hand.length, both.players.opponent.hand.length]).toEqual([1, 1])
    const onlyThem = accept(skip(s))
    expect([onlyThem.players.player.hand.length, onlyThem.players.opponent.hand.length]).toEqual([0, 1])
    const onlyMe = skip(accept(s))
    expect([onlyMe.players.player.hand.length, onlyMe.players.opponent.hand.length]).toEqual([1, 0])
    noChoice(onlyMe)
  })

  it("K-2SO (SOR_145) either deals 3 damage to the opponent's base or makes the opponent discard a card", () => {
    const s = kill(board({ units: [unit('wd', 'SOR_145')] }, { hand: ['GRD'] }))
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', controller: 'player', cost: 0 })
    const base = accept(s)
    expect(base.players.opponent.base.damage).toBe(3)
    noChoice(base)
    const discard = skip(s)
    expect(discard.players.opponent.base.damage).toBe(0)
    expect(choice(discard)).toMatchObject({ kind: 'selectDiscard', controller: 'opponent' })
  })

  it("Qui-Gon Jinn (LOF_200) may choose a non-leader ground unit, and its owner puts it on the top or bottom of their deck", () => {
    const s = kill(board(
      { units: [unit('wd', 'LOF_200'), unit('f', 'GRD')] },
      { units: [unit('e', 'GRD'), unit('sp', 'SPC'), unit('l', 'L_UNIT', { isLeader: true })], deck: ['GRD2'] },
    ))
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', optional: true })
    expect(targetsOf(choice(s)).sort()).toEqual(['e', 'f'])
    const picked = accept(s, { targetInstanceId: 'e' })
    expect(U(picked, 'e')).toBeDefined() // not moved until its owner says where
    expect(choice(picked)).toMatchObject({ kind: 'mayPayThen', controller: 'opponent', cost: 0 })
    const top = accept(picked)
    expect(U(top, 'e')).toBeUndefined()
    expect(top.players.opponent.deck).toEqual(['GRD', 'GRD2'])
    expect(skip(picked).players.opponent.deck).toEqual(['GRD2', 'GRD'])
  })

  it('Captain Vaughn (TS26_39) searches the top 3 for any card and draws it, then puts a card from his hand on top of his deck', () => {
    const s = kill(board({ units: [unit('wd', 'TS26_39')], hand: ['EV'], deck: ['GRD', 'SPC', 'GRD2', 'PRICEY'] }))
    expect(choice(s)).toMatchObject({ kind: 'searchDraw', revealed: ['GRD', 'SPC', 'GRD2'], eligibleIndices: [0, 1, 2] })
    const drawn = accept(s, { deckIndex: 1 })
    expect(drawn.players.player.hand).toEqual(['EV', 'SPC'])
    expect(choice(drawn)).toMatchObject({ kind: 'selectHandCardThen', controller: 'player', handIndices: [0, 1] })
    const done = accept(drawn, { handIndex: 1 })
    expect(done.players.player.hand).toEqual(['EV'])
    expect(done.players.player.deck[0]).toBe('SPC')
    // Settled without a draw, the rest of the ability still follows.
    expect(choice(skip(s))).toMatchObject({ kind: 'selectHandCardThen', handIndices: [0] })
  })

  it.each(['SHD_085', 'SOR_083'])('Superlaser Technician (%s) may put itself into play as a resource, ready', id => {
    const s = kill(board({ units: [unit('wd', id)], resources: ready(2) }))
    expect(s.players.player.discard).toEqual([id])
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', controller: 'player', cost: 0 })
    const done = accept(s)
    expect(done.players.player.discard).toEqual([])
    expect(done.players.player.resources).toHaveLength(3)
    expect(done.players.player.resources[2]).toEqual({ cardId: id, exhausted: false })
    expect(skip(s).players.player.discard).toEqual([id])
  })
})

describe('When Defeated units, C: the next unit played, and a constant ability alongside', () => {
  const costOf = (s: GameState, id: string) => effectiveCost(s, 'player', s.cards[id])
  const playedThisPhase = (mine: string[], theirs: string[]): PhaseEvents => ({
    enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
    upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, played: { player: mine, opponent: theirs },
    leaderLeftPlay: [],
  })

  it('Inspiring Senator (SEC_261) makes the next Official unit played this phase cost 1 less', () => {
    const before = board({ units: [unit('wd', 'SEC_261')] })
    const after = kill(before)
    expect(costOf(after, 'OFFICIAL')).toBe(costOf(before, 'OFFICIAL') - 1)
    expect(costOf(after, 'GRD')).toBe(costOf(before, 'GRD'))
  })

  it('Deceptive Shade (LOF_180) prints no Ambush, and gives Ambush to the next unit played this phase', () => {
    expect(F.LOF_180.keywords).toEqual([])
    const s = kill(board({ units: [unit('wd', 'LOF_180')], hand: ['GRD'] }, { units: [unit('e', 'GRD')] }))
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(choice(played)).toMatchObject({ kind: 'ambush', controller: 'player' })
  })

  it('Raddus (JTL_104) has Sentinel only while his controller has another Resistance card: a unit, an upgrade or the leader', () => {
    const sentinel = (s: GameState) => unitHasKeyword(s, U(s, 'r')!, 'Sentinel')
    expect(F.JTL_104.keywords).toEqual([])
    expect(sentinel(board({ units: [unit('r', 'JTL_104')] }, { units: [unit('e', 'RES')] }))).toBe(false)
    expect(sentinel(board({ units: [unit('r', 'JTL_104'), unit('f', 'RES')] }))).toBe(true)
    expect(sentinel(board({ units: [unit('r', 'JTL_104'), unit('f', 'GRD', { upgrades: [{ cardId: 'RES_UPG', owner: 'player' }] })] }))).toBe(true)
    expect(sentinel(board({ units: [unit('r', 'JTL_104')], leader: { cardId: 'RES_L', deployed: false, epicActionUsed: false, exhausted: false } }))).toBe(true)
  })

  it('Raddus (JTL_104) deals damage equal to his power to an enemy unit when defeated', () => {
    const s = kill(board({ units: [unit('wd', 'JTL_104'), unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'wd')
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 8, unitTargets: ['e'], baseTargets: [] })
  })

  it('Director Krennic (JTL_032) makes the first unit with a When Defeated ability played each round cost 1 less', () => {
    const without = board()
    const withKrennic = board({ units: [unit('k', KRENNIC)] })
    expect(costOf(withKrennic, 'LAW_189')).toBe(costOf(without, 'LAW_189') - 1)
    expect(costOf(withKrennic, 'GRD')).toBe(costOf(without, 'GRD'))
    // Units are played only in the action phase, so the phase's plays are the round's.
    const playedOne = board({ units: [unit('k', KRENNIC)] }, {}, { phaseEvents: playedThisPhase(['TWI_131'], []) })
    expect(costOf(playedOne, 'LAW_189')).toBe(costOf(without, 'LAW_189'))
    const playedOther = board({ units: [unit('k', KRENNIC)] }, {}, { phaseEvents: playedThisPhase(['GRD'], ['TWI_131']) })
    expect(costOf(playedOther, 'LAW_189')).toBe(costOf(without, 'LAW_189') - 1)
  })
})
