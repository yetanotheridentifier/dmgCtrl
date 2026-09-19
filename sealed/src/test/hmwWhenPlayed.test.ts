import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword } from '../engine/keywords'
import { getCardDefinition } from '../engine/abilities'
import { normaliseCard } from '../engine/cardDb'
import { healBase } from '../engine/effects'
import { TOKEN_SHIELD, hasToken } from '../engine/tokenUpgrades'
import { describeAction } from '../utils/describeAction'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Homeworlds units and upgrades whose ability is a When Played (Ben Kenobi adds an On Attack).
 *
 * Almost all of them are registrations over the choices the other sets already built; what the tests
 * pin is the part each card decides: who picks, which units qualify, whether it may be declined, and
 * on what condition it fires at all. The few engine additions are named where they are tested: a
 * "choose one" whose modes the card resolves itself, the record of which units attacked a base, a
 * per-card cost cap and damage rider on a search that plays units free.
 */

const SHIPPED = [
  // A: a chosen unit, base or upgrade is damaged, defeated, exhausted, readied or returned
  'HMW_042', 'HMW_046', 'HMW_068', 'HMW_079', 'HMW_086', 'HMW_092', 'HMW_130', 'HMW_158', 'HMW_159', 'HMW_165',
  'HMW_177', 'HMW_186', 'HMW_222', 'HMW_230', 'HMW_236', 'HMW_249', 'HMW_252', 'HMW_261', 'HMW_263',
  // B: buffs, keywords, Shields, cards drawn, resources, searches
  'HMW_052', 'HMW_072', 'HMW_080', 'HMW_085', 'HMW_091', 'HMW_103', 'HMW_111', 'HMW_121', 'HMW_123', 'HMW_127',
  'HMW_136', 'HMW_148', 'HMW_154', 'HMW_180', 'HMW_189', 'HMW_228', 'HMW_243', 'HMW_246', 'HMW_247', 'HMW_255',
  'HMW_264', 'HMW_265',
  // C: a mode, a count or a chain decided as the ability resolves
  'HMW_035', 'HMW_036', 'HMW_043', 'HMW_051', 'HMW_078', 'HMW_094', 'HMW_105', 'HMW_221', 'HMW_232',
]

const POOL = poolFor(['HMW'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 8, ...over })
const base = (id: string, trait?: string) => card({ id, type: 'base', hp: 30, aspects: ['Vigilance'], traits: trait ? [trait] : [] })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  GRD: src('GRD'),
  SPC: src('SPC', { arena: 'space' }),
  BIG: src('BIG', { power: 5 }),
  ONE: src('ONE', { cost: 1 }),
  EWOK: src('EWOK', { traits: ['EWOK'] }),
  REBEL: src('REBEL', { traits: ['REBEL'] }),
  GUNGAN: src('GUNGAN', { traits: ['GUNGAN'] }),
  TUSKEN: src('TUSKEN', { traits: ['TUSKEN'] }),
  WOOKIEE: src('WOOKIEE', { traits: ['WOOKIEE'] }),
  TWILEK: src('TWILEK', { traits: ["TWI'LEK"], cost: 3 }),
  TWILEK2: src('TWILEK2', { traits: ["TWI'LEK"], cost: 2 }),
  TWILEK3: src('TWILEK3', { traits: ["TWI'LEK"], cost: 3 }),
  VIL: src('VIL', { aspects: ['Villainy'] }),
  HER: src('HER', { aspects: ['Heroism'] }),
  CHEWIE: src('CHEWIE', { name: 'Chewbacca' }),
  LEADER: src('LEADER'),
  CHEAP: src('CHEAP', { cost: 3 }),
  PRICEY: src('PRICEY', { cost: 5 }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 3, power: 1, hp: 1 }),
  UPG4: card({ id: 'UPG4', type: 'upgrade', cost: 4, power: 1, hp: 1 }),
  EVT: card({ id: 'EVT', type: 'event', cost: 1 }),
  DISASTER: card({ id: 'DISASTER', type: 'event', cost: 1, traits: ['DISASTER'] }),
  TAT_B: base('TAT_B', 'TATOOINE'),
  NAB_B: base('NAB_B', 'NABOO'),
  END_B: base('END_B', 'ENDOR'),
}

const S = { cardId: TOKEN_SHIELD, owner: 'player' as PlayerId }
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
const shielded = (s: GameState, id: string) => hasToken(U(s, id)?.upgrades ?? [], TOKEN_SHIELD)

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
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; baseTarget?: PlayerId; deckIndex?: number }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const unitOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : [])))].sort()
const baseOffers = (s: GameState) =>
  [...new Set(moves(s).flatMap(m => (m.type === 'acceptChoice' && m.baseTarget ? [m.baseTarget] : [])))].sort()
const declinable = (s: GameState) => moves(s).some(m => m.type === 'skipTrigger')
const readyCount = (s: GameState, who: PlayerId) => s.players[who].resources.filter(r => !r.exhausted).length
const modeLabels = (s: GameState) =>
  moves(s).filter(m => m.type === 'acceptChoice').map(m => describeAction(s, 'player', m))

const play = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState => {
  const p = s.players[who]
  const withCard = { ...s, activePlayer: who, players: { ...s.players, [who]: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playUnit', handIndex: p.hand.length })
}
const self = (s: GameState, cardId: string): string => s.players.player.units.find(u => u.cardId === cardId)!.instanceId
const playUpgrade = (s: GameState, cardId: string, target: string): GameState => {
  const p = s.players.player
  const withCard = { ...s, activePlayer: 'player' as PlayerId, players: { ...s.players, player: { ...p, hand: [...p.hand, cardId] } } }
  return resolve(withCard, { type: 'playUpgrade', handIndex: p.hand.length, targetInstanceId: target })
}
const attack = (s: GameState, attackerId: string, target?: string) =>
  resolve(s, { type: 'attack', attackerId, target: target ? { kind: 'unit', instanceId: target } : { kind: 'base' } })
const power = (s: GameState, id: string) => effectivePower(s, U(s, id)!)

describe('HMW When Played: registration', () => {
  it('registers an ability for every shipped card', () => {
    for (const id of SHIPPED) expect(getCardDefinition(id), id).toBeDefined()
  })
})

describe('HMW When Played, A: a chosen target', () => {
  it('Dooku (HMW_042) may ready another exhausted unit, then heals a base by that unit\'s cost', () => {
    const s = play(board({ base: { cardId: 'TST_B', damage: 5 }, units: [unit('f', 'CHEAP', { exhausted: true }), unit('r', 'GRD')] },
      { units: [unit('e', 'GRD', { exhausted: true })] }), 'HMW_042')
    expect(unitOffers(s)).toEqual(['e', 'f'])
    expect(declinable(s)).toBe(true)
    const readied = accept(s, { targetInstanceId: 'f' })
    expect(U(readied, 'f')!.exhausted).toBe(false)
    expect(baseOffers(readied)).toEqual(['opponent', 'player'])
    expect(accept(readied, { baseTarget: 'player' }).players.player.base.damage).toBe(2)
  })

  it('Krrsantan (HMW_046) may deal damage to a ground unit equal to resources controlled minus 3', () => {
    const s = play(board({}, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'HMW_046')
    expect(unitOffers(s)).toEqual(['e', self(s, 'HMW_046')].sort())
    expect(declinable(s)).toBe(true)
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.damage).toBe(7)
    // Resources controlled, ready or not: the 6 it cost (with the aspect penalty) still count.
    const seven = choice(play(board({ resources: ready(7) }, { units: [unit('e', 'GRD')] }), 'HMW_046'))
    expect(seven.kind === 'selectDamageTarget' && seven.amount).toBe(4)
  })

  it('Imperial Commandos (HMW_068) may defeat a non-leader unit with 4 or less power', () => {
    const s = play(board({}, { units: [unit('e', 'GRD'), unit('b', 'BIG'), unit('l', 'LEADER', { isLeader: true })] }), 'HMW_068')
    expect(unitOffers(s)).toEqual(['e'])
    expect(declinable(s)).toBe(true)
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')).toBeUndefined()
  })

  it('Radiant VII (HMW_079) may take 3 damage to give itself a Shield', () => {
    const s = play(board(), 'HMW_079')
    expect(declinable(s)).toBe(true)
    const done = accept(s)
    const id = self(done, 'HMW_079')
    expect([U(done, id)!.damage, shielded(done, id)]).toEqual([3, true])
    const declined = skip(s)
    expect([U(declined, id)!.damage, shielded(declined, id)]).toEqual([0, false])
  })

  it('N-1 Patroller (HMW_086) may defeat a non-leader unit with 1 or less remaining HP', () => {
    const s = play(board({}, { units: [unit('e', 'GRD', { damage: 7 }), unit('h', 'GRD', { damage: 6 }), unit('l', 'LEADER', { isLeader: true, damage: 7 })] }), 'HMW_086')
    expect(unitOffers(s)).toEqual(['e'])
    expect(declinable(s)).toBe(true)
  })

  it('Starlit Purrgil (HMW_092) may exhaust a unit', () => {
    const s = play(board({}, { units: [unit('e', 'GRD')] }), 'HMW_092')
    expect(unitOffers(s)).toContain('e')
    expect(declinable(s)).toBe(true)
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
  })

  it('Emerie Karr (HMW_130) may deal 1 to another ground unit, and the next unit costs 1 less only if it was friendly', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'HMW_130')
    expect(unitOffers(s)).toEqual(['e', 'f'])
    expect(declinable(s)).toBe(true)
    const mine = accept(s, { targetInstanceId: 'f' })
    expect(U(mine, 'f')!.damage).toBe(1)
    expect(mine.players.player.nextUnitGrants).toEqual([{ costDelta: -1 }])
    const theirs = accept(s, { targetInstanceId: 'e' })
    expect(U(theirs, 'e')!.damage).toBe(1)
    expect(theirs.players.player.nextUnitGrants ?? []).toEqual([])
  })

  it('Battle-Scarred Destroyer (HMW_158) must deal 4 damage to a friendly unit, itself included', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_158')
    expect(unitOffers(s)).toEqual(['f', self(s, 'HMW_158')].sort())
    expect(declinable(s)).toBe(false)
    expect(U(accept(s, { targetInstanceId: 'f' }), 'f')!.damage).toBe(4)
  })

  it("General Grievous (HMW_159) deals 4 damage to a base, and while he is in play bases can't be healed", () => {
    const s = play(board({ resources: ready(12) }), 'HMW_159')
    expect(baseOffers(s)).toEqual(['opponent', 'player'])
    expect(declinable(s)).toBe(false)
    const hit = accept(s, { baseTarget: 'opponent' })
    expect(hit.players.opponent.base.damage).toBe(4)
    expect(healBase(hit, 'opponent', 3).players.opponent.base.damage).toBe(4)
    const without = board({}, { base: { cardId: 'TST_B', damage: 4 } })
    expect(healBase(without, 'opponent', 3).players.opponent.base.damage).toBe(1)
  })

  it('Commandeered Tour Shuttle (HMW_165) may ready another unit with 3 or less power', () => {
    const s = play(board({ units: [unit('f', 'GRD', { exhausted: true }), unit('b', 'BIG', { exhausted: true })] }), 'HMW_165')
    expect(unitOffers(s)).toEqual(['f'])
    expect(declinable(s)).toBe(true)
    expect(U(accept(s, { targetInstanceId: 'f' }), 'f')!.exhausted).toBe(false)
  })

  it('Adamant Ewoks (HMW_177) need another Ewok or an Endor base, then may deal 1 to a base and 1 to an enemy unit', () => {
    noChoice(play(board({}, { units: [unit('e', 'GRD')] }), 'HMW_177'))
    for (const s of [
      play(board({ units: [unit('w', 'EWOK')] }, { units: [unit('e', 'GRD')] }), 'HMW_177'),
      play(board({ base: { cardId: 'END_B', damage: 0 } }, { units: [unit('e', 'GRD')] }), 'HMW_177'),
    ]) {
      expect(declinable(s)).toBe(true)
      const yes = accept(s)
      expect(baseOffers(yes)).toEqual(['opponent', 'player'])
      const based = accept(yes, { baseTarget: 'opponent' })
      expect(based.players.opponent.base.damage).toBe(1)
      expect(unitOffers(based)).toEqual(['e'])
      expect(U(accept(based, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
    }
  })

  it('Mining Guild Trespasser (HMW_186) may deal 2 to a base and 2 to an enemy unit', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_186')
    expect(declinable(s)).toBe(true)
    const based = accept(accept(s), { baseTarget: 'opponent' })
    expect(based.players.opponent.base.damage).toBe(2)
    expect(unitOffers(based)).toEqual(['e'])
    expect(U(accept(based, { targetInstanceId: 'e' }), 'e')!.damage).toBe(2)
  })

  it('Sandcrawler Sales Team (HMW_222) with a Tatooine base may return an upgrade costing 3 or less', () => {
    const units = [unit('e', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }, { cardId: 'UPG4', owner: 'opponent' }] })]
    noChoice(play(board({}, { units }), 'HMW_222'))
    const s = play(board({ base: { cardId: 'TAT_B', damage: 0 } }, { units }), 'HMW_222')
    expect(declinable(s)).toBe(true)
    const c = choice(s)
    expect(c.kind === 'selectUpgradeToReturn' && c.candidates.map(x => x.cardId)).toEqual(['UPG'])
    expect(accept(s, { optionIndex: 0 }).players.opponent.hand).toEqual(['UPG'])
  })

  it('Raiding Party (HMW_230) with another Tusken or a Tatooine base may exhaust a ground unit', () => {
    noChoice(play(board({}, { units: [unit('e', 'GRD')] }), 'HMW_230'))
    const s = play(board({ units: [unit('t', 'TUSKEN')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), 'HMW_230')
    expect(unitOffers(s)).not.toContain('sp')
    expect(unitOffers(s)).toContain('e')
    expect(declinable(s)).toBe(true)
    expect(unitOffers(play(board({ base: { cardId: 'TAT_B', damage: 0 } }, { units: [unit('e', 'GRD')] }), 'HMW_230'))).toContain('e')
  })

  it('Booma Ball (HMW_236) may return an upgrade costing 3 or less, itself included since it is attached by then', () => {
    const s = playUpgrade(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }, { cardId: 'UPG4', owner: 'opponent' }] })] }), 'HMW_236', 'f')
    const c = choice(s)
    expect(c.kind === 'selectUpgradeToReturn' && c.candidates.map(x => x.cardId)).toEqual(['HMW_236', 'UPG'])
    expect(declinable(s)).toBe(true)
  })

  it('Frenzied Tri-Fighters (HMW_249) may defeat an upgrade costing 3 or less', () => {
    const s = play(board({}, { units: [unit('e', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }, { cardId: 'UPG4', owner: 'opponent' }] })] }), 'HMW_249')
    const c = choice(s)
    expect(c.kind === 'selectUpgradeToDefeat' && c.candidates.map(x => x.cardId)).toEqual(['UPG'])
    expect(declinable(s)).toBe(true)
    expect(U(accept(s, { optionIndex: 0 }), 'e')!.upgrades.map(u => u.cardId)).toEqual(['UPG4'])
  })

  it('Villainous Ambition (HMW_252) on a Villainy unit may deal 2 damage to a unit', () => {
    noChoice(playUpgrade(board({ units: [unit('h', 'HER')] }, { units: [unit('e', 'GRD')] }), 'HMW_252', 'h'))
    const s = playUpgrade(board({ units: [unit('v', 'VIL')] }, { units: [unit('e', 'GRD')] }), 'HMW_252', 'v')
    expect(unitOffers(s)).toEqual(['e', 'v'])
    expect(declinable(s)).toBe(true)
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.damage).toBe(2)
  })

  it('Ben Kenobi (HMW_261) may exhaust a unit with 3 or less power, and on attack may heal 3 from another unit', () => {
    const s = play(board({}, { units: [unit('e', 'GRD'), unit('b', 'BIG')] }), 'HMW_261')
    expect(unitOffers(s)).toEqual(['e'])
    expect(declinable(s)).toBe(true)
    const onBoard = board({ units: [unit('k', 'HMW_261'), unit('f', 'GRD', { damage: 5 })] })
    const attacking = attack(onBoard, 'k')
    expect(unitOffers(attacking)).toEqual(['f'])
    expect(declinable(attacking)).toBe(true)
    expect(U(accept(attacking, { targetInstanceId: 'f' }), 'f')!.damage).toBe(2)
  })

  it('Wrecker (HMW_263): each player chooses a unit they control, and each chosen unit takes 3', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD'), unit('e2', 'GRD')] }), 'HMW_263')
    expect(choice(s).controller).toBe('player')
    expect(unitOffers(s)).toEqual(['f', self(s, 'HMW_263')].sort())
    expect(declinable(s)).toBe(false)
    const mine = accept(s, { targetInstanceId: 'f' })
    expect(choice(mine).controller).toBe('opponent')
    expect(unitOffers(mine)).toEqual(['e', 'e2'])
    const done = accept(mine, { targetInstanceId: 'e2' })
    expect([U(done, 'f')!.damage, U(done, 'e')!.damage, U(done, 'e2')!.damage]).toEqual([3, 0, 3])
  })
})

describe('HMW When Played, B: buffs, tokens, cards and resources', () => {
  it("A'Koba (HMW_052) gives a unit +2/+0 for this phase", () => {
    const s = play(board({ units: [unit('f', 'GRD')] }), 'HMW_052')
    expect(declinable(s)).toBe(false)
    expect(power(accept(s, { targetInstanceId: 'f' }), 'f')).toBe(4)
  })

  it('Grand Army Marine (HMW_072) gives a Shield to a friendly Gungan unit, itself included', () => {
    const s = play(board({ units: [unit('g', 'GUNGAN'), unit('f', 'GRD')] }, { units: [unit('eg', 'GUNGAN')] }), 'HMW_072')
    expect(unitOffers(s)).toEqual(['g', self(s, 'HMW_072')].sort())
    expect(declinable(s)).toBe(false)
    expect(shielded(accept(s, { targetInstanceId: 'g' }), 'g')).toBe(true)
  })

  it('Fambaa Shield Team (HMW_080) shields each friendly ground unit that has none', () => {
    const s = play(board({ units: [unit('f', 'GRD'), unit('sh', 'GRD', { upgrades: [S] }), unit('sp', 'SPC')] }, { units: [unit('e', 'GRD')] }), 'HMW_080')
    noChoice(s)
    const shields = (id: string) => U(s, id)!.upgrades.filter(u => u.cardId === TOKEN_SHIELD).length
    expect([shields('f'), shields('sh'), shields('sp'), shields('e'), shields(self(s, 'HMW_080'))]).toEqual([1, 1, 0, 0, 1])
  })

  it('Remote Scout (HMW_085) searches the top 8 for an upgrade', () => {
    const s = play(board({ deck: ['GRD', 'UPG', 'EVT', 'UPG4'] }), 'HMW_085')
    const c = choice(s)
    expect(c.kind === 'searchDraw' && c.eligibleIndices).toEqual([1, 3])
  })

  it('Pelta Relief Frigate (HMW_091) heals 2 from your base and 2 from a friendly unit', () => {
    const s = play(board({ base: { cardId: 'TST_B', damage: 5 }, units: [unit('f', 'GRD', { damage: 3 })] }, { units: [unit('e', 'GRD', { damage: 3 })] }), 'HMW_091')
    expect(s.players.player.base.damage).toBe(3)
    expect(unitOffers(s)).toEqual(['f', self(s, 'HMW_091')].sort())
    expect(declinable(s)).toBe(false)
    expect(U(accept(s, { targetInstanceId: 'f' }), 'f')!.damage).toBe(1)
  })

  it('Disposable B1 (HMW_103) draws only if another friendly unit entered play this phase', () => {
    expect(play(board({ deck: ['GRD'] }), 'HMW_103').players.player.hand).toEqual([])
    const entered = board({ deck: ['GRD'], units: [unit('t', 'GRD')] }, {}, { phaseEvents: phaseEvents({ enteredPlay: { player: ['t'], opponent: [] } }) })
    expect(play(entered, 'HMW_103').players.player.hand).toEqual(['GRD'])
    const theirs = board({ deck: ['GRD'] }, { units: [unit('t', 'GRD')] }, { phaseEvents: phaseEvents({ enteredPlay: { player: [], opponent: ['t'] } }) })
    expect(play(theirs, 'HMW_103').players.player.hand).toEqual([])
  })

  it('Invasion Lander (HMW_111) gives each other friendly unit +2/+2 for this phase', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_111')
    expect([power(s, 'f'), effectiveHp(s, U(s, 'f')!), power(s, 'e'), power(s, self(s, 'HMW_111'))]).toEqual([4, 10, 2, 3])
  })

  it("Hijacked AT-ST (HMW_121) doesn't ready during the next regroup phase", () => {
    const s = play(board(), 'HMW_121')
    const at = U(s, self(s, 'HMW_121'))!
    const def = getCardDefinition('HMW_121')!
    expect(def.readiesInRegroup!(s, at)).toBe(false)
    expect(def.readiesInRegroup!(s, unit('x', 'HMW_121'))).toBe(true)
  })

  it('King Grakchawwaa (HMW_123) resources and readies a card per other friendly Wookiee', () => {
    const s = play(board({ resources: ready(6), deck: ['GRD', 'SPC', 'EVT'], units: [unit('w1', 'WOOKIEE'), unit('w2', 'WOOKIEE'), unit('f', 'GRD')] }), 'HMW_123')
    expect(s.players.player.resources.slice(-2)).toEqual([{ cardId: 'GRD', exhausted: false }, { cardId: 'SPC', exhausted: false }])
    expect(s.players.player.deck).toEqual(['EVT'])
  })

  it("Chewbacca's Bowcaster (HMW_127) resources the top card exhausted, on Chewbacca only, and attaches to a non-Vehicle", () => {
    const on = playUpgrade(board({ deck: ['GRD'], units: [unit('c', 'CHEWIE')] }), 'HMW_127', 'c')
    expect(on.players.player.resources.at(-1)).toEqual({ cardId: 'GRD', exhausted: true })
    const off = playUpgrade(board({ deck: ['GRD'], units: [unit('f', 'GRD')] }), 'HMW_127', 'f')
    expect(off.players.player.deck).toEqual(['GRD'])
    const def = getCardDefinition('HMW_127')!
    expect(def.attachRestriction!(board(), unit('v', 'GRD'), 'player')).toBe(true)
  })

  it('Lifetree Caravan (HMW_136) may resource the top card with 3 or more units', () => {
    noChoice(play(board({ deck: ['GRD'], units: [unit('f', 'GRD')] }), 'HMW_136'))
    const s = play(board({ deck: ['GRD'], units: [unit('f', 'GRD'), unit('g', 'GRD')] }), 'HMW_136')
    expect(choice(s).kind).toBe('mayResourceTop')
  })

  it('Local Support (HMW_148) draws the top card only if it shares a Trait with a friendly unit', () => {
    const shares = playUpgrade(board({ deck: ['EWOK', 'GRD'], units: [unit('w', 'EWOK')] }), 'HMW_148', 'w')
    expect(shares.players.player.hand).toEqual(['EWOK'])
    const not = playUpgrade(board({ deck: ['REBEL', 'GRD'], units: [unit('w', 'EWOK')] }), 'HMW_148', 'w')
    expect([not.players.player.hand, not.players.player.deck]).toEqual([[], ['REBEL', 'GRD']])
  })

  it("Dooku's Solar Sailer (HMW_154) makes each opponent discard if you control a unit costing 1 or less", () => {
    noChoice(play(board({ units: [unit('f', 'GRD')] }, { hand: ['GRD'] }), 'HMW_154'))
    const s = play(board({ units: [unit('o', 'ONE')] }, { hand: ['GRD'] }), 'HMW_154')
    expect([choice(s).kind, choice(s).controller]).toEqual(['selectDiscard', 'opponent'])
  })

  it('Stormchaser (HMW_180) draws with a Disaster in the discard, or after revealing one from hand', () => {
    expect(play(board({ deck: ['GRD'], hand: ['EVT'] }), 'HMW_180').players.player.hand).toEqual(['EVT'])
    expect(play(board({ deck: ['GRD'], discard: ['DISASTER'] }), 'HMW_180').players.player.hand).toEqual(['GRD'])
    const s = play(board({ deck: ['GRD'], hand: ['EVT', 'DISASTER'] }), 'HMW_180')
    expect(declinable(s)).toBe(true)
    expect(choice(s).kind === 'selectHandCardThen' && (choice(s) as { handIndices: number[] }).handIndices).toEqual([1])
    expect(accept(s, { handIndex: 1 }).players.player.hand).toEqual(['EVT', 'DISASTER', 'GRD'])
    expect(skip(s).players.player.hand).toEqual(['EVT', 'DISASTER'])
  })

  it('Neebray Manta (HMW_189) draws 3 cards', () => {
    expect(play(board({ deck: ['GRD', 'SPC', 'EVT', 'UPG'] }), 'HMW_189').players.player.hand).toEqual(['GRD', 'SPC', 'EVT'])
  })

  it('Lakeside Shaaks (HMW_228) readies a friendly resource', () => {
    // 4 plus the aspect penalty spends all 6, and the ability readies one of them.
    expect(readyCount(play(board({ resources: ready(6) }), 'HMW_228'), 'player')).toBe(1)
  })

  it('Sun Fac (HMW_243) gives a unit Grit for this phase', () => {
    const s = accept(play(board({ units: [unit('f', 'GRD')] }), 'HMW_243'), { targetInstanceId: 'f' })
    expect(unitHasKeyword(s, U(s, 'f')!, 'Grit')).toBe(true)
  })

  it('Pyke Sarisa (HMW_246) gives a unit Sentinel for this phase', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }), 'HMW_246')
    expect(declinable(s)).toBe(false)
    const done = accept(s, { targetInstanceId: 'f' })
    expect(unitHasKeyword(done, U(done, 'f')!, 'Sentinel')).toBe(true)
  })

  it('Surveillance Cruiser (HMW_247) draws if an opponent controls a planet base', () => {
    expect(play(board({ deck: ['GRD'] }), 'HMW_247').players.player.hand).toEqual([])
    expect(play(board({ deck: ['GRD'] }, { base: { cardId: 'NAB_B', damage: 0 } }), 'HMW_247').players.player.hand).toEqual(['GRD'])
    expect(play(board({ deck: ['GRD'], base: { cardId: 'TAT_B', damage: 0 } }), 'HMW_247').players.player.hand).toEqual([])
  })

  it('C-3P0 (HMW_255) may give an Ewok +2/+2 and may give a Rebel +2/+2', () => {
    const s = play(board({ units: [unit('w', 'EWOK'), unit('r', 'REBEL')] }), 'HMW_255')
    const [ewokPick, rebelPick] = s.pendingChoices!
    expect([ewokPick.kind === 'mayLastingBuff' && ewokPick.targets, ewokPick.kind === 'mayLastingBuff' && ewokPick.optional]).toEqual([['w'], true])
    expect([rebelPick.kind === 'mayLastingBuff' && [...rebelPick.targets].sort(), rebelPick.kind === 'mayLastingBuff' && rebelPick.optional])
      .toEqual([['r', self(s, 'HMW_255')].sort(), true])
    const ewok = accept(s, { targetInstanceId: 'w' })
    expect(power(ewok, 'w')).toBe(4)
    expect(power(accept(ewok, { targetInstanceId: 'r' }), 'r')).toBe(4)
    expect(play(board({ units: [unit('r', 'REBEL')] }), 'HMW_255').pendingChoices).toHaveLength(1)
  })

  it('Heroic Bravery (HMW_264) shields a Heroism unit it attaches to', () => {
    expect(shielded(playUpgrade(board({ units: [unit('h', 'HER')] }), 'HMW_264', 'h'), 'h')).toBe(true)
    expect(shielded(playUpgrade(board({ units: [unit('v', 'VIL')] }), 'HMW_264', 'v'), 'v')).toBe(false)
  })

  it("Twi'lek Kalikori (HMW_265) on a Twi'lek plays Twi'lek units from the top 8 with combined cost 5", () => {
    noChoice(playUpgrade(board({ deck: ['TWILEK2'], units: [unit('f', 'GRD')] }), 'HMW_265', 'f'))
    const s = playUpgrade(board({ deck: ['TWILEK2', 'GRD', 'TWILEK3', 'PRICEY'], units: [unit('t', 'TWILEK')] }), 'HMW_265', 't')
    const c = choice(s)
    expect(c.kind === 'searchPlayFree' && [c.eligibleIndices, c.budget]).toEqual([[0, 2], 5])
  })
})

describe('HMW When Played, C: modes, counts and chains', () => {
  it('Hunter (HMW_035) chooses two, the same option allowed twice: a Shield, or an attack that may not hit a base', () => {
    const s = play(board({ units: [unit('f', 'GRD', { exhausted: true })] }, { units: [unit('e', 'GRD')] }), 'HMW_035')
    expect(choice(s).kind).toBe('chooseMode')
    expect(modeLabels(s)).toEqual(['Give a Shield token to a unit', 'Attack with a unit, even if exhausted'])
    const first = accept(s, { optionIndex: 0 })
    const shield = first.pendingChoices!.find(c => c.kind === 'mayGiveTokens')!
    expect(shield).toBeDefined()
    expect(first.pendingChoices!.some(c => c.kind === 'chooseMode')).toBe(true)
    const shielded1 = resolve(first, { type: 'acceptChoice', choiceId: shield.id, targetInstanceId: 'f' })
    const second = resolve(shielded1, { type: 'acceptChoice', choiceId: shielded1.pendingChoices!.find(c => c.kind === 'chooseMode')!.id, optionIndex: 1 })
    const offer = second.pendingChoices!.find(c => c.kind === 'mayAttackAnyUnit')!
    expect(offer).toMatchObject({ exhausted: true })
    const grant = offer.kind === 'mayAttackAnyUnit' ? offer.grantCardId : undefined
    expect(getCardDefinition(grant!)!.cannotAttackBases!(second, U(second, 'f')!)).toBe(true)
    expect(second.pendingChoices!.some(c => c.kind === 'chooseMode')).toBe(false)
  })

  it('Hunter (HMW_035) raises the second choice when a first-choice attack ends', () => {
    const s = play(board({ units: [unit('f', 'GRD', { exhausted: true })] }, { units: [unit('e', 'GRD')] }), 'HMW_035')
    const first = accept(s, { optionIndex: 1 })
    const offer = choice(first)
    expect(offer.kind).toBe('mayAttackAnyUnit')
    expect(first.pendingChoices!.some(c => c.kind === 'chooseMode')).toBe(false)
    const attacked = resolve(first, { type: 'attack', attackerId: 'f', target: { kind: 'unit', instanceId: 'e' }, choiceId: offer.id } as Action)
    expect(U(attacked, 'e')!.damage).toBe(2)
    expect(attacked.pendingChoices!.some(c => c.kind === 'chooseMode')).toBe(true)
  })

  it('Kelnacca (HMW_036) pays 3 resources per hit, each dealing his power to an enemy unit', () => {
    const s = play(board({}, { units: [unit('e', 'GRD'), unit('e2', 'GRD')] }), 'HMW_036')
    const c = choice(s)
    expect(c.kind === 'chooseNumber' && c.max).toBe(2)
    const paid = accept(s, { optionIndex: 2 })
    expect(readyCount(paid, 'player')).toBe(0)
    expect([unitOffers(paid), declinable(paid)]).toEqual([['e', 'e2'], false])
    const first = accept(paid, { targetInstanceId: 'e' })
    expect(U(first, 'e')!.damage).toBe(4)
    const second = accept(first, { targetInstanceId: 'e2' })
    expect(U(second, 'e2')!.damage).toBe(4)
    noChoice(second)
    const none = accept(s, { optionIndex: 0 })
    expect(readyCount(none, 'player')).toBe(6)
    noChoice(none)
  })

  it('Darth Vader (HMW_043) plays up to 2 units costing 4 or less from the top 8 free, and deals 2 to each', () => {
    const s = play(board({ resources: ready(13), deck: ['GRD', 'PRICEY', 'CHEAP', 'ONE', 'EVT'] }), 'HMW_043')
    const c = choice(s)
    expect(c.kind === 'searchPlayFree' && c.eligibleIndices).toEqual([0, 2, 3])
    const one = accept(s, { deckIndex: 0 })
    const played = one.players.player.units.find(u => u.cardId === 'GRD')!
    expect(played.damage).toBe(2)
    const again = one.pendingChoices!.find(x => x.kind === 'searchPlayFree')!
    expect(again.kind === 'searchPlayFree' && again.revealed.filter((_, i) => again.eligibleIndices.includes(i))).toEqual(['CHEAP', 'ONE'])
    const two = resolve(one, { type: 'acceptChoice', choiceId: again.id, deckIndex: again.kind === 'searchPlayFree' ? again.revealed.indexOf('CHEAP') : 0 })
    expect(two.players.player.units.find(u => u.cardId === 'CHEAP')!.damage).toBe(2)
    expect(two.pendingChoices?.some(x => x.kind === 'searchPlayFree') ?? false).toBe(false)
    expect(two.players.player.deck.sort()).toEqual(['EVT', 'ONE', 'PRICEY'])
  })

  it('Third Sister (HMW_051): 2 damage, then that unit\'s controller may deal 3, then that unit\'s controller may deal 4', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_051')
    expect(declinable(s)).toBe(true)
    const two = accept(s, { targetInstanceId: 'e' })
    expect(U(two, 'e')!.damage).toBe(2)
    expect([choice(two).controller, declinable(two)]).toEqual(['opponent', true])
    const three = accept(two, { targetInstanceId: 'f' })
    expect(U(three, 'f')!.damage).toBe(3)
    expect(choice(three).controller).toBe('player')
    const four = accept(three, { targetInstanceId: 'e' })
    expect(U(four, 'e')!.damage).toBe(6)
    noChoice(four)
    noChoice(skip(two))
  })

  it('Qui-Gon Jinn (HMW_078) may defeat a unit that attacked your base this phase, and dies with it if it was a leader', () => {
    const before = board({}, { units: [unit('e', 'GRD'), unit('l', 'LEADER', { isLeader: true }), unit('idle', 'GRD')] }, { activePlayer: 'opponent' })
    const attacked = attack({ ...attack(before, 'e'), activePlayer: 'opponent' }, 'l')
    const s = play(attacked, 'HMW_078')
    expect(unitOffers(s)).toEqual(['e', 'l'])
    expect(declinable(s)).toBe(true)
    const plain = accept(s, { targetInstanceId: 'e' })
    expect([U(plain, 'e'), plain.players.player.units.some(u => u.cardId === 'HMW_078')]).toEqual([undefined, true])
    const leader = accept(s, { targetInstanceId: 'l' })
    expect(leader.players.player.units.some(u => u.cardId === 'HMW_078')).toBe(false)
    noChoice(play(before, 'HMW_078'))
  })

  it('Sando Aqua Monster (HMW_094) with a Naboo base may defeat ground units of combined power up to its own, then takes that damage', () => {
    noChoice(play(board({}, { units: [unit('e', 'GRD')] }), 'HMW_094'))
    const s = play(board({ base: { cardId: 'NAB_B', damage: 0 } }, { units: [unit('e', 'GRD'), unit('e2', 'GRD'), unit('b', 'BIG'), unit('sp', 'SPC')] }), 'HMW_094')
    const sando = self(s, 'HMW_094')
    expect(unitOffers(s)).toEqual(['b', 'e', 'e2', sando].sort())
    expect(declinable(s)).toBe(true)
    const one = accept(s, { targetInstanceId: 'e' })
    expect(unitOffers(one)).toEqual(['e2'])
    const two = accept(one, { targetInstanceId: 'e2' })
    expect([U(two, 'e'), U(two, 'e2'), U(two, sando)!.damage]).toEqual([undefined, undefined, 4])
    const stop = skip(one)
    expect([U(stop, 'e'), U(stop, 'e2')?.instanceId, U(stop, sando)!.damage]).toEqual([undefined, 'e2', 2])
  })

  it('Nute Gunray (HMW_105): each friendly unit deals 1 damage to a different enemy unit', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD'), unit('e2', 'GRD'), unit('e3', 'GRD')] }), 'HMW_105')
    expect(unitOffers(s)).toEqual(['e', 'e2', 'e3'])
    expect(declinable(s)).toBe(false)
    const one = accept(s, { targetInstanceId: 'e' })
    expect(unitOffers(one)).toEqual(['e2', 'e3'])
    const two = accept(one, { targetInstanceId: 'e3' })
    noChoice(two)
    expect(['e', 'e2', 'e3'].map(id => U(two, id)!.damage)).toEqual([1, 0, 1])
    const few = play(board({ units: [unit('f', 'GRD'), unit('g', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_105')
    noChoice(accept(few, { targetInstanceId: 'e' }))
  })

  it('Teeka (HMW_221) chooses one: a unit gains Sentinel, or a unit loses it, for this phase', () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { units: [unit('e', 'GRD')] }), 'HMW_221')
    expect(modeLabels(s)).toEqual(['Give a unit Sentinel', 'A unit loses Sentinel'])
    const gain = accept(accept(s, { optionIndex: 0 }), { targetInstanceId: 'f' })
    expect(unitHasKeyword(gain, U(gain, 'f')!, 'Sentinel')).toBe(true)
    const teeka = self(s, 'HMW_221')
    const lose = accept(accept(s, { optionIndex: 1 }), { targetInstanceId: teeka })
    expect(unitHasKeyword(lose, U(lose, teeka)!, 'Sentinel')).toBe(false)
  })

  it("Mon Cal Cruiser (HMW_232) chooses one: attack with a unit at +2/+0, or look at a hand and swap a card out", () => {
    const s = play(board({ units: [unit('f', 'GRD')] }, { hand: ['EVT'], deck: ['GRD'], units: [unit('e', 'GRD')] }), 'HMW_232')
    expect(modeLabels(s)).toEqual(['Attack with a unit (+2/+0)', "Look at an opponent's hand"])
    const atk = accept(s, { optionIndex: 0 })
    const offer = choice(atk)
    expect(offer.kind).toBe('mayAttackAnyUnit')
    const grant = offer.kind === 'mayAttackAnyUnit' ? offer.grantCardId : undefined
    expect(getCardDefinition(grant!)!.statModifier!(atk, U(atk, 'f')!, { attacking: true })).toEqual({ power: 2 })
    const look = accept(s, { optionIndex: 1 })
    expect(choice(look)).toMatchObject({ kind: 'lookAtHand', mayDiscard: true, thenDraw: true })
  })
})
