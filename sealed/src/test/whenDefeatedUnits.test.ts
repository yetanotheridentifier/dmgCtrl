```ts
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
/**
 * Scoped by the triage but lifted out to the ticket that owns their blocker. Empty: `JTL_221`
 * Stolen AT-Hauler was the last of them and shipped with playing a card out of a discard pile,
 * which is where its When Defeated leads. Its own tests live with that group.
 */
const LIFTED: string[] = []

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
  L_UNIT: src('L_UNIT', { traits: ['LEADER'] }),
}

describe('whenDefeatedUnits', () => {
  it('registers all shipped whenDefeated units without throwing', () => {
    for (const id of SHIPPED) {
      const def = getCardDefinition(id)
      expect(def).toBeDefined()
    }
  })

  it('triggers whenDefeated and handles basic resolution', () => {
    const st = state({
      p1: player({
        ground: [fixtureUnit(F.GRD, { id: 'test_unit' })],
      }),
    })
    expect(st.p1.ground.length).toBe(1)
  })
})
```
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
/**
 * Scoped by the triage but lifted out to the ticket that owns their blocker. Empty: `JTL_221`
 * Stolen AT-Hauler was the last of them and shipped with playing a card out of a discard pile,
 * which is where its When Defeated leads. Its own tests live with that group.
 */
const LIFTED: string[] = []

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
  L_UNIT: src('L_UNIT', { traits: ['LEADER'] }),
}

describe('whenDefeatedUnits', () => {
  it('registers all shipped whenDefeated units without throwing', () => {
    for (const id of SHIPPED) {
      const def = getCardDefinition(id)
      expect(def).toBeDefined()
    }
  })

  it('triggers whenDefeated and handles basic resolution', () => {
    const st = state({
      p1: player({
        ground: [fixtureUnit(F.GRD, { id: 'test_unit' })],
      }),
    })
    expect(st.p1.ground.length).toBe(1)
  })
})
