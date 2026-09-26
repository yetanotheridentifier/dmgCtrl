import { describe, it, expect } from 'vitest'
import { whileResolving } from '../engine/abilities'
import { defeatUnit, applyUnitDamage } from '../engine/combat'
import { findUnit, exhaustUnit, returnUnitToHand, takeControlOfUnit, returnUpgradeToHand, defeatUpgradeAt } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, UnitState } from '../engine/types'

/**
 * #708's own two cards, plus the group from #701 the new primitive also makes expressible in the same
 * MR (see the ticket comment on #701 for exactly which shipped). Each test checks the registration
 * wires the right condition/action to the primitive (`enemyAbilityImmunity.test.ts`), not the
 * primitive itself.
 */
const F: Record<string, EngineCard> = {
  ...CARDS,
  SHD_187: card({ id: 'SHD_187', name: 'Lurking TIE Phantom', type: 'unit', arena: 'space', cost: 3, power: 2, hp: 2, keywords: [{ name: 'Raid', value: 2 }] }),
  TWI_220: card({ id: 'TWI_220', name: 'Shadowed Intentions', type: 'upgrade', cost: 3, power: 0, hp: 0, traits: ['Innate'] }),
  LAW_149: card({ id: 'LAW_149', name: 'Rey', type: 'unit', arena: 'ground', cost: 8, power: 9, hp: 9 }),
  SEC_061: card({ id: 'SEC_061', name: 'Willrow Hood', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 5 }),
  LOF_073: card({ id: 'LOF_073', name: 'Mythosaur', type: 'unit', arena: 'ground', cost: 9, power: 10, hp: 10, keywords: [{ name: 'Shielded' }] }),
  SEC_012: card({ id: 'SEC_012', name: 'Cassian Andor', type: 'unit', arena: 'ground', cost: 6, power: 6, hp: 2, keywords: [{ name: 'Overwhelm' }] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  UPG2: card({ id: 'UPG2', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
}
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const board = (mine: Parameters<typeof player>[0] = {}, theirs: Parameters<typeof player>[0] = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })
const enemyOf = (owner: 'player' | 'opponent') => (owner === 'player' ? 'opponent' : 'player')
const asEnemyAbility = (owner: 'player' | 'opponent', run: (s: GameState) => GameState) => (s: GameState) =>
  whileResolving(s, { cardId: 'ENEMY_ABILITY', controller: enemyOf(owner) }, run)
const asFriendlyAbility = (owner: 'player' | 'opponent', run: (s: GameState) => GameState) => (s: GameState) =>
  whileResolving(s, { cardId: 'FRIENDLY_ABILITY', controller: owner }, run)

describe('SHD_187 — Lurking TIE Phantom', () => {
  it('can\'t be captured, damaged or defeated by an enemy card ability', () => {
    const s = board({}, { units: [unit('tgt', 'SHD_187')] })
    expect(findUnit(asEnemyAbility('opponent', st => defeatUnit(st, 'tgt'))(s), 'tgt')).toBeDefined()
    const damaged = asEnemyAbility('opponent', st => applyUnitDamage(st, 'opponent', new Map([['tgt', 2]]), false, {}, { cardId: 'ENEMY_ABILITY', controller: 'player' }))(s)
    expect(findUnit(damaged, 'tgt')?.unit.damage).toBe(0)
  })

  it('combat damage still lands (the immunity is only against enemy ABILITIES)', () => {
    const s = board({}, { units: [unit('tgt', 'SHD_187')] }) // 2 HP: 1 damage proves it landed without also defeating it
    const next = applyUnitDamage(s, 'opponent', new Map([['tgt', 1]]), true, {}, { cardId: 'TST_U1', controller: 'player' })
    expect(findUnit(next, 'tgt')?.unit.damage).toBe(1)
  })

  it('its own controller\'s ability can still defeat it', () => {
    const s = board({}, { units: [unit('tgt', 'SHD_187')] })
    expect(findUnit(asFriendlyAbility('opponent', st => defeatUnit(st, 'tgt'))(s), 'tgt')).toBeUndefined()
  })
})

describe('TWI_220 — Shadowed Intentions', () => {
  it('grants its host "can\'t be captured, defeated or returned to hand by enemy card abilities"', () => {
    const s = board({}, { units: [unit('tgt', 'TST_U1', { upgrades: [{ cardId: 'TWI_220', owner: 'opponent' }] })] })
    expect(findUnit(asEnemyAbility('opponent', st => defeatUnit(st, 'tgt'))(s), 'tgt')).toBeDefined()
    expect(findUnit(asEnemyAbility('opponent', st => returnUnitToHand(st, 'tgt'))(s), 'tgt')).toBeDefined()
  })

  it('does nothing for a unit that isn\'t wearing it', () => {
    const s = board({}, { units: [unit('tgt', 'TST_U1')] })
    expect(findUnit(asEnemyAbility('opponent', st => defeatUnit(st, 'tgt'))(s), 'tgt')).toBeUndefined()
  })
})

describe('LAW_149 — Rey', () => {
  it('can\'t be defeated by an enemy card ability, and opponents can\'t take control of her', () => {
    const s = board({}, { units: [unit('tgt', 'LAW_149')] })
    expect(findUnit(asEnemyAbility('opponent', st => defeatUnit(st, 'tgt'))(s), 'tgt')).toBeDefined()
    const next = takeControlOfUnit(s, 'opponent', 'player', 'tgt')
    expect(next.players.opponent.units.some(u => u.instanceId === 'tgt')).toBe(true)
  })

  it('can still be exhausted or damaged by an enemy ability (the text names only defeat and control)', () => {
    const s = board({}, { units: [unit('tgt', 'LAW_149')] })
    expect(findUnit(asEnemyAbility('opponent', st => exhaustUnit(st, 'tgt'))(s), 'tgt')?.unit.exhausted).toBe(true)
  })
})

describe('SEC_061 — Willrow Hood', () => {
  it('protects its sole friendly upgrade from an enemy defeat or return-to-hand', () => {
    const s = board({}, { units: [unit('host', 'SEC_061', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })] })
    expect(findUnit(asEnemyAbility('opponent', st => defeatUpgradeAt(st, 'host', 0))(s), 'host')?.unit.upgrades).toHaveLength(1)
    expect(findUnit(asEnemyAbility('opponent', st => returnUpgradeToHand(st, 'host', 0))(s), 'host')?.unit.upgrades).toHaveLength(1)
  })

  it('stops protecting once a second upgrade attaches', () => {
    const s = board({}, { units: [unit('host', 'SEC_061', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }, { cardId: 'UPG2', owner: 'opponent' }] })] })
    expect(findUnit(asEnemyAbility('opponent', st => defeatUpgradeAt(st, 'host', 0))(s), 'host')?.unit.upgrades).toHaveLength(1)
  })
})

describe('LOF_073 — Mythosaur', () => {
  it('protects friendly upgraded units from an enemy exhaust or return-to-hand', () => {
    const s = board({}, { units: [unit('mytho', 'LOF_073'), unit('tgt', 'TST_U1', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })] })
    expect(findUnit(asEnemyAbility('opponent', st => exhaustUnit(st, 'tgt'))(s), 'tgt')?.unit.exhausted).toBe(false)
    expect(findUnit(asEnemyAbility('opponent', st => returnUnitToHand(st, 'tgt'))(s), 'tgt')).toBeDefined()
  })

  it('does not protect a friendly unit with no upgrade ("upgraded units" only)', () => {
    const s = board({}, { units: [unit('mytho', 'LOF_073'), unit('bare', 'TST_U1')] })
    expect(findUnit(asEnemyAbility('opponent', st => exhaustUnit(st, 'bare'))(s), 'bare')?.unit.exhausted).toBe(true)
  })

  it('does not protect an enemy upgraded unit ("friendly" only)', () => {
    const s = board({ units: [unit('upgraded', 'TST_U2', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] }, { units: [unit('mytho', 'LOF_073')] })
    expect(findUnit(asEnemyAbility('player', st => exhaustUnit(st, 'upgraded'))(s), 'upgraded')?.unit.exhausted).toBe(true)
  })
})

describe('SEC_012 — Cassian Andor', () => {
  it('while its controller has the initiative: survives 0 remaining HP and can\'t be defeated by an enemy ability', () => {
    const s = board({}, { units: [unit('tgt', 'SEC_012', { damage: 2 })] }, { initiative: 'opponent' })
    expect(findUnit(asEnemyAbility('opponent', st => defeatUnit(st, 'tgt'))(s), 'tgt')).toBeDefined()
    const damaged = applyUnitDamage(s, 'opponent', new Map([['tgt', 10]]), true, {}, { cardId: 'TST_U1', controller: 'player' })
    expect(findUnit(damaged, 'tgt')).toBeDefined() // 0 remaining HP, but doesn't die while it has the initiative
  })

  it('loses both while the opponent holds the initiative', () => {
    const s = board({}, { units: [unit('tgt', 'SEC_012', { damage: 2 })] }, { initiative: 'player' })
    expect(findUnit(asEnemyAbility('opponent', st => defeatUnit(st, 'tgt'))(s), 'tgt')).toBeUndefined()
  })
})
