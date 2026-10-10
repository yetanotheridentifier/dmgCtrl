import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the engine reads a card's traits, checked from the source.
 *
 * **A card's traits have one read**, `cardTraits` in `keywords.ts` (reached through `cardHasTrait`,
 * `unitTraits`, `unitHasTrait` and `grantMatches`). It is what adds a trait another card gives this
 * one (Malakili, Mythosaur) and takes off one the card has lost (The First Legion). A filter that reads
 * `card.traits` itself sees the printed row only, silently: a Creature in hand is Underworld to one
 * card and not to the next.
 *
 * A new direct read fails the test until whoever adds it either goes through the door or adds it to
 * the list below with the reason it has to read the printed row.
 */

const DIR = 'src/engine'
const DIRECT_READ = /\.traits\b/g

/** Every direct read, named, so a change of count names what to look at. */
const EXPECTED_READS: Record<string, number> = {
  // `cardTraits` reads the printed row, and `unitTraits` reads it twice more: the fast path with no
  // card-level rule in force, and the card a copy really is (Clone).
  'keywords.ts': 3,
  // `nextUnitGrantMatches`, for a caller with no registry to ask: the engine calls it through `grantMatches`.
  'types.ts': 1,
  // The traits a player may name (The First Legion), which are the printed ones by definition.
  'legalMoves.ts': 1,
  // Malakili's own grant: it gives Underworld to a card PRINTED as a Creature, and reading it through
  // the door would ask the question it is answering.
  'cardDefinitions.ts': 1,
}

const sources = readdirSync(join(process.cwd(), DIR))
  .filter(f => f.endsWith('.ts'))
  .map(f => ({ f, text: readFileSync(join(process.cwd(), DIR, f), 'utf8') }))

describe('trait read sites', () => {
  it('finds the door, so a silent pass is impossible', () => {
    expect(sources.find(s => s.f === 'keywords.ts')!.text).toContain('export function cardTraits(')
  })

  it("reads a card's traits directly only at the known sites (every other read goes through cardTraits)", () => {
    const perFile = Object.fromEntries(sources.flatMap(({ f, text }) => {
      const n = text.match(DIRECT_READ)?.length ?? 0
      return n > 0 ? [[f, n]] : []
    }))
    expect(perFile).toEqual(EXPECTED_READS)
  })
})
