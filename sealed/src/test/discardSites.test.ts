import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the engine adds a card to a discard pile, checked from the source.
 *
 * **Discarding from a hand or deck has one door**, `discardTaken` in `effects.ts` (reached through
 * `discardCards` or `discardFromHand`), which records the discard for the phase and announces it. A pile
 * appended to by hand skips both, silently: the card is in the pile, and Kylo's TIE Silencer, Fear and
 * Dead Men and Migs Mayfeld never hear of it.
 *
 * Every other append is a card reaching the pile WITHOUT being discarded, which is right to leave out
 * of the record. A new append fails the test until whoever adds it decides which kind it is: a discard
 * from a hand or deck goes through the door, anything else is added to the list below.
 */

const DIR = 'src/engine'
const APPEND = /\bdiscard: \[\s*\.\.\./g

/** Every append, named, so a change of count names what to look at. */
const EXPECTED_APPENDS: Record<string, number> = {
  // finishDefeats: defeated units and their upgrades, to each owner's pile (two appends).
  'combat.ts': 2,
  // discardTaken (the door), an upgrade leaving play, a resource defeated, a captured card discarded
  // from under its holder.
  'effects.ts': 4,
  // an event resolving (played, not discarded), and the free top-card play's event stub.
  'resolve.ts': 2,
  // L3-37 declining to attach instead of being defeated: defeated after all.
  'cardDefinitions.ts': 1,
}

const sources = readdirSync(join(process.cwd(), DIR))
  .filter(f => f.endsWith('.ts'))
  .map(f => ({ f, text: readFileSync(join(process.cwd(), DIR, f), 'utf8') }))

describe('discard pile append sites', () => {
  it('finds the door, so a silent pass is impossible', () => {
    expect(sources.find(s => s.f === 'effects.ts')!.text).toContain('function discardTaken(')
  })

  it('appends to a discard pile only at the known sites (a discard from hand or deck goes through the door)', () => {
    const perFile = Object.fromEntries(sources.flatMap(({ f, text }) => {
      const n = text.match(APPEND)?.length ?? 0
      return n > 0 ? [[f, n]] : []
    }))
    expect(perFile).toEqual(EXPECTED_APPENDS)
  })

  it('records a discard in one place', () => {
    expect(sources.flatMap(({ text }) => text.match(/(?<!function )\brecordDiscarded\(/g) ?? [])).toHaveLength(1)
  })
})
