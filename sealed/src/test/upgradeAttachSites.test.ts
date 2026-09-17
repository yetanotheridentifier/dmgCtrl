import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the engine puts an upgrade on a unit, checked from the source.
 *
 * **Attaching has one write**, `attachUpgrades` in `effects.ts`, and **playing has one door**,
 * `playUpgradeCardOnto` in `resolve.ts`, which attaches through it and also records the card as played,
 * fires the host's attach reactions together with the upgrade's own When Played, and runs the unique
 * check. A play or a move that appended to the host by hand skipped some of that, silently, and that shape
 * of defect was found four times over (a free replay, a deck search, a play from resources, a free top
 * card, a move between units) before every site went through the one write.
 *
 * So a new hand-built append fails the first test, and a new `attachUpgrades` call fails the second until
 * whoever adds it decides which kind it is:
 *
 * - **a play** (from any zone, paid or free): call `playUpgradeCardOnto` (or `playUpgradeOnto` from hand)
 *   instead, and nothing here changes;
 * - **an attach that is not a play** (a token given by an effect, a Shield on entry, an upgrade moved from
 *   one unit to another): add it to the list below, and fire the host's attach reactions without
 *   `upgradePlayed` (tokens are created, CR 3.7.2; a move detaches and attaches, CR 3.6.14).
 *
 * Counting text is crude, and deliberately so: it catches the one thing it is for without knowing anything
 * about how an append is written beyond the spread.
 */

const DIR = 'src/engine'
const APPEND = /\[\.\.\.\w+\.upgrades,/g
const ATTACH = /(?<!function )\battachUpgrades\(/g

/** Every attach, named, so a change of count names what to look at. */
const EXPECTED_ATTACHES: Record<string, number> = {
  // giveTokens (many of one kind) and giveMixedTokens (one each of several kinds, for "give an
  // Experience token and a Shield token to it"): token upgrades given by an effect, each attaching its
  // whole grant in one call so the attach reaction fires once, and neither is a play.
  'effects.ts': 2,
  'resolve.ts': 2, // playUpgradeCardOnto (the door, the one "played"), and applyEntryKeywords' Shield on a Shielded unit entering
  'cardDefinitions.ts': 1, // moveUpgrade: Jocasta Nu and Evidence of the Crime moving an upgrade (fires the attach reaction, not "played")
}

const sources = readdirSync(join(process.cwd(), DIR))
  .filter(f => f.endsWith('.ts'))
  .map(f => ({ f, text: readFileSync(join(process.cwd(), DIR, f), 'utf8') }))
const perFile = (re: RegExp): Record<string, number> =>
  Object.fromEntries(sources.flatMap(({ f, text }) => {
    const n = text.match(re)?.length ?? 0
    return n > 0 ? [[f, n]] : []
  }))

describe('upgrade attach sites', () => {
  it('finds the door and the write, so a silent pass is impossible', () => {
    const text = (f: string) => sources.find(s => s.f === f)!.text
    expect(text('resolve.ts')).toContain('function playUpgradeCardOnto(')
    expect(text('effects.ts')).toContain('function attachUpgrades(')
  })

  it("appends to a unit's upgrades in one place, attachUpgrades", () => {
    expect(perFile(APPEND)).toEqual({ 'effects.ts': 1 })
  })

  it('attaches only at the known sites (a play goes through playUpgradeCardOnto)', () => {
    expect(perFile(ATTACH)).toEqual(EXPECTED_ATTACHES)
  })

  it('records an upgrade as played on its host in one place', () => {
    expect(sources.flatMap(({ text }) => text.match(/upgradesPlayedThisRound: \(/g) ?? [])).toHaveLength(1)
    expect(sources.flatMap(({ text }) => text.match(/\battachUpgrades\([^\n]*, true\)/g) ?? []), 'and only the door passes played').toHaveLength(1)
  })
})
