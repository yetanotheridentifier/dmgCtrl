import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword, unitHasTrait } from '../engine/keywords'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, KeywordInstance, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'

/**
 * The When Played units and upgrades the second batch left out, in the groups the ticket names:
 * the two sets too small to sweep, cards with a second ability outside When Played, several
 * targets, attacks, "you may pay", two linked steps, upgrades returned or moved, upgrade attach
 * rules, lasting effects, and control.
 *
 * Each ability runs directly from its source (the unit itself, or for an upgrade the unit it is
 * attached to), so each test states what the card may target as well as what it does, and whether
 * its "may" lets it be declined. A card that moves units between players or plays an attack is
 * driven through `resolve`, since the turn has to come back to the right player afterwards.
 */

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 5, power: 2, hp: 6, ...over })
const upg = (id: string, over: Partial<EngineCard> = {}) => card({ id, type: 'upgrade', cost: 2, power: 0, hp: 0, ...over })

const F: Record<string, EngineCard> = {
  ...CARDS,
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  GRD2: card({ id: 'GRD2', arena: 'ground', cost: 3, power: 3, hp: 6 }),
  WEAK: card({ id: 'WEAK', arena: 'ground', cost: 1, power: 1, hp: 6 }),
  SPACE: card({ id: 'SPACE', arena: 'space', cost: 3, power: 2, hp: 6 }),
  FRAIL: card({ id: 'FRAIL', arena: 'ground', cost: 1, power: 1, hp: 3 }),
  VEH: card({ id: 'VEH', arena: 'ground', cost: 5, power: 3, hp: 9, traits: ['VEHICLE'] }),
  JEDI: card({ id: 'JEDI', arena: 'ground', cost: 3, power: 2, hp: 6, traits: ['FORCE', 'JEDI'] }),
  CUNNING: card({ id: 'CUNNING', arena: 'ground', cost: 2, power: 2, hp: 6, aspects: ['Cunning'] }),
  VIGIL: card({ id: 'VIGIL', arena: 'ground', cost: 2, power: 2, hp: 6, aspects: ['Vigilance'] }),
  UNIQ: card({ id: 'UNIQ', arena: 'ground', cost: 3, power: 2, hp: 6, unique: true }),
  LEADERU: card({ id: 'LEADERU', arena: 'ground', cost: 6, power: 4, hp: 8 }),
  EV: card({ id: 'EV', type: 'event', cost: 2 }),
  D_FILL: card({ id: 'D_FILL', arena: 'ground', cost: 3, power: 2, hp: 3 }),
  D_FILL2: card({ id: 'D_FILL2', arena: 'ground', cost: 3, power: 2, hp: 3 }),

  // TS26 and IBH
  TS26_37: upg('TS26_37', { cost: 4 }), TS26_15: src('TS26_15', { power: 2, hp: 5, unique: true, traits: ['DROID'] }),
  TS26_19: src('TS26_19', { cost: 1 }), TS26_53: src('TS26_53', { cost: 1 }), TS26_25: upg('TS26_25'),
  TS26_18: src('TS26_18', { arena: 'space' }), TS26_16: src('TS26_16'), TS26_30: src('TS26_30'),
  TS26_28: src('TS26_28'), TS26_62: src('TS26_62'), TS26_42: src('TS26_42', { arena: 'space' }),
  TS26_67: src('TS26_67'), TS26_36: src('TS26_36', { cost: 10, arena: 'space' }), TS26_41: src('TS26_41', { arena: 'space' }),
  IBH_72: src('IBH_72', { arena: 'space' }), IBH_99: src('IBH_99'), IBH_19: src('IBH_19'), IBH_68: src('IBH_68'),
  IBH_64: src('IBH_64'), IBH_20: src('IBH_20'), IBH_31: src('IBH_31', { arena: 'space' }),

  // Attacks
  BH: card({ id: 'BH', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['UNDERWORLD', 'BOUNTY HUNTER'] }),
  FORCE: card({ id: 'FORCE', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['FORCE'] }),
  REPUBLIC: card({ id: 'REPUBLIC', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['REPUBLIC'] }),
  IMPERIAL: card({ id: 'IMPERIAL', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['IMPERIAL'] }),
  REBEL: card({ id: 'REBEL', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['REBEL'] }),
  TOUGH: card({ id: 'TOUGH', arena: 'ground', cost: 4, power: 1, hp: 20 }),
  AHSOKA: card({ id: 'AHSOKA', name: 'Ahsoka Tano', arena: 'ground', cost: 4, power: 3, hp: 6, unique: true }),
  MAUL: card({ id: 'MAUL', name: 'Darth Maul', arena: 'ground', cost: 5, power: 5, hp: 6, unique: true }),
  LAW_065: src('LAW_065'), LAW_157: src('LAW_157'), SEC_103: src('SEC_103', { cost: 7 }), LOF_111: src('LOF_111'),
  TWI_091: src('TWI_091'), SHD_101: src('SHD_101', { arena: 'space' }), SHD_236: src('SHD_236'), SOR_240: src('SOR_240'),
  TWI_248: upg('TWI_248', { power: 2 }), LOF_140: upg('LOF_140'), SOR_215: upg('SOR_215', { power: 1, hp: 1 }),

  // "You may pay N"
  LAW_198: src('LAW_198'), LAW_193: src('LAW_193'), LAW_227: src('LAW_227'), LAW_113: src('LAW_113'),
  LAW_148: src('LAW_148', { arena: 'space', power: 4, hp: 5 }), TWI_212: src('TWI_212'),

  // Two linked steps
  SEC_184: src('SEC_184'), JTL_051: src('JTL_051', { arena: 'space' }), TWI_193: src('TWI_193'), SOR_099: src('SOR_099', { arena: 'space' }),
  SEC_165: src('SEC_165', { power: 3 }), LAW_075: src('LAW_075'), JTL_201: src('JTL_201'), SHD_049: src('SHD_049'), LAW_093: src('LAW_093'),
  LOF_171: upg('LOF_171'), SEC_030: src('SEC_030'), SOR_097: src('SOR_097'), LOF_037: src('LOF_037'),
  PRICEY: card({ id: 'PRICEY', arena: 'ground', cost: 5, power: 2, hp: 6 }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)
const ids = (xs: string[]) => [...xs].sort()

const board = (mine: UnitState[], theirs: UnitState[] = [], over: Partial<GameState> = {}) =>
  state({
    cards: F,
    players: {
      player: player({ units: mine, resources: ready(6), deck: ['D_FILL', 'D_FILL2'], hand: [] }),
      opponent: player({ units: theirs, resources: ready(3), deck: ['D_FILL', 'D_FILL2'], hand: [] }),
    },
    ...over,
  })
const withPlayer = (s: GameState, who: PlayerId, patch: Partial<GameState['players']['player']>): GameState =>
  ({ ...s, players: { ...s.players, [who]: { ...s.players[who], ...patch } } })

const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, played: { player: [], opponent: [] },
  leaderLeftPlay: [],
  ...over,
})

/** Run `cardId`'s `index`th When Played as the player, sourced from `host` (the unit, or an upgrade's host). */
const fire = (s: GameState, cardId: string, host = 'src', index = 0): GameState => {
  const ability = getCardDefinition(cardId)?.abilities?.filter(a => a.trigger === 'whenPlayed')[index]
  if (!ability) throw new Error(`${cardId} has no When Played ability`)
  return ability.effect(s, { owner: 'player', cardId, sourceInstanceId: host })
}
const fireAt = (s: GameState, cardId: string, trigger: string, host = 'src', owner: PlayerId = 'player'): GameState => {
  const ability = getCardDefinition(cardId)?.abilities?.find(a => a.trigger === trigger)
  if (!ability) throw new Error(`${cardId} has no ${trigger} ability`)
  return ability.effect(s, { owner, cardId, sourceInstanceId: host })
}
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices ?? [], 'a choice is raised').toHaveLength(1)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
const moves = (s: GameState) => legalMoves(s)
const declinable = (s: GameState) => moves(s).some(m => m.type === 'skipTrigger')
type Accept = Extract<Action, { type: 'acceptChoice' }>
const accepts = (s: GameState) => moves(s).filter((m): m is Accept => m.type === 'acceptChoice')
/** The unit ids the head choice offers as board targets. */
const offered = (s: GameState) => ids(accepts(s).flatMap(m => (m.targetInstanceId ? [m.targetInstanceId] : [])))
const offeredBases = (s: GameState) => ids(accepts(s).flatMap(m => (m.baseTarget ? [m.baseTarget] : [])))
const accept = (s: GameState, extra: Partial<Omit<Accept, 'type' | 'choiceId'>> = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices![0].id })

type AttackMove = Extract<Action, { type: 'attack' }>
const attackMoves = (s: GameState) => moves(s).filter((m): m is AttackMove => m.type === 'attack')
const attackers = (s: GameState) => ids([...new Set(attackMoves(s).map(m => m.attackerId))])
const baseOffered = (s: GameState, attackerId: string) => attackMoves(s).some(m => m.attackerId === attackerId && m.target.kind === 'base')
const hitBase = (s: GameState, attackerId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' }, choiceId: s.pendingChoices?.[0]?.id })
const hitUnit = (s: GameState, attackerId: string, instanceId: string) =>
  resolve(s, { type: 'attack', attackerId, target: { kind: 'unit', instanceId }, choiceId: s.pendingChoices?.[0]?.id })
const keywords = (s: GameState, id: string): string[] => {
  const u = U(s, id)
  return u ? (['Sentinel', 'Saboteur', 'Overwhelm', 'Hidden', 'Grit', 'Restore', 'Raid'] as const).filter(k => unitHasKeyword(s, u, k)) : []
}
const shields = (s: GameState, id: string) => U(s, id)?.upgrades.filter(up => up.cardId === TOKEN_SHIELD).length ?? 0
void TOKEN_ADVANTAGE
void effectiveHp
void ({} as KeywordInstance)

// ── TS26 and IBH ──────────────────────────────────────────────────────────────────────────────────

describe('TS26 and IBH: cards too few to sweep', () => {
  it('Abandoned the Order (TS26_37): the host loses Jedi and gains Restore 1; may return a non-leader unit', () => {
    const s = board([unit('src', 'JEDI', { upgrades: [{ cardId: 'TS26_37', owner: 'player' }] }), unit('lead', 'LEADERU', { isLeader: true })], [unit('e', 'GRD')])
    const host = U(s, 'src')!
    expect(unitHasTrait(s, host, 'Jedi')).toBe(false)
    expect(unitHasTrait(s, host, 'Force'), 'only Jedi is lost').toBe(true)
    expect(keywords(s, 'src')).toContain('Restore')
    const fired = fire(s, 'TS26_37')
    expect(choice(fired).kind).toBe('selectUnitToReturn')
    expect(offered(fired)).toEqual(['e', 'src'])
    expect(declinable(fired)).toBe(true)
    expect(accept(fired, { targetInstanceId: 'e' }).players.opponent.hand).toEqual(['GRD'])
  })

  it('C-3P0 (TS26_15): an opponent takes control of him for good, and only an opponent may use his action', () => {
    const s = withPlayer(board([], [unit('e', 'GRD'), unit('e2', 'WEAK')]), 'player', { hand: ['TS26_15'] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    const c3po = played.players.opponent.units.find(u => u.cardId === 'TS26_15')
    expect(c3po, 'he enters play and changes sides').toBeDefined()
    expect(played.players.player.units).toHaveLength(0)
    expect(played.activePlayer, 'the turn passes as normal').toBe('opponent')
    // A regroup does not hand him back.
    const regroup = resolve(resolve(played, { type: 'pass' }), { type: 'pass' })
    expect(regroup.players.opponent.units.some(u => u.cardId === 'TS26_15')).toBe(true)
    // His action: the controller (not his owner) may use it once he is ready.
    const readied = withPlayer(played, 'opponent', { units: played.players.opponent.units.map(u => ({ ...u, exhausted: false })) })
    const uses = moves(readied).filter(m => m.type === 'useAbility')
    expect(uses).toHaveLength(1)
    const used = resolve(readied, uses[0])
    expect(choice(used).kind).toBe('selectDamageTarget')
    expect(offered(used), 'another ground unit, either side').toEqual(['e', 'e2'])
    const hit = accept(used, { targetInstanceId: 'e' })
    expect(U(hit, 'e')!.damage).toBe(2)
    // The same unit under its owner's control offers no action.
    const home = board([unit('c', 'TS26_15')], [unit('e', 'GRD')])
    expect(moves(home).filter(m => m.type === 'useAbility')).toHaveLength(0)
  })

  it('Coleman Trebor (TS26_19): 1 damage to the enemy base, and heals as much as was dealt', () => {
    const s = board([unit('src', 'TS26_19')])
    const hurt = withPlayer(s, 'player', { base: { cardId: 'TST_B', damage: 5 } })
    const after = fire(hurt, 'TS26_19')
    expect(after.players.opponent.base.damage).toBe(1)
    expect(after.players.player.base.damage).toBe(4)
  })

  it('Coruscanti Spy (TS26_53): heals 2 from each of any number of bases, one at a time', () => {
    const s = withPlayer(withPlayer(board([unit('src', 'TS26_53')]), 'player', { base: { cardId: 'TST_B', damage: 5 } }), 'opponent', { base: { cardId: 'TST_B', damage: 4 } })
    const fired = fire(s, 'TS26_53')
    expect(offeredBases(fired)).toEqual(['opponent', 'player'])
    expect(declinable(fired), 'any number includes none').toBe(true)
    const one = accept(fired, { baseTarget: 'player' })
    expect(one.players.player.base.damage).toBe(3)
    expect(offeredBases(one), 'each base once').toEqual(['opponent'])
    noChoice(skip(one))
  })

  it('Fiery Alliance (TS26_25): may deal 1 to another friendly unit, then attack with it', () => {
    const s = board([unit('src', 'GRD', { upgrades: [{ cardId: 'TS26_25', owner: 'player' }] }), unit('a', 'GRD2')], [unit('e', 'FRAIL')])
    const fired = fire(s, 'TS26_25')
    expect(offered(fired), 'not the unit it is attached to').toEqual(['a'])
    expect(declinable(fired)).toBe(true)
    const hit = accept(fired, { targetInstanceId: 'a' })
    expect(U(hit, 'a')!.damage).toBe(1)
    expect(choice(hit).kind).toBe('mayAttackAnyUnit')
    expect(attackers(hit)).toEqual(['a'])
  })

  it('Jendirian Valley (TS26_18): searches the top 8 for any card and resources it, exhausted', () => {
    const deck = ['D_FILL', 'EV', 'GRD', 'WEAK', 'D_FILL2', 'SPACE', 'VEH', 'FRAIL', 'JEDI']
    const s = withPlayer(board([unit('src', 'TS26_18')]), 'player', { deck })
    const fired = fire(s, 'TS26_18')
    const c = choice(fired)
    expect(c.kind).toBe('searchDraw')
    expect('revealed' in c && c.revealed).toEqual(deck.slice(0, 8))
    const after = accept(fired, { deckIndex: 1 })
    expect(after.players.player.hand).toEqual([])
    expect(after.players.player.resources.at(-1)).toEqual({ cardId: 'EV', exhausted: true })
    expect(after.players.player.deck).toEqual(['JEDI', 'D_FILL', 'GRD', 'WEAK', 'D_FILL2', 'SPACE', 'VEH', 'FRAIL'])
  })

  it('King Katuunko (TS26_16): every unit gains Restore 1 for this phase', () => {
    const after = fire(board([unit('src', 'TS26_16')], [unit('e', 'GRD')]), 'TS26_16')
    expect(keywords(after, 'src')).toContain('Restore')
    expect(keywords(after, 'e')).toContain('Restore')
  })

  it('Maul (TS26_30) and Hoth Lieutenant (IBH_64): may attack with another unit, Hoth Lieutenant lending +2/+0', () => {
    const s = board([unit('src', 'GRD'), unit('a', 'GRD2')], [unit('e', 'GRD')])
    const maul = fire(s, 'TS26_30')
    expect(choice(maul).kind).toBe('mayAttackAnyUnit')
    expect(attackers(maul)).toEqual(['a'])
    expect(declinable(maul)).toBe(true)
    const hoth = fire(s, 'IBH_64')
    expect(attackers(hoth)).toEqual(['a'])
    const done = hitBase(hoth, 'a')
    expect(done.players.opponent.base.damage).toBe(5)
  })

  it('Prime Minister Almec (TS26_28): +2/+2 to a friendly unit, then exhausts each weaker enemy in its arena', () => {
    const s = board([unit('src', 'TS26_28'), unit('a', 'GRD')], [unit('e1', 'WEAK'), unit('e2', 'GRD2'), unit('e3', 'GRD2', { damage: 0 }), unit('sp', 'SPACE')])
    const fired = fire(s, 'TS26_28')
    expect(offered(fired)).toEqual(['a', 'src'])
    expect(declinable(fired)).toBe(false)
    const after = accept(fired, { targetInstanceId: 'a' })
    expect(effectivePower(after, U(after, 'a')!)).toBe(4)
    expect(U(after, 'e1')!.exhausted).toBe(true)
    expect(U(after, 'e2')!.exhausted, '3 power is less than 4').toBe(true)
    expect(U(after, 'sp')!.exhausted, 'a space unit is not in its arena').toBe(false)
  })

  it('R2-D2 (TS26_62): may deal 2 to a base, and that base\'s controller draws', () => {
    const fired = fire(board([unit('src', 'TS26_62')]), 'TS26_62')
    expect(offeredBases(fired)).toEqual(['opponent', 'player'])
    expect(offered(fired)).toEqual([])
    expect(declinable(fired)).toBe(true)
    const after = accept(fired, { baseTarget: 'opponent' })
    expect(after.players.opponent.base.damage).toBe(2)
    expect(after.players.opponent.hand).toEqual(['D_FILL'])
    expect(after.players.player.hand).toEqual([])
  })

  it('Relief Frigate (TS26_42): choosing one base heals 3 from the other', () => {
    const s = withPlayer(board([unit('src', 'TS26_42')]), 'player', { base: { cardId: 'TST_B', damage: 5 } })
    const fired = fire(s, 'TS26_42')
    expect(choice(fired).kind).toBe('selectHealTarget')
    expect(offeredBases(fired)).toEqual(['opponent', 'player'])
    expect(declinable(fired)).toBe(false)
    expect(accept(fired, { baseTarget: 'player' }).players.player.base.damage).toBe(2)
  })

  it('Ruping Rider (TS26_67): 2 damage to a base only while your base has 15 or more damage', () => {
    const s = board([unit('src', 'TS26_67')])
    noChoice(fire(withPlayer(s, 'player', { base: { cardId: 'TST_B', damage: 14 } }), 'TS26_67'))
    const fired = fire(withPlayer(s, 'player', { base: { cardId: 'TST_B', damage: 15 } }), 'TS26_67')
    expect(offeredBases(fired)).toEqual(['opponent', 'player'])
    expect(declinable(fired)).toBe(false)
  })

  it('Tribunal (TS26_36): 2 less per other card played this phase, and -2/-2 to each other unit', () => {
    const def = getCardDefinition('TS26_36')!
    const s = board([unit('src', 'TS26_36'), unit('a', 'GRD')], [unit('e', 'FRAIL')], { phaseEvents: phaseEvents({ played: { player: ['X', 'Y'], opponent: ['Z'] } }) })
    expect(def.costModifier!(s, 'player')).toBe(-4)
    const after = fire(s, 'TS26_36')
    expect(effectivePower(after, U(after, 'a')!)).toBe(0)
    expect(effectivePower(after, U(after, 'src')!), 'not itself').toBe(2)
    expect(effectiveHp(after, U(after, 'e')!)).toBe(1)
  })

  it('Twilight (TS26_41): heals 3 from your base with 5 or more cards in the discard pile', () => {
    const s = withPlayer(board([unit('src', 'TS26_41')]), 'player', { base: { cardId: 'TST_B', damage: 6 }, discard: ['a', 'b', 'c', 'd'] })
    expect(fire(s, 'TS26_41').players.player.base.damage).toBe(6)
    expect(fire(withPlayer(s, 'player', { discard: ['a', 'b', 'c', 'd', 'e'] }), 'TS26_41').players.player.base.damage).toBe(3)
  })

  it('Avenger (IBH_72): 1 damage to each other unit, friendly included', () => {
    const after = fire(board([unit('src', 'IBH_72'), unit('a', 'GRD')], [unit('e', 'SPACE')]), 'IBH_72')
    expect([U(after, 'src')!.damage, U(after, 'a')!.damage, U(after, 'e')!.damage]).toEqual([0, 1, 1])
  })

  it('Blizzard One (IBH_99): may defeat a non-leader ground unit with 3 or less remaining HP', () => {
    const s = board([unit('src', 'IBH_99')], [unit('e1', 'FRAIL'), unit('e2', 'GRD', { damage: 3 }), unit('e3', 'GRD'), unit('sp', 'SPACE', { damage: 5 }), unit('l', 'FRAIL', { isLeader: true })])
    const fired = fire(s, 'IBH_99')
    expect(offered(fired)).toEqual(['e1', 'e2'])
    expect(declinable(fired)).toBe(true)
  })

  it('C-3P0 (IBH_19) draws with a Cunning unit; General Veers (IBH_68) hits and heals with a Vigilance unit', () => {
    expect(fire(board([unit('src', 'IBH_19')]), 'IBH_19').players.player.hand).toEqual([])
    expect(fire(board([unit('src', 'IBH_19'), unit('c', 'CUNNING')]), 'IBH_19').players.player.hand).toEqual(['D_FILL'])
    const hurt = (mine: UnitState[]) => withPlayer(board(mine), 'player', { base: { cardId: 'TST_B', damage: 5 } })
    const none = fire(hurt([unit('src', 'IBH_68')]), 'IBH_68')
    expect([none.players.opponent.base.damage, none.players.player.base.damage]).toEqual([0, 5])
    const veers = fire(hurt([unit('src', 'IBH_68'), unit('v', 'VIGIL')]), 'IBH_68')
    expect([veers.players.opponent.base.damage, veers.players.player.base.damage]).toEqual([2, 3])
  })

  it('Luke Skywalker (IBH_20): may deal 3 damage to a ground unit', () => {
    const fired = fire(board([unit('src', 'IBH_20')], [unit('e', 'GRD'), unit('sp', 'SPACE')]), 'IBH_20')
    expect(offered(fired)).toEqual(['e', 'src'])
    expect(declinable(fired)).toBe(true)
  })

  it('Millennium Falcon (IBH_31): readies while your base has more damage than an enemy base', () => {
    const s = board([unit('src', 'IBH_31', { exhausted: true })])
    const even = withPlayer(s, 'player', { base: { cardId: 'TST_B', damage: 3 } })
    expect(U(fire(withPlayer(even, 'opponent', { base: { cardId: 'TST_B', damage: 3 } }), 'IBH_31'), 'src')!.exhausted).toBe(true)
    expect(U(fire(even, 'IBH_31'), 'src')!.exhausted).toBe(false)
  })
})

// ── Attacks from a unit's When Played ─────────────────────────────────────────────────────────────

describe('attacks raised by a unit or upgrade entering play', () => {
  const power = (s: GameState, attackerId: string) => {
    const after = hitBase(s, attackerId)
    return after.players.opponent.base.damage
  }

  it.each([
    ['LOF_111', 'Maz Kanata: a Force unit, +2/+0', 'FORCE', 4],
    ['TWI_091', 'Republic Tactical Officer: a Republic unit, +2/+0', 'REPUBLIC', 4],
  ])('%s %s', (id, _label, eligible, dealt) => {
    const s = board([unit('src', id), unit('x', eligible), unit('g', 'GRD')], [unit('e', 'TOUGH')])
    const fired = fire(s, id)
    expect(choice(fired).kind).toBe('mayAttackAnyUnit')
    expect(attackers(fired)).toEqual(['x'])
    expect(declinable(fired)).toBe(true)
    expect(power(fired, 'x')).toBe(dealt)
  })

  it.each([
    ['LAW_157', 'Target Tagger: any unit, +2/+0 if a Bounty Hunter', 'BH'],
    ['SHD_236', 'Snowtrooper Lieutenant: any unit, +2/+0 if Imperial', 'IMPERIAL'],
    ['SOR_240', 'Fleet Lieutenant: any unit, +2/+0 if a Rebel', 'REBEL'],
  ])('%s %s', (id, _label, favoured) => {
    // A unit enters play exhausted, so it is never among its own attackers.
    const s = board([unit('src', id, { exhausted: true }), unit('x', favoured), unit('g', 'GRD')], [unit('e', 'TOUGH')])
    const fired = fire(s, id)
    expect(attackers(fired)).toEqual(['g', 'x'])
    expect(declinable(fired)).toBe(true)
    expect(power(fired, 'x')).toBe(4)
    expect(power(fired, 'g')).toBe(2)
  })

  it('Snowtrooper Lieutenant (SOR_227) and Snapshot Reflexes (SHD_223) play as the printings they reprint', async () => {
    const { reprintCanonicalId } = await import('../data/reprints')
    expect(reprintCanonicalId('SOR_227')).toBe('SHD_236')
    expect(reprintCanonicalId('SHD_223')).toBe('SOR_215')
  })

  it('Adelphi Patrol Wing (SHD_101): any unit, +2/+0 only while you have the initiative', () => {
    const s = board([unit('src', 'SHD_101'), unit('g', 'GRD')], [unit('e', 'TOUGH')])
    expect(power(fire(s, 'SHD_101'), 'g')).toBe(4)
    expect(power(fire({ ...s, initiative: 'opponent' }, 'SHD_101'), 'g')).toBe(2)
  })

  it('4-LOM (LAW_065): a friendly Bounty Hunter, even exhausted, and never a base', () => {
    const s = board([unit('src', 'LAW_065'), unit('x', 'BH', { exhausted: true }), unit('g', 'GRD')], [unit('e', 'TOUGH')])
    const fired = fire(s, 'LAW_065')
    expect(attackers(fired)).toEqual(['x'])
    expect(baseOffered(fired, 'x')).toBe(false)
    expect(declinable(fired)).toBe(true)
    const after = hitUnit(fired, 'x', 'e')
    expect(U(after, 'e')!.damage).toBe(2)
    // With no enemy unit to attack, nothing is offered.
    noChoice(fire(board([unit('src', 'LAW_065'), unit('x', 'BH')]), 'LAW_065'))
  })

  it('Mon Mothma (SEC_103): any number of other units one at a time, exhausted too, never a base, each once', () => {
    const s = board([unit('src', 'SEC_103'), unit('a', 'GRD', { exhausted: true }), unit('b', 'GRD2')], [unit('e', 'TOUGH')])
    const fired = fire(s, 'SEC_103')
    expect(attackers(fired)).toEqual(['a', 'b'])
    expect(baseOffered(fired, 'a')).toBe(false)
    expect(declinable(fired)).toBe(true)
    const first = hitUnit(fired, 'a', 'e')
    expect(first.pendingChoices?.[0]?.kind, 'the next attack follows the first').toBe('mayAttackAnyUnit')
    expect(attackers(first)).toEqual(['b'])
    const second = hitUnit(first, 'b', 'e')
    expect(U(second, 'e')!.damage).toBe(5)
    noChoice(second)
    expect(second.activePlayer, 'the turn passes once the sequence ends').toBe('opponent')
    // Declining stops the sequence.
    const stopped = skip(hitUnit(fire(s, 'SEC_103'), 'a', 'e'))
    noChoice(stopped)
  })

  it("Ahsoka's Padawan Lightsaber (TWI_248): may attack with a unit only when attached to Ahsoka Tano", () => {
    const withSaber = (hostCard: string) => board([unit('src', hostCard, { upgrades: [{ cardId: 'TWI_248', owner: 'player' }] }), unit('g', 'GRD')], [unit('e', 'TOUGH')])
    noChoice(fire(withSaber('GRD2'), 'TWI_248'))
    const fired = fire(withSaber('AHSOKA'), 'TWI_248')
    expect(attackers(fired)).toEqual(['g', 'src'])
    expect(declinable(fired)).toBe(true)
    const restriction = getCardDefinition('TWI_248')!.attachRestriction!
    expect(restriction(s0(), U(s0(), 'v')!, 'player')).toBe(false)
  })

  it("Darth Maul's Lightsaber (LOF_140): Darth Maul attacks with Overwhelm and cannot attack a base; attaches to a friendly non-Vehicle unit", () => {
    const withSaber = (hostCard: string) => board([unit('src', hostCard, { upgrades: [{ cardId: 'LOF_140', owner: 'player' }] }), unit('g', 'GRD')], [unit('e', 'FRAIL')])
    noChoice(fire(withSaber('GRD2'), 'LOF_140'))
    const fired = fire(withSaber('MAUL'), 'LOF_140')
    expect(attackers(fired)).toEqual(['src'])
    expect(baseOffered(fired, 'src')).toBe(false)
    const after = hitUnit(fired, 'src', 'e')
    expect(after.players.opponent.base.damage, 'Overwhelm carries the excess').toBe(2)
    const restriction = getCardDefinition('LOF_140')!.attachRestriction!
    const s = s0()
    expect(restriction(s, U(s, 'g')!, 'player')).toBe(true)
    expect(restriction(s, U(s, 'v')!, 'player')).toBe(false)
    expect(restriction(s, U(s, 'e')!, 'player'), 'not an enemy unit').toBe(false)
  })
})

// ── "You may pay N. If you do" ────────────────────────────────────────────────────────────────────

const readyResources = (s: GameState, who: PlayerId = 'player') => s.players[who].resources.filter(r => !r.exhausted).length

describe('"you may pay N. If you do": a paid yes/no, then the effect', () => {
  it('is not offered when the cost cannot be paid, and costs nothing when declined', () => {
    const s = board([unit('src', 'LAW_227')], [unit('e', 'GRD')])
    noChoice(fire(withPlayer(s, 'player', { resources: [] }), 'LAW_227'))
    const fired = fire(s, 'LAW_227')
    expect(choice(fired).kind).toBe('mayPayThen')
    expect(declinable(fired)).toBe(true)
    const declined = skip(fired)
    expect(readyResources(declined)).toBe(6)
    expect(shields(declined, 'src')).toBe(0)
  })

  it('Rookie Rocket-jumper (LAW_227): pay 1, Shield to this unit', () => {
    const after = accept(fire(board([unit('src', 'LAW_227')]), 'LAW_227'))
    expect(readyResources(after)).toBe(5)
    expect(shields(after, 'src')).toBe(1)
  })

  it('Dogged Pursuers (LAW_198): pay 1, 2 damage to a ground unit', () => {
    const paid = accept(fire(board([unit('src', 'LAW_198')], [unit('e', 'GRD'), unit('sp', 'SPACE')]), 'LAW_198'))
    expect(readyResources(paid)).toBe(5)
    expect(choice(paid).kind).toBe('selectDamageTarget')
    expect(offered(paid)).toEqual(['e', 'src'])
    expect(declinable(paid), 'once paid, the damage is not a may').toBe(false)
    expect(U(accept(paid, { targetInstanceId: 'e' }), 'e')!.damage).toBe(2)
  })

  it('Freelance Assassin (TWI_212): pay 2, 2 damage to any unit', () => {
    const s = board([unit('src', 'TWI_212')], [unit('e', 'GRD'), unit('sp', 'SPACE')])
    noChoice(fire(withPlayer(s, 'player', { resources: ready(1) }), 'TWI_212'))
    const paid = accept(fire(s, 'TWI_212'))
    expect(readyResources(paid)).toBe(4)
    expect(offered(paid)).toEqual(['e', 'sp', 'src'])
  })

  it('Mid Rim Sharpshooter (LAW_193): pay 1, an opponent discards a card', () => {
    const s = withPlayer(board([unit('src', 'LAW_193')]), 'opponent', { hand: ['GRD', 'EV'] })
    const paid = accept(fire(s, 'LAW_193'))
    const c = choice(paid)
    expect(c.kind).toBe('selectDiscard')
    expect(c.controller, 'the opponent picks').toBe('opponent')
    expect(accept(paid, { handIndex: 1 }).players.opponent.discard).toEqual(['EV'])
    // Paying would buy nothing against an empty hand, but the choice is still the player's to make.
    expect(choice(fire(board([unit('src', 'LAW_193')]), 'LAW_193')).kind).toBe('mayPayThen')
  })

  it('Shield Drive Outfitter (LAW_113): pay 1, Shield to a unit', () => {
    const paid = accept(fire(board([unit('src', 'LAW_113')], [unit('e', 'GRD')]), 'LAW_113'))
    expect(offered(paid)).toEqual(['e', 'src'])
    expect(shields(accept(paid, { targetInstanceId: 'e' }), 'e')).toBe(1)
  })

  it("Smuggler's YT-2400 (LAW_148): pay 1, +1/+1 for this phase", () => {
    const after = accept(fire(board([unit('src', 'LAW_148')]), 'LAW_148'))
    expect([effectivePower(after, U(after, 'src')!), effectiveHp(after, U(after, 'src')!)]).toEqual([5, 6])
  })
})

// ── Two linked steps ──────────────────────────────────────────────────────────────────────────────

describe('two linked steps in one ability', () => {
  it('ISB Agent (SEC_184, and SOR_176 as its reprint): may reveal an event, then 1 damage to a unit', async () => {
    const s = board([unit('src', 'SEC_184')], [unit('e', 'GRD')])
    noChoice(fire(withPlayer(s, 'player', { hand: ['GRD'] }), 'SEC_184'))
    const fired = fire(withPlayer(s, 'player', { hand: ['GRD', 'EV'] }), 'SEC_184')
    expect(choice(fired).kind).toBe('mayPayThen')
    expect(declinable(fired)).toBe(true)
    const revealed = accept(fired)
    expect(readyResources(revealed), 'revealing costs no resources').toBe(6)
    expect(revealed.players.player.hand, 'the event stays in hand').toEqual(['GRD', 'EV'])
    expect(offered(revealed)).toEqual(['e', 'src'])
    expect(declinable(revealed)).toBe(false)
    const { reprintCanonicalId } = await import('../data/reprints')
    expect(reprintCanonicalId('SOR_176')).toBe('SEC_184')
  })

  it('Red Squadron X-Wing (JTL_051): may deal 2 damage to itself, then draw', () => {
    const fired = fire(board([unit('src', 'JTL_051')]), 'JTL_051')
    expect(declinable(fired)).toBe(true)
    const after = accept(fired)
    expect(U(after, 'src')!.damage).toBe(2)
    expect(after.players.player.hand).toEqual(['D_FILL'])
  })

  it('R2-D2 (TWI_193): may discard a card, then searches the top 3 and draws one', () => {
    const s = withPlayer(board([unit('src', 'TWI_193')]), 'player', { hand: ['EV'], deck: ['GRD', 'WEAK', 'SPACE', 'VEH'] })
    noChoice(fire(withPlayer(s, 'player', { hand: [] }), 'TWI_193'))
    const fired = fire(s, 'TWI_193')
    expect(choice(fired).kind).toBe('selectDiscard')
    expect(declinable(fired)).toBe(true)
    const discarded = accept(fired, { handIndex: 0 })
    expect(discarded.players.player.discard).toEqual(['EV'])
    const c = choice(discarded)
    expect(c.kind).toBe('searchDraw')
    expect('revealed' in c && c.revealed).toEqual(['GRD', 'WEAK', 'SPACE'])
    noChoice(skip(fired))
  })

  it('Bright Hope (SOR_099): may return a friendly non-leader ground unit, then draw', () => {
    const s = board([unit('src', 'SOR_099'), unit('g', 'GRD'), unit('sp', 'SPACE'), unit('L', 'LEADERU', { isLeader: true })], [unit('e', 'GRD')])
    const fired = fire(s, 'SOR_099')
    expect(offered(fired)).toEqual(['g'])
    expect(declinable(fired)).toBe(true)
    const after = accept(fired, { targetInstanceId: 'g' })
    expect(after.players.player.hand).toEqual(['GRD', 'D_FILL'])
  })

  it('Academy Disciplinarian (SEC_165): may deal 1 to a friendly unit with 2 or less power and ready it', () => {
    const s = board([unit('src', 'SEC_165'), unit('g', 'GRD', { exhausted: true }), unit('big', 'GRD2')], [unit('e', 'WEAK')])
    const fired = fire(s, 'SEC_165')
    expect(offered(fired)).toEqual(['g'])
    expect(declinable(fired)).toBe(true)
    const after = accept(fired, { targetInstanceId: 'g' })
    expect(U(after, 'g')!.damage).toBe(1)
    expect(U(after, 'g')!.exhausted).toBe(false)
  })

  it('Interrogation Droid (LAW_075): exhausts an enemy unit; if it costs 3 or less, its controller discards', () => {
    const s = withPlayer(board([unit('src', 'LAW_075')], [unit('cheap', 'GRD'), unit('dear', 'PRICEY'), unit('tired', 'WEAK', { exhausted: true })]), 'opponent', { hand: ['EV'] })
    const fired = fire(s, 'LAW_075')
    expect(offered(fired)).toEqual(['cheap', 'dear', 'tired'])
    expect(declinable(fired)).toBe(false)
    const cheap = accept(fired, { targetInstanceId: 'cheap' })
    expect(U(cheap, 'cheap')!.exhausted).toBe(true)
    expect(choice(cheap).controller).toBe('opponent')
    expect(choice(cheap).kind).toBe('selectDiscard')
    const dear = accept(fired, { targetInstanceId: 'dear' })
    expect(U(dear, 'dear')!.exhausted).toBe(true)
    noChoice(dear)
    noChoice(accept(fired, { targetInstanceId: 'tired' }))
  })

  it('Ahsoka Tano (JTL_201): an opponent discards; if it is a unit, you may exhaust a unit', () => {
    const s = withPlayer(board([unit('src', 'JTL_201')], [unit('e', 'GRD')]), 'opponent', { hand: ['GRD', 'EV'] })
    const fired = fire(s, 'JTL_201')
    expect(choice(fired).controller).toBe('opponent')
    expect(declinable(fired)).toBe(false)
    noChoice(accept(fired, { handIndex: 1 }))
    const unitGone = accept(fired, { handIndex: 0 })
    const c = choice(unitGone)
    expect(c.controller).toBe('player')
    expect(offered(unitGone)).toEqual(['e', 'src'])
    expect(declinable(unitGone)).toBe(true)
    expect(U(accept(unitGone, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
  })

  it('The Mandalorian (SHD_049): may heal all damage from a unit that costs 2 or less and give it 2 Shields', () => {
    const s = board([unit('src', 'SHD_049'), unit('w', 'WEAK', { damage: 4 })], [unit('g', 'GRD'), unit('big', 'GRD2')])
    const fired = fire(s, 'SHD_049')
    expect(offered(fired)).toEqual(['g', 'w'])
    expect(declinable(fired)).toBe(true)
    const after = accept(fired, { targetInstanceId: 'w' })
    expect(U(after, 'w')!.damage).toBe(0)
    expect(shields(after, 'w')).toBe(2)
  })

  it('Rio Durant (LAW_093): may return a non-leader unit costing 3 or less; its owner may play it free, Shielded', () => {
    const s = board([unit('src', 'LAW_093')], [unit('e', 'GRD'), unit('big', 'PRICEY')])
    const fired = fire(s, 'LAW_093')
    expect(offered(fired)).toEqual(['e'])
    expect(declinable(fired)).toBe(true)
    const returned = accept(fired, { targetInstanceId: 'e' })
    expect(returned.players.opponent.hand).toEqual(['GRD'])
    const c = choice(returned)
    expect(c.kind).toBe('playUnitFromHand')
    expect(c.controller, 'its owner decides').toBe('opponent')
    expect(declinable(returned)).toBe(true)
    const replayed = accept(returned, { handIndex: 0 })
    const again = replayed.players.opponent.units.find(u => u.cardId === 'GRD')!
    expect(again).toBeDefined()
    expect(readyResources(replayed, 'opponent'), 'for free').toBe(3)
    expect(again.upgrades.filter(up => up.cardId === TOKEN_SHIELD)).toHaveLength(1)
  })

  it('Heavy Blaster Cannon (LOF_171): may deal 1 damage to a ground unit three times', () => {
    const s = board([unit('src', 'GRD', { upgrades: [{ cardId: 'LOF_171', owner: 'player' }] })], [unit('e', 'GRD'), unit('sp', 'SPACE')])
    const fired = fire(s, 'LOF_171')
    expect(offered(fired)).toEqual(['e', 'src'])
    expect(declinable(fired)).toBe(true)
    expect(U(accept(fired, { targetInstanceId: 'e' }), 'e')!.damage).toBe(3)
    // Three separate hits: a Shield soaks only the first.
    const shielded = board([unit('src', 'GRD', { upgrades: [{ cardId: 'LOF_171', owner: 'player' }] })], [unit('e', 'GRD', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })])
    expect(U(accept(fire(shielded, 'LOF_171'), { targetInstanceId: 'e' }), 'e')!.damage).toBe(2)
  })

  it('Death Trooper (SEC_030, with SHD_030 and SOR_033): 2 damage to a friendly ground unit and 2 to an enemy ground unit', async () => {
    const s = board([unit('src', 'SEC_030'), unit('g', 'GRD'), unit('sp', 'SPACE')], [unit('e', 'GRD'), unit('esp', 'SPACE')])
    const fired = fire(s, 'SEC_030')
    expect(offered(fired)).toEqual(['g', 'src'])
    expect(declinable(fired)).toBe(false)
    const first = accept(fired, { targetInstanceId: 'g' })
    expect(U(first, 'g')!.damage).toBe(2)
    expect(offered(first)).toEqual(['e'])
    expect(declinable(first)).toBe(false)
    expect(U(accept(first, { targetInstanceId: 'e' }), 'e')!.damage).toBe(2)
    // No enemy ground unit: the friendly half still happens.
    noChoice(accept(fire(board([unit('src', 'SEC_030')]), 'SEC_030'), { targetInstanceId: 'src' }))
    const { reprintCanonicalId } = await import('../data/reprints')
    expect([reprintCanonicalId('SHD_030'), reprintCanonicalId('SOR_033')]).toEqual(['SEC_030', 'SEC_030'])
  })

  it('Admiral Ackbar (SOR_097): may deal damage equal to the units you control in the target\'s arena', () => {
    const s = board([unit('src', 'SOR_097'), unit('g', 'GRD'), unit('sp', 'SPACE')], [unit('e', 'TOUGH'), unit('esp', 'TOUGH', { arena: 'space' })])
    const fired = fire(s, 'SOR_097')
    expect(declinable(fired)).toBe(true)
    expect(offered(fired)).toEqual(['e', 'esp', 'g', 'sp', 'src'])
    expect(U(accept(fired, { targetInstanceId: 'e' }), 'e')!.damage).toBe(2)
    expect(U(accept(fired, { targetInstanceId: 'esp' }), 'esp')!.damage).toBe(1)
  })

  it('Darth Vader (LOF_037): a Shield to a friendly unit and to an enemy unit; On Attack defeats a shielded enemy', () => {
    const s = board([unit('src', 'LOF_037'), unit('g', 'GRD')], [unit('e', 'GRD'), unit('e2', 'WEAK')])
    const fired = fire(s, 'LOF_037')
    expect(offered(fired)).toEqual(['g', 'src'])
    expect(declinable(fired)).toBe(false)
    const first = accept(fired, { targetInstanceId: 'g' })
    expect(shields(first, 'g')).toBe(1)
    expect(offered(first)).toEqual(['e', 'e2'])
    const both = accept(first, { targetInstanceId: 'e' })
    expect(shields(both, 'e')).toBe(1)
    // Answering the last choice ended the turn, so the attack is taken on the player's next one.
    const attack = fireAt({ ...both, activePlayer: 'player' }, 'LOF_037', 'onAttack')
    expect(choice(attack).kind).toBe('selectUnitToDefeat')
    expect(offered(attack)).toEqual(['e'])
    expect(declinable(attack)).toBe(false)
    noChoice(fireAt(s, 'LOF_037', 'onAttack'))
  })
})

/** A plain board for attach restrictions: a friendly ground unit, a friendly Vehicle and an enemy unit. */
const s0 = () => board([unit('g', 'GRD'), unit('v', 'VEH')], [unit('e', 'GRD')])
