import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { effectivePower, effectiveHp } from '../engine/stats'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
import { defeatUnit } from '../engine/combat'
import { fireUnitsTrigger } from '../engine/effects'
import { unitHasKeyword, unitCannotAttackBases } from '../engine/keywords'
import { TOKEN_ADVANTAGE, TOKEN_EXPERIENCE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import {
  TOKEN_UNIT_CARDS, TOKEN_SPY, TOKEN_X_WING, TOKEN_TIE_FIGHTER, TOKEN_CLONE_TROOPER, TOKEN_BATTLE_DROID, TOKEN_BEAST, isTokenCard,
} from '../engine/tokenUnits'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Cards that create token units other than the Mandalorian: Spy, X-Wing, TIE Fighter, Clone Trooper,
 * Battle Droid and Beast, in groups taken whole.
 *
 * A token unit is a built-in unit card created straight into play, exhausted unless an ability says
 * otherwise, that ceases to exist when it leaves play. The Mandalorian already worked that way, so the
 * tokens are six more cards and these are registrations over primitives that exist. What the tests pin
 * is therefore the cards: which token, how many, for whom, and on what condition.
 *
 * Printed stats, traits and keywords come from the shipped set fixtures, post-correction.
 */

const SHIPPED = [
  // A: tokens on a trigger, on units and upgrades
  'HMW_038', 'HMW_047', 'HMW_152', 'HMW_250', 'HMW_262', 'JTL_082', 'JTL_099', 'JTL_243', 'JTL_252', 'SEC_083',
  'SEC_087', 'SEC_097', 'SEC_115', 'SEC_132', 'SEC_175', 'SEC_191', 'SEC_227', 'TS26_23', 'TWI_032', 'TWI_043',
  'TWI_060', 'TWI_079', 'TWI_097', 'TWI_112', 'TWI_144', 'TWI_145', 'TWI_183', 'TWI_247', 'TS26_55',
  // B: units that do more with their tokens, or with a choice
  'HMW_153', 'JTL_039', 'SEC_198', 'TWI_080', 'TWI_084', 'TWI_094', 'TWI_203', 'TWI_234', 'TWI_119',
  // C: events
  'HMW_058', 'HMW_150', 'HMW_194', 'HMW_195', 'HMW_241', 'HMW_272', 'JTL_076', 'JTL_092', 'JTL_122', 'JTL_130',
  'JTL_155', 'JTL_205', 'JTL_254', 'SEC_092', 'SEC_105', 'SEC_128', 'SEC_177', 'SEC_178', 'SEC_236', 'SEC_246',
  'TWI_073', 'TWI_076', 'TWI_088', 'TWI_125', 'TWI_190', 'TWI_200', 'TWI_222', 'TWI_237', 'TWI_239', 'TWI_251',
  // D: leaders
  'HMW_010', 'HMW_012', 'JTL_016', 'SEC_011', 'SEC_014', 'TS26_1', 'TWI_002', 'TWI_007',
]
/** Scoped by the triage or by comment, but lifted out to the ticket that owns their blocker. */
const LIFTED = ['JTL_006', 'SEC_101', 'TWI_069', 'TWI_017']

const POOL = poolFor(['SEC', 'JTL', 'TWI', 'TS26', 'HMW'])
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
  CREATURE: src('CREATURE', { traits: ['CREATURE'] }),
  FORCE_U: src('FORCE_U', { traits: ['FORCE'] }),
  VEH: src('VEH', { arena: 'space', traits: ['VEHICLE'] }),
  TRANSPORT: src('TRANSPORT', { arena: 'space', traits: ['VEHICLE', 'TRANSPORT'] }),
  REP: src('REP', { traits: ['REPUBLIC'] }),
  SEP: src('SEP', { arena: 'space', traits: ['SEPARATIST'] }),
  JEDI: src('JEDI', { traits: ['JEDI'], hp: 6 }),
  JEDI_BIG: src('JEDI_BIG', { traits: ['JEDI'], hp: 9 }),
  OFFICIAL: src('OFFICIAL', { traits: ['OFFICIAL'] }),
  UNIQ: src('UNIQ', { unique: true }),
  CHEAP: src('CHEAP', { cost: 3 }),
  PRICEY: src('PRICEY', { cost: 4 }),
  CREATURE_L: card({ id: 'CREATURE_L', type: 'leader', cost: 5, power: 3, hp: 6 }),
  REP_L: card({ id: 'REP_L', type: 'leader', cost: 5, power: 3, hp: 6, traits: ['REPUBLIC'] }),
  VEH_HAND: src('VEH_HAND', { arena: 'space', cost: 5, traits: ['VEHICLE'] }),
  EV: card({ id: 'EV', type: 'event', cost: 1 }),
  EV_CHEAP: card({ id: 'EV_CHEAP', type: 'event', cost: 3 }),
  EV_PRICEY: card({ id: 'EV_PRICEY', type: 'event', cost: 4 }),
  WD_UNIT: src('WD_UNIT'),
  // Listeners for a unit arriving, stubbed: their behaviour is what is under test, not their stats.
  ASH_017: card({ id: 'ASH_017', name: 'Greef Karga', type: 'leader', cost: 6, power: 3, hp: 6 }),
  ASH_041: src('ASH_041', { name: 'Outcast' }),
  SHD_096: src('SHD_096', { name: 'Maz Kanata' }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
/** The `token` units `who` controls. */
const made = (s: GameState, who: PlayerId, token: string): UnitState[] => s.players[who].units.filter(u => u.cardId === token)
const count = (s: GameState, who: PlayerId, token: string): number => made(s, who, token).length
const exhaustedResources = (n: number) => ready(n).map(r => ({ ...r, exhausted: true }))

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
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; deckIndex?: number; baseTarget?: PlayerId }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const unitOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : [])))].sort()
const readyCount = (s: GameState, who: PlayerId) => s.players[who].resources.filter(r => !r.exhausted).length

/** Play `cardId` (a unit) from hand through the real play door. */
const play = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState => {
  const p = s.players[who]
  const withCard = { ...s, activePlayer: who, players: { ...s.players, [who]: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playUnit', handIndex: p.hand.length })
}
/** The instance id of the unit `who` played last. */
const lastPlayed = (s: GameState, cardId: string, who: PlayerId = 'player'): string =>
  s.players[who].units.find(u => u.cardId === cardId)!.instanceId
/** Play `cardId` as an event from the player's hand. */
const playEvent = (s: GameState, cardId: string): GameState => {
  const p = s.players.player
  const withCard = { ...s, activePlayer: 'player' as PlayerId, players: { ...s.players, player: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playEvent', handIndex: p.hand.length })
}
/** Play the upgrade `cardId` onto `target`. */
const playUpgrade = (s: GameState, cardId: string, target: string): GameState => {
  const p = s.players.player
  const withCard = { ...s, activePlayer: 'player' as PlayerId, players: { ...s.players, player: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playUpgrade', handIndex: p.hand.length, targetInstanceId: target })
}
const kill = (s: GameState, id: string): GameState => defeatUnit(s, id)
const attack = (s: GameState, attackerId: string, target?: string) =>
  resolve(s, { type: 'attack', attackerId, target: target ? { kind: 'unit', instanceId: target } : { kind: 'base' } })
const undeployedLeader = (cardId: string) => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })
const deployedLeader = (cardId: string) => ({ cardId, deployed: true, epicActionUsed: true, exhausted: false })
const front = (id: string, mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) => board({ leader: undeployedLeader(id), ...mine }, theirs, over)
const back = (id: string, mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  board({ leader: deployedLeader(id), ...mine, units: [unit('L', id, { isLeader: true }), ...(mine.units ?? [])] }, theirs, over)
const usable = (s: GameState) => moves(s).some(m => m.type === 'useLeaderAbility')
const useFront = (s: GameState) => resolve(s, { type: 'useLeaderAbility', index: 0 })
const baseDamage = (s: GameState, who: PlayerId) => s.players[who].base.damage

describe('Token units: the scope and the tokens', () => {
  it('registers an ability for every shipped card and none for the lifted ones', () => {
    for (const id of SHIPPED) expect(getCardDefinition(id), id).toBeDefined()
    for (const id of LIFTED) expect(getCardDefinition(id), id).toBeUndefined()
  })

  it('each token unit carries its printed stats', () => {
    const stats = (id: string) => {
      const c = TOKEN_UNIT_CARDS[id]
      return [c.name, c.arena, c.power, c.hp, c.aspects.join('+'), c.traits.join(','), c.keywords.map(k => `${k.name}${k.value ?? ''}`).join(',')]
    }
    expect(stats(TOKEN_SPY)).toEqual(['Spy', 'ground', 0, 2, '', 'Official', 'Raid2'])
    expect(stats(TOKEN_X_WING)).toEqual(['X-Wing', 'space', 2, 2, 'Heroism', 'Vehicle,Fighter', ''])
    expect(stats(TOKEN_TIE_FIGHTER)).toEqual(['TIE Fighter', 'space', 1, 1, 'Villainy', 'Vehicle,Fighter', ''])
    expect(stats(TOKEN_CLONE_TROOPER)).toEqual(['Clone Trooper', 'ground', 2, 2, 'Heroism', 'Republic,Clone,Trooper', ''])
    expect(stats(TOKEN_BATTLE_DROID)).toEqual(['Battle Droid', 'ground', 1, 1, 'Villainy', 'Separatist,Droid,Trooper', ''])
    expect(stats(TOKEN_BEAST)).toEqual(['Beast', 'ground', 3, 3, '', 'Creature', ''])
    for (const id of Object.keys(TOKEN_UNIT_CARDS)) expect(isTokenCard(id), id).toBe(true)
  })

  it('a defeated token unit ceases to exist rather than going to a discard pile', () => {
    const s = kill(board({ units: [unit('t', TOKEN_BATTLE_DROID)] }), 't')
    expect(U(s, 't')).toBeUndefined()
    expect(s.players.player.discard).toEqual([])
  })
})

describe('Token units, A: tokens on a trigger', () => {
  type Row = [id: string, when: 'play' | 'defeat' | 'attack', token: string, n: number, who: PlayerId]
  const rows: Row[] = [
    ['JTL_082', 'play', TOKEN_TIE_FIGHTER, 1, 'player'],
    ['JTL_099', 'play', TOKEN_X_WING, 1, 'player'],
    ['JTL_252', 'play', TOKEN_X_WING, 1, 'player'],
    ['SEC_097', 'play', TOKEN_SPY, 1, 'player'],
    ['SEC_191', 'play', TOKEN_SPY, 2, 'player'],
    ['TWI_097', 'play', TOKEN_CLONE_TROOPER, 2, 'player'],
    ['TWI_144', 'play', TOKEN_CLONE_TROOPER, 1, 'player'],
    ['TS26_23', 'play', TOKEN_CLONE_TROOPER, 2, 'player'],
    ['TWI_145', 'play', TOKEN_BATTLE_DROID, 2, 'opponent'],
    ['HMW_152', 'play', TOKEN_BEAST, 1, 'opponent'],
    ['SEC_132', 'defeat', TOKEN_SPY, 1, 'player'],
    ['TWI_032', 'defeat', TOKEN_BATTLE_DROID, 1, 'player'],
    ['TWI_079', 'defeat', TOKEN_BATTLE_DROID, 1, 'player'],
    ['TWI_043', 'defeat', TOKEN_CLONE_TROOPER, 1, 'player'],
    ['TWI_247', 'defeat', TOKEN_CLONE_TROOPER, 2, 'player'],
    ['JTL_243', 'attack', TOKEN_TIE_FIGHTER, 1, 'player'],
    ['SEC_087', 'attack', TOKEN_SPY, 1, 'player'],
  ]
  for (const [id, when, token, n, who] of rows) {
    it(`${F[id].name} (${id}) creates ${n} ${TOKEN_UNIT_CARDS[token].name} token${n > 1 ? 's' : ''} for ${who === 'player' ? 'its controller' : 'an opponent'} on ${when}`, () => {
      // A When Defeated unit is placed on the board rather than played, so its defeat is the only trigger.
      const s = when === 'play' ? play(board(), id)
        : when === 'defeat' ? kill(board({ units: [unit('a', id)] }), 'a')
          : attack(board({ units: [unit('a', id)] }), 'a')
      noChoice(s)
      expect(count(s, who, token)).toBe(n)
      expect(count(s, who === 'player' ? 'opponent' : 'player', token)).toBe(0)
      // Created units enter play exhausted.
      expect(made(s, who, token).every(u => u.exhausted)).toBe(true)
    })
  }

  it('ISB Shuttle (SEC_083) creates a Spy only if a friendly unit was defeated this phase', () => {
    expect(count(play(board(), 'SEC_083'), 'player', TOKEN_SPY)).toBe(0)
    const enemyOnly = board({}, {}, { phaseEvents: phaseEvents({ defeated: { player: [], opponent: ['GRD'] } }) })
    expect(count(play(enemyOnly, 'SEC_083'), 'player', TOKEN_SPY)).toBe(0)
    const friendly = board({}, {}, { phaseEvents: phaseEvents({ defeated: { player: ['GRD'], opponent: [] } }) })
    expect(count(play(friendly, 'SEC_083'), 'player', TOKEN_SPY)).toBe(1)
  })

  it('Taylander Shuttle (SEC_115) creates a Spy on attack only while you have the initiative', () => {
    expect(count(attack(board({ units: [unit('a', 'SEC_115')] }), 'a'), 'player', TOKEN_SPY)).toBe(1)
    expect(count(attack(board({ units: [unit('a', 'SEC_115')] }, {}, { initiative: 'opponent' }), 'a'), 'player', TOKEN_SPY)).toBe(0)
  })

  it('Subjugating Starfighter (TWI_112) creates a Battle Droid only while you have the initiative', () => {
    expect(count(play(board(), 'TWI_112'), 'player', TOKEN_BATTLE_DROID)).toBe(1)
    expect(count(play(board({}, {}, { initiative: 'opponent' }), 'TWI_112'), 'player', TOKEN_BATTLE_DROID)).toBe(0)
  })

  it('Trade Federation Shuttle (TWI_060) creates a Battle Droid only while you control a damaged unit', () => {
    expect(count(play(board({ units: [unit('g', 'GRD')] }), 'TWI_060'), 'player', TOKEN_BATTLE_DROID)).toBe(0)
    expect(count(play(board({}, { units: [unit('e', 'GRD', { damage: 1 })] }), 'TWI_060'), 'player', TOKEN_BATTLE_DROID)).toBe(0)
    expect(count(play(board({ units: [unit('g', 'GRD', { damage: 1 })] }), 'TWI_060'), 'player', TOKEN_BATTLE_DROID)).toBe(1)
  })

  it('Rush Clovis (TWI_183) creates a Battle Droid on attack only if the defending player has no ready resources', () => {
    expect(count(attack(board({ units: [unit('a', 'TWI_183')] }), 'a'), 'player', TOKEN_BATTLE_DROID)).toBe(0)
    const spent = board({ units: [unit('a', 'TWI_183')] }, { resources: exhaustedResources(4) })
    expect(count(attack(spent, 'a'), 'player', TOKEN_BATTLE_DROID)).toBe(1)
  })

  it('Eravana (HMW_047) creates a Beast on attack and readies it', () => {
    const s = attack(board({ units: [unit('a', 'HMW_047')] }), 'a')
    expect(made(s, 'player', TOKEN_BEAST).map(u => u.exhausted)).toEqual([false])
  })

  it('Imperial Cavalry (HMW_250) creates a Beast and deals 1 damage to an enemy unit', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_250')
    expect(count(s, 'player', TOKEN_BEAST)).toBe(1)
    expect(unitOffers(s)).toEqual(['e'])
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
  })

  it('Mylaya Rider (HMW_262) creates a Beast and heals 2 damage from your base', () => {
    const s = play(board({ base: { cardId: 'TST_B', damage: 5 } }), 'HMW_262')
    expect(count(s, 'player', TOKEN_BEAST)).toBe(1)
    expect(baseDamage(s, 'player')).toBe(3)
  })

  it('Bestial Bond (HMW_038) creates a Beast only when attached to a Creature or Force unit', () => {
    for (const host of ['CREATURE', 'FORCE_U']) {
      expect(count(playUpgrade(board({ units: [unit('h', host)] }), 'HMW_038', 'h'), 'player', TOKEN_BEAST), host).toBe(1)
    }
    expect(count(playUpgrade(board({ units: [unit('h', 'GRD')] }), 'HMW_038', 'h'), 'player', TOKEN_BEAST)).toBe(0)
  })

  it("Ambition's Reward (SEC_175) creates a Spy as it is played", () => {
    expect(count(playUpgrade(board({ units: [unit('h', 'GRD')] }), 'SEC_175', 'h'), 'player', TOKEN_SPY)).toBe(1)
  })

  it('Special Modifications (SEC_227) attaches to a Vehicle, and may create a Spy on a Transport', () => {
    const s = board({ units: [unit('g', 'GRD'), unit('v', 'VEH'), unit('t', 'TRANSPORT')], hand: ['SEC_227'] })
    const targets = moves(s).flatMap(m => (m.type === 'playUpgrade' ? [m.targetInstanceId] : [])).sort()
    expect(targets).toEqual(['t', 'v'])
    noChoice(playUpgrade(board({ units: [unit('v', 'VEH')] }), 'SEC_227', 'v'))
    const onTransport = playUpgrade(board({ units: [unit('t', 'TRANSPORT')] }), 'SEC_227', 't')
    expect(count(accept(onTransport), 'player', TOKEN_SPY)).toBe(1)
    expect(count(skip(onTransport), 'player', TOKEN_SPY)).toBe(0)
  })

  it('Assault Lander LAAT (TS26_23) deals 4 damage to itself as the regroup phase starts', () => {
    const s = fireUnitsTrigger(board({ units: [unit('a', 'TS26_23')] }), 'whenRegroupStarts', 'player')
    expect(U(s, 'a')!.damage).toBe(4)
  })

  it('Outspoken Representative (TWI_043) has Sentinel only while you control another Republic unit', () => {
    const alone = board({ units: [unit('a', 'TWI_043'), unit('g', 'GRD')] })
    expect(unitHasKeyword(alone, U(alone, 'a')!, 'Sentinel')).toBe(false)
    const withRepublic = board({ units: [unit('a', 'TWI_043'), unit('r', 'REP')] })
    expect(unitHasKeyword(withRepublic, U(withRepublic, 'a')!, 'Sentinel')).toBe(true)
  })

  it('Jedi General (TS26_55) creates a Clone Trooper with an Experience token for each Republic leader you control', () => {
    const none = play(board(), 'TS26_55')
    expect(count(none, 'player', TOKEN_CLONE_TROOPER)).toBe(0)
    const s = play(board({ leader: undeployedLeader('REP_L') }), 'TS26_55')
    const clones = made(s, 'player', TOKEN_CLONE_TROOPER)
    expect(clones).toHaveLength(1)
    expect(clones[0].upgrades.map(u => u.cardId)).toEqual([TOKEN_EXPERIENCE])
    // Deployed, the leader still counts: "as a leader or unit".
    const deployed = play(back('REP_L'), 'TS26_55')
    expect(count(deployed, 'player', TOKEN_CLONE_TROOPER)).toBe(1)
  })
})

describe('Token units, B: units that do more', () => {
  it("Poacher's Starfighter (HMW_153) may defeat itself to create a Beast with 1 damage", () => {
    const s = play(board(), 'HMW_153')
    const self = lastPlayed(s, 'HMW_153')
    const yes = accept(s)
    expect(U(yes, self)).toBeUndefined()
    expect(made(yes, 'player', TOKEN_BEAST).map(u => u.damage)).toEqual([1])
    const no = skip(s)
    expect(U(no, self)).toBeDefined()
    expect(count(no, 'player', TOKEN_BEAST)).toBe(0)
  })

  it('Chimaera (JTL_039) may use a When Defeated ability on another friendly unit, and creates 2 TIE Fighters when defeated', () => {
    const s = play(board({ units: [unit('occ', 'SEC_132'), unit('g', 'GRD')] }, { units: [unit('e', 'SEC_132')] }), 'JTL_039')
    // Only a friendly unit with a When Defeated ability is offered.
    expect(unitOffers(s)).toEqual(['occ'])
    const used = accept(s, { targetInstanceId: 'occ' })
    expect(count(used, 'player', TOKEN_SPY)).toBe(1)
    expect(U(used, 'occ')).toBeDefined()
    expect(count(skip(s), 'player', TOKEN_SPY)).toBe(0)
    noChoice(play(board({ units: [unit('g', 'GRD')] }), 'JTL_039'))
    expect(count(kill(board({ units: [unit('c', 'JTL_039')] }), 'c'), 'player', TOKEN_TIE_FIGHTER)).toBe(2)
  })

  it('Bail Organa (SEC_198) may discard a card on attack to create a Spy', () => {
    const s = attack(board({ units: [unit('a', 'SEC_198')], hand: ['EV'] }), 'a')
    const yes = accept(s, { handIndex: 0 })
    expect(yes.players.player.hand).toEqual([])
    expect(count(yes, 'player', TOKEN_SPY)).toBe(1)
    expect(count(skip(s), 'player', TOKEN_SPY)).toBe(0)
    expect(count(attack(board({ units: [unit('a', 'SEC_198')] }), 'a'), 'player', TOKEN_SPY)).toBe(0)
  })

  it('Poggle the Lesser (TWI_080) may exhaust itself when you play another unit to create a Battle Droid', () => {
    const s = play(board({ units: [unit('p', 'TWI_080')] }), 'GRD')
    const yes = accept(s)
    expect(U(yes, 'p')!.exhausted).toBe(true)
    expect(count(yes, 'player', TOKEN_BATTLE_DROID)).toBe(1)
    expect(count(skip(s), 'player', TOKEN_BATTLE_DROID)).toBe(0)
    // Already exhausted, there is nothing to pay with; an enemy's play is not yours.
    noChoice(play(board({ units: [unit('p', 'TWI_080', { exhausted: true })] }), 'GRD'))
    noChoice(play(board({ units: [unit('p', 'TWI_080')] }), 'GRD', 'opponent'))
  })

  it('Kraken (TWI_084) creates 2 Battle Droids, and gives each friendly token unit +1/+1 for the phase on attack', () => {
    expect(count(play(board(), 'TWI_084'), 'player', TOKEN_BATTLE_DROID)).toBe(2)
    const s = attack(board({ units: [unit('k', 'TWI_084'), unit('bd', TOKEN_BATTLE_DROID), unit('g', 'GRD')] }, { units: [unit('ebd', TOKEN_BATTLE_DROID)] }), 'k')
    expect([effectivePower(s, U(s, 'bd')!), effectiveHp(s, U(s, 'bd')!)]).toEqual([2, 2])
    expect(effectivePower(s, U(s, 'g')!)).toBe(2)
    expect(effectivePower(s, U(s, 'ebd')!)).toBe(1)
  })

  it('Shaak Ti (TWI_094) gives each friendly token unit +1/+0, and creates a Clone Trooper on attack', () => {
    const s = board({ units: [unit('st', 'TWI_094'), unit('bd', TOKEN_BATTLE_DROID), unit('g', 'GRD')] }, { units: [unit('ebd', TOKEN_BATTLE_DROID)] })
    expect(effectivePower(s, U(s, 'bd')!)).toBe(2)
    expect(effectivePower(s, U(s, 'g')!)).toBe(2)
    expect(effectivePower(s, U(s, 'ebd')!)).toBe(1)
    expect(count(attack(s, 'st'), 'player', TOKEN_CLONE_TROOPER)).toBe(1)
  })

  it('Chancellor Palpatine (TWI_203) makes the token units you create enter ready, and creates a Clone Trooper on attack if a unit left play', () => {
    const withPalp = play(board({ units: [unit('p', 'TWI_203')] }), 'TWI_097')
    expect(made(withPalp, 'player', TOKEN_CLONE_TROOPER).map(u => u.exhausted)).toEqual([false, false])
    // Only your tokens: an opponent's still enter exhausted.
    const theirs = play(board({ units: [unit('p', 'TWI_203')] }), 'TWI_145')
    expect(made(theirs, 'opponent', TOKEN_BATTLE_DROID).map(u => u.exhausted)).toEqual([true, true])
    expect(count(attack(board({ units: [unit('p', 'TWI_203')] }), 'p'), 'player', TOKEN_CLONE_TROOPER)).toBe(0)
    const left = board({ units: [unit('p', 'TWI_203')] }, {}, { phaseEvents: phaseEvents({ leftPlay: { player: [], opponent: ['GRD'] } }) })
    expect(count(attack(left, 'p'), 'player', TOKEN_CLONE_TROOPER)).toBe(1)
  })

  it('The Invisible Hand (TWI_234) creates 4 Battle Droids, and on attack exhausts any number of friendly Separatist units for 1 base damage each', () => {
    expect(count(play(board(), 'TWI_234'), 'player', TOKEN_BATTLE_DROID)).toBe(4)
    const s = attack(board({ units: [unit('ih', 'TWI_234'), unit('s1', 'SEP'), unit('s2', 'SEP'), unit('s3', 'SEP', { exhausted: true }), unit('g', 'SPC')] }), 'ih')
    expect(unitOffers(s)).toEqual(['s1', 's2'])
    const one = accept(s, { targetInstanceId: 's1' })
    const two = accept(one, { targetInstanceId: 's2' })
    expect(U(two, 's1')!.exhausted && U(two, 's2')!.exhausted).toBe(true)
    // 4 combat damage plus 1 for each unit exhausted.
    expect(baseDamage(two, 'opponent')).toBe(6)
    expect(baseDamage(skip(one), 'opponent')).toBe(5)
  })

  it('Nameless Valor (TWI_119) attaches only to a token unit', () => {
    const s = board({ units: [unit('g', 'GRD'), unit('t', TOKEN_CLONE_TROOPER)], hand: ['TWI_119'] })
    expect(moves(s).flatMap(m => (m.type === 'playUpgrade' ? [m.targetInstanceId] : []))).toEqual(['t'])
  })
})

describe('Token units, C: events', () => {
  type Row = [id: string, token: string, n: number, ready: boolean]
  const rows: Row[] = [
    ['JTL_254', TOKEN_X_WING, 2, false],
    ['SEC_092', TOKEN_SPY, 5, false],
    ['TWI_237', TOKEN_BATTLE_DROID, 2, false],
    ['TWI_251', TOKEN_CLONE_TROOPER, 2, false],
    ['TWI_190', TOKEN_BATTLE_DROID, 3, true],
  ]
  for (const [id, token, n, isReady] of rows) {
    it(`${F[id].name} (${id}) creates ${n} ${TOKEN_UNIT_CARDS[token].name} tokens${isReady ? ' and readies them' : ''}`, () => {
      const s = playEvent(board(), id)
      expect(made(s, 'player', token).map(u => u.exhausted)).toEqual(Array(n).fill(!isReady))
    })
  }

  it('Mysterious Disappearance (HMW_058): a chosen player picks a non-leader unit they control; you may defeat it, and they create a Beast', () => {
    const s = playEvent(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD'), unit('eL', 'GRD', { isLeader: true })] }), 'HMW_058')
    // optionIndex 0 picks the opponent.
    const theirPick = accept(s, { optionIndex: 0 })
    expect(choice(theirPick).controller).toBe('opponent')
    expect(unitOffers(theirPick)).toEqual(['e'])
    const picked = accept(theirPick, { targetInstanceId: 'e' })
    const defeated = accept(picked)
    expect(U(defeated, 'e')).toBeUndefined()
    expect(count(defeated, 'opponent', TOKEN_BEAST)).toBe(1)
    const spared = skip(picked)
    expect(U(spared, 'e')).toBeDefined()
    expect(count(spared, 'opponent', TOKEN_BEAST)).toBe(0)
  })

  it('Migrate (HMW_150) creates a Beast for every 3 resources you control', () => {
    expect(count(playEvent(board({ resources: ready(8) }), 'HMW_150'), 'player', TOKEN_BEAST)).toBe(2)
    expect(count(playEvent(board({ resources: ready(9) }), 'HMW_150'), 'player', TOKEN_BEAST)).toBe(3)
  })

  it('Run Amok (HMW_194) creates a Beast, then deals 1 damage to a friendly and to an enemy ground unit', () => {
    const s = playEvent(board({ units: [unit('f', 'GRD'), unit('fs', 'SPC')] }, { units: [unit('e', 'GRD'), unit('es', 'SPC')] }), 'HMW_194')
    const beast = made(s, 'player', TOKEN_BEAST)[0].instanceId
    // Two damage choices, one over each side's ground units. The new Beast is a friendly ground unit.
    const raised = (s.pendingChoices ?? []) as Extract<PendingChoice, { kind: 'selectDamageTarget' }>[]
    expect(raised.map(c => [...c.unitTargets].sort().join()).sort()).toEqual([[beast, 'f'].sort().join(), 'e'].sort())
    const answer = (st: GameState, target: string) => {
      const c = raised.find(x => x.unitTargets.includes(target))!
      return resolve(st, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: target })
    }
    const done = answer(answer(s, 'f'), 'e')
    expect([U(done, 'e')!.damage, U(done, 'f')!.damage]).toEqual([1, 1])
  })

  it('Catch the Scent (HMW_195) creates 2 Beasts and readies 1', () => {
    const s = playEvent(board(), 'HMW_195')
    expect(made(s, 'player', TOKEN_BEAST).map(u => u.exhausted).sort()).toEqual([false, true])
  })

  it("Howl (HMW_241) creates a Beast, and may return a non-leader unit to its owner's hand", () => {
    const s = playEvent(board({}, { units: [unit('e', 'GRD'), unit('eL', 'GRD', { isLeader: true })] }), 'HMW_241')
    expect(count(s, 'player', TOKEN_BEAST)).toBe(1)
    expect(unitOffers(s)).not.toContain('eL')
    const back = accept(s, { targetInstanceId: 'e' })
    expect(back.players.opponent.hand).toEqual(['GRD'])
    expect(U(skip(s), 'e')).toBeDefined()
  })

  it('Growth (HMW_272) creates a Beast, heals 3 damage from your base and draws a card', () => {
    const s = playEvent(board({ base: { cardId: 'TST_B', damage: 5 }, deck: ['GRD'] }), 'HMW_272')
    expect(count(s, 'player', TOKEN_BEAST)).toBe(1)
    expect(baseDamage(s, 'player')).toBe(2)
    expect(s.players.player.hand).toEqual(['GRD'])
  })

  it('Covering the Wing (JTL_076) creates an X-Wing and may give a Shield token to another unit', () => {
    const s = playEvent(board({ units: [unit('f', 'GRD')] }), 'JTL_076')
    const xwing = made(s, 'player', TOKEN_X_WING)[0].instanceId
    expect(unitOffers(s)).toEqual(['f'])
    expect(U(accept(s, { targetInstanceId: 'f' }), 'f')!.upgrades.map(u => u.cardId)).toEqual([TOKEN_SHIELD])
    expect(U(skip(s), xwing)!.upgrades).toEqual([])
  })

  it("Scramble Fighters (JTL_092) creates 8 ready TIE Fighters that can't attack bases this phase", () => {
    const s = playEvent(board(), 'JTL_092')
    const ties = made(s, 'player', TOKEN_TIE_FIGHTER)
    expect(ties).toHaveLength(8)
    expect(ties.every(u => !u.exhausted && unitCannotAttackBases(s, u))).toBe(true)
  })

  it('All Wings Report In (JTL_122) exhausts up to 2 friendly space units and creates an X-Wing for each', () => {
    const s = playEvent(board({ units: [unit('a', 'SPC'), unit('b', 'SPC'), unit('c', 'SPC'), unit('x', 'SPC', { exhausted: true }), unit('g', 'GRD')] }), 'JTL_122')
    expect(unitOffers(s)).toEqual(['a', 'b', 'c'])
    const two = accept(accept(s, { targetInstanceId: 'a' }), { targetInstanceId: 'b' })
    expect(count(two, 'player', TOKEN_X_WING)).toBe(2)
    noChoice(two)
    expect(count(skip(accept(s, { targetInstanceId: 'a' })), 'player', TOKEN_X_WING)).toBe(1)
  })

  it('Timely Reinforcements (JTL_130) creates an X-Wing with Sentinel for this phase for every 2 resources an opponent controls', () => {
    const s = playEvent(board({}, { resources: ready(7) }), 'JTL_130')
    const xwings = made(s, 'player', TOKEN_X_WING)
    expect(xwings).toHaveLength(3)
    expect(xwings.every(u => unitHasKeyword(s, u, 'Sentinel'))).toBe(true)
  })

  it('They Hate That Ship (JTL_155) has an opponent create 2 ready TIE Fighters, then plays a Vehicle unit from your hand for 3 less', () => {
    const s = playEvent(board({ hand: ['VEH_HAND', 'GRD'] }), 'JTL_155')
    expect(made(s, 'opponent', TOKEN_TIE_FIGHTER).map(u => u.exhausted)).toEqual([false, false])
    expect(choice(s)).toMatchObject({ kind: 'playUnitFromHand', costDelta: -3 })
    const before = readyCount(s, 'player')
    const played = accept(s, { handIndex: 0 })
    expect(played.players.player.units.map(u => u.cardId)).toContain('VEH_HAND')
    expect(before - readyCount(played, 'player')).toBe(2)
  })

  it("Commence Patrol (JTL_205) puts another card from a discard pile on the bottom of its owner's deck, and then creates an X-Wing", () => {
    const s = playEvent(board({ deck: ['GRD2'] }, { discard: ['GRD'] }), 'JTL_205')
    // Only the opponent's pile has another card in it, so there is no pile to choose.
    const done = accept(s, { optionIndex: 0 })
    expect(done.players.opponent.discard).toEqual([])
    expect(done.players.opponent.deck.at(-1)).toBe('GRD')
    expect(count(done, 'player', TOKEN_X_WING)).toBe(1)
    // With no other card in any discard pile, nothing is moved and no token is created.
    const empty = playEvent(board(), 'JTL_205')
    noChoice(empty)
    expect(count(empty, 'player', TOKEN_X_WING)).toBe(0)
  })

  it('Renewed Friendship (SEC_105) returns a unit from your discard pile to your hand and creates 2 Spies', () => {
    const s = playEvent(board({ discard: ['GRD', 'EV'] }), 'SEC_105')
    expect(count(s, 'player', TOKEN_SPY)).toBe(2)
    expect((choice(s) as { candidates: string[] }).candidates).toEqual(['GRD'])
    expect(accept(s, { optionIndex: 0 }).players.player.hand).toEqual(['GRD'])
  })

  it('Convene the Senate (SEC_128) searches the top 8 for up to 2 Official units, and creates a Spy', () => {
    const s = playEvent(board({ deck: ['OFFICIAL', 'GRD', 'OFFICIAL'] }), 'SEC_128')
    expect(count(s, 'player', TOKEN_SPY)).toBe(1)
    expect(choice(s)).toMatchObject({ kind: 'searchDraw', eligibleIndices: [0, 2] })
  })

  it("It's Not Over Yet (SEC_177) may ready a unit that didn't attack or enter play this phase, and creates a Spy", () => {
    const s = playEvent(board({ units: [unit('a', 'GRD', { exhausted: true }), unit('b', 'GRD2', { exhausted: true }), unit('c', 'SPC', { exhausted: true })] }, {},
      { phaseEvents: phaseEvents({ attackedUnits: ['a'], enteredPlay: { player: ['b'], opponent: [] } }) }), 'SEC_177')
    expect(count(s, 'player', TOKEN_SPY)).toBe(1)
    expect(unitOffers(s)).toEqual(['c'])
    expect(U(accept(s, { targetInstanceId: 'c' }), 'c')!.exhausted).toBe(false)
  })

  it('Pursue the Lead (SEC_178): the chosen player discards a card, and a Spy is created if it costs 3 or less', () => {
    const s = playEvent(board({}, { hand: ['EV_CHEAP', 'EV_PRICEY'] }), 'SEC_178')
    const theirs = accept(s, { optionIndex: 0 })
    expect(choice(theirs).controller).toBe('opponent')
    expect(count(accept(theirs, { handIndex: 0 }), 'player', TOKEN_SPY)).toBe(1)
    expect(count(accept(theirs, { handIndex: 1 }), 'player', TOKEN_SPY)).toBe(0)
  })

  it('Undercover Operation (SEC_236) readies a unit played this phase, and creates a Spy if it costs 3 or less', () => {
    const played = { phaseEvents: phaseEvents({ enteredPlay: { player: ['c', 'p'], opponent: [] } }) }
    const s = playEvent(board({ units: [unit('c', 'CHEAP', { exhausted: true }), unit('p', 'PRICEY', { exhausted: true }), unit('o', 'GRD', { exhausted: true })] }, {}, played), 'SEC_236')
    expect(unitOffers(s)).toEqual(['c', 'p'])
    const cheap = accept(s, { targetInstanceId: 'c' })
    expect(U(cheap, 'c')!.exhausted).toBe(false)
    expect(count(cheap, 'player', TOKEN_SPY)).toBe(1)
    expect(count(accept(s, { targetInstanceId: 'p' }), 'player', TOKEN_SPY)).toBe(0)
  })

  it('Contempt for Culture (SEC_246) deals 2 damage to a non-Vehicle unit and creates a Spy', () => {
    const s = playEvent(board({}, { units: [unit('e', 'GRD'), unit('v', 'VEH')] }), 'SEC_246')
    expect(count(s, 'player', TOKEN_SPY)).toBe(1)
    expect(unitOffers(s)).not.toContain('v')
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.damage).toBe(2)
  })

  it('Grievous Reassembly (TWI_073) heals 3 damage from a unit and creates a Battle Droid', () => {
    const s = playEvent(board({ units: [unit('f', 'GRD', { damage: 4 })] }), 'TWI_073')
    expect(count(s, 'player', TOKEN_BATTLE_DROID)).toBe(1)
    expect(U(accept(s, { targetInstanceId: 'f' }), 'f')!.damage).toBe(1)
  })

  it('Death by Droids (TWI_076) defeats a unit that costs 3 or less and creates 2 Battle Droids', () => {
    const s = playEvent(board({}, { units: [unit('c', 'CHEAP'), unit('p', 'PRICEY')] }), 'TWI_076')
    expect(count(s, 'player', TOKEN_BATTLE_DROID)).toBe(2)
    expect(unitOffers(s)).not.toContain('p')
    expect(U(accept(s, { targetInstanceId: 'c' }), 'c')).toBeUndefined()
  })

  it('Reprocess (TWI_088) puts up to 4 units from your discard pile on the bottom of your deck and creates that many Battle Droids', () => {
    const s = playEvent(board({ discard: ['GRD', 'EV', 'GRD2'] }), 'TWI_088')
    expect((choice(s) as { candidates: string[] }).candidates).toEqual(['GRD', 'GRD2'])
    const one = accept(s, { optionIndex: 0 })
    const two = accept(one, { optionIndex: 0 })
    expect(two.players.player.discard).toEqual(['EV', 'TWI_088'])
    expect([...two.players.player.deck].sort()).toEqual(['GRD', 'GRD2'])
    expect(count(two, 'player', TOKEN_BATTLE_DROID)).toBe(2)
    expect(count(skip(one), 'player', TOKEN_BATTLE_DROID)).toBe(1)
  })

  it('The Clone Wars (TWI_125) pays any number of resources: that many Clone Troopers for you and Battle Droids for each opponent', () => {
    const s = playEvent(board({ resources: ready(6) }), 'TWI_125')
    const left = readyCount(s, 'player')
    const done = accept(s, { optionIndex: 3 })
    expect(readyCount(done, 'player')).toBe(left - 3)
    expect(count(done, 'player', TOKEN_CLONE_TROOPER)).toBe(3)
    expect(count(done, 'opponent', TOKEN_BATTLE_DROID)).toBe(3)
  })

  it('Creative Thinking (TWI_200) exhausts a non-unique unit and creates a Clone Trooper', () => {
    const s = playEvent(board({}, { units: [unit('e', 'GRD'), unit('u', 'UNIQ')] }), 'TWI_200')
    expect(count(s, 'player', TOKEN_CLONE_TROOPER)).toBe(1)
    expect(unitOffers(s)).not.toContain('u')
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
  })

  it("Political Pressure (TWI_222): an opponent may discard a random card; if they don't, create 2 Battle Droids", () => {
    const s = playEvent(board({}, { hand: ['GRD'] }), 'TWI_222')
    expect(choice(s).controller).toBe('opponent')
    const discarded = accept(s)
    expect(discarded.players.opponent.hand).toEqual([])
    expect(count(discarded, 'player', TOKEN_BATTLE_DROID)).toBe(0)
    expect(count(skip(s), 'player', TOKEN_BATTLE_DROID)).toBe(2)
    // With nothing in hand there is nothing to discard.
    expect(count(playEvent(board(), 'TWI_222'), 'player', TOKEN_BATTLE_DROID)).toBe(2)
  })

  it('Execute Order 66 (TWI_239) deals 6 damage to each Jedi unit; each one defeated gives its controller a Clone Trooper', () => {
    const s = playEvent(board({ units: [unit('j', 'JEDI'), unit('g', 'GRD')] }, { units: [unit('ej', 'JEDI'), unit('big', 'JEDI_BIG')] }), 'TWI_239')
    expect(U(s, 'j')).toBeUndefined()
    expect(U(s, 'ej')).toBeUndefined()
    expect(U(s, 'big')!.damage).toBe(6)
    expect(U(s, 'g')!.damage).toBe(0)
    expect(count(s, 'player', TOKEN_CLONE_TROOPER)).toBe(1)
    expect(count(s, 'opponent', TOKEN_CLONE_TROOPER)).toBe(1)
  })
})

describe('Token units, D: leaders', () => {
  it('Tarfful (HMW_010): the front pays 2 and a discard for a Beast; deployed, he may pay 1 on attack for one', () => {
    expect(usable(front('HMW_010'))).toBe(false)
    const s = useFront(front('HMW_010', { hand: ['EV'] }))
    const done = accept(s, { handIndex: 0 })
    expect(done.players.player.hand).toEqual([])
    expect(count(done, 'player', TOKEN_BEAST)).toBe(1)
    const atk = attack(back('HMW_010'), 'L')
    expect(count(accept(atk), 'player', TOKEN_BEAST)).toBe(1)
    expect(count(skip(atk), 'player', TOKEN_BEAST)).toBe(0)
  })

  it('Poggle the Lesser (HMW_012): readies a friendly Creature and deals 1 damage to it; deployed, creates a Beast', () => {
    expect(usable(front('HMW_012'))).toBe(false)
    const s = useFront(front('HMW_012', { units: [unit('c', 'CREATURE', { exhausted: true })] }))
    const done = accept(s, { targetInstanceId: 'c' })
    expect(U(done, 'c')).toMatchObject({ exhausted: false, damage: 1 })
    const deployed = resolve(board({ leader: undeployedLeader('HMW_012'), resources: ready(6) }), { type: 'deployLeader' })
    expect(count(deployed, 'player', TOKEN_BEAST)).toBe(1)
    const atk = attack(back('HMW_012', { units: [unit('c', 'CREATURE', { exhausted: true })] }), 'L')
    expect(U(accept(atk, { targetInstanceId: 'c' }), 'c')).toMatchObject({ exhausted: false, damage: 1 })
  })

  it("Admiral Ackbar (JTL_016): exhaust a unit, and its controller creates an X-Wing", () => {
    const s = useFront(front('JTL_016', {}, { units: [unit('e', 'GRD'), unit('eL', 'GRD', { isLeader: true })] }))
    expect(unitOffers(s)).toEqual(['e'])
    const done = accept(s, { targetInstanceId: 'e' })
    expect(U(done, 'e')!.exhausted).toBe(true)
    expect(count(done, 'opponent', TOKEN_X_WING)).toBe(1)
    const atk = attack(back('JTL_016', { units: [unit('f', 'GRD')] }), 'L')
    const own = accept(atk, { targetInstanceId: 'f' })
    expect(count(own, 'player', TOKEN_X_WING)).toBe(1)
    expect(count(skip(atk), 'player', TOKEN_X_WING)).toBe(0)
  })

  it('Governor Pryce (SEC_011): readies a token unit; deployed, +1/+0 per ready friendly token unit and a Spy on attack', () => {
    expect(usable(front('SEC_011', { units: [unit('g', 'GRD', { exhausted: true })] }))).toBe(false)
    const s = useFront(front('SEC_011', { units: [unit('t', TOKEN_SPY, { exhausted: true })] }))
    expect(U(accept(s, { targetInstanceId: 't' }), 't')!.exhausted).toBe(false)
    const b = back('SEC_011', { units: [unit('t1', TOKEN_SPY), unit('t2', TOKEN_SPY, { exhausted: true }), unit('g', 'GRD')] })
    expect(effectivePower(b, U(b, 'L')!)).toBe(F['SEC_011'].power! + 1)
    expect(count(attack(back('SEC_011'), 'L'), 'player', TOKEN_SPY)).toBe(1)
  })

  it('Sly Moore (SEC_014): a Spy while 4 or more units are exhausted; deployed, may deal 2 damage to an exhausted unit on attack', () => {
    const three = [unit('a', 'GRD', { exhausted: true }), unit('b', 'GRD', { exhausted: true }), unit('c', 'GRD', { exhausted: true })]
    expect(usable(front('SEC_014', { units: three }))).toBe(false)
    const four = front('SEC_014', { units: three }, { units: [unit('d', 'GRD', { exhausted: true })] })
    expect(count(useFront(four), 'player', TOKEN_SPY)).toBe(1)
    const atk = attack(back('SEC_014', {}, { units: [unit('e', 'GRD', { exhausted: true }), unit('r', 'GRD2')] }), 'L')
    // Sly Moore is exhausted by her own attack, so she is an exhausted unit too.
    expect(unitOffers(atk)).toEqual(['L', 'e'])
    expect(U(accept(atk, { targetInstanceId: 'e' }), 'e')!.damage).toBe(2)
  })

  it('Count Dooku (TS26_1): each player heals 1 from their base and creates a Battle Droid; deployed, 2 Battle Droids on attack', () => {
    const s = useFront(front('TS26_1', { base: { cardId: 'TST_B', damage: 3 } }, { base: { cardId: 'TST_B', damage: 3 } }))
    expect([baseDamage(s, 'player'), baseDamage(s, 'opponent')]).toEqual([2, 2])
    expect([count(s, 'player', TOKEN_BATTLE_DROID), count(s, 'opponent', TOKEN_BATTLE_DROID)]).toEqual([1, 1])
    expect(count(attack(back('TS26_1'), 'L'), 'player', TOKEN_BATTLE_DROID)).toBe(2)
  })

  it('Nute Gunray (TWI_002): a Battle Droid if 2 or more friendly units were defeated this phase; deployed, one on attack', () => {
    expect(usable(front('TWI_002', {}, {}, { phaseEvents: phaseEvents({ defeated: { player: ['GRD'], opponent: ['GRD', 'GRD'] } }) }))).toBe(false)
    const two = front('TWI_002', {}, {}, { phaseEvents: phaseEvents({ defeated: { player: ['GRD', 'GRD2'], opponent: [] } }) })
    expect(count(useFront(two), 'player', TOKEN_BATTLE_DROID)).toBe(1)
    expect(count(attack(back('TWI_002'), 'L'), 'player', TOKEN_BATTLE_DROID)).toBe(1)
  })

  it('Captain Rex (TWI_007): a Clone Trooper if a friendly unit attacked this phase; deployed, one on deploy and +0/+1 to other Troopers', () => {
    expect(usable(front('TWI_007', { units: [unit('g', 'GRD')] }))).toBe(false)
    const attacked = front('TWI_007', { units: [unit('g', 'GRD', { exhausted: true })] }, {}, { phaseEvents: phaseEvents({ attackedUnits: ['g'] }) })
    expect(count(useFront(attacked), 'player', TOKEN_CLONE_TROOPER)).toBe(1)
    const deployed = resolve(board({ leader: undeployedLeader('TWI_007'), resources: ready(6) }), { type: 'deployLeader' })
    const clone = made(deployed, 'player', TOKEN_CLONE_TROOPER)[0]
    expect(effectiveHp(deployed, clone)).toBe(3)
    const rex = deployed.players.player.units.find(u => u.isLeader)!
    expect(effectiveHp(deployed, rex)).toBe(F['TWI_007'].hp)
  })
})

/**
 * Creating a token unit is seen by the abilities that read "create" or "enters play", and by no ability
 * that reads "play". Droid Deployment (TWI_237) creates 2 Battle Droids, which exercises each token
 * being its own arrival.
 */
describe('Token units: who sees one being created', () => {
  const CREATES_TWO = 'TWI_237'
  const hasAdvantage = (u: UnitState) => u.upgrades.some(x => x.cardId === TOKEN_ADVANTAGE)
  const droids = (s: GameState, who: PlayerId = 'player') => made(s, who, TOKEN_BATTLE_DROID)

  it('Greef Karga (ASH_017), deployed: each created token unit gets an Advantage token', () => {
    const s = playEvent(back('ASH_017'), CREATES_TWO)
    noChoice(s)
    expect(droids(s).map(hasAdvantage)).toEqual([true, true])
  })

  it('Greef Karga (ASH_017), front: creating a token unit offers to exhaust him for an Advantage token on it', () => {
    const s = playEvent(front('ASH_017'), CREATES_TWO)
    expect(choice(s).kind).toBe('mayExhaustLeaderForAdvantage')
    const yes = accept(s)
    expect(yes.players.player.leader.exhausted).toBe(true)
    // Exhausted by the first, he has nothing left to pay the second with.
    noChoice(yes)
    expect(droids(yes).map(hasAdvantage).sort()).toEqual([false, true])
  })

  it("Greef Karga (ASH_017) does not see an opponent's token units being created", () => {
    const s = playEvent(board({}, { leader: deployedLeader('ASH_017'), units: [unit('L', 'ASH_017', { isLeader: true })] }), CREATES_TWO)
    expect(droids(s).map(hasAdvantage)).toEqual([false, false])
  })

  it('Outcast (ASH_041): a created token unit enters play, so it gets +1/+0 for the phase', () => {
    const s = playEvent(board({ units: [unit('o', 'ASH_041')] }), CREATES_TWO)
    expect(droids(s).map(d => effectivePower(s, d))).toEqual([2, 2])
  })

  it('an ability that reads "when you play another unit" does not see a token unit being created', () => {
    // Maz Kanata (SHD_096) and Poggle the Lesser (TWI_080).
    const s = playEvent(board({ units: [unit('m', 'SHD_096'), unit('p', 'TWI_080')] }), CREATES_TWO)
    noChoice(s)
    expect(droids(s)).toHaveLength(2)
    expect(U(s, 'm')!.upgrades.some(x => x.cardId === TOKEN_EXPERIENCE)).toBe(false)
  })
})
