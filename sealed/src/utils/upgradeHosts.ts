/**
 * The units hosting a set of defeatable upgrades, each listed once in candidate order.
 *
 * Defeating an upgrade is a two-step pick (#368): step one highlights these units on the board, so
 * it is obvious where an upgrade sits and who controls it; step two shows just that unit's
 * upgrades. Picking straight out of one flat overlay hid all three, and was unusable when two
 * units shared a name.
 */
export function upgradeHostIds<T extends { unitId: string }>(candidates: readonly T[]): string[] {
  return [...new Set(candidates.map(c => c.unitId))]
}
