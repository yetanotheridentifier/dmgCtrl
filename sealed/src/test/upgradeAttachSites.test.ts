import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every place the engine appends to a unit's upgrades, counted per file.
 *
 * **Playing an upgrade has one door**, `playUpgradeCardOnto` in `resolve.ts`: it attaches the card, records
 * it as played (for the phase and on the unit for the round), fires the host's attach reactions together
 * with the upgrade's own When Played, and runs the unique check. A play that appends to the host by hand
 * skips some of that, silently, and that shape of defect was found three times over (a free replay, a deck
 * search, a play from resources, a free top card) before the last copy was routed through the door.
 *
 * So a new append fails here, and whoever adds it has to decide which kind it is:
 *
 * - **a play** (from any zone, paid or free): call `playUpgradeCardOnto` (or `playUpgradeOnto` from hand)
 *   instead, and this count does not change;
 * - **an attach that is not a play** (a token given by an effect, a Shield on entry, an upgrade moved from
 *   one unit to another): raise the count below, and fire the host's attach reactions if the rules say so.
 *
 * Counting text is crude, and deliberately so: it catches the one thing it is for without knowing anything
 * about how an append is written beyond the spread.
 */

const DIR = 'src/engine'
const APPEND = /\[\.\.\.\w+\.upgrades,/g

/** The known appends. Each is named, so a change of count names what to look at. */
const EXPECTED: Record<string, number> = {
  'effects.ts': 1, // giveTokens: token upgrades given by an effect (fires the attach reaction, not "played")
  'resolve.ts': 2, // playUpgradeCardOnto (the door), and applyEntryKeywords' Shield on a Shielded unit entering
  'cardDefinitions.ts': 1, // Jocasta Nu moving an upgrade to a different unit
}

describe('upgrade attach sites', () => {
  const found: Record<string, number> = {}
  for (const f of readdirSync(join(process.cwd(), DIR)).filter(f => f.endsWith('.ts'))) {
    const n = readFileSync(join(process.cwd(), DIR, f), 'utf8').match(APPEND)?.length ?? 0
    if (n > 0) found[f] = n
  }

  it('finds the door, so a silent pass is impossible', () => {
    expect(readFileSync(join(process.cwd(), DIR, 'resolve.ts'), 'utf8')).toContain('function playUpgradeCardOnto(')
  })

  it('appends to a unit\'s upgrades only at the known sites (a play goes through playUpgradeCardOnto)', () => {
    expect(found).toEqual(EXPECTED)
  })

  it('records an upgrade as played on its host in one place', () => {
    const writes = readdirSync(join(process.cwd(), DIR))
      .filter(f => f.endsWith('.ts'))
      .flatMap(f => readFileSync(join(process.cwd(), DIR, f), 'utf8').match(/upgradesPlayedThisRound: \(/g) ?? [])
    expect(writes).toHaveLength(1)
  })
})
