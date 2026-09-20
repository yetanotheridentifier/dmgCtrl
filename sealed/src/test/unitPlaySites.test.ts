import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the engine adds a unit to a player's board, and where it records a card as played, checked from
 * the source.
 *
 * **Playing a unit has one door**, `playUnitCard` in `resolve.ts`: it adds the unit, records the card as
 * played, applies entry keywords, fires When Played and the rest of the arrival batch, and runs the unique
 * check. The action from hand and every ability that plays a unit (from hand, a search, the discard, the top
 * of the deck) go through it. Four of those once built the entry themselves by calling the entry half
 * without the record, so a unit they played never counted for "if you played ... this phase".
 *
 * So a new hand-built append to `units` fails the first test until whoever adds it decides which kind it is:
 *
 * - **a play** (from any zone, paid or free): call `playUnitCard` instead, and nothing here changes;
 * - **a unit arriving that is not a play** (a token created, control taken, a captured card released, a
 *   leader deployed): add it to the list below. None of those is played, so none records.
 *
 * And a new `recordCardPlayed` call fails the second: each card type has one door that records.
 */

const DIR = 'src/engine'
const APPEND = /units: \[\.\.\./g
const RECORD = /(?<!function )\brecordCardPlayed\(/g

/** Every unit append, named, so a change of count names what to look at. */
const EXPECTED_APPENDS: Record<string, number> = {
  'effects.ts': 3, // takeControlOfUnit, createTokenUnit, releaseCaptured: none of them a play
  'resolve.ts': 2, // playUnitCard (the door, the one "played"), and deploying a leader
}

/** The three doors: a unit, an event, an upgrade. */
const EXPECTED_RECORDS: Record<string, number> = { 'resolve.ts': 3 }

const sources = readdirSync(join(process.cwd(), DIR))
  .filter(f => f.endsWith('.ts'))
  .map(f => ({ f, text: readFileSync(join(process.cwd(), DIR, f), 'utf8') }))
const perFile = (re: RegExp): Record<string, number> =>
  Object.fromEntries(sources.flatMap(({ f, text }) => {
    const n = text.match(re)?.length ?? 0
    return n > 0 ? [[f, n]] : []
  }))
const body = (f: string, fn: string): string => {
  const text = sources.find(s => s.f === f)!.text
  const start = text.indexOf(`function ${fn}(`)
  expect(start, `${fn} exists in ${f}`).toBeGreaterThan(-1)
  return text.slice(start, text.indexOf('\n}\n', start))
}

describe('unit play sites', () => {
  it('each door records the card as played', () => {
    expect(body('resolve.ts', 'playUnitCard')).toContain('recordCardPlayed(')
    // `playEventCard`, not `playEvent`: an event is played from the resource zone and from the top
    // of a deck as well as from hand, so the door is the half that takes a card whose cost is
    // already paid, exactly as `playUnitCard` and `playUpgradeCardOnto` are.
    expect(body('resolve.ts', 'playEventCard')).toContain('recordCardPlayed(')
    expect(body('resolve.ts', 'playUpgradeCardOnto')).toContain('recordCardPlayed(')
  })

  it("adds a unit to a player's board only at the known sites (a play goes through playUnitCard)", () => {
    expect(perFile(APPEND)).toEqual(EXPECTED_APPENDS)
  })

  it('records a card as played only in the doors', () => {
    expect(perFile(RECORD)).toEqual(EXPECTED_RECORDS)
  })

  /**
   * Entering play is not the same event as being played, so every arrival collects the arrival
   * triggers, which is where `whenFriendlyEntersPlay` ("when a friendly unit enters play", Outcast)
   * and `whenUnitEntersPlay` (Trap Field) come from. A deployed leader and a released captured card
   * are entries as much as a play or a create is, and each raised nothing until it collected here.
   * Taking control is the exception, and the reason this is a list rather than a count: that unit is
   * already in play, so it enters nothing.
   */
  it('raises the arrival triggers at every site a unit enters play, and nowhere else', () => {
    for (const [file, fn] of [['effects.ts', 'createTokenUnit'], ['effects.ts', 'releaseCaptured'], ['resolve.ts', 'deployLeader'], ['resolve.ts', 'collectEntersPlay']] as const) {
      expect(body(file, fn), `${fn} collects the arrival triggers`).toContain('collectArrivalTriggers(')
    }
    expect(body('effects.ts', 'takeControlOfUnit')).not.toContain('collectArrivalTriggers(')
  })
})
