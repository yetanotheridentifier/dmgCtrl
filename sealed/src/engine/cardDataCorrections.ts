import type { EngineCard } from './types'

/**
 * Corrections for **wrong** values in the upstream (SWUDB) card data.
 *
 * Distinct from `UPGRADE_STAT_OVERRIDES`, which only *fills in* fields the source omits: these
 * entries **override** a value the source provides but gets wrong, read off the printed card.
 * Applied last in `normaliseCard`. Remove an entry once the upstream data is fixed; add new ones
 * as gaps surface during play (arena, cost, power/HP, …).
 *
 * A unit's or leader's conditional keywords, and those it only gives to other units, need no entry
 * here: `toKeywords` keeps only the keywords a unit's text prints. What is left is what that rule
 * cannot read off the text: a printed keyword the source omits, and upgrades, whose list `toKeywords`
 * leaves alone.
 */
export const CARD_DATA_CORRECTIONS: Record<string, Partial<EngineCard>> = {
  ASH_081: { arena: 'space' }, // Nebulon-C Frigate — a Space capital ship; the source ships Ground

  // A printed keyword the source omits.
  SHD_005: { keywords: [{ name: 'Raid', value: 1 }] }, // Hondo Ohnaka (leader): printed on his back, absent from the source
  HMW_018: { keywords: [{ name: 'Ambush' }, { name: 'Raid', value: 1 }] }, // The Warrior: both printed on her back, neither in the source
  SEC_189: { keywords: [{ name: 'Plot' }] }, // Lurking Snub Fighter: the source ships no Keywords array at all, though FrontText prints the full Plot reminder
  SHD_007: { keywords: [{ name: 'Overwhelm' }] }, // Moff Gideon (leader)
  SHD_016: { keywords: [{ name: 'Saboteur' }] }, // Fennec Shand (leader)
  SHD_188: { keywords: [{ name: 'Ambush' }] }, // 4-LOM
  JTL_054: { keywords: [{ name: 'Shielded' }] }, // Gold Leader
  TWI_037: { keywords: [{ name: 'Exploit', value: 2 }, { name: 'Sentinel' }] }, // Droideka Security
  TWI_038: { keywords: [{ name: 'Exploit', value: 2 }] }, // Providence Destroyer

  // A leader whose Exploit is what it gives other cards: its deployed side prints Overwhelm only.
  TWI_005: { keywords: [{ name: 'Overwhelm' }] }, // Count Dooku (leader)

  // A keyword the source lists that the card does not print, alongside one it omits.
  LAW_081: { keywords: [{ name: 'Ambush' }, { name: 'Overwhelm' }] }, // Sullustan Sapper: the card prints Ambush and Overwhelm, not Shielded

  // An upgrade's "attached unit gains X", granted by the upgrade's ability while its condition holds,
  // or a keyword its host gives to other units: not the attached unit's own keyword.
  SEC_104: { keywords: [] }, // Figure of Unity: its host gives each OTHER friendly unit Overwhelm, Raid 1 and Restore 1
  HMW_112: { keywords: [{ name: 'Fortify' }] }, // Military Academy: its base gives friendly units Overwhelm
  HMW_126: { keywords: [{ name: 'Fortify' }] }, // Verdant Fortress: its base gives friendly units Raid 1
  HMW_096: { keywords: [] }, // Devotion: Restore 2
  HMW_190: { keywords: [] }, // Enraged: Raid 2
  HMW_191: { keywords: [] }, // Hunter's Instinct: Grit on a Creature
  SEC_071: { keywords: [] }, // Disciples' Devotion: Sentinel while attached unit is exhausted
  LOF_215: { keywords: [] }, // Ascension Cable: Saboteur
  LOF_238: { keywords: [] }, // Darth Revan's Lightsabers: Grit on a Sith
  LOF_053: { keywords: [] }, // Heirloom Lightsaber: Restore 1 on a Force unit
  LAW_128: { keywords: [] }, // Veiled Strength: Grit
  TWI_071: { keywords: [] }, // Unshakeable Will: Sentinel
  TWI_051: { keywords: [] }, // For The Republic: Coordinate - Restore 2
  SOR_070: { keywords: [] }, // Devotion: Restore 2
  SOR_166: { keywords: [] }, // Infiltrator's Skill: Saboteur
  SOR_057: { keywords: [] }, // Protector: Sentinel

  // An arena the source gets wrong. "This unit can attack space units" is printed on a GROUND unit;
  // shipped as Space it could not have been printed at all.
  JTL_259: { arena: 'ground' }, // Retrofitted Airspeeder

  // A card type the source gets wrong. "When Played: you may attack with attached unit" is an
  // upgrade's text, and the printed card is an upgrade with +1/+1 that the source omits.
  SOR_215: { type: 'upgrade', power: 1, hp: 1 }, // Snapshot Reflexes
}
