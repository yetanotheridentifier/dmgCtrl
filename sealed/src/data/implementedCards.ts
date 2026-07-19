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

/**
 * The 179 ASH unit cards, split into work groups by effort (least → most) for #306. Group A needs
 * no engine work; B–F are the split-out tickets (#353–#357). Counts are approximate — a few
 * multi-ability cards straddle groups. Descriptive only (no per-card drift-guard yet).
 */
export interface UnitGroup {
  id: string
  name: string
  status: GroupStatus
  note: string
  /** The specific unit cards in this group (approximate — a few multi-ability cards straddle groups). */
  units: string[]
}

export const UNIT_GROUPS: UnitGroup[] = [
  {
    id: 'A',
    name: 'No engine work (vanilla + keyword-only)',
    status: 'done',
    note: 'Vanilla + keyword-only. Every keyword in the set is already implemented, so these play correctly as printed — validated by groupAUnits.test.ts.',
    units: [
      'Alamite Hunter', 'Blurrg', 'Covert Veteran', 'Death Trooper Squad', 'Defenders of the Forest', 'Dinosaur Turtle',
      'Emperor\'s Champion', 'Ewok Warrior', 'Fang Fighter Squadron', 'Fennec Shand', 'Flanking TIE Interceptor', 'Forest Patroller',
      'Honorable Nite Owl', 'Imperial Armored Commando', 'Imperial Loyalist', 'Inspired Recruit', 'Mos Eisley Modifier', 'N5 Sentry Droid',
      'Noti Mobile Pod', 'Noti Nomad', 'Open Circle Ace', 'Outland Protector', 'Pathfinder Sergeant', 'Peridea Bandit',
      'Praetorian Elite', 'Rebel Infiltrators', 'Remnant Interceptor', 'Remnant Official', 'Remnant Trooper Corps', 'Scorpenek Annihilator Droid',
      'Shydopp Pirate Skiff', 'Strike Team Vanguard', 'Survivors\' Langskib', 'TIE Striker', 'Tatooine Sand Beast', 'Tempest Lieutenant',
      'Unsanctioned Patrol', 'Womp Rat', 'Wookiee Chieftain',
    ],
  },
  {
    id: 'B',
    name: 'Conditional self buffs (“While X …”)',
    status: 'in progress',
    note: 'Grant this unit a keyword or stat while a condition holds. Reuses conditionalKeywords + statModifier. (#353)',
    units: [
      'AT-ST Raider', 'B-Wing Rearguard', 'Bo-Katan Kryze', 'Captain Pellaeon', 'Carson Teva', 'Consortium StarViper',
      'Darth Vader', 'Elzar Mann', 'Heroic Purrgil', 'Koska Reeves', 'Lothal E-Wing', 'Mandalorian Flagship',
      'Mandalorian Super Commandos', 'Marrok', 'Scion Shuttle', 'Shin Hati', 'Stolen Eta Shuttle', 'Warrior of Clan Kryze',
    ],
  },
  {
    id: 'C',
    name: 'Constant effects on other units (auras)',
    status: 'done',
    note: 'Buff or strip keywords on other units. Reuses the aura hook. (#354)',
    units: ['Domesticated Loth-Cat', 'Gallius Rax', 'Onyx Cinder', 'Poe Dameron'],
  },
  {
    id: 'D',
    name: 'When Played effects',
    status: 'in progress',
    note: 'The largest bucket; mostly reuses existing effect primitives (damage / tokens / heal / draw). (#355)',
    units: [
      'Admiral Ackbar', 'Amnesty Officer', 'Anakin Skywalker', 'Attendant Navigator', 'Barriss Offee', 'Battered Haulcraft',
      'Baylan Skoll', 'Boba Fett\'s Rancor', 'Children of the Watch', 'Chimaera', 'Clan Wren Loyalist', 'Crix Madine',
      'Desert Sharpshooter', 'Ferry Droid', 'Flarestar Attack Shuttle', 'Han Solo', 'Helix Starfighter', 'Home One',
      'Imperial Defector', 'Imposing Scout Walker', 'Inspiring Veteran', 'Jabba the Hutt', 'Jod Na Nawood', 'Justifier',
      'Knobby White Ice Spider', 'LEP Ratcatcher', 'Luke Skywalker', 'Mos Espa Watermonger', 'Mouse Droid', 'Nebulon-C Frigate',
      'Neel', 'Ninth Sister', 'Pegasus Tri-Wing', 'Pre Vizsla', 'Protectorate Fighter', 'Purrgil Ultra', 'Queen Soruna',
      'Reinforcing Light Cruiser', 'Remnant Lookouts', 'Ryder Azadi', 'Snub Fighter Squadron', 'StarFortress Heavy Bomber',
      'The Armorer', 'The Cyborg Mech', 'The Twins', 'Trask Walker', 'Trexler Armored Marauder', 'Zealous Soldier', 'Zeb Orrelios',
    ],
  },
  {
    id: 'E',
    name: 'When Defeated / On Attack / Action',
    status: 'planned',
    note: 'Reuses the whenDefeated / onAttack / actionAbilities hooks. (#356)',
    units: [
      '8D8', 'Ant Droid', 'Axe Woves', 'Blade Three', 'Clan Vizsla Soldier', 'Cobb Vanth', 'Corona Four', 'Covert Believers',
      'Danger Squadron Wingmen', 'Doctor Pershing', 'Duchess\'s Protector', 'Emperor\'s Messenger', 'Enoch', 'Eye of Sion',
      'Ezra Bridger', 'Gallofree Transport', 'Gar Saxon', 'Gozanti Assault Carrier', 'Greef Karga', 'Green Leader', 'Grogu',
      'Helgait', 'Huyang', 'Lang', 'Leia Organa', 'Mandalorian Scout', 'Mando\'s N-1 Starfighter', 'Mayor\'s Majordomo',
      'Migs Mayfeld', 'Moff Gideon', 'Morgan Elsbeth', 'Mortar Trooper', 'Paz Vizsla', 'R5-D4', 'Ravager', 'Razor Crest',
      'Reanimated Night Trooper', 'Shin Hati\'s Fiend Fighter', 'Summa-verminoth', 'T-6 Shuttle 1974', 'Yellow Aces Bomber',
    ],
  },
  {
    id: 'F',
    name: 'Unique abilities & new mechanics',
    status: 'planned',
    note: 'The long tail — new triggers, targeting rules, and a damage-prevention layer. (#357)',
    units: [
      'Alphabet Squadron U-Wing', 'At Attin Safety Droid', 'Bo-Katan\'s Gauntlet', 'Bothan-5', 'Eviscerator', 'Executor',
      'Gorian Shard\'s Corsair', 'Grand Admiral Thrawn', 'Halo', 'Hera Syndulla', 'Kachirho Militia', 'Kelleran Beq',
      'Marrok\'s Fiend Fighter', 'Moff Jerjerrod', 'Outcast', 'Palace Chef Droid', 'Peli Motto', 'Pit Droid Team', 'Qi\'ra',
      'Rancor Keeper', 'Red Leader', 'Rukh', 'Sabine Wren', 'Tatooine Repulsor Train', 'The Great Mothers', 'The Mandalorian',
      'Vane\'s Snub Fighter', 'Wicket',
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
 * Unit cards whose *abilities* are built into the engine (#306). Keyword-only / vanilla units
 * (Group A) aren't here — they need no definition and are counted separately. Grows group by group.
 */
export const IMPLEMENTED_UNITS: UpgradeStatus[] = [
  // Group B1 (#353) — conditional self keyword grants
  { id: 'ASH_098', name: 'AT-ST Raider' },
  { id: 'ASH_078', name: 'B-Wing Rearguard' },
  { id: 'ASH_105', name: 'Bo-Katan Kryze' },
  { id: 'ASH_093', name: 'Captain Pellaeon' },
  { id: 'ASH_122', name: 'Consortium StarViper' },
  { id: 'ASH_243', name: 'Darth Vader' },
  { id: 'ASH_057', name: 'Lothal E-Wing' },
  { id: 'ASH_049', name: 'Shin Hati' },
  { id: 'ASH_120', name: 'Warrior of Clan Kryze' },
  // Group B2 (#353) — conditional stat buffs
  { id: 'ASH_240', name: 'Mandalorian Super Commandos' },
  { id: 'ASH_125', name: 'Stolen Eta Shuttle' },
  { id: 'ASH_113', name: 'Mandalorian Flagship' },
  // Group B3 (#353) — conditional keyword swap
  { id: 'ASH_030', name: 'Marrok' },
  // Group C (#354) — auras / constant effects on other units
  { id: 'ASH_177', name: 'Onyx Cinder' },
  { id: 'ASH_100', name: 'Gallius Rax' },
  { id: 'ASH_068', name: 'Domesticated Loth-Cat' },
  { id: 'ASH_040', name: 'Poe Dameron' },
  // Group D (#355) — "When Played" effects — D1: self / no-target
  { id: 'ASH_218', name: 'Ferry Droid' },
  { id: 'ASH_251', name: 'Zealous Soldier' },
  { id: 'ASH_178', name: 'Knobby White Ice Spider' },
  { id: 'ASH_221', name: 'Helix Starfighter' },
  { id: 'ASH_111', name: 'Children of the Watch' },
  { id: 'ASH_124', name: 'Protectorate Fighter' },
  { id: 'ASH_065', name: 'Home One' },
  { id: 'ASH_064', name: 'The Armorer' },
  // D2: single target
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
  // D3: multi-step
  { id: 'ASH_071', name: 'Battered Haulcraft' },
  { id: 'ASH_158', name: 'Han Solo' },
  { id: 'ASH_112', name: 'Luke Skywalker' },
  { id: 'ASH_176', name: 'Imposing Scout Walker' },
  // D4: generalised next-unit grants
  { id: 'ASH_237', name: 'Mouse Droid' },
  { id: 'ASH_248', name: 'Neel' },
  // Multi-target pick (#355 UI)
  { id: 'ASH_205', name: 'Inspiring Veteran' },
  { id: 'ASH_053', name: 'Pre Vizsla' },
  // Discard from hand (#355 UI)
  { id: 'ASH_260', name: 'Mos Espa Watermonger' },
  // Opponent discard + distribute damage (#355 UI)
  { id: 'ASH_148', name: 'Ninth Sister' },
  // Look at opponent's hand (#355 UI)
  { id: 'ASH_250', name: 'Imperial Defector' },
  { id: 'ASH_220', name: 'Remnant Lookouts' },
  // Search top 5 for a trait match (#355 UI)
  { id: 'ASH_107', name: 'Clan Wren Loyalist' },
  // Play a discounted unit from hand (#355 UI)
  { id: 'ASH_108', name: 'Crix Madine' },
  // Self-defeat + search top 10, play space units free (#355 UI)
  { id: 'ASH_110', name: 'Admiral Ackbar' },
  // Name a card (#355 UI)
  { id: 'ASH_077', name: 'Ryder Azadi' },
  // Modal / variable damage & heal (#355 UI)
  { id: 'ASH_147', name: 'The Cyborg Mech' },
  { id: 'ASH_044', name: 'Barriss Offee' },
  // Group E (#356) — whenDefeated
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
]

/** Card-type totals for the ASH set (from the SWUDB set listing). */
const SET_TOTAL = { leaders: 18, upgrades: 25, bases: 8, units: 179, events: 34 } as const

// Tokens actually created/used by cards: Shield + Advantage (upgrades) + Mandalorian (unit). The
// Experience token upgrade is defined but no card grants it yet — deferred until one needs it (#306).
const TOKEN_COUNT = 3

export interface CategoryProgress {
  label: string
  done: number
  total: number
}

/** Fully-implemented cards vs the whole set, by category — feeds the setup-screen progress bar (#306). */
export const IMPLEMENTATION_PROGRESS: CategoryProgress[] = [
  { label: 'Leaders', done: IMPLEMENTED_LEADERS.filter(l => l.front && l.back).length, total: SET_TOTAL.leaders },
  { label: 'Upgrades', done: IMPLEMENTED_UPGRADES.length, total: SET_TOTAL.upgrades },
  { label: 'Bases', done: SET_TOTAL.bases, total: SET_TOTAL.bases }, // all vanilla — fully playable
  { label: 'Tokens', done: TOKEN_COUNT, total: TOKEN_COUNT },
  // Units done = keyword-only/vanilla units (Group A, need no code) + units with a registered ability.
  { label: 'Units', done: (UNIT_GROUPS.find(g => g.id === 'A')?.units.length ?? 0) + IMPLEMENTED_UNITS.length, total: SET_TOTAL.units },
  { label: 'Events', done: 0, total: SET_TOTAL.events },
]

/** Whole-set implementation total (tokens included) — the headline progress figure. */
export const TOTAL_PROGRESS = {
  done: IMPLEMENTATION_PROGRESS.reduce((n, c) => n + c.done, 0),
  total: IMPLEMENTATION_PROGRESS.reduce((n, c) => n + c.total, 0),
}
