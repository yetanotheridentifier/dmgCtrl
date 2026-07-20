/**
 * Implementation manifest — the cards whose abilities are built into the engine, shown as a
 * reference on the setup screen. Kept in step with the ability registry by a test
 * (`implementedCards.test.ts`) that asserts these ids exactly match the registered ASH cards.
 *
 * Leaders are two-sided: `front` = the undeployed leader ability, `back` = the deployed
 * (leader-unit) ability. A `false` marks a side still to come (see the ability-framework doc).
 */

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
]

/**
 * Unit cards whose *abilities* are built into the engine. Keyword-only / vanilla units aren't here —
 * they need no definition and are counted separately. Grouped by the mechanic each ability uses.
 */
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
]

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
]

/**
 * Groups shown on the setup screen: the plan above with every already-built unit lifted out into its
 * own "built" group. Derived so implementing a card needs no edit here.
 */
export const UNIT_GROUPS: UnitGroup[] = (() => {
  const built = new Set(IMPLEMENTED_UNITS.map(u => u.id))
  const plan = UNIT_PLAN.map(g => ({ ...g, units: g.units.filter(u => !built.has(u.id)) }))
  const keep = (id: string) => plan.find(g => g.id === id)!
  return [
    keep('keyword'),
    {
      id: 'built',
      name: 'Abilities built',
      status: 'done' as GroupStatus,
      note: 'Card abilities are implemented and covered by tests.',
      units: IMPLEMENTED_UNITS.map(u => ({ id: u.id, name: u.name })),
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

const NONE: TypeCounts = { leaders: 0, bases: 0, units: 0, upgrades: 0, events: 0, tokens: 0 }

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
 * every keyword is implemented (Ambush, Grit, Hidden, Overwhelm, Raid, Restore, Saboteur, Sentinel,
 * Shielded, Support). Counted from the SWUDB set listings by the same rule `keywordOnlyUnits.test.ts`
 * applies — strip parenthetical reminder text and the declared keywords, and anything left is a real
 * ability. IBH is counted by distinct card, so its reprints aren't double-counted.
 *
 * LEADERS ARE EXCLUDED: every leader has a deployed-side ability, and reading only `FrontText` would
 * wrongly pass one whose front is blank (ASH's Grogu).
 *
 * The unimplemented keywords across the card data are Bounty (SHD, TS26), Coordinate and Exploit
 * (TWI), Piloting (JTL), Plot (SEC, TS26) and Smuggle (SHD). A card carrying any of them is never
 * credited. 12 are otherwise vanilla and held back purely by the keyword — 6 on Plot, 6 on Exploit —
 * and would move over if those landed. ASH uses none of them, so no registered card is affected.
 */
const PLAYABLE_AS_PRINTED: Record<string, Partial<TypeCounts>> = {
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
 * What's implemented, per set: the cards that play as printed, plus — for ASH — every card with a
 * registered ability. Tokens count the three the engine actually creates; Experience is printed but
 * no card grants it, so ASH reads 3 of 4.
 */
const IMPLEMENTED_BY_SET: Record<string, TypeCounts> = {
  ...Object.fromEntries(SET_TOTALS.map(({ code }) => [code, { ...NONE, ...PLAYABLE_AS_PRINTED[code] }])),
  ASH: {
    leaders: IMPLEMENTED_LEADERS.filter(l => l.front && l.back).length,
    bases: 8,
    units: (UNIT_GROUPS.find(g => g.id === 'keyword')?.units.length ?? 0) + IMPLEMENTED_UNITS.length,
    upgrades: IMPLEMENTED_UPGRADES.length,
    events: IMPLEMENTED_EVENTS.length,
    tokens: 3,
  },
}

export const SET_PROGRESS: SetProgress[] = SET_TOTALS.map(({ code, group, total }) => ({
  code,
  group,
  total,
  done: IMPLEMENTED_BY_SET[code] ?? NONE,
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
