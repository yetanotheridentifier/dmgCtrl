import type { GameState, UnitState } from '../engine/types'
import { getCardDefinition } from '../engine/abilities'
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitKeywords } from '../engine/keywords'

/**
 * Whether an upgrade is bad for the unit it is attached to (#509).
 *
 * A class of upgrades exists whose whole effect lies in the future: Pointless to Resist takes 3 power
 * off an attack on a base, Deadly Vulnerability doubles incoming damage, Grav Charge burns the host
 * when its attack ends, The Conflict Within taxes it every time it readies. **None of them changes the
 * board the moment they are played.** The evaluation prices boards, so it sees two identical positions
 * whether such a card lands on a friendly unit or an enemy one, and the seeded pick decides.
 *
 * The fix is the question the model never asks: not "what does this do now" but **"what would this do
 * when it triggers"**.
 *
 * ## Two signals, in order
 *
 * **The computed delta comes first**, because it reads the actual mechanism. The host's power, HP and
 * keywords are compared with and without the upgrade, in the contexts where conditional effects
 * apply, which is exactly the context the board term leaves empty. Anything with a readable static
 * effect is judged on that effect and never on its trait.
 *
 * **The CONDITION trait is the fallback**, used only when the delta is silent. Grav Charge and The
 * Conflict Within work through granted triggered abilities, which cannot be priced without simulating
 * them, and both are CONDITIONs. Measured across the ASH pool, of five CONDITION upgrades four are
 * hostile and the fifth, Nowhere to Hide, grants Sentinel and is caught by the delta before the
 * fallback is reached.
 *
 * **Known limitation:** a CONDITION whose granted ability is a benefit would be misread. None exists in
 * ASH. Ordering the signals this way keeps that as the narrow case rather than the common one.
 *
 * Positive means hostile, so it reads the same way round as "how much do we want this on THEIR unit".
 */
export function upgradeHostility(state: GameState, host: UnitState, cardId: string): number {
  const withUpgrade: UnitState = { ...host, upgrades: [...host.upgrades, { cardId, owner: 'player' }] }
  const cost = statCost(state, host, withUpgrade) + damageCost(state, withUpgrade, cardId)
  // A stat loss is decisive. Keywords deliberately do NOT offset one: Nowhere to Hide is -2 power and
  // grants Sentinel, and it is a card you give the opponent. Counting the grant against the loss made
  // it read as a buff, which is the opposite of how it plays.
  if (cost > 0) return cost
  // Nothing readable was lost. A keyword grant is a real benefit, so it rules out the fallback below;
  // without it a purely beneficial CONDITION would be handed to the opponent on its trait alone.
  if (grantsKeywords(state, host, withUpgrade)) return 0
  // Nothing readable at all. Grav Charge and The Conflict Within act through granted triggered
  // abilities, which cannot be priced without simulating them, and both are CONDITIONs. Across the ASH
  // pool every CONDITION reaching this point is hostile.
  return isCondition(state, cardId) ? 1 : 0
}

/**
 * Power, HP and keywords, compared across the attachment.
 *
 * Scored in the contexts an upgrade's condition can name, not the empty one. `{}` is what `presence`
 * uses and is precisely why a "while attacking a base" modifier is invisible to it. Taking the worst
 * context rather than the average, because an upgrade that is neutral most of the time and crippling
 * in one is a card you give to the opponent.
 */
function statCost(state: GameState, before: UnitState, after: UnitState): number {
  const contexts = [
    { attacking: true, attackingBase: true },
    { attacking: true },
    { defending: true },
  ]
  let worst = 0
  for (const ctx of contexts) {
    const power = effectivePower(state, after, ctx) - effectivePower(state, before, ctx)
    const hp = effectiveHp(state, after, ctx) - effectiveHp(state, before, ctx)
    // HP at half weight: a point of power is a point of damage every attack, a point of HP is absorbed
    // once. Only the ordering matters here, not the exact ratio.
    const total = power + hp / 2
    if (total < worst) worst = total
  }
  // Measured against the ACTUAL host, so the floor at zero power applies: a -2 modifier on a 1-power
  // unit costs 1, not 2, because a unit cannot deal negative damage. That is the real cost of playing
  // it there, and it makes a small unit a cheaper place to absorb a debuff, which is correct.
  return -worst
}

/** Doubling incoming damage is worth more on a big unit than a small one, so it scales with HP. */
function damageCost(state: GameState, host: UnitState, cardId: string): number {
  const multiplier = getCardDefinition(cardId)?.damageMultiplier?.(state, host) ?? 1
  if (multiplier <= 1) return 0
  return (multiplier - 1) * effectiveHp(state, host) / 2
}

/**
 * Whether attaching this upgrade hands the host a keyword it did not have.
 *
 * Compared against the specific host, which is what makes "on a unit that already has Sentinel" come
 * out right: there is no grant, so nothing offsets the loss and the card reads as the debuff it is.
 */
function grantsKeywords(state: GameState, before: UnitState, after: UnitState): boolean {
  return unitKeywords(state, after).length > unitKeywords(state, before).length
}

function isCondition(state: GameState, cardId: string): boolean {
  return (state.cards[cardId]?.traits ?? []).some(t => t.toUpperCase() === 'CONDITION')
}
