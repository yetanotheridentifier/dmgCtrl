/**
 * Implementation manifest — the cards whose abilities are built into the engine, shown as a
 * reference on the setup screen. Kept in step with the ability registry by a test
 * (`implementedCards.test.ts`) that asserts these ids exactly match every registered card, in any set.
 * A card is credited to the set its id names, so the lists carry no set field of their own.
 *
 * Leaders are two-sided: `front` = the undeployed leader ability, `back` = the deployed
 * (leader-unit) ability. A `false` marks a side still to come (see `docs/abilities.md`).
 */

import { REPRINTS, type Reprint } from './reprints'

export interface LeaderStatus {
  id: string
  name: string
  front: boolean
  back: boolean
}

export interface UpgradeStatus {
  id: string
  name: string
}

/** Development status of a body of work shown in the setup reference panel. */
export type GroupStatus = 'done' | 'in progress' | 'planned'

/** A unit card in a group. Keyed by id: 13 unit names collide with leader names (Grogu, Baylan
 *  Skoll, The Mandalorian, …), so name alone can't identify a card. */
export interface UnitRef {
  id: string
  name: string
}

export interface UnitGroup {
  id: string
  name: string
  status: GroupStatus
  note: string
  /** The unit cards in this group. */
  units: UnitRef[]
}

/**
 * The 179 ASH unit cards that do NOT yet have a registered ability, grouped by what blocks each one:
 * not how hard it looks, but whether the engine can already express it. Order runs done → ready →
 * blocked, so the first open group is what's next.
 *
 * The "built" group is derived from IMPLEMENTED_UNITS rather than listed here, so a card leaves its
 * blocker group automatically the moment its ability lands — the panel can't go stale.
 */
const UNIT_PLAN: { id: string; name: string; status: GroupStatus; note: string; units: UnitRef[] }[] = [
  {
    id: 'keyword',
    name: 'Playable as printed (no engine work)',
    status: 'done',
    note: 'Vanilla or keyword-only. Every keyword in the set is implemented, so these already play correctly — validated by keywordOnlyUnits.test.ts.',
    units: [
      { id: 'ASH_164', name: 'Alamite Hunter' },
      { id: 'ASH_121', name: 'Blurrg' },
      { id: 'ASH_249', name: 'Covert Veteran' },
      { id: 'ASH_242', name: 'Death Trooper Squad' },
      { id: 'ASH_129', name: 'Defenders of the Forest' },
      { id: 'ASH_131', name: 'Dinosaur Turtle' },
      { id: 'ASH_193', name: 'Emperor\'s Champion' },
      { id: 'ASH_166', name: 'Ewok Warrior' },
      { id: 'ASH_130', name: 'Fang Fighter Squadron' },
      { id: 'ASH_192', name: 'Fennec Shand' },
      { id: 'ASH_215', name: 'Flanking TIE Interceptor' },
      { id: 'ASH_096', name: 'Forest Patroller' },
      { id: 'ASH_154', name: 'Honorable Nite Owl' },
      { id: 'ASH_048', name: 'Imperial Armored Commando' },
      { id: 'ASH_239', name: 'Imperial Loyalist' },
      { id: 'ASH_152', name: 'Inspired Recruit' },
      { id: 'ASH_074', name: 'Mos Eisley Modifier' },
      { id: 'ASH_252', name: 'N5 Sentry Droid' },
      { id: 'ASH_261', name: 'Noti Mobile Pod' },
      { id: 'ASH_069', name: 'Noti Nomad' },
      { id: 'ASH_201', name: 'Open Circle Ace' },
      { id: 'ASH_117', name: 'Outland Protector' },
      { id: 'ASH_106', name: 'Pathfinder Sergeant' },
      { id: 'ASH_190', name: 'Peridea Bandit' },
      { id: 'ASH_145', name: 'Praetorian Elite' },
      { id: 'ASH_256', name: 'Rebel Infiltrators' },
      { id: 'ASH_095', name: 'Remnant Interceptor' },
      { id: 'ASH_076', name: 'Remnant Official' },
      { id: 'ASH_244', name: 'Remnant Trooper Corps' },
      { id: 'ASH_029', name: 'Scorpenek Annihilator Droid' },
      { id: 'ASH_173', name: 'Shydopp Pirate Skiff' },
      { id: 'ASH_061', name: 'Strike Team Vanguard' },
      { id: 'ASH_126', name: 'Survivors\' Langskib' },
      { id: 'ASH_141', name: 'TIE Striker' },
      { id: 'ASH_225', name: 'Tatooine Sand Beast' },
      { id: 'ASH_143', name: 'Tempest Lieutenant' },
      { id: 'ASH_222', name: 'Unsanctioned Patrol' },
      { id: 'ASH_213', name: 'Womp Rat' },
      { id: 'ASH_175', name: 'Wookiee Chieftain' },
    ],
  },
  {
    id: 'ready',
    name: 'Ready to build (hooks already exist)',
    status: 'in progress',
    note: 'Blocked on nothing — the triggers, choices and effects these need are already in place.',
    units: [
      { id: 'ASH_079', name: 'Koska Reeves' },
      { id: 'ASH_171', name: 'Pegasus Tri-Wing' },
      { id: 'ASH_118', name: '8D8' },
      { id: 'ASH_060', name: 'Cobb Vanth' },
      { id: 'ASH_245', name: 'Eye of Sion' },
      { id: 'ASH_047', name: 'Gar Saxon' },
      { id: 'ASH_155', name: 'Grogu' },
      { id: 'ASH_102', name: 'Ravager' },
      { id: 'ASH_109', name: 'T-6 Shuttle 1974' },
      { id: 'ASH_041', name: 'Outcast' },
      { id: 'ASH_144', name: 'Vane\'s Snub Fighter' },
    ],
  },
  {
    id: 'mechanic',
    name: 'Needs one new mechanic each',
    status: 'planned',
    note: 'Each is blocked on a single small addition — a new trigger, a chained choice, an extra action-ability cost, or choice support during the regroup phase.',
    units: [
      { id: 'ASH_202', name: 'Carson Teva' },
      { id: 'ASH_207', name: 'Heroic Purrgil' },
      { id: 'ASH_039', name: 'Baylan Skoll' },
      { id: 'ASH_052', name: 'Chimaera' },
      { id: 'ASH_042', name: 'Jabba the Hutt' },
      { id: 'ASH_219', name: 'Jod Na Nawood' },
      { id: 'ASH_132', name: 'Queen Soruna' },
      { id: 'ASH_133', name: 'Trask Walker' },
      { id: 'ASH_161', name: 'Zeb Orrelios' },
      { id: 'ASH_169', name: 'Axe Woves' },
      { id: 'ASH_204', name: 'Blade Three' },
      { id: 'ASH_217', name: 'Mayor\'s Majordomo' },
      { id: 'ASH_149', name: 'Eviscerator' },
      { id: 'ASH_032', name: 'Rancor Keeper' },
      { id: 'ASH_159', name: 'Alphabet Squadron U-Wing' },
    ],
  },
  {
    id: 'subsystem',
    name: 'Blocked on a subsystem',
    status: 'planned',
    note: 'Each needs a substantial new system: a damage pipeline that tracks sources, unit capture, aura-granted triggered abilities, or the event card type.',
    units: [
      { id: 'ASH_224', name: 'Elzar Mann' },
      { id: 'ASH_063', name: 'Bo-Katan\'s Gauntlet' },
      { id: 'ASH_128', name: 'Bothan-5' },
      { id: 'ASH_196', name: 'Gorian Shard\'s Corsair' },
      { id: 'ASH_062', name: 'The Mandalorian' },
    ],
  },
]


export const IMPLEMENTED_LEADERS: LeaderStatus[] = [
  { id: 'ASH_001', name: 'The Armorer', front: true, back: true },
  { id: 'ASH_009', name: 'Ahsoka Tano', front: true, back: true },
  { id: 'ASH_003', name: 'Baylan Skoll', front: true, back: true },
  { id: 'ASH_002', name: 'Fennec Shand', front: true, back: true },
  { id: 'ASH_004', name: 'Grand Admiral Thrawn', front: true, back: true },
  { id: 'ASH_010', name: 'Bo-Katan Kryze', front: true, back: true },
  { id: 'ASH_011', name: 'Cad Bane', front: true, back: true },
  { id: 'ASH_015', name: 'Emperor Palpatine', front: true, back: true },
  { id: 'ASH_013', name: 'Ezra Bridger', front: true, back: true },
  { id: 'ASH_005', name: 'Luke Skywalker', front: true, back: true },
  { id: 'ASH_007', name: 'Grand Admiral Sloane', front: true, back: true },
  { id: 'ASH_018', name: 'Grogu', front: true, back: true },
  { id: 'ASH_017', name: 'Greef Karga', front: true, back: true },
  { id: 'ASH_008', name: 'Moff Gideon', front: true, back: true },
  { id: 'ASH_016', name: 'Shin Hati', front: true, back: true },
  { id: 'ASH_014', name: 'The Mandalorian', front: true, back: true },
  { id: 'ASH_012', name: 'Vane', front: true, back: true },
  { id: 'ASH_006', name: 'Sabine Wren', front: true, back: true },
]

export const IMPLEMENTED_UPGRADES: UpgradeStatus[] = [
  { id: 'ASH_084', name: 'Arcana Star Map' },
  { id: 'ASH_055', name: 'Blade of Talzin' },
  { id: 'ASH_180', name: 'Bokken Saber' },
  { id: 'ASH_229', name: 'Camtono' },
  { id: 'ASH_088', name: 'The Conflict Within' },
  { id: 'ASH_087', name: 'Cybernetic Enhancements' },
  { id: 'ASH_135', name: 'The Darksaber' },
  { id: 'ASH_210', name: 'DDC Defender' },
  { id: 'ASH_150', name: 'Deadly Vulnerability' },
  { id: 'ASH_086', name: 'Durasteel Plating' },
  { id: 'ASH_262', name: 'Faith in the Empire' },
  { id: 'ASH_085', name: 'Grav Charge' },
  { id: 'ASH_227', name: 'Heightened Awareness' },
  { id: 'ASH_230', name: 'Improvised Identity' },
  { id: 'ASH_066', name: "Luke's Jedi Lightsaber" },
  { id: 'ASH_181', name: 'Mark My Words' },
  { id: 'ASH_198', name: 'Nowhere to Hide' },
  { id: 'ASH_054', name: 'Pointless to Resist' },
  { id: 'ASH_228', name: 'Preparation' },
  { id: 'ASH_114', name: "Sabine's Lightsaber" },
  { id: 'ASH_199', name: 'There Is No Conflict' },
  { id: 'ASH_182', name: 'Unfettered Ambition' },
  { id: 'ASH_134', name: "Warrior's Legacy" },
  { id: 'ASH_263', name: "The Way of the Mand'alor" },
  { id: 'ASH_183', name: 'Whistling Birds' },
  // When Played, other sets
  { id: 'TWI_155', name: 'Twice the Pride' },
  { id: 'LAW_127', name: 'Kill Switch' },
  { id: 'TWI_070', name: 'Perilous Position' },
  { id: 'SOR_053', name: "Luke's Lightsaber" },
  { id: 'SHD_073', name: 'Mandalorian Armor' },
  { id: 'TWI_152', name: "Mace Windu's Lightsaber" },
  { id: 'TWI_168', name: 'Old Access Codes' },
  // Constant abilities, other sets
  { id: 'SEC_071', name: "Disciples' Devotion" },
  { id: 'LOF_215', name: 'Ascension Cable' },
  { id: 'LOF_261', name: 'Constructed Lightsaber' },
  { id: 'LOF_238', name: "Darth Revan's Lightsabers" },
  { id: 'LOF_053', name: 'Heirloom Lightsaber' },
  { id: 'TWI_071', name: 'Unshakeable Will' },
  { id: 'TWI_236', name: "Grievous's Wheel Bike" },
  { id: 'SOR_070', name: 'Devotion' },
  { id: 'SOR_166', name: "Infiltrator's Skill" },
  { id: 'SOR_057', name: 'Protector' },
  { id: 'LAW_128', name: 'Veiled Strength' },
  { id: 'LOF_074', name: 'Bolstered Endurance' },
  { id: 'LOF_151', name: "Knight's Saber" },
  { id: 'TS26_79', name: 'Underestimated' },
  { id: 'SHD_069', name: 'Foundling' },
  { id: 'LAW_150', name: 'Fulcrum' },
  { id: 'SOR_072', name: 'Entrenched' },
  { id: 'LAW_129', name: 'Mastery' },
  // When Played, other sets: deck searches
  { id: 'LOF_122', name: 'Pillio Star Compass' },
  // Constant abilities, other sets: the remainder
  { id: 'SOR_071', name: 'Electrostaff' },
  { id: 'SHD_224', name: "Boba Fett's Armor" },
  { id: 'LOF_056', name: 'Size Matters Not' },
  // When Played, other sets: TS26 and IBH, the two sets too small to sweep
  { id: 'TS26_37', name: 'Abandoned the Order' },
  { id: 'TS26_25', name: 'Fiery Alliance' },
  // When Played, other sets: attacks
  { id: 'TWI_248', name: "Ahsoka's Padawan Lightsaber" },
  { id: 'LOF_140', name: "Darth Maul's Lightsaber" },
  // When Played, other sets: two linked steps
  { id: 'LOF_171', name: 'Heavy Blaster Cannon' },
  // When Played, other sets: upgrade attach rules and upgrade-specific text
  { id: 'SEC_069', name: 'Nimble Prowess' },
  { id: 'LOF_091', name: 'Craving Power' },
  { id: 'LOF_201', name: "Qui-Gon Jinn's Lightsaber" },
  { id: 'SHD_193', name: 'Frozen in Carbonite' },
  { id: 'LAW_111', name: "Leia's Disguise" },
  { id: 'TWI_256', name: 'Hold-Out Blaster' },
  { id: 'SOR_136', name: "Vader's Lightsaber" },
  { id: 'TWI_219', name: 'On Top of Things' },
  // When Played, other sets: several targets
  { id: 'LAW_187', name: '"Staccato Lightning" Repeater' },
]

/**
 * Event cards whose effects are built into the engine. An event's effect is registered as its
 * `whenPlayed`, so — unlike units — there is no "vanilla event": every one needs a definition.
 */
export const IMPLEMENTED_EVENTS: UpgradeStatus[] = [
  { id: 'ASH_140', name: 'Stronger Together' },
  { id: 'ASH_185', name: 'Intimidation' },
  { id: 'ASH_258', name: 'Grassroots Resistance' },
  { id: 'ASH_136', name: 'Display of Strength' },
  { id: 'ASH_151', name: 'Operation Cinder' },
  { id: 'ASH_187', name: 'Reckoning' },
  { id: 'ASH_138', name: 'Turning the Tide' },
  { id: 'ASH_264', name: 'A New Order' },
  { id: 'ASH_067', name: 'Get Lost' },
  { id: 'ASH_092', name: 'Foundling Rescue' },
  { id: 'ASH_091', name: 'Buy Time' },
  { id: 'ASH_103', name: 'Long Live the Empire' },
  { id: 'ASH_246', name: 'Exploit Advantage' },
  { id: 'ASH_089', name: 'Perserverance' },
  { id: 'ASH_233', name: 'Keep Them Talking' },
  { id: 'ASH_236', name: 'Far Far Away' },
  { id: 'ASH_232', name: 'Full of Surprises' },
  { id: 'ASH_115', name: 'The Student Guides the Master' },
  { id: 'ASH_139', name: 'Hold Them Off' },
  { id: 'ASH_163', name: 'Reckless Sacrifice' },
  { id: 'ASH_188', name: 'Galvanized Leap' },
  { id: 'ASH_211', name: 'Fateful Goodbye' },
  { id: 'ASH_231', name: 'Diplomatic Pageantry' },
  { id: 'ASH_247', name: 'One Must Destroy to Create' },
  { id: 'ASH_104', name: 'Dathomiri Magicks' },
  { id: 'ASH_257', name: 'Choose Your Path' },
  { id: 'ASH_200', name: 'Rehabilitation' },
  { id: 'ASH_162', name: 'Rash Action' },
  { id: 'ASH_184', name: 'Follow Me' },
  { id: 'ASH_234', name: 'Masterstroke' },
  { id: 'ASH_137', name: 'Wipe Them Out' },
  { id: 'ASH_186', name: 'Treacherous Minefield' },
  { id: 'ASH_090', name: 'Reforge' },
  { id: 'ASH_235', name: 'Sense Through the Force' },
  { id: 'SOR_172', name: 'Open Fire' },
  { id: 'SHD_178', name: 'Daring Raid' },
  { id: 'JTL_125', name: 'Air Superiority' },
  { id: 'SOR_078', name: 'Vanquish' },
  { id: 'LOF_264', name: "It's Worse" },
  { id: 'SHD_079', name: "Rival's Fall" },
  { id: 'LOF_077', name: 'Crushing Blow' },
  { id: 'SHD_078', name: 'Fell the Dragon' },
  { id: 'SOR_077', name: 'Takedown' },
  { id: 'JTL_078', name: 'Direct Hit' },
  { id: 'SEC_247', name: 'Evil is Everywhere' },
  { id: 'SOR_251', name: 'Confiscate' },
  { id: 'SOR_074', name: 'Repair' },
  { id: 'SOR_073', name: 'Moment of Peace' },
  { id: 'JTL_262', name: 'Evasive Maneuver' },
  { id: 'SOR_169', name: 'Keep Fighting' },
  { id: 'LOF_174', name: 'Ataru Onslaught' },
  { id: 'JTL_179', name: 'Koiogran Turn' },
  { id: 'JTL_209', name: "It's a Trap" },
  { id: 'SOR_222', name: 'Waylay' },
  { id: 'LAW_246', name: 'The Axe Forgets' },
  { id: 'SHD_233', name: 'Evacuate' },
  { id: 'SOR_124', name: 'Tactical Advantage' },
  { id: 'SHD_130', name: 'Moment of Glory' },
  { id: 'LAW_131', name: 'Incapacitate' },
  { id: 'JTL_079', name: 'Out the Airlock' },
  { id: 'SOR_216', name: 'Disarm' },
  { id: 'LOF_126', name: 'Overpower' },
  { id: 'JTL_229', name: 'Diversion' },
  { id: 'LOF_217', name: 'Force Slow' },
  { id: 'TWI_052', name: 'Hello There' },
  { id: 'SHD_051', name: 'Mystic Reflection' },
  { id: 'LOF_078', name: 'Whirlwind of Power' },
  { id: 'LAW_167', name: 'Common Cause' },
  { id: 'TWI_074', name: 'Guarding the Way' },
  { id: 'SOR_076', name: 'Make an Opening' },
  { id: 'SEC_075', name: 'Knowledge and Defense' },
  { id: 'TWI_175', name: 'Strategic Analysis' },
  { id: 'SEC_125', name: 'Reconnaissance' },
  { id: 'TWI_100', name: 'Petition the Senate' },
  { id: 'SHD_159', name: 'The Chaos of War' },
  { id: 'TWI_173', name: 'Blood Sport' },
  { id: 'LOF_141', name: 'Death Field' },
  { id: 'TWI_126', name: 'Encouraging Leadership' },
  { id: 'TWI_075', name: 'Disruptive Burst' },
  { id: 'LOF_127', name: 'Rampage' },
  { id: 'SOR_154', name: 'Rallying Cry' },
  { id: 'LOF_152', name: 'Focus Determines Reality' },
  { id: 'TWI_250', name: 'Sword and Shield Maneuver' },
  { id: 'SOR_220', name: 'Surprise Strike' },
  { id: 'TWI_224', name: 'Breaking In' },
  { id: 'SOR_168', name: 'Precision Fire' },
  { id: 'SOR_217', name: 'Shoot First' },
  // Events that defeat several units as one event
  { id: 'SOR_043', name: 'Superlaser Blast' },
  { id: 'SEC_078', name: 'Hyperspace Disaster' },
  { id: 'JTL_080', name: 'Nebula Ignition' },
  { id: 'LAW_044', name: 'Single Reactor Ignition' },
  { id: 'LAW_096', name: 'Rhydonium Detonation' },
  // TS26 and IBH, the two sets too small to sweep
  { id: 'TS26_68', name: 'Arms Deal' },
  { id: 'TS26_56', name: 'Galactic Escalation' },
  { id: 'TS26_64', name: 'Urgent Mission' },
  { id: 'TS26_48', name: 'Vanquish the Legion' },
  { id: 'TS26_82', name: 'Evade Arrest' },
  { id: 'TS26_84', name: 'Fearless Attack' },
  { id: 'TS26_72', name: 'Fervor' },
  { id: 'TS26_33', name: 'Kouhun Assassination' },
  { id: 'TS26_81', name: 'Mislead' },
  { id: 'TS26_32', name: 'Reckless Landing' },
  { id: 'TS26_69', name: 'Remove the Chip' },
  { id: 'TS26_80', name: 'Reveal Intentions' },
  { id: 'TS26_71', name: 'Take Action' },
  { id: 'TS26_83', name: 'Take Aim' },
  { id: 'TS26_47', name: 'Take Cover' },
  { id: 'TS26_70', name: 'Backed by Black Sun' },
  { id: 'IBH_18', name: 'Go for the Legs' },
  { id: 'IBH_74', name: 'I Want Proof, Not Leads' },
  { id: 'IBH_5', name: "I'll Cover For You" },
  { id: 'IBH_9', name: "I've Found Them" },
  { id: 'IBH_21', name: 'Improvised Detonation' },
  { id: 'IBH_13', name: 'Recovery' },
  { id: 'IBH_59', name: 'Target the Main Generator' },
  { id: 'IBH_104', name: 'The Desolation of Hoth' },
  { id: 'IBH_66', name: 'Too Strong for Blasters' },
  { id: 'IBH_52', name: 'Watch This' },
  { id: 'IBH_61', name: "We're In Trouble" },
  { id: 'IBH_95', name: 'You Have Failed Me' },
  // Attack events beyond a plain rider
  { id: 'LOF_224', name: 'Pounce' },
  { id: 'JTL_231', name: 'Punch It' },
  { id: 'SHD_179', name: 'Desperate Attack' },
  { id: 'TWI_172', name: 'Grim Resolve' },
  { id: 'SOR_103', name: 'Rebel Assault' },
  { id: 'LOF_124', name: 'Niman Strike' },
  { id: 'JTL_123', name: 'Dogfight' },
  { id: 'SEC_229', name: 'Catch Unawares' },
  { id: 'SHD_230', name: 'Swoop Down' },
  { id: 'TWI_123', name: 'Outflank' },
  { id: 'SHD_128', name: 'Outflank' },
  { id: 'JTL_261', name: 'Attack Run' },
  { id: 'SHD_145', name: 'Headhunting' },
  { id: 'JTL_124', name: 'Tandem Assault' },
  { id: 'TS26_59', name: 'Brothers' },
  { id: 'SEC_228', name: 'Accelerate Our Plans' },
  { id: 'LAW_202', name: 'Commence the Festivities' },
  { id: 'LAW_205', name: 'Flash the Vents' },
  { id: 'SEC_179', name: 'Aggressive Negotiations' },
  { id: 'TWI_139', name: 'Corner the Prey' },
  { id: 'JTL_228', name: 'Barrel Roll' },
  { id: 'JTL_193', name: 'I Have You Now' },
  { id: 'JTL_177', name: 'Stay on Target' },
  { id: 'SOR_150', name: 'Heroic Sacrifice' },
  { id: 'JTL_156', name: 'Trench Run' },
  { id: 'JTL_174', name: 'Hotshot Maneuver' },
  { id: 'TS26_31', name: 'Chaotic Diversion' },
  // Searches that draw
  { id: 'LAW_166', name: 'Putting a Team Together' },
  { id: 'SEC_072', name: 'Scour the Archives' },
  { id: 'SOR_123', name: 'Recruit' },
  { id: 'JTL_128', name: 'Prepare for Takeoff' },
  { id: 'SOR_125', name: 'Prepare For Takeoff' },
  { id: 'SHD_093', name: 'Remnant Reserves' },
  { id: 'SHD_253', name: 'This Is The Way' },
  // Hands: looking, discarding, drawing, and "choose a player"
  { id: 'SOR_200', name: 'Spark of Rebellion' },
  { id: 'LOF_226', name: 'Tip the Scale' },
  { id: 'JTL_207', name: 'Jam Communications' },
  { id: 'TWI_223', name: 'Unmasking the Conspiracy' },
  { id: 'LAW_217', name: 'Hold For Questioning' },
  { id: 'SEC_233', name: 'Beguile' },
  { id: 'LAW_204', name: 'Every Day, More Lies' },
  { id: 'SHD_244', name: 'No Bargain' },
  { id: 'SHD_156', name: 'Cripple Authority' },
  { id: 'SOR_175', name: 'Forced Surrender' },
  { id: 'SOR_174', name: 'Smoke and Cinders' },
  { id: 'SOR_171', name: 'Mission Briefing' },
  { id: 'SHD_181', name: 'Pillage' },
  { id: 'SOR_167', name: 'Force Throw' },
  // Damage read from a unit, and "choose an arena"
  { id: 'SOR_127', name: 'Strike True' },
  { id: 'SOR_151', name: 'Karabast' },
  { id: 'LOF_128', name: 'Protect the Pod' },
  { id: 'SOR_234', name: 'Maximum Firepower' },
  { id: 'JTL_129', name: 'Focus Fire' },
  { id: 'TWI_176', name: 'Caught in the Crossfire' },
  { id: 'JTL_173', name: 'Fight Fire With Fire' },
  { id: 'SEC_130', name: 'Ferrix Uprising' },
  { id: 'TWI_099', name: 'Synchronized Strike' },
  { id: 'JTL_144', name: 'No Disintegrations' },
  { id: 'SOR_092', name: 'Overwhelming Barrage' },
  { id: 'SOR_173', name: 'Bombing Run' },
  { id: 'SOR_221', name: 'Outmaneuver' },
  { id: 'JTL_131', name: 'Turbolaser Salvo' },
  // Exhausting and readying
  { id: 'SOR_218', name: 'Asteroid Sanctuary' },
  { id: 'TWI_221', name: 'In Pursuit' },
  { id: 'JTL_195', name: 'Cat and Mouse' },
  { id: 'SEC_196', name: 'No One Ever Knew' },
  { id: 'LAW_226', name: 'Secret Battle of Pretend' },
  { id: 'JTL_230', name: 'Electromagnetic Pulse' },
  { id: 'SHD_227', name: 'Look the Other Way' },
  { id: 'JTL_194', name: 'Heartless Tactics' },
  { id: 'LOF_223', name: 'Force Illusion' },
  { id: 'JTL_178', name: 'Face Off' },
  { id: 'JTL_206', name: 'Fly Casual' },
  { id: 'LAW_043', name: 'Shadow Cloaking' },
  { id: 'SHD_182', name: 'Bravado' },
  // Phase-long changes to units
  { id: 'SEC_091', name: 'Corporate Warmongering' },
  { id: 'SOR_106', name: 'Attack Pattern Delta' },
  { id: 'JTL_253', name: 'Coordinated Front' },
  { id: 'JTL_042', name: 'Power from Pain' },
  { id: 'TWI_153', name: 'Bold Resistance' },
  { id: 'TWI_249', name: 'Heroes on Both Sides' },
  { id: 'JTL_106', name: 'Unity of Purpose' },
  { id: 'TWI_055', name: 'Equalize' },
  { id: 'LAW_041', name: 'Nothing Left to Fear' },
  { id: 'LOF_262', name: 'Go Into Hiding' },
  { id: 'JTL_077', name: 'In the Heat of Battle' },
  // Defeats, and damage with a tail
  { id: 'LAW_133', name: 'Lost and Forgotten' },
  { id: 'TWI_140', name: 'Self-Destruct' },
  { id: 'SHD_108', name: 'Enforced Loyalty' },
  { id: 'TWI_041', name: 'Lethal Crackdown' },
  { id: 'SOR_041', name: 'Power of the Dark Side' },
  { id: 'TWI_238', name: 'Merciless Contest' },
  { id: 'LAW_103', name: 'Display Piece' },
  { id: 'JTL_043', name: 'No Glory, Only Results' },
  { id: 'JTL_175', name: 'System Shock' },
  { id: 'SOR_170', name: 'Power Failure' },
  { id: 'JTL_180', name: 'Piercing Shot' },
  { id: 'SOR_139', name: 'Force Choke' },
  { id: 'JTL_176', name: 'Shoot Down' },
  { id: 'LAW_208', name: 'Collateral Damage' },
  { id: 'SEC_180', name: "Let's Call It War" },
  { id: 'TWI_171', name: 'Grenade Strike' },
  // Change of control
  { id: 'SOR_224', name: 'Change of Heart' },
  { id: 'SHD_132', name: 'Choose Sides' },
  { id: 'TWI_204', name: 'Impropriety Among Thieves' },
  { id: 'LAW_085', name: 'You Hold This' },
  // Returns to hand, and this phase's record
  { id: 'TWI_199', name: 'Clear the Field' },
  { id: 'JTL_233', name: 'Sweep the Area' },
  { id: 'SHD_207', name: 'A New Adventure' },
  { id: 'SHD_229', name: 'Ma Klounkee' },
  { id: 'SEC_144', name: 'Tempest Assault' },
  { id: 'SOR_091', name: "The Emperor's Legion" },
  { id: 'TWI_188', name: 'Wartime Profiteering' },
  // Playing a unit from hand, and resourcing
  { id: 'LOF_076', name: 'Soresu Stance' },
  { id: 'SEC_257', name: 'Restore Freedom' },
  { id: 'SOR_235', name: 'Galactic Ambition' },
  { id: 'TWI_225', name: 'Now There Are Two of Them' },
  { id: 'TWI_127', name: 'Resupply' },
  { id: 'SOR_126', name: 'Resupply' },
  { id: 'LAW_171', name: 'Stockpile' },
  // Decks, draws and discard piles
  { id: 'SEC_232', name: "Kreia's Whispers" },
  { id: 'TWI_257', name: 'Private Manufacturing' },
  { id: 'LAW_203', name: 'Daring Delve' },
  { id: 'JTL_208', name: 'Never Tell Me the Odds' },
  { id: 'LOF_240', name: 'Flight of the Inquisitor' },
  { id: 'SOR_042', name: 'Search Your Feelings' },
  // Printed as an upgrade (see `cardDataCorrections.ts`), but the set data, and so the set totals
  // below, file it as an event. Counted where the totals count it.
  { id: 'SOR_215', name: 'Snapshot Reflexes' },
]

/**
 * Unit cards whose *abilities* are built into the engine. Keyword-only / vanilla units aren't here —
 * they need no definition and are counted separately. Grouped by the mechanic each ability uses.
 */
export const IMPLEMENTED_UNITS: UpgradeStatus[] = [
  // Conditional self keyword grants
  { id: 'ASH_098', name: 'AT-ST Raider' },
  { id: 'ASH_078', name: 'B-Wing Rearguard' },
  { id: 'ASH_105', name: 'Bo-Katan Kryze' },
  { id: 'ASH_093', name: 'Captain Pellaeon' },
  { id: 'ASH_122', name: 'Consortium StarViper' },
  { id: 'ASH_243', name: 'Darth Vader' },
  { id: 'ASH_057', name: 'Lothal E-Wing' },
  { id: 'ASH_049', name: 'Shin Hati' },
  { id: 'ASH_120', name: 'Warrior of Clan Kryze' },
  // Conditional stat buffs
  { id: 'ASH_240', name: 'Mandalorian Super Commandos' },
  { id: 'ASH_125', name: 'Stolen Eta Shuttle' },
  { id: 'ASH_113', name: 'Mandalorian Flagship' },
  // Conditional keyword swap
  { id: 'ASH_030', name: 'Marrok' },
  // Auras — constant effects on other units
  { id: 'ASH_177', name: 'Onyx Cinder' },
  { id: 'ASH_100', name: 'Gallius Rax' },
  { id: 'ASH_068', name: 'Domesticated Loth-Cat' },
  { id: 'ASH_040', name: 'Poe Dameron' },
  // "When Played" — self / no target
  { id: 'ASH_218', name: 'Ferry Droid' },
  { id: 'ASH_251', name: 'Zealous Soldier' },
  { id: 'ASH_178', name: 'Knobby White Ice Spider' },
  { id: 'ASH_221', name: 'Helix Starfighter' },
  { id: 'ASH_111', name: 'Children of the Watch' },
  { id: 'ASH_124', name: 'Protectorate Fighter' },
  { id: 'ASH_065', name: 'Home One' },
  { id: 'ASH_064', name: 'The Armorer' },
  // "When Played" — single target
  { id: 'ASH_259', name: 'LEP Ratcatcher' },
  { id: 'ASH_170', name: 'Desert Sharpshooter' },
  { id: 'ASH_174', name: 'StarFortress Heavy Bomber' },
  { id: 'ASH_081', name: 'Nebulon-C Frigate' },
  { id: 'ASH_051', name: 'Reinforcing Light Cruiser' },
  { id: 'ASH_214', name: 'Amnesty Officer' },
  { id: 'ASH_238', name: 'Attendant Navigator' },
  { id: 'ASH_255', name: 'Anakin Skywalker' },
  { id: 'ASH_082', name: 'Trexler Armored Marauder' },
  { id: 'ASH_194', name: 'Snub Fighter Squadron' },
  // "When Played" — multi-step
  { id: 'ASH_071', name: 'Battered Haulcraft' },
  { id: 'ASH_158', name: 'Han Solo' },
  { id: 'ASH_112', name: 'Luke Skywalker' },
  { id: 'ASH_176', name: 'Imposing Scout Walker' },
  // "Your next unit …" grants
  { id: 'ASH_237', name: 'Mouse Droid' },
  { id: 'ASH_248', name: 'Neel' },
  // Multi-target pick
  { id: 'ASH_205', name: 'Inspiring Veteran' },
  { id: 'ASH_053', name: 'Pre Vizsla' },
  // Discard from hand
  { id: 'ASH_260', name: 'Mos Espa Watermonger' },
  // Opponent discard + distribute damage
  { id: 'ASH_148', name: 'Ninth Sister' },
  // Look at opponent's hand
  { id: 'ASH_250', name: 'Imperial Defector' },
  { id: 'ASH_220', name: 'Remnant Lookouts' },
  // Search top 5 for a trait match
  { id: 'ASH_107', name: 'Clan Wren Loyalist' },
  // Play a discounted unit from hand
  { id: 'ASH_108', name: 'Crix Madine' },
  // Self-defeat + search top 10, play space units free
  { id: 'ASH_110', name: 'Admiral Ackbar' },
  // Name a card
  { id: 'ASH_077', name: 'Ryder Azadi' },
  // Modal / variable damage & heal
  { id: 'ASH_147', name: 'The Cyborg Mech' },
  { id: 'ASH_044', name: 'Barriss Offee' },
  // When Defeated
  { id: 'ASH_116', name: 'Ant Droid' },
  { id: 'ASH_080', name: 'Covert Believers' },
  { id: 'ASH_058', name: "Duchess's Protector" },
  { id: 'ASH_216', name: 'Mandalorian Scout' },
  { id: 'ASH_153', name: 'Green Leader' },
  { id: 'ASH_254', name: 'Gallofree Transport' },
  { id: 'ASH_028', name: 'Paz Vizsla' },
  { id: 'ASH_191', name: "Shin Hati's Fiend Fighter" },
  { id: 'ASH_167', name: 'Flarestar Attack Shuttle' },
  { id: 'ASH_195', name: 'Helgait' },
  { id: 'ASH_043', name: 'Corona Four' },
  { id: 'ASH_165', name: 'Clan Vizsla Soldier' },
  { id: 'ASH_097', name: 'Moff Gideon' },
  { id: 'ASH_027', name: 'Enoch' },
  { id: 'ASH_038', name: 'Purrgil Ultra' },
  { id: 'ASH_045', name: 'Reanimated Night Trooper' },
  // On Attack
  { id: 'ASH_157', name: 'Danger Squadron Wingmen' },
  { id: 'ASH_189', name: "Emperor's Messenger" },
  { id: 'ASH_056', name: 'Huyang' },
  { id: 'ASH_168', name: 'Migs Mayfeld' },
  { id: 'ASH_083', name: 'Summa-verminoth' },
  { id: 'ASH_156', name: 'R5-D4' },
  { id: 'ASH_072', name: 'Doctor Pershing' },
  { id: 'ASH_099', name: 'Gozanti Assault Carrier' },
  { id: 'ASH_209', name: 'Ezra Bridger' },
  { id: 'ASH_253', name: 'Yellow Aces Bomber' },
  { id: 'ASH_059', name: 'Leia Organa' },
  { id: 'ASH_172', name: 'Razor Crest' },
  { id: 'ASH_203', name: "Mando's N-1 Starfighter" },
  // When Attack Ends
  { id: 'ASH_033', name: 'Grand Admiral Thrawn' },
  { id: 'ASH_223', name: 'Halo' },
  { id: 'ASH_036', name: 'Rukh' },
  { id: 'ASH_101', name: 'The Great Mothers' },
  { id: 'ASH_031', name: 'Hera Syndulla' },
  { id: 'ASH_146', name: 'Justifier' },
  { id: 'ASH_123', name: 'Lang' },
  { id: 'ASH_142', name: 'Mortar Trooper' },
  { id: 'ASH_179', name: "Boba Fett's Rancor" },
  { id: 'ASH_119', name: 'Greef Karga' },
  // Conditional stat modifiers (combat role, board state)
  { id: 'ASH_073', name: 'Palace Chef Droid' },
  { id: 'ASH_241', name: "Marrok's Fiend Fighter" },
  { id: 'ASH_206', name: 'Kelleran Beq' },
  { id: 'ASH_197', name: 'Executor' },
  { id: 'ASH_226', name: "Qi'ra" },
  // Reactive triggers — firing off another card's event
  { id: 'ASH_127', name: 'The Twins' },
  { id: 'ASH_160', name: 'Kachirho Militia' },
  { id: 'ASH_208', name: 'Sabine Wren' },
  // Once-per-phase cost reductions
  { id: 'ASH_075', name: 'Pit Droid Team' },
  { id: 'ASH_212', name: 'Peli Motto' },
  // Targeting rules — what may attack, and what may be attacked
  { id: 'ASH_034', name: 'Wicket' },
  { id: 'ASH_037', name: 'Red Leader' },
  { id: 'ASH_035', name: 'Tatooine Repulsor Train' },
  // HP reduction, defeating a unit without dealing damage
  { id: 'ASH_050', name: 'Morgan Elsbeth' },
  { id: 'ASH_046', name: 'Scion Shuttle' },
  // Damage prevention and token-creation replacement
  { id: 'ASH_070', name: 'At Attin Safety Droid' },
  { id: 'ASH_094', name: 'Moff Jerjerrod' },
  // Reactions to units entering play, and to friendly attacks
  { id: 'ASH_144', name: "Vane's Snub Fighter" },
  { id: 'ASH_041', name: 'Outcast' },
  { id: 'ASH_102', name: 'Ravager' },
  { id: 'ASH_079', name: 'Koska Reeves' },
  // Chained follow-up choices, and "[Exhaust]" action costs
  { id: 'ASH_171', name: 'Pegasus Tri-Wing' },
  { id: 'ASH_060', name: 'Cobb Vanth' },
  { id: 'ASH_047', name: 'Gar Saxon' },
  { id: 'ASH_155', name: 'Grogu' },
  { id: 'ASH_118', name: '8D8' },
  { id: 'ASH_109', name: 'T-6 Shuttle 1974' },
  { id: 'ASH_245', name: 'Eye of Sion' },
  // Draw / base-damage / upgrade-defeat triggers, combat timing, and multi-step choices
  { id: 'ASH_169', name: 'Axe Woves' },
  { id: 'ASH_204', name: 'Blade Three' },
  { id: 'ASH_161', name: 'Zeb Orrelios' },
  { id: 'ASH_032', name: 'Rancor Keeper' },
  { id: 'ASH_039', name: 'Baylan Skoll' },
  { id: 'ASH_202', name: 'Carson Teva' },
  { id: 'ASH_207', name: 'Heroic Purrgil' },
  { id: 'ASH_052', name: 'Chimaera' },
  { id: 'ASH_042', name: 'Jabba the Hutt' },
  { id: 'ASH_219', name: 'Jod Na Nawood' },
  { id: 'ASH_132', name: 'Queen Soruna' },
  { id: 'ASH_133', name: 'Trask Walker' },
  { id: 'ASH_217', name: 'Mayor\'s Majordomo' },
  { id: 'ASH_159', name: 'Alphabet Squadron U-Wing' },
  { id: 'ASH_149', name: 'Eviscerator' },
  // Aura-granted abilities, capture, unpreventable damage, damage prevention
  { id: 'ASH_063', name: 'Bo-Katan\'s Gauntlet' },
  { id: 'ASH_128', name: 'Bothan-5' },
  { id: 'ASH_224', name: 'Elzar Mann' },
  { id: 'ASH_196', name: 'Gorian Shard\'s Corsair' },
  { id: 'ASH_062', name: 'The Mandalorian' },
  // When Played, other sets: damage, defeat, ready, return, tokens, exhaust, heal, buffs, draw, bases
  { id: 'LAW_213', name: 'Cutthroat Podracer' },
  { id: 'LAW_045', name: 'Zeb Orellios' },
  { id: 'LAW_137', name: 'Ruthless Duo' },
  { id: 'SEC_241', name: 'Political Bully' },
  { id: 'SEC_254', name: 'Heroic ARC-170' },
  { id: 'LOF_133', name: 'Purge Trooper' },
  { id: 'LOF_158', name: 'Hyena Bomber' },
  { id: 'LOF_145', name: 'Jedi Knight' },
  { id: 'LOF_259', name: 'Ravening Gundark' },
  { id: 'LOF_198', name: 'Stinger Mantis' },
  { id: 'JTL_239', name: 'TIE Dagger Vanguard' },
  { id: 'JTL_153', name: 'Rebellious Hammerhead' },
  { id: 'JTL_102', name: 'Resistance Blue Squadron' },
  { id: 'SHD_254', name: 'Bounty Guild Initiate' },
  { id: 'SHD_235', name: 'Ruthless Assassin' },
  { id: 'SOR_132', name: 'Imperial Interceptor' },
  { id: 'SOR_090', name: 'Devastator' },
  { id: 'TWI_149', name: 'Low Altitude Gunship' },
  { id: 'SHD_158', name: 'Wild Rancor' },
  { id: 'LAW_124', name: 'Industrious Team' },
  { id: 'LOF_071', name: 'Grappling Guardian' },
  { id: 'TWI_036', name: 'Devastating Gunship' },
  { id: 'SOR_038', name: 'Count Dooku' },
  { id: 'SOR_162', name: 'Disabling Fang Fighter' },
  { id: 'SEC_163', name: 'Outer Rim Constable' },
  { id: 'LOF_155', name: 'DRK-1 Probe Droid' },
  { id: 'LAW_061', name: 'Asajj Ventress' },
  { id: 'SHD_189', name: "Slaver's Freighter" },
  { id: 'JTL_135', name: 'Special Forces TIE Fighter' },
  { id: 'TWI_137', name: 'Savage Opress' },
  { id: 'SOR_148', name: 'Guerilla Attack Pod' },
  { id: 'LOF_234', name: 'Darth Malak' },
  { id: 'SOR_202', name: 'Cantina Bouncer' },
  { id: 'LAW_241', name: 'The Blade Wing' },
  { id: 'LAW_089', name: 'Kanan Jarrus' },
  { id: 'LAW_240', name: 'Milodon Rider' },
  { id: 'TWI_191', name: 'Wolf Pack Escort' },
  { id: 'SOR_209', name: 'Pirated Starfighter' },
  { id: 'LOF_242', name: 'Refugee of The Path' },
  { id: 'JTL_044', name: 'Echo Base Engineer' },
  { id: 'JTL_199', name: 'Blade Squadron B-Wing' },
  { id: 'JTL_217', name: 'Death Space Skirmisher' },
  { id: 'SOR_178', name: 'Cartel Spacer' },
  { id: 'SOR_039', name: 'AT-AT Suppressor' },
  { id: 'TWI_109', name: '501st Liberator' },
  { id: 'LAW_035', name: 'Ezra Bridger' },
  { id: 'SEC_206', name: 'Emissaries from Ryloth' },
  { id: 'LAW_151', name: 'Profiteering Hunter' },
  { id: 'LOF_114', name: 'Kaadu' },
  { id: 'SOR_086', name: 'Gladiator Star Destroyer' },
  { id: 'TWI_031', name: 'Rune Haako' },
  { id: 'SOR_051', name: 'Luke Skywalker' },
  { id: 'SOR_111', name: 'Patrolling V-Wing' },
  { id: 'SHD_249', name: 'Wookiee Warrior' },
  { id: 'LOF_121', name: 'The Purrgil King' },
  { id: 'SOR_068', name: 'Cargo Juggernaut' },
  { id: 'LAW_109', name: 'Tantive IV' },
  { id: 'SEC_102', name: 'Renowned Dignitaries' },
  { id: 'TWI_160', name: 'Vanguard Droid Bomber' },
  { id: 'SEC_240', name: 'Hutt Cartel Starfighter' },
  { id: 'JTL_248', name: 'Dilapidated Ski Speeder' },
  { id: 'TWI_059', name: 'Royal Guard Attaché' },
  { id: 'JTL_158', name: 'Crackshot V-Wing' },
  { id: 'JTL_067', name: 'Cloaked StarViper' },
  // Constant abilities, other sets
  { id: 'LAW_105', name: 'Cinta Kaz' },
  { id: 'SEC_201', name: 'Anakin Skywalker' },
  { id: 'SEC_079', name: 'Corrupt Politician' },
  { id: 'SEC_249', name: 'High Command Councilor' },
  { id: 'SEC_134', name: 'Hunting Assassin Droid' },
  { id: 'SEC_116', name: 'Nubian Star Skiff' },
  { id: 'SEC_063', name: 'Rotunda Senate Guards' },
  { id: 'SEC_029', name: 'Zam Wesell' },
  { id: 'LOF_162', name: 'Hunting Nexu' },
  { id: 'LOF_212', name: 'Life Wind Sage' },
  { id: 'LOF_118', name: 'Terentatek' },
  { id: 'JTL_107', name: 'Bunker Defender' },
  { id: 'JTL_081', name: 'First Order TIE Fighter' },
  { id: 'JTL_257', name: 'Flanking Fang Fighter' },
  { id: 'JTL_113', name: 'Homestead Militia' },
  { id: 'TWI_062', name: 'Daughter of Dathomir' },
  { id: 'TWI_081', name: 'Droid Commando' },
  { id: 'TWI_054', name: "Duchess's Champion" },
  { id: 'TWI_180', name: 'Separatist Commando' },
  { id: 'SHD_169', name: 'Clan Challengers' },
  { id: 'SHD_112', name: 'Gamorrean Retainer' },
  { id: 'SHD_247', name: 'Protector of the Throne' },
  { id: 'SHD_034', name: 'Supercommando Squad' },
  { id: 'SOR_065', name: 'Baze Malbus' },
  { id: 'SOR_114', name: 'Escort Skiff' },
  { id: 'SOR_249', name: 'Frontier AT-RT' },
  { id: 'SOR_211', name: 'Gamorrean Guards' },
  { id: 'SOR_159', name: 'Partisan Insurgent' },
  { id: 'SOR_048', name: 'Vigilant Honor Guards' },
  { id: 'TS26_20', name: '501st Veteran' },
  { id: 'SOR_082', name: "Emperor's Royal Guard" },
  { id: 'TWI_130', name: 'Bo-Katan Kryze' },
  { id: 'TWI_143', name: 'Jyn Erso' },
  { id: 'TS26_50', name: 'General Grievous' },
  { id: 'SEC_151', name: 'Kazuda Xiono' },
  { id: 'SEC_114', name: 'Kino Loy' },
  { id: 'SEC_108', name: "Senator's Aide" },
  { id: 'LOF_062', name: 'Axe Woves' },
  { id: 'LOF_083', name: 'Captain Enoch' },
  { id: 'LOF_049', name: 'Jedi Guardian' },
  { id: 'LOF_244', name: 'Jedi Vector' },
  { id: 'LOF_060', name: 'Padawan Starfighter' },
  { id: 'LOF_153', name: 'Paz Vizsla' },
  { id: 'LOF_233', name: 'Scimitar' },
  { id: 'LOF_081', name: 'Sith Legionnaire' },
  { id: 'JTL_115', name: 'Clone Combat Squadron' },
  { id: 'JTL_052', name: "D'Qar Cargo Frigate" },
  { id: 'JTL_256', name: 'Swarming Vulture Droid' },
  { id: 'TWI_142', name: "Anakin's Interceptor" },
  { id: 'TWI_163', name: 'Relentless Rocket Droid' },
  { id: 'SHD_042', name: 'Concord Dawn Interceptors' },
  { id: 'SHD_056', name: 'Follower of The Way' },
  { id: 'SHD_083', name: 'Seasoned Shoretrooper' },
  { id: 'SOR_118', name: '97th Legion' },
  { id: 'SOR_161', name: 'Ardent Sympathizer' },
  { id: 'LAW_139', name: 'Admiral Motti' },
  { id: 'SEC_047', name: 'Coronet' },
  { id: 'LOF_169', name: 'Invasion Control Ship' },
  { id: 'LOF_089', name: 'Supremacy' },
  { id: 'JTL_161', name: 'Captain Tarkin' },
  { id: 'JTL_085', name: 'Victor Leader' },
  { id: 'TWI_092', name: 'Admiral Yularen' },
  { id: 'SHD_188', name: '4-LOM' },
  { id: 'SHD_190', name: 'Zuckuss' },
  { id: 'SHD_037', name: 'Supreme Leader Snoke' },
  { id: 'SOR_079', name: 'Admiral Piett' },
  { id: 'SOR_242', name: 'General Dodonna' },
  { id: 'SOR_230', name: 'General Veers' },
  { id: 'SOR_144', name: 'Red Three' },
  { id: 'SOR_100', name: 'Wedge Antilles' },
  { id: 'TS26_40', name: 'Obi-Wan Kenobi' },
  { id: 'SEC_224', name: 'Vel Sartha' },
  { id: 'SOR_212', name: 'Strafing Gunship' },
  { id: 'LAW_110', name: 'Phoenix Squadron Fighters' },
  { id: 'JTL_163', name: 'AT-DP Occupier' },
  { id: 'JTL_204', name: 'Home One' },
  { id: 'TWI_197', name: 'Republic Attack Pod' },
  { id: 'TWI_098', name: 'Republic Defense Carrier' },
  { id: 'SOR_248', name: 'Volunteer Soldier' },
  { id: 'LAW_223', name: 'Rose Tico' },
  { id: 'LAW_210', name: 'Salacious Crumb' },
  { id: 'SEC_170', name: 'Corellian Hounds' },
  { id: 'SEC_135', name: 'Muckraker Crab Droid' },
  { id: 'SOR_198', name: 'Han Solo' },
  { id: 'SHD_234', name: 'Incinerator Trooper' },
  // When Played, other sets: deck searches
  { id: 'LAW_145', name: 'R2-D2' },
  { id: 'LAW_136', name: 'Syndicate Spice Runner' },
  { id: 'LAW_138', name: 'Undercity Hunting Team' },
  { id: 'LAW_229', name: 'The Master Codebreaker' },
  { id: 'SEC_112', name: 'Orn Free Taa' },
  { id: 'SHD_245', name: 'Greef Karga' },
  { id: 'SHD_198', name: 'Omega' },
  { id: 'SOR_084', name: 'Grand Moff Tarkin' },
  { id: 'SOR_181', name: 'Jabba the Hutt' },
  { id: 'SOR_096', name: 'Mon Mothma' },
  { id: 'LOF_100', name: 'Kelleran Beq' },
  { id: 'LAW_063', name: 'L3-37' },
  { id: 'SOR_087', name: 'Darth Vader' },
  // When Played, other sets: hands and named cards
  { id: 'SEC_239', name: 'Viper Probe Droid' },
  { id: 'SOR_201', name: 'Bodhi Rook' },
  { id: 'SOR_190', name: 'Lothal Insurgent' },
  { id: 'SHD_202', name: "Qi'ra" },
  { id: 'SOR_062', name: 'Regional Governor' },
  // When Played, other sets: resources
  { id: 'LAW_083', name: 'Broken Horn' },
  { id: 'JTL_164', name: 'Cham Syndulla' },
  { id: 'JTL_119', name: 'Resupply Carrier' },
  { id: 'SOR_189', name: 'Leia Organa' },
  // Constant abilities, other sets: the attacker's power while a unit defends
  { id: 'LAW_108', name: 'Lando Calrissian' },
  { id: 'JTL_054', name: 'Gold Leader' },
  { id: 'SEC_042', name: 'Cassian Andor' },
  // Constant abilities, other sets: combat-conditional keywords and attack variants
  { id: 'SOR_130', name: 'First Legion Snowtrooper' },
  { id: 'JTL_185', name: "Hound's Tooth" },
  { id: 'LAW_219', name: "Anakin's Podracer" },
  { id: 'SHD_219', name: 'Enfys Nest' },
  { id: 'JTL_259', name: 'Retrofitted Airspeeder' },
  // Constant abilities, other sets: keywords granted rather than printed
  { id: 'SHD_212', name: 'Privateer Scyk' },
  { id: 'LOF_132', name: 'Grand Inquisitor' },
  // Constant abilities, other sets: conditions on computed power or keywords
  { id: 'LOF_085', name: 'Praetorian Guard' },
  { id: 'JTL_137', name: "Vonreg's TIE Interceptor" },
  { id: 'SEC_032', name: "Kylo Ren's Command Shuttle" },
  { id: 'LOF_186', name: 'Marchion Ro' },
  // Constant abilities, other sets: units that can't attack
  { id: 'LOF_044', name: 'Loth-Wolf' },
  { id: 'JTL_059', name: 'Corporate Defense Shuttle' },
  // Constant abilities, other sets: damage prevention
  { id: 'SEC_067', name: 'Umbaran Mobile Cannon' },
  { id: 'LOF_108', name: 'Malakili' },
  // Constant abilities, other sets: cost rules
  { id: 'SEC_064', name: 'Congress of Malastare' },
  { id: 'LOF_058', name: 'Guardian of the Whills' },
  { id: 'SOR_034', name: 'Del Meeko' },
  { id: 'JTL_105', name: 'The Starhawk' },
  // Constant abilities, other sets: printed stats replaced
  { id: 'LAW_036', name: 'Obi-Wan Kenobi' },
  // Constant abilities, other sets: rule changes
  { id: 'TWI_132', name: 'Confederate Tri-Fighter' },
  { id: 'JTL_182', name: 'Rampart' },
  { id: 'TWI_042', name: 'Barriss Offee' },
  // When Played, other sets: TS26 and IBH, the two sets too small to sweep
  { id: 'TS26_15', name: 'C-3P0' },
  { id: 'TS26_19', name: 'Coleman Trebor' },
  { id: 'TS26_53', name: 'Coruscanti Spy' },
  { id: 'TS26_18', name: 'Jendirian Valley' },
  { id: 'TS26_16', name: 'King Katuunko' },
  { id: 'TS26_30', name: 'Maul' },
  { id: 'TS26_28', name: 'Prime Minister Almec' },
  { id: 'TS26_62', name: 'R2-D2' },
  { id: 'TS26_42', name: 'Relief Frigate' },
  { id: 'TS26_67', name: 'Ruping Rider' },
  { id: 'TS26_36', name: 'Tribunal' },
  { id: 'TS26_41', name: 'Twilight' },
  { id: 'IBH_72', name: 'Avenger' },
  { id: 'IBH_99', name: 'Blizzard One' },
  { id: 'IBH_19', name: 'C-3P0' },
  { id: 'IBH_68', name: 'General Veers' },
  { id: 'IBH_64', name: 'Hoth Lieutenant' },
  { id: 'IBH_20', name: 'Luke Skywalker' },
  { id: 'IBH_31', name: 'Millennium Falcon' },
  // When Played, other sets: attacks
  { id: 'LAW_065', name: '4-LOM' },
  { id: 'LAW_157', name: 'Target Tagger' },
  { id: 'SEC_103', name: 'Mon Mothma' },
  { id: 'LOF_111', name: 'Maz Kanata' },
  { id: 'TWI_091', name: 'Republic Tactical Officer' },
  { id: 'SHD_101', name: 'Adelphi Patrol Wing' },
  { id: 'SHD_236', name: 'Snowtrooper Lieutenant' },
  { id: 'SOR_240', name: 'Fleet Lieutenant' },
  // When Played, other sets: "you may pay N"
  { id: 'LAW_198', name: 'Dogged Pursuers' },
  { id: 'LAW_193', name: 'Mid Rim Sharpshooter' },
  { id: 'LAW_227', name: 'Rookie Rocket-jumper' },
  { id: 'LAW_113', name: 'Shield Drive Outfitter' },
  { id: 'LAW_148', name: "Smuggler's YT-2400" },
  { id: 'TWI_212', name: 'Freelance Assassin' },
  // When Played, other sets: two linked steps
  { id: 'SEC_184', name: 'ISB Agent' },
  { id: 'JTL_051', name: 'Red Squadron X-Wing' },
  { id: 'TWI_193', name: 'R2-D2' },
  { id: 'SOR_099', name: 'Bright Hope' },
  { id: 'SEC_165', name: 'Academy Disciplinarian' },
  { id: 'LAW_075', name: 'Interrogation Droid' },
  { id: 'JTL_201', name: 'Ahsoka Tano' },
  { id: 'SHD_049', name: 'The Mandalorian' },
  { id: 'LAW_093', name: 'Rio Durant' },
  { id: 'SEC_030', name: 'Death Trooper' },
  { id: 'SOR_097', name: 'Admiral Ackbar' },
  { id: 'LOF_037', name: 'Darth Vader' },
  // When Played, other sets: upgrades returned, moved or played
  { id: 'SEC_200', name: 'Junior Senator' },
  { id: 'SHD_209', name: 'Criminal Muscle' },
  { id: 'LAW_078', name: 'Sabine Wren' },
  { id: 'LOF_248', name: 'Jocasta Nu' },
  { id: 'LOF_150', name: 'Cin Drallig' },
  // When Played, other sets: lasting effects the buff choice cannot carry
  { id: 'LOF_191', name: 'BD-1' },
  { id: 'TWI_110', name: 'Huyang' },
  { id: 'LOF_211', name: 'Dooku' },
  { id: 'LOF_209', name: 'Tusken Tracker' },
  { id: 'SOR_140', name: 'SpecForce Soldier' },
  { id: 'TWI_067', name: 'The Zillo Beast' },
  { id: 'LOF_070', name: 'Anakin Skywalker' },
  // When Played, other sets: control and other zones
  { id: 'LAW_233', name: 'Galen Erso' },
  { id: 'SEC_192', name: 'Grand Moff Tarkin' },
  { id: 'TWI_211', name: 'Sly Moore' },
  { id: 'LAW_099', name: "Governor's Shuttle" },
  { id: 'TWI_252', name: 'Aggrieved Parliamentarian' },
  { id: 'SOR_183', name: 'Bounty Hunter Crew' },
  // When Played, other sets: a second ability outside When Played
  { id: 'LAW_058', name: 'Honor-Bound Partisan' },
  { id: 'LAW_091', name: 'Val' },
  { id: 'LOF_194', name: 'J-Type Nubian Starship' },
  { id: 'TWI_208', name: 'Favorable Delegate' },
  { id: 'TWI_185', name: 'Ziro the Hutt' },
  { id: 'SHD_080', name: 'Salacious Crumb' },
  { id: 'SOR_184', name: "Fett's Firespray" },
  { id: 'SEC_139', name: 'Miraj Scintel' },
  // When Played, other sets: several targets
  { id: 'LAW_183', name: 'B-Wing Skirmisher' },
  { id: 'SEC_169', name: 'AAT Incinerator' },
  { id: 'SEC_155', name: 'Alexsandr Kallus' },
  { id: 'LOF_167', name: 'Saesee Tiin' },
  { id: 'JTL_140', name: 'IG-2000' },
  { id: 'JTL_170', name: 'War Juggernaut' },
  { id: 'JTL_072', name: 'Wing Guard Security Team' },
  { id: 'SHD_047', name: 'The Armorer' },
  { id: 'LOF_147', name: "Kit Fisto's Aethersprite" },
  { id: 'SOR_135', name: 'Emperor Palpatine' },
  { id: 'SOR_052', name: 'Redemption' },
  { id: 'TWI_044', name: 'Kashyyyk Defender' },
]

/**
 * Groups shown on the setup screen: the plan above with every already-built unit lifted out into its
 * own "built" group. Derived so implementing a card needs no edit here.
 */
export const UNIT_GROUPS: UnitGroup[] = (() => {
  // The plan is ASH's, so only ASH's built units belong in it.
  const builtUnits = IMPLEMENTED_UNITS.filter(u => setOf(u.id) === 'ASH')
  const built = new Set(builtUnits.map(u => u.id))
  const plan = UNIT_PLAN.map(g => ({ ...g, units: g.units.filter(u => !built.has(u.id)) }))
  const keep = (id: string) => plan.find(g => g.id === id)!
  return [
    keep('keyword'),
    {
      id: 'built',
      name: 'Abilities built',
      status: 'done' as GroupStatus,
      note: 'Card abilities are implemented and covered by tests.',
      units: builtUnits.map(u => ({ id: u.id, name: u.name })),
    },
    keep('ready'),
    keep('mechanic'),
    keep('subsystem'),
    // A blocker group empties as its units get built; drop it rather than render an empty section.
  ].filter(g => g.id === 'built' || g.units.length > 0)
    // Status follows position, not a hand-maintained field: whichever blocker group is next up is
    // the one in progress, and clearing a group promotes the one behind it.
    .map((g, _i, all) => {
      if (g.status === 'done') return g
      const first = all.find(x => x.status !== 'done')
      return { ...g, status: (g === first ? 'in progress' : 'planned') as GroupStatus }
    })
})()

/** The card types counted separately on the setup panel, in the order they're displayed. */
export const CARD_TYPES = ['leaders', 'bases', 'units', 'upgrades', 'events', 'tokens'] as const
export type CardTypeKey = (typeof CARD_TYPES)[number]
export type TypeCounts = Record<CardTypeKey, number>

/**
 * Which block a set is listed under. `rotation` is the currently-legal cycle; `retired` sets have
 * rotated out; `out-of-cycle` products released outside the cycle altogether and are legal in a
 * different subset of formats.
 */
export type SetGroup = 'rotation' | 'retired' | 'out-of-cycle'

export interface SetProgress {
  /** SWU set code — the only set identifier the card data carries. */
  code: string
  group: SetGroup
  done: TypeCounts
  total: TypeCounts
}


/**
 * Printed card counts per set, from the SWUDB set listing (`cards/search?q=set:…`, normal variants
 * only), newest first within each group — the order the panel shows them in.
 *
 * TOKEN counts are NOT from that listing, which omits them. The API's own token data is too partial
 * to use: only `TSOR` and `TASH` exist at all, it holds no token *units* (Mandalorian, X-wing, …),
 * and some rows are findable by search but not by direct fetch. These counts are therefore recorded
 * from the printed cards — every set in the cycle prints Experience and Shield, plus its own
 * extras: Clone Trooper/Battle Droid (TWI), X-wing/TIE Fighter (JTL), Force (LOF),
 * Advantage/Mandalorian (ASH), Spy (SEC), Credit (LAW). The out-of-cycle products print none
 * of their own.
 *
 * IBH is counted by DISTINCT cards, not collector numbers: it reprints the same card at up to three
 * numbers (Blizzard Force AT-ST is #70, #89 and #103), so its 104 printed slots are 51 real cards,
 * and implementing one covers every printing of it.
 */
const SET_TOTALS: { code: string; group: SetGroup; total: TypeCounts }[] = [
  { code: 'ASH', group: 'rotation', total: { leaders: 18, bases: 8, units: 179, upgrades: 25, events: 34, tokens: 4 } },
  { code: 'LAW', group: 'rotation', total: { leaders: 18, bases: 12, units: 182, upgrades: 14, events: 38, tokens: 3 } },
  { code: 'SEC', group: 'rotation', total: { leaders: 18, bases: 8, units: 171, upgrades: 17, events: 50, tokens: 3 } },
  { code: 'LOF', group: 'rotation', total: { leaders: 18, bases: 12, units: 166, upgrades: 20, events: 48, tokens: 3 } },
  { code: 'JTL', group: 'rotation', total: { leaders: 18, bases: 13, units: 167, upgrades: 7, events: 57, tokens: 4 } },
  { code: 'TWI', group: 'retired', total: { leaders: 18, bases: 12, units: 150, upgrades: 19, events: 58, tokens: 4 } },
  { code: 'SHD', group: 'retired', total: { leaders: 18, bases: 8, units: 160, upgrades: 30, events: 46, tokens: 2 } },
  { code: 'SOR', group: 'retired', total: { leaders: 18, bases: 12, units: 148, upgrades: 14, events: 60, tokens: 2 } },
  { code: 'TS26', group: 'out-of-cycle', total: { leaders: 8, bases: 4, units: 41, upgrades: 8, events: 23, tokens: 0 } },
  { code: 'IBH', group: 'out-of-cycle', total: { leaders: 2, bases: 2, units: 35, upgrades: 0, events: 12, tokens: 0 } },
]

/**
 * Cards that already play correctly with no engine work: vanilla ones, and keyword-only ones whose
 * every keyword is implemented. This is the triage tool's rule (`bench/triage.ts`): strip parenthetical
 * reminder text and the declared keywords, and anything left is a real ability. IBH is counted by
 * distinct card, so its reprints aren't double-counted.
 *
 * Recorded rather than computed, because computing it means shipping every set's fixture in the app.
 * `implementedCards.test.ts` triages each set's fixture and fails if any count here differs, so when a
 * keyword lands and cards move over, the test names the new numbers. It also fails if a built card is
 * counted here as well.
 *
 * LEADERS ARE EXCLUDED: every leader has a deployed-side ability, and reading only `FrontText` would
 * wrongly pass one whose front is blank (ASH's Grogu). A card carrying an unimplemented keyword is never
 * credited, even when it is otherwise vanilla.
 */
export const PLAYABLE_AS_PRINTED: Record<string, Partial<TypeCounts>> = {
  ASH: { bases: 8, units: 39 },
  LAW: { units: 47 },
  SEC: { bases: 8, units: 32 },
  LOF: { units: 46 },
  JTL: { bases: 9, units: 22 },
  TWI: { bases: 8, units: 22 },
  SHD: { bases: 8, units: 23, upgrades: 1 },
  SOR: { bases: 8, units: 29, upgrades: 2 },
  TS26: { units: 5, upgrades: 1 },
  IBH: { bases: 2, units: 19 },
}

/**
 * Tokens the engine creates, per set. ASH counts Shield, Advantage and Mandalorian; Experience is
 * printed but no card grants it, so ASH reads 3 of 4.
 */
const TOKENS_BUILT: Record<string, number> = { ASH: 3 }

/** The set a card id belongs to: the code before its underscore (`TS26_012` is TS26). */
export function setOf(id: string): string {
  return id.slice(0, id.indexOf('_'))
}

/** The built cards, by the card type the panel counts them under. */
export interface Manifest {
  leaders: LeaderStatus[]
  units: UpgradeStatus[]
  upgrades: UpgradeStatus[]
  events: UpgradeStatus[]
}

export const IMPLEMENTED: Manifest = {
  leaders: IMPLEMENTED_LEADERS,
  units: IMPLEMENTED_UNITS,
  upgrades: IMPLEMENTED_UPGRADES,
  events: IMPLEMENTED_EVENTS,
}

/**
 * What's implemented in one set: the cards that play as printed, plus every built card whose id is
 * in the set. A leader counts once both sides are built. A reprint of a built card (`data/reprints.ts`)
 * counts for each set that prints it, under its own id, since one implementation plays every printing.
 */
export function implementedCounts(code: string, manifest: Manifest, reprints: readonly Reprint[] = REPRINTS): TypeCounts {
  const inSet = (cards: { id: string }[]): number => {
    const ids = cards.map(c => c.id)
    const printings = reprints.filter(r => ids.includes(r.canonical)).flatMap(r => r.printings)
    return [...ids, ...printings].filter(id => setOf(id) === code).length
  }
  const playable = PLAYABLE_AS_PRINTED[code] ?? {}
  return {
    leaders: (playable.leaders ?? 0) + inSet(manifest.leaders.filter(l => l.front && l.back)),
    bases: playable.bases ?? 0,
    units: (playable.units ?? 0) + inSet(manifest.units),
    upgrades: (playable.upgrades ?? 0) + inSet(manifest.upgrades),
    events: (playable.events ?? 0) + inSet(manifest.events),
    tokens: TOKENS_BUILT[code] ?? 0,
  }
}

export const SET_PROGRESS: SetProgress[] = SET_TOTALS.map(({ code, group, total }) => ({
  code,
  group,
  total,
  done: implementedCounts(code, IMPLEMENTED),
}))

/** Sum a set's counts across every card type. */
export function sumCounts(counts: TypeCounts): number {
  return CARD_TYPES.reduce((n, t) => n + counts[t], 0)
}

/** Every set combined — the headline progress figure. */
export const TOTAL_PROGRESS = {
  done: SET_PROGRESS.reduce((n, s) => n + sumCounts(s.done), 0),
  total: SET_PROGRESS.reduce((n, s) => n + sumCounts(s.total), 0),
}
