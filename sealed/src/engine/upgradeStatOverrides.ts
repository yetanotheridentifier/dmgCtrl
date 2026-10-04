/**
 * Upgrade Power/HP modifiers the card source omits.
 *
 * SWUDB ships no Power/HP for any unit upgrade in ASH, HMW, JTL, LAW, LOF, SEC
 * or TS26 (SOR, SHD and TWI carry them). The +X/+Y is printed on the card, so
 * without a row here the upgrade plays as +0/+0. The values are the publisher's
 * own (`admin.starwarsunlimited.com/api/card-list`, `upgradePower`/`upgradeHp`),
 * which agree with every upgrade the source does carry stats for. `normaliseCard`
 * uses an entry only when the source provides NO Power/HP, so each row drops out
 * once the upstream data is fixed. Fortify upgrades attach to a base and print
 * no modifier, so they have no row. `engineCardDb.test.ts` fails if a unit
 * upgrade in a bundled set is left uncovered.
 *
 * Format: `{ power, hp }` is the printed modifier (may be negative).
 */
export const UPGRADE_STAT_OVERRIDES: Record<string, { power: number; hp: number }> = {
  ASH_054: { power: 0, hp: 0 }, // Pointless to Resist
  ASH_055: { power: 2, hp: 1 }, // Blade of Talzin
  ASH_066: { power: 3, hp: 3 }, // Luke's Jedi Lightsaber
  ASH_084: { power: 0, hp: 3 }, // Arcana Star Map
  ASH_085: { power: 0, hp: 0 }, // Grav Charge
  ASH_086: { power: 1, hp: 1 }, // Durasteel Plating
  ASH_087: { power: 2, hp: 2 }, // Cybernetic Enhancements
  ASH_088: { power: 0, hp: 0 }, // The Conflict Within
  ASH_114: { power: 2, hp: 2 }, // Sabine's Lightsaber
  ASH_134: { power: 2, hp: 1 }, // Warrior's Legacy
  ASH_135: { power: 4, hp: 2 }, // The Darksaber
  ASH_150: { power: 0, hp: 0 }, // Deadly Vulnerability
  ASH_180: { power: 1, hp: 1 }, // Bokken Saber
  ASH_181: { power: 2, hp: 0 }, // Mark My Words
  ASH_182: { power: 1, hp: 1 }, // Unfettered Ambition
  ASH_183: { power: 2, hp: 2 }, // Whistling Birds
  ASH_198: { power: -2, hp: 0 }, // Nowhere to Hide
  ASH_199: { power: 2, hp: 2 }, // There Is No Conflict
  ASH_210: { power: 1, hp: 0 }, // DDC Defender
  ASH_227: { power: 0, hp: 2 }, // Heightened Awareness
  ASH_228: { power: 2, hp: 1 }, // Preparation
  ASH_229: { power: 0, hp: 0 }, // Camtono
  ASH_230: { power: 0, hp: 3 }, // Improvised Identity
  ASH_262: { power: 1, hp: 2 }, // Faith in the Empire
  ASH_263: { power: 2, hp: 0 }, // The Way of the Mand'alor (+2/+0 — cost-reduction only, no HP)
  HMW_038: { power: 2, hp: 2 }, // Bestial Bond
  HMW_097: { power: 1, hp: 1 }, // Dire Prowess
  HMW_127: { power: 3, hp: 1 }, // Chewbacca's Bowcaster
  HMW_148: { power: 1, hp: 3 }, // Local Support
  HMW_190: { power: 1, hp: 1 }, // Enraged
  HMW_191: { power: 2, hp: 1 }, // Hunter's Instinct
  HMW_235: { power: 2, hp: 1 }, // Gaderffii Stick
  HMW_236: { power: 2, hp: 2 }, // Booma Ball
  HMW_252: { power: 2, hp: 0 }, // Villainous Ambition
  HMW_264: { power: 0, hp: 2 }, // Heroic Bravery
  HMW_265: { power: 2, hp: 2 }, // Twi'lek Kalikori
  JTL_073: { power: 1, hp: 1 }, // Grim Valor
  JTL_120: { power: 0, hp: 0 }, // Dorsal Turret
  JTL_171: { power: 1, hp: 1 }, // Targeting Computer
  JTL_172: { power: 2, hp: 2 }, // Twin Laser Turret
  JTL_192: { power: 0, hp: 0 }, // In Debt to Crimson Dawn
  JTL_227: { power: 0, hp: 3 }, // Superheavy Ion Cannon
  JTL_260: { power: 0, hp: 0 }, // Death Star Plans
  LAW_077: { power: 0, hp: 0 }, // Shadow of Stygeon Prime
  LAW_111: { power: 2, hp: 2 }, // Leia's Disguise
  LAW_125: { power: 0, hp: 2 }, // Watchful
  LAW_126: { power: 0, hp: 0 }, // Adventurer Sniper Rifle
  LAW_127: { power: -1, hp: -1 }, // Kill Switch
  LAW_128: { power: 0, hp: 0 }, // Veiled Strength
  LAW_129: { power: 3, hp: 3 }, // Mastery
  LAW_141: { power: 0, hp: 0 }, // Targeted For Removal
  LAW_150: { power: 2, hp: 2 }, // Fulcrum
  LAW_186: { power: 0, hp: 2 }, // Enfys Nest's Helmet
  LAW_187: { power: 3, hp: 1 }, // "Staccato Lightning" Repeater
  LAW_200: { power: 2, hp: 0 }, // Salvaged Blaster
  LAW_201: { power: 1, hp: 1 }, // Thermal Detonator
  LAW_225: { power: 0, hp: 0 }, // Han's Golden Dice
  LOF_040: { power: 1, hp: 3 }, // Kylo Ren's Lightsaber
  LOF_051: { power: 1, hp: 1 }, // Jedi Holocron
  LOF_052: { power: 0, hp: 0 }, // Jedi Trials
  LOF_053: { power: 2, hp: 2 }, // Heirloom Lightsaber
  LOF_056: { power: 0, hp: 0 }, // Size Matters Not
  LOF_074: { power: 1, hp: 3 }, // Bolstered Endurance
  LOF_090: { power: 1, hp: 3 }, // Inquisitor's Lightsaber
  LOF_091: { power: 2, hp: 2 }, // Craving Power
  LOF_102: { power: 3, hp: 1 }, // Yoda's Lightsaber
  LOF_122: { power: 1, hp: 1 }, // Pillio Star Compass
  LOF_138: { power: 1, hp: 1 }, // Sith Holocron
  LOF_139: { power: 3, hp: 3 }, // Battle Fury
  LOF_140: { power: 4, hp: 2 }, // Darth Maul's Lightsaber
  LOF_151: { power: 3, hp: 2 }, // Knight's Saber
  LOF_171: { power: 2, hp: 2 }, // Heavy Blaster Cannon
  LOF_187: { power: 2, hp: 1 }, // Corrupted Saber
  LOF_201: { power: 3, hp: 1 }, // Qui-Gon Jinn's Lightsaber
  LOF_215: { power: 1, hp: 3 }, // Ascension Cable
  LOF_238: { power: 2, hp: 2 }, // Darth Revan's Lightsabers
  LOF_261: { power: 2, hp: 3 }, // Constructed Lightsaber
  SEC_038: { power: 0, hp: 0 }, // Condemn
  SEC_039: { power: 2, hp: 2 }, // Creditor's Claim
  SEC_052: { power: 2, hp: 2 }, // Diplomatic Immunity
  SEC_054: { power: 0, hp: 0 }, // Exiled from the Force
  SEC_069: { power: 1, hp: 1 }, // Nimble Prowess
  SEC_070: { power: 0, hp: 3 }, // Armor of Fortune
  SEC_071: { power: 1, hp: 3 }, // Disciples' Devotion
  SEC_104: { power: 2, hp: 2 }, // Figure of Unity
  SEC_123: { power: 2, hp: 3 }, // Unveiled Might
  SEC_156: { power: 1, hp: 1 }, // Nemik's Manifesto
  SEC_175: { power: 1, hp: 1 }, // Ambition's Reward
  SEC_176: { power: 3, hp: 0 }, // Sudden Ferocity
  SEC_210: { power: 1, hp: 1 }, // Stolen Starpath Unit
  SEC_226: { power: 1, hp: 1 }, // Sneaking Suspicion
  SEC_227: { power: 1, hp: 3 }, // Special Modifications
  SEC_256: { power: 2, hp: 0 }, // Moral Authority
  SEC_264: { power: 1, hp: 1 }, // Clandestine Connections
  TS26_22: { power: 2, hp: 2 }, // The Darksaber
  TS26_25: { power: 2, hp: 2 }, // Fiery Alliance
  TS26_35: { power: 2, hp: 3 }, // Ahsoka's Lightsabers
  TS26_37: { power: 1, hp: 1 }, // Abandoned the Order
  TS26_45: { power: 4, hp: 4 }, // Champion
  TS26_52: { power: 1, hp: 1 }, // Sith Traditions
  TS26_63: { power: 3, hp: 2 }, // Rex's DC-17s
  TS26_79: { power: 2, hp: 1 }, // Underestimated
}

/**
 * The +X/+Y a unit or leader card adds when attached as an upgrade (a Pilot played with Piloting, a
 * pilot leader deployed as an upgrade). Printed beside the card's own power and HP, and not in the
 * card source at all, so unlike the table above it is applied unconditionally, as
 * `EngineCard.upgradePower`/`upgradeHp`. Same publisher source (`upgradePower`/`upgradeHp`).
 */
export const PILOT_UPGRADE_STATS: Record<string, { power: number; hp: number }> = {
  JTL_001: { power: 3, hp: 4 }, // Asajj Ventress
  JTL_003: { power: 5, hp: 5 }, // Lando Calrissian
  JTL_006: { power: 5, hp: 5 }, // Darth Vader
  JTL_008: { power: 3, hp: 4 }, // Wedge Antilles
  JTL_009: { power: 4, hp: 4 }, // Boba Fett
  JTL_011: { power: 3, hp: 3 }, // Major Vonreg
  JTL_012: { power: 4, hp: 5 }, // Luke Skywalker
  JTL_013: { power: 2, hp: 1 }, // Poe Dameron
  JTL_015: { power: 3, hp: 5 }, // Rio Durant
  JTL_017: { power: 3, hp: 4 }, // Han Solo
  JTL_018: { power: 3, hp: 3 }, // Kazuda Xiono
  JTL_034: { power: 2, hp: 3 }, // Interceptor Ace
  JTL_035: { power: 2, hp: 2 }, // Tam Ryvora
  JTL_036: { power: 3, hp: 3 }, // Iden Versio
  JTL_045: { power: 2, hp: 3 }, // Hera Syndulla
  JTL_046: { power: 2, hp: 2 }, // Paige Tico
  JTL_048: { power: 1, hp: 3 }, // Cassian Andor
  JTL_049: { power: 3, hp: 3 }, // L3-37
  JTL_057: { power: 1, hp: 3 }, // Astromech Pilot
  JTL_058: { power: 1, hp: 2 }, // Academy Graduate
  JTL_066: { power: 1, hp: 2 }, // Trace Martez
  JTL_083: { power: 0, hp: 0 }, // Pantoran Starship Thief
  JTL_084: { power: 1, hp: 1 }, // Wingman Victor Two
  JTL_086: { power: 1, hp: 1 }, // Wingman Victor Three
  JTL_093: { power: 1, hp: 2 }, // Nien Nunb
  JTL_094: { power: 3, hp: 2 }, // Luke Skywalker
  JTL_098: { power: 2, hp: 2 }, // Snap Wexley
  JTL_100: { power: 2, hp: 3 }, // Poe Dameron
  JTL_103: { power: 3, hp: 3 }, // Chewbacca
  JTL_108: { power: 2, hp: 2 }, // Clone Pilot
  JTL_109: { power: 2, hp: 2 }, // Jarek Yeager
  JTL_139: { power: 1, hp: 2 }, // Dengar
  JTL_141: { power: 0, hp: 3 }, // IG-88
  JTL_142: { power: 3, hp: 3 }, // Darth Vader
  JTL_145: { power: 1, hp: 2 }, // BB-8
  JTL_148: { power: 2, hp: 2 }, // Frisk
  JTL_150: { power: 2, hp: 1 }, // Biggs Darklighter
  JTL_159: { power: 3, hp: 1 }, // Determined Recruit
  JTL_187: { power: 2, hp: 2 }, // Bossk
  JTL_189: { power: 2, hp: 3 }, // Boba Fett
  JTL_196: { power: 2, hp: 1 }, // Dagger Squadron Pilot
  JTL_197: { power: 2, hp: 3 }, // Anakin Skywalker
  JTL_203: { power: 2, hp: 3 }, // Han Solo
  JTL_210: { power: 3, hp: 1 }, // The Mandalorian
  JTL_211: { power: 1, hp: 1 }, // Independent Smuggler
  JTL_213: { power: -2, hp: -2 }, // Sidon Ithano
  JTL_215: { power: 1, hp: 2 }, // BoShek
  JTL_236: { power: 1, hp: 2 }, // Indoctrinated Conscript
  JTL_245: { power: 1, hp: 1 }, // R2-D2
  JTL_246: { power: 1, hp: 3 }, // Hopeful Volunteer
  JTL_255: { power: 1, hp: 1 }, // Sullustan Spacer
}
