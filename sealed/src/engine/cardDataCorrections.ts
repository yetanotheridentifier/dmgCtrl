import type { EngineCard } from './types'

/**
 * Corrections for **wrong** values in the upstream (SWUDB) card data.
 *
 * Distinct from `UPGRADE_STAT_OVERRIDES`, which only *fills in* fields the source omits: these
 * entries **override** a value the source provides but gets wrong, read off the printed card.
 * Applied last in `normaliseCard`. Remove an entry once the upstream data is fixed; add new ones
 * as gaps surface during play (arena, cost, power/HP, …).
 */
export const CARD_DATA_CORRECTIONS: Record<string, Partial<EngineCard>> = {
  ASH_081: { arena: 'space' }, // Nebulon-C Frigate — a Space capital ship; the source ships Ground

  // The source lists each card's *conditional* keyword in its base `Keywords`, which
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
  ASH_113: { keywords: [] }, // Mandalorian Flagship — Ambush is conditional (while you control a leader)
  ASH_030: { keywords: [{ name: 'Sentinel' }] }, // Marrok — Sentinel is real; Saboteur is conditional (while upgraded)
  ASH_099: { keywords: [{ name: 'Support' }] }, // Gozanti Assault Carrier (E) — Support is real; Sentinel is gained on attack
  ASH_079: { keywords: [] }, // Koska Reeves (F) — Sentinel is conditional (while you control a token unit)

  // Same source behaviour, one step further out: a keyword the card only ever GIVES to other units
  // is listed as the card's own. The ability grants it where it belongs; the card itself has only
  // what is printed on it.
  ASH_007: { keywords: [{ name: 'Overwhelm' }] }, // Grand Admiral Sloane — Overwhelm is hers; Sentinel goes to each OTHER friendly unit
  ASH_127: { keywords: [] }, // The Twins — Sentinel is given to another friendly unit, never held
  HMW_112: { keywords: [{ name: 'Fortify' }] }, // Military Academy: its base gives friendly units Overwhelm
  HMW_126: { keywords: [{ name: 'Fortify' }] }, // Verdant Fortress: its base gives friendly units Raid 1
  HMW_066: { keywords: [{ name: 'Shielded' }] }, // Carrion Spike: Shielded is real; Restore 1 per upgrade on your base

  // Homeworlds constant abilities: a keyword gained on a condition, given to other units, or given to
  // the attached unit.
  HMW_074: { keywords: [] }, // Yord Fandar: Sentinel while a base has 15 or more damage
  HMW_084: { keywords: [{ name: 'Restore', value: 1 }] }, // Gunga City Guard: Restore 1 is real; Shielded is conditional
  HMW_090: { keywords: [] }, // Opee Sea Killer: Grit while you control a Naboo base
  HMW_117: { keywords: [] }, // Chewbacca: Raid per exhausted resource, Overwhelm while all are exhausted
  HMW_118: { keywords: [] }, // Ryyk Blademaster: Ambush and Overwhelm at 6 resources
  HMW_131: { keywords: [{ name: 'Raid', value: 1 }] }, // Soaring Can-Cell: Raid 1 is real; Ambush with a Kashyyyk base
  HMW_137: { keywords: [] }, // V-19 Skirmisher: Sentinel at 3 units
  HMW_138: { keywords: [] }, // Commander Gree: Raid 4 at 3 Command icons
  HMW_142: { keywords: [] }, // Wookiee Rangers: Sentinel with another Wookiee or a Kashyyyk base
  HMW_176: { keywords: [] }, // Village Troublemaker: Hidden and Saboteur with an Endor base
  HMW_257: { keywords: [] }, // Ewok Archers: Ambush with another unit costing 3 or less
  HMW_259: { keywords: [] }, // Pack Guardian: Sentinel while ready
  HMW_210: { keywords: [{ name: 'Shielded' }] }, // Sol: Shielded is real; Sentinel is gained on attack

  // Homeworlds leaders. The BackText spells out the leader unit's own keywords, so a keyword the
  // source lists that the back does not print belongs to the units the leader gives it to, and one
  // the back prints that the source omits is missing from the data.
  HMW_006: { keywords: [] }, // Omega: Grit goes to each OTHER friendly Heroic unit
  HMW_007: { keywords: [{ name: 'Raid', value: 1 }] }, // Darth Vader: the source ships Raid with no numeral
  HMW_018: { keywords: [{ name: 'Ambush' }, { name: 'Raid', value: 1 }] }, // The Warrior: both printed on her back, neither in the source
  HMW_039: { keywords: [{ name: 'Raid', value: 1 }] }, // Mother Talzin: Raid 1 is hers; Restore 1 goes to each other friendly unit
  HMW_212: { keywords: [] }, // The Chieftain: Raid 1 per other friendly Tusken
  HMW_096: { keywords: [] }, // Devotion: Restore 2
  HMW_190: { keywords: [] }, // Enraged: Raid 2
  HMW_191: { keywords: [] }, // Hunter's Instinct: Grit on a Creature

  // The other sealed sets, conditional keywords.
  LAW_105: { keywords: [] }, // Cinta Kaz: Sentinel while upgraded
  SEC_201: { keywords: [{ name: 'Hidden' }] }, // Anakin Skywalker: Hidden is real; Raid 2 while you control Padmé Amidala
  SEC_079: { keywords: [] }, // Corrupt Politician: Sentinel while you control more units
  SEC_249: { keywords: [] }, // High Command Councilor: Raid 2 while you control another Official unit
  SEC_134: { keywords: [] }, // Hunting Assassin Droid: Raid 2 while an enemy unit is damaged
  SEC_116: { keywords: [] }, // Nubian Star Skiff: Restore 2 while you control an Official unit
  SEC_063: { keywords: [] }, // Rotunda Senate Guards: Sentinel while undamaged
  SEC_029: { keywords: [] }, // Zam Wesell: Grit while upgraded
  LOF_162: { keywords: [] }, // Hunting Nexu: Raid 2 while you control another Aggression unit
  LOF_212: { keywords: [] }, // Life Wind Sage: Raid 2 while an enemy unit is exhausted
  LOF_118: { keywords: [] }, // Terentatek: Ambush while an opponent controls a Force unit
  JTL_107: { keywords: [] }, // Bunker Defender: Sentinel while you control a Vehicle unit
  JTL_081: { keywords: [] }, // First Order TIE Fighter: Raid 1 while you control a token unit
  JTL_257: { keywords: [] }, // Flanking Fang Fighter: Raid 2 while you control another Fighter unit
  JTL_113: { keywords: [] }, // Homestead Militia: Sentinel while you control 6 or more resources
  TWI_062: { keywords: [] }, // Daughter of Dathomir: Restore 2 while undamaged
  TWI_081: { keywords: [] }, // Droid Commando: Ambush while you control another Separatist unit
  TWI_180: { keywords: [] }, // Separatist Commando: Raid 2 while you control another Separatist unit
  TWI_130: { keywords: [] }, // Bo-Katan Kryze: Overwhelm and Saboteur while you control another Mandalorian unit
  TWI_143: { keywords: [] }, // Jyn Erso: Saboteur while an enemy unit was defeated this phase
  TWI_043: { keywords: [] }, // Outspoken Representative: Sentinel while you control another Republic unit
  SHD_169: { keywords: [{ name: 'Raid', value: 3 }] }, // Clan Challengers: Raid 3 is real; Overwhelm while upgraded
  SHD_112: { keywords: [] }, // Gamorrean Retainer: Sentinel while you control another Command unit
  SHD_247: { keywords: [] }, // Protector of the Throne: Sentinel while upgraded
  SHD_034: { keywords: [{ name: 'Shielded' }] }, // Supercommando Squad: Shielded is real; Sentinel while upgraded
  SOR_065: { keywords: [{ name: 'Grit' }] }, // Baze Malbus: Grit is real; Sentinel while you have the initiative
  SOR_082: { keywords: [] }, // Emperor's Royal Guard: Sentinel while you control an Official unit
  SOR_114: { keywords: [] }, // Escort Skiff: Ambush while you control another Command unit
  SOR_249: { keywords: [] }, // Frontier AT-RT: Ambush while you control another Vehicle unit
  SOR_211: { keywords: [] }, // Gamorrean Guards: Sentinel while you control another Cunning unit
  SOR_159: { keywords: [] }, // Partisan Insurgent: Raid 2 while you control another Aggression unit
  SOR_048: { keywords: [] }, // Vigilant Honor Guards: Sentinel while undamaged
  TS26_20: { keywords: [{ name: 'Grit' }, { name: 'Raid', value: 1 }] }, // 501st Veteran: Grit and Raid 1 are real; Sentinel while undamaged
  TS26_50: { keywords: [] }, // General Grievous: Sentinel while undamaged

  // The other sealed sets, keywords a unit only gives to other units.
  LOF_169: { keywords: [] }, // Invasion Control Ship: Raid 2 goes to friendly Droid units
  JTL_161: { keywords: [] }, // Captain Tarkin: Overwhelm goes to friendly Vehicle units
  SOR_079: { keywords: [] }, // Admiral Piett: Ambush goes to friendly units that cost 6 or more
  SOR_100: { keywords: [] }, // Wedge Antilles: Ambush goes to friendly Vehicle units
  TS26_40: { keywords: [] }, // Obi-Wan Kenobi: Restore 1 goes to other friendly Republic units

  // An upgrade's "attached unit gains X" is the attached unit's keyword, granted by the ability, not the upgrade's own.
  SEC_071: { keywords: [] }, // Disciples' Devotion: Sentinel while attached unit is exhausted
  LOF_215: { keywords: [] }, // Ascension Cable: Saboteur
  LOF_238: { keywords: [] }, // Darth Revan's Lightsabers: Grit on a Sith
  LOF_053: { keywords: [] }, // Heirloom Lightsaber: Restore 1 on a Force unit
  LAW_128: { keywords: [] }, // Veiled Strength: Grit
  TWI_071: { keywords: [] }, // Unshakeable Will: Sentinel
  SOR_070: { keywords: [] }, // Devotion: Restore 2
  SOR_166: { keywords: [] }, // Infiltrator's Skill: Saboteur
  SOR_057: { keywords: [] }, // Protector: Sentinel

  // The other sealed sets, conditional keywords (continued).
  SOR_130: { keywords: [] }, // First Legion Snowtrooper: Overwhelm while attacking a damaged unit
  SHD_212: { keywords: [] }, // Privateer Scyk: Shielded while you control another Cunning unit
  LOF_085: { keywords: [] }, // Praetorian Guard: Sentinel while you control a unit with 4 or more power
  JTL_137: { keywords: [] }, // Vonreg's TIE Interceptor: Overwhelm at 4 power, Raid 1 at 6
  SOR_188: { keywords: [] }, // Chopper: Raid 1 while you control another Spectre unit
  SOR_131: { keywords: [] }, // Fifth Brother: Raid 1 for each damage on him
  TS26_75: { keywords: [] }, // Jango Fett: Ambush while an enemy unit has attacked your base this phase

  // A keyword a unit only ever hands to other units (continued).
  LOF_186: { keywords: [] }, // Marchion Ro: he doubles each friendly unit's Raid, and has none of his own
  LAW_104: { keywords: [] }, // Bodhi Rook: gives a friendly Rebel unit Sentinel
  SOR_156: { keywords: [] }, // Benthic "Two Tubes": gives another friendly Aggression unit Raid 2
  LOF_180: { keywords: [] }, // Deceptive Shade: gives the next unit played Ambush

  // The other sealed sets, conditional keywords (continued).
  JTL_104: { keywords: [] }, // Raddus: Sentinel while you control another Resistance card

  // Leaders: a deployed side's conditional keyword, or one it only gives to other units.
  TWI_010: { keywords: [] }, // Pre Vizsla: Saboteur while you have 3 or more cards in hand
  SEC_010: { keywords: [] }, // Dedra Meero: Raid 2 while you have more cards in hand than an opponent
  SOR_012: { keywords: [] }, // IG-88: gives each other friendly unit Raid 1
  LAW_001: { keywords: [] }, // Saw Gerrera: gives an attacker Overwhelm for that attack
  SEC_007: { keywords: [{ name: 'Overwhelm' }] }, // Dryden Vos: Overwhelm is his; Ambush goes to the unit he plays

  // A printed keyword the source omits.
  SHD_007: { keywords: [{ name: 'Overwhelm' }] }, // Moff Gideon (leader)
  SHD_016: { keywords: [{ name: 'Saboteur' }] }, // Fennec Shand (leader)
  SHD_188: { keywords: [{ name: 'Ambush' }] }, // 4-LOM
  JTL_054: { keywords: [{ name: 'Shielded' }] }, // Gold Leader

  // A keyword the source lists that the card does not print, alongside one it omits.
  LAW_081: { keywords: [{ name: 'Ambush' }, { name: 'Overwhelm' }] }, // Sullustan Sapper: the card prints Ambush and Overwhelm, not Shielded

  // An arena the source gets wrong. "This unit can attack space units" is printed on a GROUND unit;
  // shipped as Space it could not have been printed at all.
  JTL_259: { arena: 'ground' }, // Retrofitted Airspeeder

  // A card type the source gets wrong. "When Played: you may attack with attached unit" is an
  // upgrade's text, and the printed card is an upgrade with +1/+1 that the source omits.
  SOR_215: { type: 'upgrade', power: 1, hp: 1 }, // Snapshot Reflexes
}
