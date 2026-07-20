import type { GameState, UnitState, CombatContext, PlayerId } from './types'
import { lastingEffectTotals } from './types'
import { unitHasKeyword, unitKeywordValue, auraContributions } from './keywords'
import { getCardDefinition } from './abilities'
import { TOKEN_ADVANTAGE } from './tokenUpgrades'

/**
 * Computed unit stats (#305). All combat and defeat checks go through these
 * helpers so upgrades (#308) and lasting effects (#306) slot into one place.
 * Attached upgrades add their printed power/HP; Power/HP never drop below 0
 * (CR 1.10.4 / 1.11.4).
 */

export interface StatContext {
  /** True while the unit is the attacker in an attack (Raid applies). */
  attacking?: boolean
  /** True while the unit is attacking the enemy base (not a unit). */
  attackingBase?: boolean
  /** True while the unit is the defender in the current combat (#357, Palace Chef Droid). */
  defending?: boolean
  /** For the attacker: the defending unit had damage on it (#357, Marrok's Fiend Fighter). */
  defenderDamaged?: boolean
  /** The attack was made via Ambush, on the unit entering play (#357, Heroic Purrgil). */
  viaAmbush?: boolean
  /** The current combat's roles, for combat-conditional auras (Grogu, #348). */
  combat?: CombatContext
}

/**
 * True while `owner`'s Advantage tokens "lose all abilities" (#357, Eviscerator): they add no
 * power and aren't spent after combat. Read from the controller's own units.
 */
export function friendlyAdvantageInert(state: GameState, owner: PlayerId): boolean {
  return state.players[owner].units.some(u =>
    [u.cardId, ...u.upgrades.map(x => x.cardId)].some(id => getCardDefinition(id)?.suppressesFriendlyAdvantage?.(state, u) ?? false),
  )
}

/** Sum a stat across the unit's card and every attached upgrade (#308). */
function withUpgrades(state: GameState, unit: UnitState, stat: 'power' | 'hp'): number {
  let total = state.cards[unit.cardId]?.[stat] ?? 0
  // An inert Advantage token contributes nothing (#357, Eviscerator).
  const owner = findUnitOwner(state, unit.instanceId)
  const inert = owner !== undefined && friendlyAdvantageInert(state, owner)
  for (const { cardId } of unit.upgrades) {
    if (inert && cardId === TOKEN_ADVANTAGE) continue
    total += state.cards[cardId]?.[stat] ?? 0
  }
  return total
}

/** The controller of a unit in play, by instance id (local to avoid an effects.ts import cycle). */
function findUnitOwner(state: GameState, instanceId: string): PlayerId | undefined {
  if (state.players.player.units.some(u => u.instanceId === instanceId)) return 'player'
  if (state.players.opponent.units.some(u => u.instanceId === instanceId)) return 'opponent'
  return undefined
}

/**
 * Conditional stat deltas from the unit's own card definition and each attached
 * upgrade's (#342) — e.g. Pointless to Resist's −3 power while attacking a base.
 */
function statModifiers(state: GameState, unit: UnitState, ctx: StatContext, stat: 'power' | 'hp'): number {
  let total = 0
  for (const cardId of [unit.cardId, ...unit.upgrades.map(u => u.cardId)]) {
    total += getCardDefinition(cardId)?.statModifier?.(state, unit, ctx)?.[stat] ?? 0
  }
  return total
}

export function effectivePower(state: GameState, unit: UnitState, ctx: StatContext = {}): number {
  let power = withUpgrades(state, unit, 'power')
  if (ctx.attacking) {
    power += unitKeywordValue(state, unit, 'Raid')
  }
  if (unitHasKeyword(state, unit, 'Grit')) {
    power += unit.damage
  }
  power += statModifiers(state, unit, ctx, 'power')
  power += auraContributions(state, unit, ctx.combat).power // other units' auras (#346/#348)
  power += lastingEffectTotals(state, unit.instanceId).power // "this phase" buffs (#347)
  return Math.max(0, power)
}

export function effectiveHp(state: GameState, unit: UnitState, ctx: StatContext = {}): number {
  return Math.max(
    0,
    withUpgrades(state, unit, 'hp') + statModifiers(state, unit, ctx, 'hp') + auraContributions(state, unit, ctx.combat).hp + lastingEffectTotals(state, unit.instanceId).hp,
  )
}
