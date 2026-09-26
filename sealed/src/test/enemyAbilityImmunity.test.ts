import { describe, it, expect } from 'vitest'
import { registerCard, whileResolving } from '../engine/abilities'
import { defeatUnit, defeatUnits, applyUnitDamage, dealDamageToUnit } from '../engine/combat'
import { findUnit, exhaustUnit, returnUnitToHand, takeControlOfUnit, defeatUpgradeAt, returnUpgradeToHand } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState, PlayerId } from '../engine/types'

/**
 * #708: the general "can't be captured/damaged/defeated/exhausted/returned to hand/taken control of
 * by enemy card abilities" primitive — `CardDefinition.cannotBeTargetedByEnemyAbility`,
 * `grantsEnemyAbilityProtection` and `protectsAttachedUpgrade`, read by `protectedFromEnemyAbility`
 * (and, for an attached upgrade, `upgradeProtectedFromEnemyAbility`) at every guarded site. Generalises
 * `cannotBeCaptured` (#466), whose own coverage now lives under the 'capture' action in
 * `capture.test.ts`.
 */
const F = {
  ...CARDS,
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  UPG2: card({ id: 'UPG2', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
}
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const opponentOf = (p: PlayerId): PlayerId => (p === 'player' ? 'opponent' : 'player')
/** Simulate an ability controlled by `targetOwner`'s opponent (an "enemy card ability" of the target). */
const enemy = (targetOwner: PlayerId, run: (s: GameState) => GameState) => (s: GameState) =>
  whileResolving(s, { cardId: 'ENEMY_ABILITY', controller: opponentOf(targetOwner) }, run)
/** Simulate an ability controlled by the target's own side (never blocked by this text). */
const friendly = (targetOwner: PlayerId, run: (s: GameState) => GameState) => (s: GameState) =>
  whileResolving(s, { cardId: 'FRIENDLY_ABILITY', controller: targetOwner }, run)

describe('protectedFromEnemyAbility — the general primitive', () => {
  registerCard('TST_DEFEAT', { cannotBeTargetedByEnemyAbility: (_s, _u, action) => action === 'defeat' })
  registerCard('TST_EXHAUST', { cannotBeTargetedByEnemyAbility: (_s, _u, action) => action === 'exhaust' })
  registerCard('TST_RETURN', { cannotBeTargetedByEnemyAbility: (_s, _u, action) => action === 'return' })
  registerCard('TST_DAMAGE', { cannotBeTargetedByEnemyAbility: (_s, _u, action) => action === 'damage' })
  registerCard('TST_TAKECONTROL', { cannotBeTargetedByEnemyAbility: (_s, _u, action) => action === 'takeControl' })
  const G = {
    ...F,
    TST_DEFEAT: card({ id: 'TST_DEFEAT', type: 'unit', cost: 2, power: 1, hp: 3 }),
    TST_EXHAUST: card({ id: 'TST_EXHAUST', type: 'unit', cost: 2, power: 1, hp: 3 }),
    TST_RETURN: card({ id: 'TST_RETURN', type: 'unit', cost: 2, power: 1, hp: 3 }),
    TST_DAMAGE: card({ id: 'TST_DAMAGE', type: 'unit', cost: 2, power: 1, hp: 3 }),
    TST_TAKECONTROL: card({ id: 'TST_TAKECONTROL', type: 'unit', cost: 2, power: 1, hp: 3 }),
  }
  const board = (over: Partial<GameState> = {}) => state({ cards: G, players: { player: rich(), opponent: rich() }, ...over })

  it('blocks a defeat attempted by an enemy ability, but not a friendly one', () => {
    const s = board({ players: { player: rich(), opponent: rich({ units: [unit('tgt', 'TST_DEFEAT')] }) } })
    expect(findUnit(enemy('opponent', st => defeatUnit(st, 'tgt'))(s), 'tgt')).toBeDefined() // untouched
    expect(findUnit(friendly('opponent', st => defeatUnit(st, 'tgt'))(s), 'tgt')).toBeUndefined() // its own side
  })

  it('is not blocked when nothing traces the defeat to any ability (a plain direct call, as a state-based sweep would be)', () => {
    const s = board({ players: { player: rich(), opponent: rich({ units: [unit('tgt', 'TST_DEFEAT')] }) } })
    expect(findUnit(defeatUnit(s, 'tgt'), 'tgt')).toBeUndefined()
  })

  it('defeatUnits keeps the protected unit alive while still defeating the rest of the batch', () => {
    const s = board({ players: { player: rich(), opponent: rich({ units: [unit('tgt', 'TST_DEFEAT'), unit('other', 'TST_U1')] }) } })
    const next = enemy('opponent', st => defeatUnits(st, ['tgt', 'other']))(s)
    expect(findUnit(next, 'tgt')).toBeDefined()
    expect(findUnit(next, 'other')).toBeUndefined()
  })

  it('blocks an exhaust attempted by an enemy ability, but not a friendly one', () => {
    const s = board({ players: { player: rich(), opponent: rich({ units: [unit('tgt', 'TST_EXHAUST')] }) } })
    expect(findUnit(enemy('opponent', st => exhaustUnit(st, 'tgt'))(s), 'tgt')?.unit.exhausted).toBe(false)
    expect(findUnit(friendly('opponent', st => exhaustUnit(st, 'tgt'))(s), 'tgt')?.unit.exhausted).toBe(true)
  })

  it('blocks a return-to-hand attempted by an enemy ability, but not a friendly one', () => {
    const s = board({ players: { player: rich(), opponent: rich({ units: [unit('tgt', 'TST_RETURN')] }) } })
    expect(findUnit(enemy('opponent', st => returnUnitToHand(st, 'tgt'))(s), 'tgt')).toBeDefined()
    expect(findUnit(friendly('opponent', st => returnUnitToHand(st, 'tgt'))(s), 'tgt')).toBeUndefined()
  })

  it('blocks damage attempted by an enemy ability, but not a friendly one, and never blocks combat damage', () => {
    const s = board({ players: { player: rich(), opponent: rich({ units: [unit('tgt', 'TST_DAMAGE')] }) } })
    const fromEnemy = dealDamageToUnit(s, 'tgt', 2, { cardId: 'ENEMY_ABILITY', controller: 'player' })
    expect(findUnit(fromEnemy, 'tgt')?.unit.damage).toBe(0)
    const fromFriendly = dealDamageToUnit(s, 'tgt', 2, { cardId: 'FRIENDLY_ABILITY', controller: 'opponent' })
    expect(findUnit(fromFriendly, 'tgt')?.unit.damage).toBe(2)
    const combat = applyUnitDamage(s, 'opponent', new Map([['tgt', 2]]), true, {}, { cardId: 'TST_U1', controller: 'player' })
    expect(findUnit(combat, 'tgt')?.unit.damage).toBe(2)
  })

  it('take-control: an opponent can never take control, since only two players exist (Rey\'s wording)', () => {
    const s = board({ players: { player: rich(), opponent: rich({ units: [unit('tgt', 'TST_TAKECONTROL')] }) } })
    const next = takeControlOfUnit(s, 'opponent', 'player', 'tgt')
    expect(next.players.opponent.units.some(u => u.instanceId === 'tgt')).toBe(true) // stayed put
  })

  it('an unprotected unit is still taken as usual (no regression)', () => {
    const s = board({ players: { player: rich(), opponent: rich({ units: [unit('tgt', 'TST_U1')] }) } })
    const next = takeControlOfUnit(s, 'opponent', 'player', 'tgt')
    expect(next.players.player.units.some(u => u.instanceId === 'tgt')).toBe(true)
  })
})

describe('grantsEnemyAbilityProtection — the aura form (Mythosaur\'s shape)', () => {
  registerCard('TST_GRANTER', {
    grantsEnemyAbilityProtection: (_s, _source, target, sameController, action) =>
      sameController && target.upgrades.length > 0 && action === 'exhaust',
  })
  const G = { ...F, TST_GRANTER: card({ id: 'TST_GRANTER', type: 'unit', cost: 2, power: 1, hp: 3 }) }
  const board = (mine: Parameters<typeof player>[0], theirs: Parameters<typeof player>[0] = {}) =>
    state({ cards: G, players: { player: rich(mine), opponent: rich(theirs) } })

  it('protects a friendly upgraded unit while the granter is in play', () => {
    const s = board({ units: [unit('granter', 'TST_GRANTER'), unit('tgt', 'TST_U1', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] })
    expect(findUnit(enemy('player', st => exhaustUnit(st, 'tgt'))(s), 'tgt')?.unit.exhausted).toBe(false)
  })

  it('does not protect a friendly unit with no upgrade', () => {
    const s = board({ units: [unit('granter', 'TST_GRANTER'), unit('tgt', 'TST_U1')] })
    expect(findUnit(enemy('player', st => exhaustUnit(st, 'tgt'))(s), 'tgt')?.unit.exhausted).toBe(true)
  })

  it('does not protect an enemy unit, even if upgraded', () => {
    const s = board(
      { units: [unit('granter', 'TST_GRANTER')] },
      { units: [unit('tgt', 'TST_U1', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })] },
    )
    expect(findUnit(enemy('opponent', st => exhaustUnit(st, 'tgt'))(s), 'tgt')?.unit.exhausted).toBe(true)
  })
})

describe('protectsAttachedUpgrade — the one printed case on an upgrade rather than a unit (Willrow Hood\'s shape)', () => {
  registerCard('TST_HOST', {
    protectsAttachedUpgrade: (_s, host, upgrade, action) =>
      (action === 'defeat' || action === 'return') && host.upgrades.length === 1 && upgrade.owner === 'player',
  })
  const G = { ...F, TST_HOST: card({ id: 'TST_HOST', type: 'unit', cost: 2, power: 1, hp: 3 }) }
  const board = (over: Partial<GameState> = {}) => state({ cards: G, players: { player: rich(), opponent: rich() }, ...over })

  it('protects the sole friendly upgrade from an enemy defeat, but not from a friendly one', () => {
    const s = board({ players: { player: rich({ units: [unit('host', 'TST_HOST', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] }), opponent: rich() } })
    expect(findUnit(enemy('player', st => defeatUpgradeAt(st, 'host', 0))(s), 'host')?.unit.upgrades).toHaveLength(1)
    expect(findUnit(friendly('player', st => defeatUpgradeAt(st, 'host', 0))(s), 'host')?.unit.upgrades).toHaveLength(0)
  })

  it('protects the sole friendly upgrade from an enemy return-to-hand', () => {
    const s = board({ players: { player: rich({ units: [unit('host', 'TST_HOST', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] }), opponent: rich() } })
    const next = enemy('player', st => returnUpgradeToHand(st, 'host', 0))(s)
    expect(findUnit(next, 'host')?.unit.upgrades).toHaveLength(1)
    expect(next.players.player.hand).not.toContain('UPG')
  })

  it('does not protect when the unit has 2 upgrades ("exactly 1" fails)', () => {
    const s = board({ players: {
      player: rich({ units: [unit('host', 'TST_HOST', { upgrades: [{ cardId: 'UPG', owner: 'player' }, { cardId: 'UPG2', owner: 'player' }] })] }),
      opponent: rich(),
    } })
    expect(findUnit(enemy('player', st => defeatUpgradeAt(st, 'host', 0))(s), 'host')?.unit.upgrades).toHaveLength(1)
  })
})
