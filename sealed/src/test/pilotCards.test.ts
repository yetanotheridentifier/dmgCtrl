import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { normaliseCard } from '../engine/cardDb'
import { legalMoves, effectiveCost } from '../engine/legalMoves'
import { effectiveHp, effectivePower } from '../engine/stats'
import { unitHasKeyword, unitKeywordValue } from '../engine/keywords'
import { poolFor, SET_CODES } from '../bench/setPools'
import { TOKEN_SHIELD, TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
import { TOKEN_X_WING } from '../engine/tokenUnits'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState, UpgradeAttachment } from '../engine/types'

/**
 * The Pilot cards and the cards that read Pilots, one behaviour each. The mechanic itself (the play,
 * the stats, which side's abilities count) is covered in `piloting.test.ts`. A Pilot is put on its
 * host with the real play wherever its "When played as an upgrade" matters, and attached directly
 * where only its standing upgrade side does.
 */

const POOL = poolFor(SET_CODES)
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the bundled fixtures`)
  return normaliseCard(row)
}
const REAL = [
  'JTL_034', 'JTL_045', 'JTL_211', 'JTL_150', 'JTL_109', 'JTL_086', 'JTL_057', 'JTL_148', 'JTL_189', 'JTL_145', 'JTL_215',
  'JTL_098', 'JTL_203', 'JTL_036', 'JTL_197', 'JTL_046', 'JTL_048', 'JTL_066', 'JTL_142', 'JTL_139', 'JTL_187', 'JTL_141',
  'JTL_103', 'JTL_093', 'JTL_245', 'JTL_249', 'JTL_247', 'JTL_101', 'JTL_223', 'JTL_186', 'JTL_097', 'JTL_056', 'JTL_235',
  'JTL_108', 'JTL_255',
]
const vehicle = (id: string, traits: string[], over: Partial<EngineCard> = {}) =>
  card({ id, arena: 'space', cost: 3, power: 3, hp: 5, traits: ['Vehicle', ...traits], ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(REAL.map(id => [id, real(id)])),
  FIGHTER: vehicle('FIGHTER', ['Fighter']),
  SPEEDER: vehicle('SPEEDER', ['Speeder'], { arena: 'ground' }),
  TRANSPORT: vehicle('TRANSPORT', ['Transport']),
  UNDERWORLD_V: vehicle('UNDERWORLD_V', ['Underworld']),
  BULWARK: vehicle('BULWARK', ['Capital Ship'], { power: 1, hp: 12 }),
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 5 }),
  TANK: card({ id: 'TANK', arena: 'ground', cost: 5, power: 1, hp: 9 }),
  CHEAP: card({ id: 'CHEAP', arena: 'ground', cost: 2, power: 1, hp: 3 }),
  DEAR: card({ id: 'DEAR', arena: 'ground', cost: 4, power: 1, hp: 3 }),
  RES: card({ id: 'RES', arena: 'ground', cost: 2, power: 1, hp: 3, traits: ['Resistance'] }),
  ODD: card({ id: 'ODD', type: 'event', cost: 3 }),
  EVEN: card({ id: 'EVEN', type: 'event', cost: 2 }),
  UPG2: card({ id: 'UPG2', type: 'upgrade', cost: 2, power: 1, hp: 1 }),
  UPG3: card({ id: 'UPG3', type: 'upgrade', cost: 3, power: 1, hp: 1 }),
  // Provides every aspect a tested card prints, so no play pays a penalty.
  ALL_L: card({ id: 'ALL_L', type: 'leader', cost: 5, power: 4, hp: 7, aspects: ['Vigilance', 'Command', 'Aggression', 'Cunning', 'Heroism', 'Villainy'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const pilot = (cardId: string, owner: PlayerId = 'player'): UpgradeAttachment => ({ cardId, owner, unitCard: true })
/** A unit with Pilots already attached. */
const piloted = (instanceId: string, cardId: string, pilots: string[], over: Partial<UnitState> = {}): UnitState =>
  unit(instanceId, cardId, { upgrades: pilots.map(p => pilot(p)), ...over })

function board(mine: UnitState[], theirs: UnitState[] = [], over: { hand?: string[]; deck?: string[]; oppDeck?: string[]; resources?: number } = {}): GameState {
  return state({
    cards: F,
    players: {
      player: player({ leader: { cardId: 'ALL_L', deployed: false, epicActionUsed: false, exhausted: false }, hand: over.hand ?? [], units: mine, resources: ready(over.resources ?? 10), ...(over.deck ? { deck: over.deck } : {}) }),
      opponent: player({ units: theirs, ...(over.oppDeck ? { deck: over.oppDeck } : {}) }),
    },
  })
}
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const find = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)!
const choice = (s: GameState): PendingChoice | undefined => s.pendingChoices?.[0]
const pilotOnto = (s: GameState, cardId: string, hostId: string): GameState => {
  const handIndex = s.players.player.hand.indexOf(cardId)
  const move = legalMoves(s).find((m): m is Extract<Action, { type: 'playUpgrade' }> => m.type === 'playUpgrade' && m.piloting === true && m.handIndex === handIndex && m.targetInstanceId === hostId)
  if (!move) throw new Error(`${cardId} cannot be piloted onto ${hostId}`)
  return resolve(s, move)
}
const accept = (s: GameState, extra: Partial<Extract<Action, { type: 'acceptChoice' }>> = {}): GameState =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s)!.id, ...extra })
const attackBase = (s: GameState, attackerId: string): GameState => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' } })
const attackUnit = (s: GameState, attackerId: string, defenderId: string): GameState => resolve(s, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: defenderId } })

describe('"Attached unit gains <keyword>"', () => {
  it.each([
    ['JTL_034', 'Grit', 0], // Interceptor Ace
    ['JTL_045', 'Restore', 1], // Hera Syndulla
    ['JTL_211', 'Raid', 1], // Independent Smuggler
  ])('%s gives its host %s', (id, keyword, value) => {
    const s = board([piloted('v', 'FIGHTER', [id as string])])
    expect(unitHasKeyword(s, find(s, 'v'), keyword as string)).toBe(true)
    expect(unitKeywordValue(s, find(s, 'v'), keyword as string)).toBe(value)
  })

  it('Biggs Darklighter: Overwhelm on a Fighter, Grit on a Speeder, +0/+1 on a Transport, nothing printed as a unit', () => {
    const s = board([piloted('f', 'FIGHTER', ['JTL_150']), piloted('sp', 'SPEEDER', ['JTL_150']), piloted('t', 'TRANSPORT', ['JTL_150']), unit('b', 'JTL_150')])
    expect(unitHasKeyword(s, find(s, 'f'), 'Overwhelm')).toBe(true)
    expect(unitHasKeyword(s, find(s, 'f'), 'Grit')).toBe(false)
    expect(unitHasKeyword(s, find(s, 'sp'), 'Grit')).toBe(true)
    expect(effectiveHp(s, find(s, 't'))).toBe(5 + 1 + 1)
    expect(unitHasKeyword(s, find(s, 'b'), 'Grit')).toBe(false)
    expect(unitHasKeyword(s, find(s, 'b'), 'Overwhelm')).toBe(false)
  })

  it('Jarek Yeager: Sentinel only while you control a ground and a space unit, and none as a unit', () => {
    const spaceOnly = board([piloted('v', 'FIGHTER', ['JTL_109'])])
    expect(unitHasKeyword(spaceOnly, find(spaceOnly, 'v'), 'Sentinel')).toBe(false)
    const both = board([piloted('v', 'FIGHTER', ['JTL_109']), unit('g', 'GRD')])
    expect(unitHasKeyword(both, find(both, 'v'), 'Sentinel')).toBe(true)
    const asUnit = board([unit('j', 'JTL_109'), unit('v', 'FIGHTER')])
    expect(unitHasKeyword(asUnit, find(asUnit, 'j'), 'Sentinel')).toBe(false)
  })
})

describe('"When played as an upgrade"', () => {
  it('Wingman Victor Three: an Experience token for a unit other than the host', () => {
    const s = pilotOnto(board([unit('v', 'FIGHTER'), unit('g', 'GRD')], [], { hand: ['JTL_086'] }), 'JTL_086', 'v')
    expect((choice(s) as { targets: string[] }).targets).toEqual(['g'])
  })

  it('Astromech Pilot: may heal 2 from a unit', () => {
    const s = pilotOnto(board([unit('v', 'FIGHTER'), unit('g', 'GRD', { damage: 3 })], [], { hand: ['JTL_057'] }), 'JTL_057', 'v')
    expect(choice(s)).toMatchObject({ kind: 'selectHealTarget', amount: 2, optional: true })
    expect(find(accept(s, { targetInstanceId: 'g' }), 'g').damage).toBe(1)
  })

  it('Frisk: may defeat an upgrade that costs 2 or less', () => {
    const s = pilotOnto(board([unit('v', 'FIGHTER')], [unit('e', 'GRD', { upgrades: [{ cardId: 'UPG2', owner: 'opponent' }, { cardId: 'UPG3', owner: 'opponent' }] })], { hand: ['JTL_148'] }), 'JTL_148', 'v')
    // Frisk herself costs 2, so she is one of them.
    expect((choice(s) as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId).sort()).toEqual(['JTL_148', 'UPG2'])
  })

  it('Boba Fett: 1 damage, or 2 on a Transport', () => {
    const onFighter = pilotOnto(board([unit('v', 'FIGHTER')], [unit('e', 'GRD')], { hand: ['JTL_189'] }), 'JTL_189', 'v')
    expect(choice(onFighter)).toMatchObject({ kind: 'selectDamageTarget', amount: 1, optional: true })
    const onTransport = pilotOnto(board([unit('v', 'TRANSPORT')], [unit('e', 'GRD')], { hand: ['JTL_189'] }), 'JTL_189', 'v')
    expect(choice(onTransport)).toMatchObject({ kind: 'selectDamageTarget', amount: 2 })
  })

  it('BB-8: pay 2 to ready a Resistance unit', () => {
    const s = pilotOnto(board([unit('v', 'FIGHTER'), unit('r', 'RES', { exhausted: true }), unit('g', 'GRD', { exhausted: true })], [], { hand: ['JTL_145'] }), 'JTL_145', 'v')
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', cost: 2 })
    const paid = accept(s)
    expect((choice(paid) as { targets: string[] }).targets).toEqual(['r'])
    expect(find(accept(paid, { targetInstanceId: 'r' }), 'r').exhausted).toBe(false)
  })

  it('BoShek: discards 2 from your deck and returns the odd-cost ones to hand', () => {
    const s = pilotOnto(board([unit('v', 'FIGHTER')], [], { hand: ['JTL_215'], deck: ['ODD', 'EVEN', 'GRD'] }), 'JTL_215', 'v')
    expect(s.players.player.hand).toEqual(['ODD'])
    expect(s.players.player.discard).toEqual(['EVEN'])
    expect(s.players.player.deck).toEqual(['GRD'])
  })

  it('Snap Wexley: as an upgrade searches 5 for a Resistance card; as a unit discounts the next Resistance card', () => {
    const asPilot = pilotOnto(board([unit('v', 'FIGHTER')], [], { hand: ['JTL_098'], deck: ['GRD', 'RES', 'GRD'] }), 'JTL_098', 'v')
    expect(choice(asPilot)).toMatchObject({ kind: 'searchDraw', eligibleIndices: [1] })
    const asUnit = resolve(board([], [], { hand: ['JTL_098', 'RES'] }), { type: 'playUnit', handIndex: 0 })
    expect(effectiveCost(asUnit, 'player', F.RES)).toBe(1)
  })

  it('Han Solo: may attack with the host, which strikes first only if it is the Millennium Falcon', () => {
    const s = pilotOnto(board([unit('v', 'FIGHTER')], [unit('e', 'GRD')], { hand: ['JTL_203'] }), 'JTL_203', 'v')
    expect(choice(s)).toMatchObject({ kind: 'mayAttack', unitId: 'v' })
    expect((choice(s) as { grantCardId?: string }).grantCardId).toBeUndefined()
    const falcon = pilotOnto(board([unit('mf', 'JTL_249')], [], { hand: ['JTL_203'] }), 'JTL_203', 'mf')
    expect(choice(falcon)).toMatchObject({ kind: 'mayAttack', unitId: 'mf', grantCardId: 'GRANT_FALCON_FIRST' })
  })
})

describe('attach and attack-end triggers', () => {
  it('Iden Versio: a Shield token for the host as she attaches', () => {
    const s = pilotOnto(board([unit('v', 'FIGHTER')], [], { hand: ['JTL_036'] }), 'JTL_036', 'v')
    expect(find(s, 'v').upgrades.map(u => u.cardId)).toContain(TOKEN_SHIELD)
  })

  it('Anakin Skywalker: after the host survives an attack, may return to hand', () => {
    const s = attackBase(board([piloted('v', 'FIGHTER', ['JTL_197'])]), 'v')
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', cost: 0 })
    const back = accept(s)
    expect(back.players.player.hand).toEqual(['JTL_197'])
    expect(find(back, 'v').upgrades).toEqual([])
  })

  it('Red Leader: an X-Wing token when a Pilot attaches, and 1 less per friendly Pilot', () => {
    const s = pilotOnto(board([unit('r', 'JTL_101')], [], { hand: ['JTL_108'] }), 'JTL_108', 'r')
    expect(s.players.player.units.filter(u => u.cardId === TOKEN_X_WING)).toHaveLength(1)
    const withPilots = board([unit('p', 'JTL_108'), piloted('v', 'FIGHTER', ['JTL_255'])])
    expect(effectiveCost(withPilots, 'player', F.JTL_101)).toBe(F.JTL_101.cost - 2)
  })

  it('Razor Crest: when a Pilot attaches, may return a cheap or exhausted non-leader unit', () => {
    const s = pilotOnto(board([unit('rc', 'JTL_223')], [unit('c', 'CHEAP'), unit('d', 'DEAR'), unit('x', 'DEAR', { exhausted: true })], { hand: ['JTL_108'] }), 'JTL_108', 'rc')
    expect(choice(s)).toMatchObject({ kind: 'selectUnitToReturn', optional: true })
    expect((choice(s) as { targets: string[] }).targets.sort()).toEqual(['c', 'x'])
  })
})

describe('"Attached unit gains: ..." blocks', () => {
  it('Paige Tico: an Experience token for the host, then 1 damage to it', () => {
    const s = attackBase(board([piloted('v', 'FIGHTER', ['JTL_046'])]), 'v')
    expect(find(s, 'v').upgrades.map(u => u.cardId)).toContain(TOKEN_EXPERIENCE)
    expect(find(s, 'v').damage).toBe(1)
  })

  it('Cassian Andor: discards from the defending deck and draws when it cost 3 or less', () => {
    const s = attackBase(board([piloted('v', 'FIGHTER', ['JTL_048'])], [], { deck: ['GRD'], oppDeck: ['EVEN'] }), 'v')
    expect(s.players.opponent.discard).toEqual(['EVEN'])
    expect(s.players.player.hand).toEqual(['GRD'])
  })

  it('Trace Martez: may heal 2 total from any number of units', () => {
    const s = attackBase(board([piloted('v', 'FIGHTER', ['JTL_066']), unit('g', 'GRD', { damage: 1 })]), 'v')
    expect(choice(s)).toMatchObject({ kind: 'distributeHealing', remaining: 2, unitTargets: ['g'] })
  })

  it('Darth Vader: 1 damage, and another if it defeats', () => {
    const s = attackBase(board([piloted('v', 'FIGHTER', ['JTL_142'])], [unit('e', 'CHEAP', { damage: 2 })]), 'v')
    const dealt = accept(s, { targetInstanceId: 'e' })
    expect(all(dealt).some(u => u.instanceId === 'e')).toBe(false)
    expect(choice(dealt)).toMatchObject({ kind: 'selectDamageTarget', amount: 1, optional: true })
  })

  it('Dengar: 2 indirect damage, 3 on an Underworld host', () => {
    const plain = attackBase(board([piloted('v', 'FIGHTER', ['JTL_139'])]), 'v')
    expect(choice(plain)?.kind).toBe('choosePlayerThen')
    const underworld = accept(attackBase(board([piloted('v', 'UNDERWORLD_V', ['JTL_139'])]), 'v'), { optionIndex: 0 })
    // Combat dealt the host's 3 plus Dengar's +1; the indirect damage is either still being assigned or on the base.
    const assigning = underworld.pendingChoices?.find(c => c.kind === 'distributeIndirectDamage') as { total: number } | undefined
    expect(assigning ? assigning.total : underworld.players.opponent.base.damage - 4).toBe(3)
  })

  it('Bossk: exhausts the defender and deals it 1, as a unit and as an upgrade', () => {
    const asPilot = attackUnit(board([piloted('v', 'FIGHTER', ['JTL_187'])], [unit('e', 'BULWARK')]), 'v', 'e')
    expect(find(asPilot, 'e').exhausted).toBe(true)
    const asUnit = attackUnit(board([unit('b', 'JTL_187')], [unit('e', 'TANK')]), 'b', 'e')
    expect(find(asUnit, 'e').exhausted).toBe(true)
  })

  it('IG-88: +3/+0 while an enemy unit is damaged', () => {
    const calm = board([piloted('v', 'FIGHTER', ['JTL_141'])], [unit('e', 'GRD')])
    expect(effectivePower(calm, find(calm, 'v'))).toBe(3)
    const hurt = board([piloted('v', 'FIGHTER', ['JTL_141'])], [unit('e', 'GRD', { damage: 1 })])
    expect(effectivePower(hurt, find(hurt, 'v'))).toBe(6)
  })

  it('Nien Nunb: +1/+0 for each OTHER friendly Pilot unit and upgrade', () => {
    const s = board([piloted('v', 'FIGHTER', ['JTL_093']), unit('p', 'JTL_108'), piloted('w', 'FIGHTER', ['JTL_255']), unit('n', 'JTL_093')])
    // Others for the upgrade side: Clone Pilot, Sullustan Spacer, Nien the unit.
    expect(effectivePower(s, find(s, 'v'))).toBe(3 + 1 + 3)
    // Others for the unit side: Clone Pilot, Sullustan Spacer, Nien the upgrade.
    expect(effectivePower(s, find(s, 'n'))).toBe(F.JTL_093.power! + 3)
  })
})

describe('Pilot slots', () => {
  it('Millennium Falcon takes a second Pilot and gets +1/+0 for each', () => {
    const s = board([piloted('mf', 'JTL_249', ['JTL_108'])], [], { hand: ['JTL_255'] })
    const two = pilotOnto(s, 'JTL_255', 'mf')
    expect(effectivePower(two, find(two, 'mf'))).toBe(F.JTL_249.power! + 2 + 1 + 2)
    const full = { ...two, players: { ...two.players, player: { ...two.players.player, hand: ['JTL_108'] } } }
    expect(legalMoves(full).some(m => m.type === 'playUpgrade' && m.piloting)).toBe(false)
  })

  it('R2-D2 goes onto a Vehicle that already has a Pilot', () => {
    const s = board([piloted('v', 'FIGHTER', ['JTL_108'])], [], { hand: ['JTL_245', 'JTL_255'] })
    const moves = legalMoves(s).filter(m => m.type === 'playUpgrade' && m.piloting)
    expect(moves.map(m => (m as { handIndex: number }).handIndex)).toEqual([0])
  })

  it('Resistance X-Wing gets +1/+1 with a Pilot on it', () => {
    const s = board([unit('a', 'JTL_247'), piloted('b', 'JTL_247', ['JTL_108'])])
    expect(effectiveHp(s, find(s, 'b')) - effectiveHp(s, find(s, 'a'))).toBe(2 + 1)
  })
})

describe('cards that read Pilots', () => {
  it('Mist Hunter: may draw on attack once a Pilot card was played this phase', () => {
    const before = attackBase(board([unit('m', 'JTL_186')]), 'm')
    expect(before.pendingChoices ?? []).toEqual([])
    const played = pilotOnto(board([unit('m', 'JTL_186'), unit('v', 'FIGHTER')], [], { hand: ['JTL_108'] }), 'JTL_108', 'v')
    expect(choice(attackBase({ ...played, activePlayer: 'player' }, 'm'))).toMatchObject({ kind: 'mayPayToDraw', cost: 0 })
  })

  it('Leia Organa: may attack with a Pilot unit or a piloted unit, +1/+0 and Restore 1', () => {
    const s = resolve(board([unit('p', 'JTL_108'), piloted('v', 'FIGHTER', ['JTL_255']), unit('g', 'GRD')], [], { hand: ['JTL_097'] }), { type: 'playUnit', handIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'mayAttackAnyUnit', optional: true, grantCardId: 'GRANT_LEIA_PILOT' })
    expect((choice(s) as { attacker: { only: string[] } }).attacker.only.sort()).toEqual(['p', 'v'])
  })

  it('Hondo Ohnaka: takes a non-Pilot upgrade and attaches it to a different unit', () => {
    const s = attackBase(board([unit('h', 'JTL_056'), unit('g', 'GRD')], [unit('e', 'FIGHTER', { upgrades: [pilot('JTL_108', 'opponent'), { cardId: 'UPG2', owner: 'opponent' }] })]), 'h')
    expect((choice(s) as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId)).toEqual(['UPG2'])
    const picked = accept(s, { optionIndex: 0 })
    expect((choice(picked) as { targets: string[] }).targets.sort()).toEqual(['g', 'h'])
    const moved = accept(picked, { targetInstanceId: 'g' })
    expect(find(moved, 'g').upgrades).toEqual([{ cardId: 'UPG2', owner: 'player' }])
  })

  it('Commandeer: takes and readies an unpiloted Vehicle costing 6 or less', () => {
    const s = resolve(board([], [unit('v', 'FIGHTER', { exhausted: true }), piloted('w', 'FIGHTER', ['JTL_108'])], { hand: ['JTL_235'] }), { type: 'playEvent', handIndex: 0 })
    expect((choice(s) as { targets: string[] }).targets).toEqual(['v'])
    const taken = accept(s, { targetInstanceId: 'v' })
    expect(taken.players.player.units.map(u => u.instanceId)).toEqual(['v'])
    expect(find(taken, 'v').exhausted).toBe(false)
    expect(taken.delayedEffects).toContainEqual(expect.objectContaining({ cardId: 'JTL_235', unitId: 'v', when: 'regroupStart' }))
  })

  it('Chewbacca as a Pilot protects the host from enemy defeat', async () => {
    const { protectedFromEnemyAbility } = await import('../engine/effects')
    const s = board([piloted('v', 'FIGHTER', ['JTL_103'])])
    expect(protectedFromEnemyAbility(s, find(s, 'v'), 'player', 'opponent', 'defeat')).toBe(true)
    expect(protectedFromEnemyAbility(s, find(s, 'v'), 'player', 'opponent', 'damage')).toBe(false)
  })
})
