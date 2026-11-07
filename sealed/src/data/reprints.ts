/**
 * Cross-set reprints: one card, several sets, one implementation.
 *
 * Within a set, every printing of a card collapses onto its Normal id (`printings.ts`). Across sets
 * a reprint is a different id entirely, and the reprint is already a Normal printing, so that join
 * can never reach it. Everything the engine keys by card id (the ability registry,
 * `cardDataCorrections`, `upgradeStatOverrides`, the unique rule) is written against one printing,
 * so the others played as vanilla cards: SEC_258 Grassroots Resistance did nothing at all, and
 * SOR_112 Consortium StarViper granted Restore 2 unconditionally because the correction that makes
 * it conditional is written against ASH_122.
 *
 * The table is declared, not generated, because sets are added as they are released rather than
 * discovered at runtime. **Extending it is one line**: name the card, the id whose behaviour the
 * engine implements, and the other sets' Normal ids. `npm run bench --prefix sealed -- --triage
 * <SETS>` lists cards printed in more than one set and marks the ones missing here.
 *
 * Only Normal ids belong in `printings`: a variant printing reaches its set's Normal id through the
 * within-set tier first, so one line per set covers every printing of the card in it.
 */

export interface Reprint {
  /** The card's name, checked against the set listing so a mistyped id cannot pass unnoticed. */
  name: string
  /** The id every printing of this card canonicalises to: the one the engine implements. */
  canonical: string
  /** The same card's Normal id in each other set. */
  printings: string[]
}

export const REPRINTS: Reprint[] = [
  { name: 'Consortium StarViper', canonical: 'ASH_122', printings: ['SOR_112'] },
  { name: 'Inspired Recruit', canonical: 'ASH_152', printings: ['LAW_180'] },
  { name: 'Grassroots Resistance', canonical: 'ASH_258', printings: ['SEC_258'] },
  { name: 'Open Fire', canonical: 'SOR_172', printings: ['TWI_174'] },
  { name: 'Daring Raid', canonical: 'SHD_178', printings: ['TWI_170'] },
  { name: 'Vanquish', canonical: 'SOR_078', printings: ['TWI_077'] },
  { name: 'Confiscate', canonical: 'SOR_251', printings: ['SHD_262'] },
  { name: 'Repair', canonical: 'SOR_074', printings: ['JTL_075'] },
  { name: 'Waylay', canonical: 'SOR_222', printings: ['TWI_226'] },
  { name: 'Tactical Advantage', canonical: 'SOR_124', printings: ['TWI_124'] },
  { name: 'Surprise Strike', canonical: 'SOR_220', printings: ['SHD_231'] },
  { name: 'Patrolling V-Wing', canonical: 'SOR_111', printings: ['TWI_107'] },
  { name: 'Cargo Juggernaut', canonical: 'SOR_068', printings: ['SHD_066'] },
  { name: 'Disabling Fang Fighter', canonical: 'SOR_162', printings: ['SHD_166'] },
  { name: 'Homestead Militia', canonical: 'JTL_113', printings: ['SOR_113'] },
  { name: 'Street Gang Recruiter', canonical: 'SHD_260', printings: ['LAW_261'] },
  { name: 'Hunting Nexu', canonical: 'LOF_162', printings: ['SHD_168'] },
  { name: 'Padawan Starfighter', canonical: 'LOF_060', printings: ['TWI_058'] },
  { name: 'Seasoned Shoretrooper', canonical: 'SHD_083', printings: ['SOR_081'] },
  { name: 'Volunteer Soldier', canonical: 'SOR_248', printings: ['TWI_254'] },
  { name: 'Viper Probe Droid', canonical: 'SEC_239', printings: ['SOR_228'] },
  { name: 'Guardian of the Whills', canonical: 'LOF_058', printings: ['SOR_061'] },
  { name: 'Snowtrooper Lieutenant', canonical: 'SHD_236', printings: ['SOR_227'] },
  { name: 'Snapshot Reflexes', canonical: 'SOR_215', printings: ['SHD_223'] },
  { name: 'ISB Agent', canonical: 'SEC_184', printings: ['SOR_176'] },
  { name: 'Death Trooper', canonical: 'SEC_030', printings: ['SHD_030', 'SOR_033', 'IC27_017'] },
  { name: 'Pounce', canonical: 'LOF_224', printings: ['HMW_239'] },
  { name: 'Devotion', canonical: 'SOR_070', printings: ['HMW_096'] },
  { name: 'General Tagge', canonical: 'SHD_081', printings: ['SOR_080'] },
  { name: 'Outflank', canonical: 'TWI_123', printings: ['SHD_128'] },
  { name: 'Prepare for Takeoff', canonical: 'JTL_128', printings: ['SOR_125'] },
  { name: 'Resupply', canonical: 'TWI_127', printings: ['SOR_126'] },
  { name: 'Rickety Quadjumper', canonical: 'LAW_115', printings: ['SHD_057'] },
  { name: 'Take Captive', canonical: 'SHD_131', printings: ['TWI_128'] },
  // Not Superlaser Technician: SOR_083 is 2/1 and SHD_085 is 2/3, so they are two cards.
  // IC27 reprints cards from every earlier set.
  { name: 'Onyx Squadron Brute', canonical: 'JTL_033', printings: ['IC27_015'] },
  { name: 'Rune Haako', canonical: 'TWI_031', printings: ['IC27_016'] },
  { name: 'Admiral Piett', canonical: 'IBH_60', printings: ['IC27_020'] },
  { name: 'Blizzard One', canonical: 'IBH_99', printings: ['IC27_025'] },
  { name: 'AT-AT Suppressor', canonical: 'SOR_039', printings: ['IC27_027'] },
  { name: 'Avenger', canonical: 'IBH_72', printings: ['IC27_028'] },
  { name: 'Lethal Crackdown', canonical: 'TWI_041', printings: ['IC27_030'] },
  { name: 'Luke Skywalker', canonical: 'IBH_20', printings: ['IC27_082'] },
  { name: 'Inspiring Mentor', canonical: 'SHD_104', printings: ['IC27_085'] },
  { name: 'General Veers', canonical: 'IBH_68', printings: ['IC27_105'] },
  { name: 'Savage Opress', canonical: 'TWI_137', printings: ['IC27_108'] },
  { name: 'DRK-1 Probe Droid', canonical: 'LOF_155', printings: ['IC27_129'] },
  { name: 'Grogu', canonical: 'SHD_196', printings: ['IC27_154'] },
  { name: 'Han Solo', canonical: 'IBH_10', printings: ['IC27_161'] },
  { name: 'Millennium Falcon', canonical: 'IBH_31', printings: ['IC27_164'] },
  { name: 'Shoot First', canonical: 'SOR_217', printings: ['IC27_175'] },
  { name: 'HK-87 Assassin Droid', canonical: 'LOF_235', printings: ['IC27_182'] },
  { name: 'Consumed by the Dark Side', canonical: 'LOF_239', printings: ['IC27_184'] },
  { name: 'I Am Your Father', canonical: 'SOR_233', printings: ['IC27_185'] },
  { name: 'R2-D2', canonical: 'SOR_236', printings: ['IC27_186'] },
  { name: 'C-3P0', canonical: 'SOR_238', printings: ['IC27_188'] },
  { name: 'Dilapidated Ski Speeder', canonical: 'JTL_248', printings: ['IC27_190'] },
  { name: 'Medical Frigate', canonical: 'LOF_250', printings: ['IC27_191'] },
]

const BY_PRINTING: Record<string, string> = Object.fromEntries(
  REPRINTS.flatMap(({ canonical, printings }) => printings.map(id => [id, canonical])),
)

/** The implemented printing's id for a reprint, or undefined if the id is not one. */
export function reprintCanonicalId(id: string): string | undefined {
  return BY_PRINTING[id]
}
