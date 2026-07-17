import type { EngineCard } from './types'

/**
 * Corrections for **wrong** values in the upstream (SWUDB) card data (#306).
 *
 * Distinct from `UPGRADE_STAT_OVERRIDES`, which only *fills in* fields the source omits: these
 * entries **override** a value the source provides but gets wrong, read off the printed card.
 * Applied last in `normaliseCard`. Remove an entry once the upstream data is fixed; add new ones
 * as gaps surface during play (arena, cost, power/HP, …).
 */
export const CARD_DATA_CORRECTIONS: Record<string, Partial<EngineCard>> = {
  ASH_097: { cost: 3 }, // Moff Gideon (unit) — printed cost is 3; the source ships 8
  ASH_081: { arena: 'space' }, // Nebulon-C Frigate — a Space capital ship; the source ships Ground
}
