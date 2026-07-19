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

  // Group B1 (#353): the source lists each card's *conditional* keyword in its base `Keywords`, which
  // would make it permanent. Strip it to the genuine base set; the ability re-grants it when its
  // condition holds (see `conditionalKeywords` in cardDefinitions.ts).
  ASH_098: { keywords: [] }, // AT-ST Raider — Ambush is conditional
  ASH_078: { keywords: [] }, // B-Wing Rearguard — Sentinel is conditional
  ASH_105: { keywords: [] }, // Bo-Katan Kryze (unit) — Raid is conditional
  ASH_093: { keywords: [] }, // Captain Pellaeon — Raid is conditional
  ASH_122: { keywords: [] }, // Consortium StarViper — Restore is conditional
  ASH_057: { keywords: [] }, // Lothal E-Wing — Restore is conditional
  ASH_049: { keywords: [] }, // Shin Hati (unit) — Sentinel is conditional
  ASH_120: { keywords: [] }, // Warrior of Clan Kryze — Sentinel is conditional
  ASH_243: { keywords: [{ name: 'Shielded' }] }, // Darth Vader — Shielded is real; Sentinel is conditional (while ready)
  ASH_113: { keywords: [] }, // Mandalorian Flagship (B2) — Ambush is conditional (while you control a leader)
  ASH_030: { keywords: [{ name: 'Sentinel' }] }, // Marrok (B3) — Sentinel is real; Saboteur is conditional (while upgraded)
  ASH_099: { keywords: [{ name: 'Support' }] }, // Gozanti Assault Carrier (E) — Support is real; Sentinel is gained on attack
}
