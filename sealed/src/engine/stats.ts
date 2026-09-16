import type { Arena, GameState, UnitState, CombatContext, PlayerId } from './types'
import { lastingEffectTotals, abilityCardIds } from './types'
import { unitHasKeyword, unitKeywordValue, auraContributions } from './keywords'
import { getCardDefinition } from './abilities'

/**
 * Computed unit stats. All combat and defeat checks go through these
 * helpers so upgrades and lasting effects slot into one place.
 * Attached upgrades add their printed power/HP; Power/HP never drop below 0
 * (CR 1.10.4 / 1.11.4).
 */

export interface StatContext {
  /** True while the unit is the attacker in an attack (Raid applies). */
  attacking?: boolean
  /** True while the unit is attacking the enemy base (not a unit). */
  attackingBase?: boolean
  /** True while the unit is the defender in the current combat (Palace Chef Droid). */
  defending?: boolean
  /** For the attacker: the defending unit had damage on it (Marrok's Fiend Fighter). */
  defenderDamaged?: boolean
  /** The attack was made via Ambush, on the unit entering play (Heroic Purrgil). */
  viaAmbush?: boolean
  /** For the attacker: which arena the defending unit stands in (Retrofitted Airspeeder). */
  defenderArena?: Arena
  /** The current combat's roles, for combat-conditional auras (Grogu). */
  combat?: CombatContext
}

/**
 * True while `owner`'s Advantage tokens "lose all abilities" (Eviscerator): they add no
 * power and aren't spent after combat. Read from the controller's own units.
 */
export function friendlyAdvantageInert(state: GameState, owner: PlayerId): boolean {
  return state.players[owner].units.some(u =>
    abilityCardIds(u).some(id => getCardDefinition(id)?.suppressesFriendlyAdvantage?.(state, u) ?? false),
  )
}

/**
 * Sum a stat across the unit's card and every attached upgrade.
 *
 * An Eviscerator-blanked Advantage token still contributes its printed +1/+0: "lose all
 * abilities" removes the token's ability, and its stats are not one. The card's own reminder text
 * names the only consequence, "(They aren't defeated after combat.)", which is handled in
 * `consumeAdvantage`. Because they are never spent, the +1s accumulate, which is the card's point.
 */
function withUpgrades(state: GameState, unit: UnitState, stat: 'power' | 'hp'): number {
  // A card may REPLACE the printed value before the upgrades are added (Obi-Wan Kenobi's 7/7, Size
  // Matters Not's 5/5): the card says "printed power is considered to be N", so an upgrade's +X
  // still applies on top of N.
  let total = printedStatOverride(state, unit)?.[stat] ?? state.cards[unit.cardId]?.[stat] ?? 0
  for (const { cardId } of unit.upgrades) {
    total += state.cards[cardId]?.[stat] ?? 0
  }
  return total
}

/**
 * The replacement for a unit's printed power/HP, if a card in play declares one. Scanned across both
 * sides' units and their upgrades, so one pass answers both shapes the pool prints: a replacement
 * coming from the host's own upgrade, and one another unit hands out. It must not read computed
 * stats (that is the pass it is part of); both cards inspect counts and card data only.
 */
function printedStatOverride(state: GameState, unit: UnitState): { power?: number; hp?: number } | undefined {
  const targetOwner = (['player', 'opponent'] as PlayerId[]).find(o => state.players[o].units.some(u => u.instanceId === unit.instanceId))
  if (!targetOwner) return undefined
  let out: { power?: number; hp?: number } | undefined
  for (const owner of ['player', 'opponent'] as PlayerId[]) {
    for (const source of state.players[owner].units) {
      for (const cardId of abilityCardIds(source)) {
        const override = getCardDefinition(cardId)?.printedStats?.(state, source, unit, owner === targetOwner)
        if (override) out = { ...out, ...override }
      }
    }
  }
  return out
}


/**
 * Instance+stat keys whose conditional modifier is currently being evaluated. A modifier that reads
 * other units' effective power (Kelleran Beq: "+1/+0 per other unit with 0 power") can ask, via that
 * other unit, for THIS unit's power again; without a guard two such units recurse forever and blow
 * the stack (#408). While a key is in flight, a nested request for the same key contributes 0, which
 * breaks the cycle and cannot affect a non-cyclic computation (that never re-enters the same key).
 */
const computingModifier = new Set<string>()

/**
 * Conditional stat deltas from the unit's own card definition and each attached
 * upgrade's — e.g. Pointless to Resist's −3 power while attacking a base.
 */
function statModifiers(state: GameState, unit: UnitState, ctx: StatContext, stat: 'power' | 'hp'): number {
  const key = `${unit.instanceId}:${stat}`
  if (computingModifier.has(key)) return 0
  computingModifier.add(key)
  try {
    let total = 0
    // Includes cards lent for a single attack (Support, Improvised Identity, and the attack-granting
    // events), so a rider's stat bonus applies for exactly that attack.
    for (const cardId of abilityCardIds(unit)) {
      total += getCardDefinition(cardId)?.statModifier?.(state, unit, ctx)?.[stat] ?? 0
    }
    return total
  } finally {
    computingModifier.delete(key)
  }
}

/**
 * Instance ids whose power is currently being computed. A card whose condition reads another unit's
 * power (Praetorian Guard: "while you control a unit with 4 or more power") is reached from inside
 * this pass, and that unit's own condition can ask for the first unit's power again. While an id is
 * in flight a nested request answers with the unit's printed-and-upgraded power plus its "this
 * phase" buffs: everything except the hooks and auras that form the cycle.
 */
const computingPower = new Set<string>()

export function effectivePower(state: GameState, unit: UnitState, ctx: StatContext = {}): number {
  if (computingPower.has(unit.instanceId)) {
    return Math.max(0, withUpgrades(state, unit, 'power') + lastingEffectTotals(state, unit.instanceId).power)
  }
  computingPower.add(unit.instanceId)
  try {
    let power = withUpgrades(state, unit, 'power')
    if (ctx.attacking) {
      power += unitKeywordValue(state, unit, 'Raid', ctx)
    }
    if (unitHasKeyword(state, unit, 'Grit', ctx)) {
      power += unit.damage
    }
    power += statModifiers(state, unit, ctx, 'power')
    power += auraContributions(state, unit, ctx.combat).power // other units' auras
    power += lastingEffectTotals(state, unit.instanceId).power // "this phase" buffs
    return Math.max(0, power)
  } finally {
    computingPower.delete(unit.instanceId)
  }
}

export function effectiveHp(state: GameState, unit: UnitState, ctx: StatContext = {}): number {
  return Math.max(
    0,
    withUpgrades(state, unit, 'hp') + statModifiers(state, unit, ctx, 'hp') + auraContributions(state, unit, ctx.combat).hp + lastingEffectTotals(state, unit.instanceId).hp,
  )
}
