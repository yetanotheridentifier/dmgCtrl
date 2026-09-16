import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves, enemyAttackTargets } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword, unitHasTrait } from '../engine/keywords'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'

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

  // Upgrades returned, moved or played
  SEC_200: src('SEC_200'), SHD_209: src('SHD_209'), LAW_078: src('LAW_078', { aspects: ['Aggression', 'Cunning', 'Heroism'] }),
  LOF_248: src('LOF_248'), LOF_150: src('LOF_150', { cost: 8 }),
  CHEAPUP: upg('CHEAPUP', { cost: 3 }), DEARUP: upg('DEARUP', { cost: 4 }), UNIQUP: upg('UNIQUP', { cost: 1, unique: true }),
  COMMAND: card({ id: 'COMMAND', arena: 'ground', cost: 2, power: 2, hp: 6, aspects: ['Command'] }),
  SABER: upg('SABER', { traits: ['LIGHTSABER'] }), SABER2: upg('SABER2', { traits: ['LIGHTSABER'] }),

  // Upgrade attach rules and upgrade-specific text
  SEC_069: upg('SEC_069'), LOF_091: upg('LOF_091', { cost: 5 }), LOF_201: upg('LOF_201', { unique: true }), SHD_193: upg('SHD_193', { cost: 3 }),
  LAW_111: upg('LAW_111', { unique: true }), TWI_256: upg('TWI_256', { power: 1 }), SOR_136: upg('SOR_136', { power: 3, hp: 1, unique: true }),
  TWI_219: upg('TWI_219', { power: 2 }),
  QUIGON: card({ id: 'QUIGON', name: 'Qui-Gon Jinn', arena: 'ground', cost: 5, power: 4, hp: 6, unique: true }),
  LEIA: card({ id: 'LEIA', name: 'Leia Organa', arena: 'ground', cost: 3, power: 2, hp: 6, unique: true }),
  VADER: card({ id: 'VADER', name: 'Darth Vader', arena: 'ground', cost: 7, power: 5, hp: 8, unique: true }),
  SENT: card({ id: 'SENT', arena: 'ground', cost: 2, power: 2, hp: 6, keywords: [{ name: 'Sentinel' }] }),
  HIDER: card({ id: 'HIDER', arena: 'ground', cost: 2, power: 2, hp: 6, keywords: [{ name: 'Hidden' }] }),
  C2: card({ id: 'C2', arena: 'ground', cost: 2, power: 1, hp: 6 }), C4: card({ id: 'C4', arena: 'ground', cost: 4, power: 1, hp: 6 }),

  // Lasting effects
  LOF_191: src('LOF_191', { cost: 1, power: 1, hp: 3 }), TWI_110: src('TWI_110'), LOF_211: src('LOF_211', { keywords: [{ name: 'Hidden' }] }),
  LOF_209: src('LOF_209'), SOR_140: src('SOR_140'), TWI_067: src('TWI_067', { cost: 9, power: 10, hp: 10 }), LOF_070: src('LOF_070'),
  HERO: card({ id: 'HERO', type: 'event', cost: 1, aspects: ['Heroism'] }), VILLAIN: card({ id: 'VILLAIN', type: 'event', cost: 1, aspects: ['Villainy'] }),

  // Control and other zones
  LAW_233: src('LAW_233', { power: 0, hp: 5 }), SEC_192: src('SEC_192'), TWI_211: src('TWI_211'), LAW_099: src('LAW_099', { arena: 'space' }),
  TWI_252: src('TWI_252'), SOR_183: src('SOR_183'),
  SPACEVEH: card({ id: 'SPACEVEH', arena: 'space', cost: 3, power: 3, hp: 5, traits: ['VEHICLE'] }),

  // A second ability outside When Played
  LAW_058: src('LAW_058'), LAW_091: src('LAW_091'), LOF_194: src('LOF_194', { arena: 'space' }), TWI_208: src('TWI_208'),
  TWI_185: src('TWI_185'), SHD_080: src('SHD_080', { cost: 1, power: 1, hp: 3 }), SOR_184: src('SOR_184', { arena: 'space', unique: true }), SEC_139: src('SEC_139'),
  BOBA: card({ id: 'BOBA', name: 'Boba Fett', arena: 'ground', cost: 5, power: 4, hp: 6, unique: true }),
  UNIQ2: card({ id: 'UNIQ2', arena: 'ground', cost: 2, power: 2, hp: 6, unique: true }),

  // Several targets
  LAW_187: upg('LAW_187'), LAW_183: src('LAW_183', { arena: 'space' }), SEC_169: src('SEC_169'), SEC_155: src('SEC_155', { unique: true }),
  LOF_167: src('LOF_167'), JTL_140: src('JTL_140', { arena: 'space' }), JTL_170: src('JTL_170', { power: 3, hp: 7 }), JTL_072: src('JTL_072'),
  SHD_047: src('SHD_047'), LOF_147: src('LOF_147', { arena: 'space' }), SOR_135: src('SOR_135'), SOR_052: src('SOR_052', { arena: 'space', hp: 9 }),
  TWI_044: src('TWI_044', { power: 0, hp: 5 }),
  FRINGE: card({ id: 'FRINGE', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['FRINGE'] }),
  MANDO: card({ id: 'MANDO', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['MANDALORIAN'] }),
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

// ── Upgrades returned, moved or played ────────────────────────────────────────────────────────────

describe('upgrades returned, moved or played', () => {
  const upgraded = (hostCard = 'GRD') => board(
    [unit('src', hostCard), unit('g', 'GRD', { upgrades: [{ cardId: 'CHEAPUP', owner: 'player' }, { cardId: 'UNIQUP', owner: 'player' }] }), unit('v', 'VEH')],
    [unit('e', 'GRD', { upgrades: [{ cardId: 'DEARUP', owner: 'opponent' }] })],
  )
  const offeredUpgrades = (s: GameState) => {
    const c = choice(s)
    return 'candidates' in c ? (c.candidates as { cardId: string }[]).map(x => x.cardId).sort() : []
  }

  it('Junior Senator (SEC_200): may return an upgrade that costs 3 or less, with no free replay', () => {
    const fired = fire(upgraded(), 'SEC_200')
    expect(choice(fired).kind).toBe('selectUpgradeToReturn')
    expect(offeredUpgrades(fired)).toEqual(['CHEAPUP', 'UNIQUP'])
    expect(declinable(fired)).toBe(true)
    const after = accept(fired, { optionIndex: offeredUpgrades(fired).indexOf('CHEAPUP') === 0 ? 0 : 1 })
    expect(after.players.player.hand).toContain('CHEAPUP')
    noChoice(after)
  })

  it('Criminal Muscle (SHD_209): may return a non-unique upgrade, with no free replay', () => {
    const fired = fire(upgraded(), 'SHD_209')
    expect(offeredUpgrades(fired)).toEqual(['CHEAPUP', 'DEARUP'])
    expect(declinable(fired)).toBe(true)
  })

  it('Jabba the Hutt (ASH_042) still offers his free replay', () => {
    const fired = fire(upgraded(), 'ASH_042')
    const c = choice(fired)
    const i = 'candidates' in c ? (c.candidates as { cardId: string }[]).findIndex(x => x.cardId === 'CHEAPUP') : -1
    expect(choice(accept(fired, { optionIndex: i })).kind).toBe('mayPlayUpgradeFree')
  })

  it('Sabine Wren (LAW_078): may defeat a non-unique upgrade, or any upgrade with a Vigilance or Command unit', () => {
    const plain = fire(upgraded(), 'LAW_078')
    expect(choice(plain).kind).toBe('selectUpgradeToDefeat')
    expect(offeredUpgrades(plain)).toEqual(['CHEAPUP', 'DEARUP'])
    expect(declinable(plain)).toBe(true)
    const commanded = fire(upgraded('COMMAND'), 'LAW_078')
    expect(offeredUpgrades(commanded)).toEqual(['CHEAPUP', 'DEARUP', 'UNIQUP'])
  })

  it('Jocasta Nu (LOF_248): may move a friendly upgrade on a friendly unit to a different eligible unit', () => {
    const s = board(
      [unit('src', 'LOF_248'), unit('g', 'GRD', { upgrades: [{ cardId: 'LOF_140', owner: 'player' }, { cardId: 'CHEAPUP', owner: 'player' }] }), unit('v', 'VEH')],
      [unit('e', 'GRD', { upgrades: [{ cardId: 'DEARUP', owner: 'opponent' }] })],
    )
    const fired = fire(s, 'LOF_248')
    expect(offeredUpgrades(fired), 'not an enemy upgrade').toEqual(['CHEAPUP', 'LOF_140'])
    expect(declinable(fired)).toBe(true)
    const c = choice(fired)
    const saber = 'candidates' in c ? (c.candidates as { cardId: string }[]).findIndex(x => x.cardId === 'LOF_140') : -1
    const picked = accept(fired, { optionIndex: saber })
    expect(offered(picked), "Darth Maul's Lightsaber: a friendly non-Vehicle unit other than its host").toEqual(['src'])
    const moved = accept(picked, { targetInstanceId: 'src' })
    expect(U(moved, 'src')!.upgrades).toEqual([{ cardId: 'LOF_140', owner: 'player' }])
    expect(U(moved, 'g')!.upgrades).toEqual([{ cardId: 'CHEAPUP', owner: 'player' }])
    const cheap = accept(fired, { optionIndex: 1 - saber })
    expect(offered(cheap), 'any other unit').toEqual(['e', 'src', 'v'])
  })

  it('Cin Drallig (LOF_150): may play a Lightsaber upgrade from hand on him for free, then ready him', () => {
    const s = withPlayer(board([unit('src', 'LOF_150', { exhausted: true })]), 'player', { hand: ['CHEAPUP', 'SABER', 'SABER2'], resources: [] })
    noChoice(fire(withPlayer(s, 'player', { hand: ['CHEAPUP'] }), 'LOF_150'))
    const fired = fire(s, 'LOF_150')
    expect(declinable(fired)).toBe(true)
    expect(accepts(fired).map(m => m.handIndex).sort()).toEqual([1, 2])
    const after = accept(fired, { handIndex: 2 })
    expect(U(after, 'src')!.upgrades).toEqual([{ cardId: 'SABER2', owner: 'player' }])
    expect(after.players.player.hand).toEqual(['CHEAPUP', 'SABER'])
    expect(U(after, 'src')!.exhausted).toBe(false)
  })
})

// ── Upgrade attach rules and upgrade-specific text ────────────────────────────────────────────────

/** The unit ids `attackerId` may attack. */
const targetsOf = (s: GameState, attackerId: string) => {
  const controller: PlayerId = s.players.player.units.some(u => u.instanceId === attackerId) ? 'player' : 'opponent'
  return ids(enemyAttackTargets(s, U(s, attackerId)!, controller).targets.map(u => u.instanceId))
}
const on = (upgradeId: string, hostCard = 'GRD', theirs: UnitState[] = [unit('e', 'GRD'), unit('esp', 'SPACE')], mine: UnitState[] = []) =>
  board([unit('src', hostCard, { upgrades: [{ cardId: upgradeId, owner: 'player' }] }), ...mine], theirs)

describe('upgrade attach rules and upgrade-specific text', () => {
  it('Nimble Prowess (SEC_069): attaches to a friendly unit; may exhaust a unit in its arena', () => {
    const restriction = getCardDefinition('SEC_069')!.attachRestriction!
    const s = s0()
    expect([restriction(s, U(s, 'g')!, 'player'), restriction(s, U(s, 'e')!, 'player')]).toEqual([true, false])
    const fired = fire(on('SEC_069'), 'SEC_069')
    expect(choice(fired).kind).toBe('mayExhaustUnit')
    expect(offered(fired)).toEqual(['e', 'src'])
    expect(declinable(fired)).toBe(true)
  })

  it("Craving Power (LOF_091): attaches to a friendly unit; damage to an enemy unit equal to the attached unit's power", () => {
    const restriction = getCardDefinition('LOF_091')!.attachRestriction!
    const s = s0()
    expect(restriction(s, U(s, 'e')!, 'player')).toBe(false)
    const fired = fire(on('LOF_091', 'GRD2'), 'LOF_091')
    expect(offered(fired)).toEqual(['e', 'esp'])
    expect(declinable(fired)).toBe(false)
    expect(U(accept(fired, { targetInstanceId: 'e' }), 'e')!.damage).toBe(3)
  })

  it("Qui-Gon Jinn's Lightsaber (LOF_201): on Qui-Gon, may exhaust any number of units costing 6 or less combined", () => {
    const restriction = getCardDefinition('LOF_201')!.attachRestriction!
    const s = s0()
    expect([restriction(s, U(s, 'g')!, 'player'), restriction(s, U(s, 'v')!, 'player'), restriction(s, U(s, 'e')!, 'player')]).toEqual([true, false, false])
    noChoice(fire(on('LOF_201', 'GRD', [unit('a', 'C2')]), 'LOF_201'))
    const fired = fire(on('LOF_201', 'QUIGON', [unit('a', 'C2'), unit('b', 'C4'), unit('c', 'C4'), unit('big', 'VADER')]), 'LOF_201')
    expect(offered(fired), 'ready units that fit the budget').toEqual(['a', 'b', 'c', 'src'])
    expect(declinable(fired)).toBe(true)
    const one = accept(fired, { targetInstanceId: 'b' })
    expect(U(one, 'b')!.exhausted).toBe(true)
    expect(offered(one), '2 left: only a 2-cost unit').toEqual(['a'])
    const two = accept(one, { targetInstanceId: 'a' })
    expect(U(two, 'a')!.exhausted).toBe(true)
    noChoice(two)
  })

  it("Frozen in Carbonite (SHD_193): attaches to a non-leader unit, exhausts it, and it can't ready", () => {
    const restriction = getCardDefinition('SHD_193')!.attachRestriction!
    const s = board([unit('L', 'LEADERU', { isLeader: true })], [unit('e', 'GRD')])
    expect([restriction(s, U(s, 'L')!, 'player'), restriction(s, U(s, 'e')!, 'player')]).toEqual([false, true])
    const frozen = board([], [unit('e', 'GRD', { upgrades: [{ cardId: 'SHD_193', owner: 'player' }] })])
    const fired = fire(frozen, 'SHD_193', 'e')
    expect(U(fired, 'e')!.exhausted).toBe(true)
    expect(U(readyUnitViaGalvanized(fired, 'e'), 'e')!.exhausted, 'an ability cannot ready it').toBe(true)
    const regroup = resolve(resolve({ ...fired, activePlayer: 'player' }, { type: 'pass' }), { type: 'pass' })
    expect(U(regroup, 'e')!.exhausted, 'nor the regroup phase').toBe(true)
  })

  it("Leia's Disguise (LAW_111): grants Underworld; on Leia Organa, a Shield to a friendly unit", () => {
    const s = on('LAW_111')
    expect(unitHasTrait(s, U(s, 'src')!, 'Underworld')).toBe(true)
    expect(getCardDefinition('LAW_111')!.attachRestriction!(s0(), U(s0(), 'v')!, 'player')).toBe(false)
    noChoice(fire(s, 'LAW_111'))
    const fired = fire(on('LAW_111', 'LEIA', [unit('e', 'GRD')], [unit('g', 'GRD')]), 'LAW_111')
    expect(offered(fired)).toEqual(['g', 'src'])
    expect(declinable(fired)).toBe(false)
  })

  it('Hold-Out Blaster (TWI_256): the attached unit may deal 1 damage to a ground unit', () => {
    const fired = fire(on('TWI_256', 'GRD2'), 'TWI_256')
    expect(offered(fired)).toEqual(['e', 'src'])
    expect(declinable(fired)).toBe(true)
    expect(choice(fired).source?.cardId, 'dealt by the attached unit').toBe('GRD2')
    expect(getCardDefinition('TWI_256')!.attachRestriction!(s0(), U(s0(), 'v')!, 'player')).toBe(false)
  })

  it("Vader's Lightsaber (SOR_136): on Darth Vader, may deal 4 damage to a ground unit", () => {
    noChoice(fire(on('SOR_136'), 'SOR_136'))
    const fired = fire(on('SOR_136', 'VADER'), 'SOR_136')
    expect(offered(fired)).toEqual(['e', 'src'])
    expect(declinable(fired)).toBe(true)
    expect(U(accept(fired, { targetInstanceId: 'e' }), 'e')!.damage).toBe(4)
  })

  it("On Top of Things (TWI_219): the attached unit can't be attacked this phase, unless it has Sentinel", () => {
    const s = board([unit('src', 'GRD', { upgrades: [{ cardId: 'TWI_219', owner: 'player' }] }), unit('sent', 'SENT', { upgrades: [{ cardId: 'TWI_219', owner: 'player' }] })], [unit('e', 'GRD')])
    const after = fire(fire(s, 'TWI_219'), 'TWI_219', 'sent')
    expect(targetsOf(after, 'e')).toEqual(['sent'])
    expect(targetsOf(withPlayer(after, 'player', { units: after.players.player.units.filter(u => u.instanceId === 'src') }), 'e')).toEqual([])
  })
})

/** Ready a unit through an ability, the way Galvanized Leap does. */
const readyUnitViaGalvanized = (s: GameState, id: string): GameState =>
  resolve({ ...s, activePlayer: 'player', pendingChoices: [{ kind: 'selectUnitToReady', id: 'x', controller: 'player', targets: [id] }] }, { type: 'acceptChoice', choiceId: 'x', targetInstanceId: id })

// ── Lasting effects ───────────────────────────────────────────────────────────────────────────────

describe('lasting effects the buff choice cannot carry', () => {
  it('BD-1 (LOF_191) and Huyang (TWI_110): another friendly unit is buffed while the source stays in play', () => {
    const s = board([unit('src', 'LOF_191'), unit('g', 'GRD')], [unit('e', 'GRD')])
    const fired = fire(s, 'LOF_191')
    expect(offered(fired)).toEqual(['g'])
    expect(declinable(fired)).toBe(false)
    const after = accept(fired, { targetInstanceId: 'g' })
    expect(effectivePower(after, U(after, 'g')!)).toBe(3)
    expect(keywords(after, 'g')).toContain('Saboteur')
    const regroup = resolve(resolve({ ...after, activePlayer: 'player' }, { type: 'pass' }), { type: 'pass' })
    expect(effectivePower(regroup, U(regroup, 'g')!), 'beyond this phase').toBe(3)
    const gone = withPlayer(after, 'player', { units: after.players.player.units.filter(u => u.instanceId !== 'src') })
    expect(effectivePower(gone, U(gone, 'g')!), 'only while BD-1 is in play').toBe(2)

    const huyang = accept(fire(board([unit('src', 'TWI_110'), unit('g', 'GRD')]), 'TWI_110'), { targetInstanceId: 'g' })
    expect([effectivePower(huyang, U(huyang, 'g')!), effectiveHp(huyang, U(huyang, 'g')!)]).toEqual([4, 8])
  })

  it("Dooku (LOF_211): each friendly unit with Hidden can't be attacked for this phase", () => {
    const s = board([unit('src', 'LOF_211'), unit('h', 'HIDER'), unit('g', 'GRD')], [unit('e', 'GRD')])
    const after = fire(s, 'LOF_211')
    expect(targetsOf(after, 'e')).toEqual(['g'])
  })

  it('Tusken Tracker (LOF_209): each enemy unit loses Hidden for this phase', () => {
    const s = board([unit('src', 'LOF_209'), unit('a', 'GRD')], [unit('h', 'HIDER', { hidden: true })])
    expect(targetsOf(s, 'a')).toEqual([])
    const after = fire(s, 'LOF_209')
    expect(keywords(after, 'h')).not.toContain('Hidden')
    expect(targetsOf(after, 'a')).toEqual(['h'])
  })

  it('SpecForce Soldier (SOR_140): a unit loses Sentinel for this phase', () => {
    const s = board([unit('src', 'SOR_140'), unit('a', 'GRD')], [unit('sent', 'SENT'), unit('e', 'GRD')])
    const fired = fire(s, 'SOR_140')
    expect(offered(fired)).toEqual(['a', 'e', 'sent', 'src'])
    expect(declinable(fired)).toBe(false)
    const after = accept(fired, { targetInstanceId: 'sent' })
    expect(keywords(after, 'sent')).not.toContain('Sentinel')
    expect(targetsOf(after, 'a')).toEqual(['e', 'sent'])
  })

  it('The Zillo Beast (TWI_067): each enemy ground unit gets -5/-0; heals 5 as the regroup phase starts', () => {
    const s = board([unit('src', 'TWI_067', { damage: 7 }), unit('g', 'GRD2')], [unit('e', 'VEH'), unit('esp', 'SPACE')])
    const after = fire(s, 'TWI_067')
    expect(effectivePower(after, U(after, 'e')!)).toBe(0)
    expect(effectivePower(after, U(after, 'esp')!)).toBe(2)
    expect(effectivePower(after, U(after, 'g')!)).toBe(3)
    expect(U(fireAt(after, 'TWI_067', 'whenRegroupStarts'), 'src')!.damage).toBe(2)
  })

  it('Anakin Skywalker (LOF_070): -3/-3 once for a Heroism card in the discard pile, once for a Villainy card', () => {
    const s = board([unit('src', 'LOF_070')], [unit('e', 'GRD')])
    noChoice(fire(s, 'LOF_070', 'src', 0))
    noChoice(fire(s, 'LOF_070', 'src', 1))
    const hero = withPlayer(s, 'player', { discard: ['HERO'] })
    const first = fire(hero, 'LOF_070', 'src', 0)
    expect(offered(first)).toEqual(['e', 'src'])
    expect(declinable(first)).toBe(true)
    noChoice(fire(hero, 'LOF_070', 'src', 1))
    const both = withPlayer(s, 'player', { discard: ['HERO', 'VILLAIN'] })
    const debuffed = accept(fire(both, 'LOF_070', 'src', 1), { targetInstanceId: 'e' })
    expect(effectivePower(debuffed, U(debuffed, 'e')!)).toBe(0)
    expect(effectiveHp(debuffed, U(debuffed, 'e')!)).toBe(3)
  })
})

// ── Control and other zones ───────────────────────────────────────────────────────────────────────

const controllerOf = (s: GameState, id: string): PlayerId | undefined =>
  s.players.player.units.some(u => u.instanceId === id) ? 'player' : s.players.opponent.units.some(u => u.instanceId === id) ? 'opponent' : undefined
const toRegroup = (s: GameState) => resolve(resolve({ ...s, pendingChoices: [], activePlayer: 'player' }, { type: 'pass' }), { type: 'pass' })

describe('control and other zones', () => {
  it('Galen Erso (LAW_233): may hand himself to an opponent for good; enemy units gain Raid 1 and Saboteur', () => {
    const s = board([unit('src', 'LAW_233'), unit('g', 'GRD')], [unit('e', 'GRD')])
    expect(keywords(s, 'e')).toEqual(expect.arrayContaining(['Saboteur', 'Raid']))
    expect(keywords(s, 'g')).not.toContain('Saboteur')
    const fired = fire(s, 'LAW_233')
    expect(declinable(fired)).toBe(true)
    const given = accept(fired)
    expect(controllerOf(given, 'src')).toBe('opponent')
    expect(keywords(given, 'g'), 'now the player\'s units are his enemies').toEqual(expect.arrayContaining(['Saboteur', 'Raid']))
    expect(controllerOf(toRegroup(given), 'src'), 'a regroup does not hand him back').toBe('opponent')
  })

  it('Grand Moff Tarkin (SEC_192): takes an enemy non-leader Vehicle until he leaves play', () => {
    const s = board([unit('src', 'SEC_192')], [unit('v', 'VEH'), unit('sv', 'SPACEVEH'), unit('g', 'GRD'), unit('lv', 'VEH', { isLeader: true })])
    const fired = fire(s, 'SEC_192')
    expect(offered(fired)).toEqual(['sv', 'v'])
    expect(declinable(fired)).toBe(false)
    const taken = accept(fired, { targetInstanceId: 'v' })
    expect(controllerOf(taken, 'v')).toBe('player')
    expect(controllerOf(toRegroup(taken), 'v'), 'the regroup phase does not end it').toBe('player')
    const tarkinGone = resolve({ ...taken, activePlayer: 'player', pendingChoices: [{ kind: 'selectUnitToDefeat', id: 'x', controller: 'player', targets: ['src'] }] }, { type: 'acceptChoice', choiceId: 'x', targetInstanceId: 'src' })
    expect(controllerOf(tarkinGone, 'v'), 'his leaving play hands it back').toBe('opponent')
  })

  it('Sly Moore (TWI_211): takes an enemy token unit and readies it, until the regroup phase starts', () => {
    const s = board([unit('src', 'TWI_211')], [unit('t', TOKEN_MANDALORIAN, { exhausted: true }), unit('g', 'GRD')])
    const fired = fire(s, 'TWI_211')
    expect(offered(fired)).toEqual(['t'])
    const taken = accept(fired, { targetInstanceId: 't' })
    expect(controllerOf(taken, 't')).toBe('player')
    expect(U(taken, 't')!.exhausted).toBe(false)
    expect(controllerOf(toRegroup(taken), 't')).toBe('opponent')
  })

  it("Governor's Shuttle (LAW_099): each player chooses a unit they control, and both are defeated", () => {
    const s = board([unit('src', 'LAW_099'), unit('g', 'GRD')], [unit('e', 'GRD'), unit('e2', 'WEAK')])
    const fired = fire(s, 'LAW_099')
    expect(choice(fired).controller).toBe('player')
    expect(offered(fired)).toEqual(['g', 'src'])
    expect(declinable(fired)).toBe(false)
    const mine = accept(fired, { targetInstanceId: 'g' })
    expect(U(mine, 'g'), 'nothing is defeated until both have chosen').toBeDefined()
    expect(choice(mine).controller).toBe('opponent')
    expect(offered(mine)).toEqual(['e', 'e2'])
    const both = accept(mine, { targetInstanceId: 'e2' })
    expect([U(both, 'g'), U(both, 'e2')]).toEqual([undefined, undefined])
    // An opponent with no units: the player's pick is still defeated.
    const alone = accept(fire(board([unit('src', 'LAW_099'), unit('g', 'GRD')]), 'LAW_099'), { targetInstanceId: 'g' })
    expect(U(alone, 'g')).toBeUndefined()
  })

  it('Aggrieved Parliamentarian (TWI_252): the opponent\'s discard pile goes under their deck', () => {
    const s = withPlayer(board([unit('src', 'TWI_252')]), 'opponent', { discard: ['GRD', 'WEAK', 'EV'], deck: ['D_FILL'] })
    const after = fire(s, 'TWI_252')
    expect(after.players.opponent.discard).toEqual([])
    expect(after.players.opponent.deck[0]).toBe('D_FILL')
    expect(ids(after.players.opponent.deck.slice(1))).toEqual(['EV', 'GRD', 'WEAK'])
  })

  it('Bounty Hunter Crew (SOR_183): may return an event from either discard pile to its owner\'s hand', () => {
    const s = withPlayer(withPlayer(board([unit('src', 'SOR_183')]), 'player', { discard: ['GRD', 'EV'] }), 'opponent', { discard: ['HERO', 'WEAK'] })
    const fired = fire(s, 'SOR_183')
    const c = choice(fired)
    expect(c.kind).toBe('selectFromDiscard')
    expect('candidates' in c && c.candidates).toEqual(['EV', 'HERO'])
    expect(declinable(fired)).toBe(true)
    const theirs = accept(fired, { optionIndex: 1 })
    expect(theirs.players.opponent.hand).toEqual(['HERO'])
    expect(theirs.players.opponent.discard).toEqual(['WEAK'])
    expect(theirs.players.player.hand).toEqual([])
  })
})

// ── A second ability outside When Played ──────────────────────────────────────────────────────────

describe('cards with a second ability outside When Played', () => {
  it('Honor-Bound Partisan (LAW_058): 1 damage to a base; defeated, the next unit this phase costs 1 less', () => {
    const s = board([unit('src', 'LAW_058')])
    const fired = fire(s, 'LAW_058')
    expect(offeredBases(fired)).toEqual(['opponent', 'player'])
    expect(declinable(fired)).toBe(false)
    const defeated = fireAt(s, 'LAW_058', 'whenDefeated')
    expect(defeated.players.player.nextUnitGrants).toEqual([{ costDelta: -1 }])
  })

  it('Val (LAW_091): a Shield to another friendly unit; defeated, a Shield to an enemy unit', () => {
    const s = board([unit('src', 'LAW_091'), unit('g', 'GRD')], [unit('e', 'GRD')])
    const fired = fire(s, 'LAW_091')
    expect(offered(fired)).toEqual(['g'])
    expect(declinable(fired)).toBe(false)
    const defeated = fireAt(s, 'LAW_091', 'whenDefeated')
    expect(offered(defeated)).toEqual(['e'])
  })

  it.each(['LOF_194', 'TWI_208'])('%s draws when played, and discards a card when defeated', id => {
    const s = withPlayer(board([unit('src', id)]), 'player', { hand: ['EV'] })
    expect(fire(s, id).players.player.hand).toEqual(['EV', 'D_FILL'])
    const defeated = fireAt(s, id, 'whenDefeated')
    expect(choice(defeated).kind).toBe('selectDiscard')
    expect(declinable(defeated)).toBe(false)
    noChoice(fireAt(withPlayer(s, 'player', { hand: [] }), id, 'whenDefeated'))
  })

  it('Ziro the Hutt (TWI_185): may exhaust an enemy unit; On Attack, may exhaust an enemy resource', () => {
    const s = board([unit('src', 'TWI_185')], [unit('e', 'GRD')])
    const fired = fire(s, 'TWI_185')
    expect(offered(fired)).toEqual(['e'])
    expect(declinable(fired)).toBe(true)
    const attack = fireAt(s, 'TWI_185', 'onAttack')
    expect(declinable(attack)).toBe(true)
    expect(readyResources(accept(attack), 'opponent')).toBe(2)
  })

  it('Salacious Crumb (SHD_080): heals 1 from your base; his action returns him to hand to deal 1 to a ground unit', () => {
    const s = withPlayer(board([unit('src', 'SHD_080'), unit('g', 'GRD')], [unit('e', 'GRD'), unit('sp', 'SPACE')]), 'player', { base: { cardId: 'TST_B', damage: 3 } })
    expect(fire(s, 'SHD_080').players.player.base.damage).toBe(2)
    const uses = moves(s).filter(m => m.type === 'useAbility')
    expect(uses).toHaveLength(1)
    const used = resolve(s, uses[0])
    expect(used.players.player.hand).toEqual(['SHD_080'])
    expect(offered(used)).toEqual(['e', 'g'])
  })

  it("Fett's Firespray (SOR_184): readies with Boba or Jango Fett; C=2 action exhausts a non-unique unit", () => {
    const s = board([unit('src', 'SOR_184', { exhausted: true })], [unit('e', 'GRD'), unit('u', 'UNIQ2')])
    expect(U(fire(s, 'SOR_184'), 'src')!.exhausted).toBe(true)
    const withBoba = board([unit('src', 'SOR_184', { exhausted: true }), unit('b', 'BOBA')])
    expect(U(fire(withBoba, 'SOR_184'), 'src')!.exhausted).toBe(false)
    const ready = board([unit('src', 'SOR_184')], [unit('e', 'GRD'), unit('u', 'UNIQ2')])
    const uses = moves(ready).filter(m => m.type === 'useAbility')
    expect(uses).toHaveLength(1)
    const used = resolve(ready, uses[0])
    expect(readyResources(used)).toBe(4)
    expect(offered(used)).toEqual(['e'])
  })

  it('Miraj Scintel (SEC_139): may deal 3 to an undamaged unit; a friendly attacker gains Overwhelm against a damaged unit', () => {
    const s = board([unit('src', 'SEC_139'), unit('a', 'GRD2')], [unit('e', 'FRAIL', { damage: 1 }), unit('f', 'FRAIL')])
    const fired = fire(s, 'SEC_139')
    expect(offered(fired)).toEqual(['a', 'f', 'src'])
    expect(declinable(fired)).toBe(true)
    expect(hitUnit(s, 'a', 'e').players.opponent.base.damage, '3 power into 2 remaining HP: 1 carries over').toBe(1)
    expect(hitUnit(s, 'a', 'f').players.opponent.base.damage, 'an undamaged defender: no Overwhelm').toBe(0)
  })
})

// ── Several targets ───────────────────────────────────────────────────────────────────────────────

describe('several targets: each of up to N, any number, divided amounts', () => {
  /** Pick `picks` in order from a fired "each of up to N" choice, returning the state after each. */
  const pickAllOf = (s: GameState, picks: string[]) => picks.reduce((acc, id) => accept(acc, { targetInstanceId: id }), s)

  it('"Staccato Lightning" Repeater (LAW_187): 1 damage to each of up to 3 different ground units', () => {
    const s = board([unit('src', 'GRD', { upgrades: [{ cardId: 'LAW_187', owner: 'player' }] })], [unit('a', 'GRD'), unit('b', 'GRD'), unit('c', 'GRD'), unit('sp', 'SPACE')])
    const fired = fire(s, 'LAW_187')
    expect(offered(fired)).toEqual(['a', 'b', 'c', 'src'])
    expect(declinable(fired), 'up to: none is allowed').toBe(true)
    const one = accept(fired, { targetInstanceId: 'a' })
    expect(offered(one), 'each unit once').toEqual(['b', 'c', 'src'])
    const three = pickAllOf(fired, ['a', 'b', 'c'])
    expect([U(three, 'a')!.damage, U(three, 'b')!.damage, U(three, 'c')!.damage]).toEqual([1, 1, 1])
    noChoice(three)
    expect(getCardDefinition('LAW_187')!.attachRestriction!(s0(), U(s0(), 'v')!, 'player')).toBe(false)
  })

  it('B-Wing Skirmisher (LAW_183): up to 2 space units; IG-2000 (JTL_140): up to 3 units', () => {
    const s = board([unit('src', 'LAW_183')], [unit('a', 'SPACE'), unit('b', 'SPACE'), unit('g', 'GRD')])
    const fired = fire(s, 'LAW_183')
    expect(offered(fired)).toEqual(['a', 'b', 'src'])
    noChoice(pickAllOf(fired, ['a', 'b']))
    const ig = fire(board([unit('src', 'JTL_140')], [unit('a', 'SPACE'), unit('g', 'GRD'), unit('h', 'GRD')]), 'JTL_140')
    expect(offered(ig)).toEqual(['a', 'g', 'h', 'src'])
    noChoice(pickAllOf(ig, ['a', 'g', 'h']))
  })

  it('AAT Incinerator (SEC_169): up to 4 other ground units; 2 damage to your base if no friendly unit was damaged', () => {
    const s = board([unit('src', 'SEC_169'), unit('g', 'GRD')], [unit('a', 'GRD'), unit('b', 'GRD')])
    const fired = fire(s, 'SEC_169')
    expect(offered(fired)).toEqual(['a', 'b', 'g'])
    expect(skip(fired).players.player.base.damage, 'no units at all: still no friendly damaged').toBe(2)
    expect(skip(accept(fired, { targetInstanceId: 'a' })).players.player.base.damage).toBe(2)
    expect(skip(accept(fired, { targetInstanceId: 'g' })).players.player.base.damage).toBe(0)
    const shielded = board([unit('src', 'SEC_169'), unit('g', 'GRD', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })], [unit('a', 'GRD')])
    expect(skip(accept(fire(shielded, 'SEC_169'), { targetInstanceId: 'g' })).players.player.base.damage, 'a Shield soaked it: not damaged').toBe(2)
  })

  it('Alexsandr Kallus (SEC_155): 2 damage to each of up to 3 ground units; other friendly unique units gain Raid 2 with the initiative', () => {
    const s = board([unit('src', 'SEC_155'), unit('u', 'UNIQ2'), unit('g', 'GRD')], [unit('e', 'GRD')])
    const after = accept(fire(s, 'SEC_155'), { targetInstanceId: 'e' })
    expect(U(after, 'e')!.damage).toBe(2)
    expect(keywords(s, 'u')).toContain('Raid')
    expect(keywords(s, 'g')).not.toContain('Raid')
    expect(keywords(s, 'src'), 'other').not.toContain('Raid')
    expect(keywords({ ...s, initiative: 'opponent' }, 'u')).not.toContain('Raid')
  })

  it('Saesee Tiin (LOF_167): up to 3 units only with the initiative', () => {
    const s = board([unit('src', 'LOF_167')], [unit('e', 'GRD')])
    noChoice(fire({ ...s, initiative: 'opponent' }, 'LOF_167'))
    expect(offered(fire(s, 'LOF_167'))).toEqual(['e', 'src'])
  })

  it('War Juggernaut (JTL_170): 1 damage to each of any number of units; +1/+0 for each damaged unit', () => {
    const s = board([unit('src', 'JTL_170'), unit('g', 'GRD')], [unit('a', 'GRD'), unit('b', 'GRD'), unit('c', 'GRD'), unit('d', 'GRD')])
    const all5 = pickAllOf(fire(s, 'JTL_170'), ['a', 'b', 'c', 'd', 'g'])
    expect(offered(all5)).toEqual(['src'])
    expect(effectivePower(all5, U(all5, 'src')!)).toBe(3 + 5)
  })

  it('Wing Guard Security Team (JTL_072) and The Armorer (SHD_047): Shields to up to 2 Fringe / 3 Mandalorian units', () => {
    const wing = fire(board([unit('src', 'JTL_072'), unit('f', 'FRINGE'), unit('g', 'GRD')], [unit('ef', 'FRINGE')]), 'JTL_072')
    expect(offered(wing)).toEqual(['ef', 'f'])
    const two = pickAllOf(wing, ['f', 'ef'])
    expect([shields(two, 'f'), shields(two, 'ef')]).toEqual([1, 1])
    const armorer = fire(board([unit('src', 'SHD_047'), unit('m', 'MANDO'), unit('g', 'GRD')]), 'SHD_047')
    expect(offered(armorer)).toEqual(['m'])
    expect(declinable(armorer)).toBe(true)
  })

  it("Kit Fisto's Aethersprite (LOF_147): may defeat any number of upgrades on one unit", () => {
    const s = board([unit('src', 'LOF_147'), unit('g', 'GRD', { upgrades: [{ cardId: 'CHEAPUP', owner: 'player' }] })],
      [unit('e', 'GRD', { upgrades: [{ cardId: 'DEARUP', owner: 'opponent' }, { cardId: TOKEN_SHIELD, owner: 'opponent' }] }), unit('bare', 'GRD')])
    const fired = fire(s, 'LOF_147')
    expect(offered(fired), 'units with an upgrade').toEqual(['e', 'g'])
    expect(declinable(fired)).toBe(true)
    const onE = accept(fired, { targetInstanceId: 'e' })
    expect(choice(onE).kind).toBe('selectUpgradeThen')
    expect(declinable(onE)).toBe(true)
    const first = accept(onE, { optionIndex: 0 })
    expect(U(first, 'e')!.upgrades.map(u => u.cardId)).toEqual([TOKEN_SHIELD])
    const second = accept(first, { optionIndex: 0 })
    expect(U(second, 'e')!.upgrades).toEqual([])
    noChoice(second)
  })

  it('Emperor Palpatine (SOR_135): 6 damage divided among enemy units, all of it', () => {
    const s = board([unit('src', 'SOR_135'), unit('g', 'GRD')], [unit('a', 'TOUGH'), unit('b', 'TOUGH')])
    const fired = fire(s, 'SOR_135')
    expect(choice(fired).kind).toBe('distributeDamage')
    expect(offered(fired)).toEqual(['a', 'b'])
    expect(declinable(fired), 'the whole 6 must be dealt').toBe(false)
    const done = ['a', 'a', 'b', 'a', 'b', 'b'].reduce((acc, id) => accept(acc, { targetInstanceId: id }), fired)
    expect([U(done, 'a')!.damage, U(done, 'b')!.damage]).toEqual([3, 3])
    noChoice(done)
    noChoice(fire(board([unit('src', 'SOR_135')]), 'SOR_135'))
  })

  it('Redemption (SOR_052): heals up to 8 from units and bases, then takes that much damage', () => {
    const s = withPlayer(board([unit('src', 'SOR_052'), unit('g', 'GRD', { damage: 2 })], [unit('e', 'GRD', { damage: 1 }), unit('ok', 'GRD')]), 'player', { base: { cardId: 'TST_B', damage: 10 } })
    const fired = fire(s, 'SOR_052')
    expect(choice(fired).kind).toBe('distributeHealing')
    expect(offered(fired), 'damaged units only').toEqual(['e', 'g'])
    expect(offeredBases(fired), 'damaged bases only').toEqual(['player'])
    expect(declinable(fired)).toBe(true)
    const healed = accept(accept(accept(fired, { targetInstanceId: 'g' }), { targetInstanceId: 'g' }), { baseTarget: 'player' })
    expect(offered(healed), 'g is fully healed').toEqual(['e'])
    const stopped = skip(healed)
    expect([U(stopped, 'g')!.damage, stopped.players.player.base.damage, U(stopped, 'src')!.damage]).toEqual([0, 9, 3])
    noChoice(stopped)
    const eight = Array.from({ length: 8 }).reduce<GameState>(acc => accept(acc, { baseTarget: 'player' }), fired)
    expect([eight.players.player.base.damage, U(eight, 'src')!.damage]).toEqual([2, 8])
    noChoice(eight)
  })

  it('Kashyyyk Defender (TWI_044): heals up to 2 from another unit and takes that much damage', () => {
    const s = board([unit('src', 'TWI_044', { damage: 1 }), unit('g', 'GRD', { damage: 3 }), unit('h', 'GRD', { damage: 3 })])
    const fired = fire(s, 'TWI_044')
    expect(offered(fired)).toEqual(['g', 'h'])
    expect(offeredBases(fired)).toEqual([])
    const one = accept(fired, { targetInstanceId: 'g' })
    expect(offered(one), 'the same unit').toEqual(['g'])
    const two = accept(one, { targetInstanceId: 'g' })
    expect([U(two, 'g')!.damage, U(two, 'src')!.damage]).toEqual([1, 3])
    noChoice(two)
  })
})

/** A plain board for attach restrictions: a friendly ground unit, a friendly Vehicle and an enemy unit. */
const s0 = () => board([unit('g', 'GRD'), unit('v', 'VEH')], [unit('e', 'GRD')])
