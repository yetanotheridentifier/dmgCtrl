import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { defeatUnit } from '../engine/combat'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword, unitKeywordValue } from '../engine/keywords'
import { TOKEN_CLONE_TROOPER } from '../engine/tokenUnits'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PlayerId, UnitState } from '../engine/types'

/**
 * Coordinate (#472): "Gain this ability while you control 3 or more units." A live, continuously
 * checked board-state condition (`hasCoordinate`/`unitHasCoordinate` in cardDefinitions.ts) — the
 * same treatment as every other conditional keyword/stat grant (`conditionalKeywords`/
 * `statModifier`/`aura`): it can turn on and off mid-round as units enter or leave play, and every
 * read settles it fresh rather than caching it.
 *
 * 15 cards shipped here: 14 sole-blocked by Coordinate plus TWI_213, whose only other blocker
 * (capture, #466) is a fully built primitive already reused by other cards (`captureWp`). 8 more
 * candidates split to a follow-up (see the ticket comment): TWI_096 Aayla Secura needs a new
 * "prevent all combat damage this attack" lasting-effect field; TWI_064 Ki-Adi-Mundi needs a new
 * per-phase play-count condition; TWI_011 Ahsoka Tano and TWI_008 Padmé Amidala are deployed-leader
 * action abilities; TWI_147 Anakin Skywalker, TWI_165 Kit Fisto and TWI_192 Padmé Amidala (unit) are
 * simple gated `onAttack` effects held back only for time, and so is TWI_051 For The Republic's
 * granted "Coordinate - Restore 2".
 */

const POOL = poolFor(['TWI'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the TWI fixture`)
  return normaliseCard(row)
}
const SHIPPED = [
  'TWI_240', 'TWI_045', 'TWI_114', 'TWI_205', 'TWI_158', 'TWI_106', 'TWI_090', 'TWI_164', 'TWI_061',
  'TWI_050', 'TWI_095', 'TWI_196', 'TWI_162', 'TWI_243', 'TWI_213',
]
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  FILLER: card({ id: 'FILLER', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  FILLER_SP: card({ id: 'FILLER_SP', arena: 'space', cost: 1, power: 1, hp: 5 }),
  ENEMY: card({ id: 'ENEMY', arena: 'ground', cost: 3, power: 3, hp: 3 }),
  ENEMY_SP: card({ id: 'ENEMY_SP', arena: 'space', cost: 3, power: 3, hp: 6 }),
  ENEMY_CHEAP: card({ id: 'ENEMY_CHEAP', arena: 'space', cost: 2, power: 2, hp: 2 }),
  ENEMY_PRICEY: card({ id: 'ENEMY_PRICEY', arena: 'space', cost: 5, power: 4, hp: 6 }),
}
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), deck: [], ...over })
const board = (mine: Parameters<typeof player>[0] = {}, theirs: Parameters<typeof player>[0] = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const choice = (s: GameState) => { expect(s.pendingChoices?.length ?? 0).toBeGreaterThan(0); return s.pendingChoices![0] }
type Extra = { targetInstanceId?: string; optionIndex?: number; baseTarget?: PlayerId }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })

describe('Coordinate stat buffs (statModifier)', () => {
  it.each([
    ['TWI_240', 1, 1],
    ['TWI_045', 0, 3],
    ['TWI_158', 2, 0],
    ['TWI_090', 2, 2],
  ] as const)('%s: +%i/+%i while you control 3 or more units, printed otherwise', (id, dp, dh) => {
    const printed = F[id]
    const below = board({ units: [unit('c', id), unit('f1', 'FILLER')] }) // 2 units total
    expect(effectivePower(below, U(below, 'c')!)).toBe(printed.power)
    expect(effectiveHp(below, U(below, 'c')!)).toBe(printed.hp)

    const at3 = board({ units: [unit('c', id), unit('f1', 'FILLER'), unit('f2', 'FILLER')] }) // 3 units
    expect(effectivePower(at3, U(at3, 'c')!)).toBe(printed.power! + dp)
    expect(effectiveHp(at3, U(at3, 'c')!)).toBe(printed.hp! + dh)
  })

  it('turns off immediately when a unit is defeated mid-round, not just at the next phase change', () => {
    let s = board({ units: [unit('c', 'TWI_240'), unit('f1', 'FILLER'), unit('f2', 'FILLER')] })
    expect(effectivePower(s, U(s, 'c')!)).toBe(F.TWI_240.power! + 1)
    s = defeatUnit(s, 'f1')
    expect(effectivePower(s, U(s, 'c')!)).toBe(F.TWI_240.power) // back to 2 units: printed value
  })
})

describe('Coordinate self-keyword grants (conditionalKeywords)', () => {
  it.each([
    ['TWI_106', 'Ambush'],
    ['TWI_061', 'Sentinel'],
    ['TWI_243', 'Saboteur'],
  ] as const)('%s: gains %s only at 3+ units; the printed Keywords[] carries it as conditional, not real', (id, kw) => {
    const below = board({ units: [unit('c', id), unit('f1', 'FILLER')] })
    expect(unitHasKeyword(below, U(below, 'c')!, kw)).toBe(false)
    const at3 = board({ units: [unit('c', id), unit('f1', 'FILLER'), unit('f2', 'FILLER')] })
    expect(unitHasKeyword(at3, U(at3, 'c')!, kw)).toBe(true)
  })
})

describe('TWI_164 Hevy — Coordinate: Raid 2; When Defeated: 1 damage to each enemy ground unit (unconditional)', () => {
  it('Raid only applies at 3+ units', () => {
    const below = board({ units: [unit('c', 'TWI_164'), unit('f1', 'FILLER')] })
    expect(unitKeywordValue(below, U(below, 'c')!, 'Raid')).toBe(0)
    const at3 = board({ units: [unit('c', 'TWI_164'), unit('f1', 'FILLER'), unit('f2', 'FILLER')] })
    expect(unitKeywordValue(at3, U(at3, 'c')!, 'Raid')).toBe(2)
  })

  it('When Defeated fires regardless of Coordinate, hitting only enemy ground units', () => {
    const s = board({ units: [unit('c', 'TWI_164')] }, { units: [unit('eg', 'ENEMY'), unit('es', 'ENEMY_SP')] })
    const after = defeatUnit(s, 'c')
    expect(U(after, 'eg')?.damage).toBe(1)
    expect(U(after, 'es')?.damage).toBe(0)
  })
})

describe('TWI_050 Luminara Unduli — Coordinate: Grit; When Played: heal 1 per unit you control (unconditional)', () => {
  it('Grit only applies at 3+ units', () => {
    const below = board({ units: [unit('c', 'TWI_050', { damage: 3 }), unit('f1', 'FILLER')] })
    expect(unitHasKeyword(below, U(below, 'c')!, 'Grit')).toBe(false)
    const at3 = board({ units: [unit('c', 'TWI_050', { damage: 3 }), unit('f1', 'FILLER'), unit('f2', 'FILLER')] })
    expect(unitHasKeyword(at3, U(at3, 'c')!, 'Grit')).toBe(true)
  })

  it('When Played heals the chosen base 1 per unit controlled, regardless of Coordinate', () => {
    const s = board({ hand: ['TWI_050'], units: [unit('f1', 'FILLER')], base: { cardId: 'TST_B', damage: 5 } })
    // 1 filler + itself = 2 units, below the Coordinate threshold, but the heal is unconditional.
    let played = resolve(s, { type: 'playUnit', handIndex: 0 })
    played = accept(played, { baseTarget: 'player' })
    expect(played.players.player.base.damage).toBe(3) // 5 - 2
  })
})

describe('TWI_196 Plo Koon — Ambush (unconditional) + Coordinate: Raid 3', () => {
  it('has Ambush regardless of Coordinate', () => {
    const below = board({ units: [unit('c', 'TWI_196'), unit('f1', 'FILLER')] })
    expect(unitHasKeyword(below, U(below, 'c')!, 'Ambush')).toBe(true)
  })

  it('Raid only applies at 3+ units', () => {
    const below = board({ units: [unit('c', 'TWI_196'), unit('f1', 'FILLER')] })
    expect(unitKeywordValue(below, U(below, 'c')!, 'Raid')).toBe(0)
    const at3 = board({ units: [unit('c', 'TWI_196'), unit('f1', 'FILLER'), unit('f2', 'FILLER')] })
    expect(unitKeywordValue(at3, U(at3, 'c')!, 'Raid')).toBe(3)
  })
})

describe('TWI_114 Clone Commander Cody — Overwhelm (own, unconditional) + Coordinate: other friendly units +1/+1 and Overwhelm', () => {
  it('keeps its own Overwhelm regardless of Coordinate', () => {
    const below = board({ units: [unit('cody', 'TWI_114'), unit('ally', 'FILLER')] })
    expect(unitHasKeyword(below, U(below, 'cody')!, 'Overwhelm')).toBe(true)
  })

  it('grants +1/+1 and Overwhelm to OTHER friendly units only at 3+, never to itself', () => {
    const below = board({ units: [unit('cody', 'TWI_114'), unit('ally', 'FILLER')] }) // 2 units
    expect(effectivePower(below, U(below, 'ally')!)).toBe(F.FILLER.power)
    expect(unitHasKeyword(below, U(below, 'ally')!, 'Overwhelm')).toBe(false)

    const at3 = board({ units: [unit('cody', 'TWI_114'), unit('ally', 'FILLER'), unit('f3', 'FILLER')] })
    expect(effectivePower(at3, U(at3, 'ally')!)).toBe(F.FILLER.power! + 1)
    expect(effectiveHp(at3, U(at3, 'ally')!)).toBe(F.FILLER.hp! + 1)
    expect(unitHasKeyword(at3, U(at3, 'ally')!, 'Overwhelm')).toBe(true)
    // Cody's own aura excludes himself.
    expect(effectivePower(at3, U(at3, 'cody')!)).toBe(F.TWI_114.power)
  })
})

describe('TWI_205 Clone Dive Trooper — Coordinate: while attacking, the defender gets -2/-0', () => {
  it('reduces the defender’s power only at 3+ units, only in combat, and only against this attacker', () => {
    const below = board({ units: [unit('dt', 'TWI_205'), unit('f1', 'FILLER')] }, { units: [unit('def', 'ENEMY')] })
    const combat = { attackerInstanceId: 'dt', defenderInstanceId: 'def' }
    expect(effectivePower(below, U(below, 'def')!, { defending: true, combat })).toBe(F.ENEMY.power)

    const at3 = board({ units: [unit('dt', 'TWI_205'), unit('f1', 'FILLER'), unit('f2', 'FILLER')] }, { units: [unit('def', 'ENEMY')] })
    expect(effectivePower(at3, U(at3, 'def')!, { defending: true, combat })).toBe(F.ENEMY.power! - 2)
    // Outside combat, the aura does not apply.
    expect(effectivePower(at3, U(at3, 'def')!)).toBe(F.ENEMY.power)
  })
})

describe('TWI_095 Pelta Supply Frigate — Coordinate: When Played, create a Clone Trooper token', () => {
  it('creates the token only at 3+ units (including itself)', () => {
    const below = board({ hand: ['TWI_095'], units: [unit('f1', 'FILLER')] }) // 1 + itself = 2
    const playedBelow = resolve(below, { type: 'playUnit', handIndex: 0 })
    expect(playedBelow.players.player.units.some(u => u.cardId === TOKEN_CLONE_TROOPER)).toBe(false)

    const at3 = board({ hand: ['TWI_095'], units: [unit('f1', 'FILLER'), unit('f2', 'FILLER')] }) // 2 + itself = 3
    const playedAt3 = resolve(at3, { type: 'playUnit', handIndex: 0 })
    expect(playedAt3.players.player.units.some(u => u.cardId === TOKEN_CLONE_TROOPER)).toBe(true)
  })
})

describe('TWI_162 Reckless Torrent — Coordinate: When Played, you may deal 2 damage to a friendly unit and 2 to an enemy unit in the same arena', () => {
  it('offers no choice below 3 units', () => {
    const below = board({ hand: ['TWI_162'], units: [unit('f1', 'FILLER_SP')] }, { units: [unit('e', 'ENEMY_SP')] })
    const played = resolve(below, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.length ?? 0).toBe(0)
  })

  it('deals 2 to a chosen friendly and 2 to a chosen enemy in the same arena at 3+ units', () => {
    const at3 = board({ hand: ['TWI_162'], units: [unit('f1', 'FILLER_SP'), unit('f2', 'FILLER_SP')] }, { units: [unit('e', 'ENEMY_SP')] })
    let played = resolve(at3, { type: 'playUnit', handIndex: 0 })
    played = accept(played, { targetInstanceId: 'f1' })
    played = accept(played, { targetInstanceId: 'e' })
    expect(U(played, 'f1')?.damage).toBe(2)
    expect(U(played, 'e')?.damage).toBe(2)
  })

  it('may be declined entirely', () => {
    const at3 = board({ hand: ['TWI_162'], units: [unit('f1', 'FILLER_SP'), unit('f2', 'FILLER_SP')] }, { units: [unit('e', 'ENEMY_SP')] })
    let played = resolve(at3, { type: 'playUnit', handIndex: 0 })
    played = skip(played)
    expect(U(played, 'f1')?.damage).toBe(0)
    expect(U(played, 'e')?.damage).toBe(0)
  })
})

describe("TWI_213 Sanctioner's Shuttle — Coordinate: When Played, captures an enemy non-leader unit costing 3 or less", () => {
  it('offers no capture below 3 units', () => {
    const below = board({ hand: ['TWI_213'], units: [unit('f1', 'FILLER_SP')] }, { units: [unit('e', 'ENEMY_CHEAP')] })
    const played = resolve(below, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.length ?? 0).toBe(0)
  })

  it('captures a chosen enemy costing 3 or less at 3+ units, filtering out a pricier one', () => {
    const at3 = board({ hand: ['TWI_213'], units: [unit('f1', 'FILLER_SP'), unit('f2', 'FILLER_SP')] },
      { units: [unit('cheap', 'ENEMY_CHEAP'), unit('pricey', 'ENEMY_PRICEY')] })
    let played = resolve(at3, { type: 'playUnit', handIndex: 0 })
    const targets = (choice(played) as unknown as { targets: string[] }).targets
    expect(targets).toEqual(['cheap'])
    played = accept(played, { targetInstanceId: 'cheap' })
    expect(U(played, 'cheap')).toBeUndefined()
  })
})
