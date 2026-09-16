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
  { name: 'Hunting Nexu', canonical: 'LOF_162', printings: ['SHD_168'] },
  { name: 'Padawan Starfighter', canonical: 'LOF_060', printings: ['TWI_058'] },
  { name: 'Seasoned Shoretrooper', canonical: 'SHD_083', printings: ['SOR_081'] },
  { name: 'Volunteer Soldier', canonical: 'SOR_248', printings: ['TWI_254'] },
  { name: 'Viper Probe Droid', canonical: 'SEC_239', printings: ['SOR_228'] },
  { name: 'Guardian of the Whills', canonical: 'LOF_058', printings: ['SOR_061'] },
]

const BY_PRINTING: Record<string, string> = Object.fromEntries(
  REPRINTS.flatMap(({ canonical, printings }) => printings.map(id => [id, canonical])),
)

/** The implemented printing's id for a reprint, or undefined if the id is not one. */
export function reprintCanonicalId(id: string): string | undefined {
  return BY_PRINTING[id]
}
