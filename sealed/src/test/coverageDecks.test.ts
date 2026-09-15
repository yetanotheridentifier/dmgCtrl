import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { deckSuiteId } from '../bench/matrix'
import { SEALED_SET_CODES, poolFor } from '../bench/setPools'
import { deckReport } from '../deckgen/rules'

/**
 * The coverage orchestration (#408): a set of legal, realistic decks whose union exercises every card
 * in the set, turning the bench into a whole-pool fuzzer. The test asserts full coverage, every
 * leader present, and every deck valid; if realism ever makes a card unplaceable it is LISTED (in
 * `uncovered`) rather than silently dropped, so we can add a targeted deck or relax a rule.
 */
const POOL = ashSet as unknown as SwuCard[]
const byId = new Map(POOL.map(c => [`${c.Set}_${c.Number}`, c]))
const result = buildCoverageDecks(POOL, 1)

/** The matrix's deck-set fingerprint, which reads only each deck's label and contents. */
const fingerprint = (decks: ParsedDeck[]): string =>
  deckSuiteId(decks.map(deck => ({ deck, label: deck.name, leaderName: '', baseAspect: '' })))

describe('buildCoverageDecks', () => {
  it('covers every deck-able card in the set', () => {
    expect(result.uncovered, `uncovered: ${result.uncovered.join(', ')}`).toEqual([])
  })

  it('includes every leader at least once', () => {
    const leadersUsed = new Set(result.decks.map(d => d.leader))
    const allLeaders = POOL.filter(c => c.Type === 'Leader').map(c => `${c.Set}_${c.Number}`)
    for (const l of allLeaders) expect(leadersUsed.has(l), l).toBe(true)
  })

  it('produces only rule-satisfying decks', () => {
    for (const deck of result.decks) {
      const report = deckReport(deck, byId)
      expect(report.violations, `${deck.name}: ${report.violations.join('; ')}`).toEqual([])
    }
  })

  it('is deterministic', () => {
    expect(buildCoverageDecks(POOL, 1).decks).toEqual(result.decks)
  })

  /**
   * Pinned, because every coverage run, sweep, generalisation and lethal sizing plays this deck set, and
   * a change to it moves all of their numbers at once. It is sensitive to the fixture as well as the
   * generator: correcting one printed cost (Moff Gideon, ASH_097, from 8 to 3) changed it. A change here
   * should be deliberate, and the benches that play the set re-read afterwards.
   */
  it('builds the pinned ASH deck set', () => {
    expect(fingerprint(result.decks)).toBe('5a180363')
  })
})

/**
 * A deck draws on one set. Sealed is the format this app models, and a sealed pool is opened from one
 * set, so a pool spanning several sets is built as one coverage deck set per set, never as decks that
 * mix them. Cross-set formats (Premier, Eternal, chaos sealed) need their own copy and legality rules.
 */
describe('buildCoverageDecks over several sets', () => {
  // A copy of ASH under another code: each set's decks are then known exactly, because they must
  // match the decks ASH builds alone.
  const twin = POOL.map(c => ({ ...c, Set: 'TWN' }))
  const both = buildCoverageDecks([...POOL, ...twin], 1)
  const setOf = (id: string): string => id.split('_')[0]

  it('builds every deck from a single set', () => {
    for (const deck of both.decks) {
      const sets = new Set([deck.leader, deck.base, ...deck.cards.map(e => e.id)].map(setOf))
      expect([...sets], deck.name).toHaveLength(1)
    }
  })

  it('builds each set exactly the decks it builds alone, in pool order', () => {
    const toTwin = (id: string): string => id.replace(/^ASH_/, 'TWN_')
    const twinAlone = result.decks.map(d => ({
      ...d,
      leader: toTwin(d.leader),
      base: toTwin(d.base),
      cards: d.cards.map(e => ({ ...e, id: toTwin(e.id) })),
    }))
    expect(both.decks).toEqual([...result.decks, ...twinAlone])
  })

  it('covers every deck-able card of both sets', () => {
    expect(both.uncovered).toEqual([])
  })
})

/**
 * Every sealed set's coverage decks, not only ASH's: a sweep over a set is only evidence if its decks
 * are legal. Sets too small for sealed are left out by `SEALED_SET_CODES`, because they cannot fill one.
 */
describe('buildCoverageDecks for every sealed set', () => {
  it.each(SEALED_SET_CODES)('%s builds only rule-satisfying decks', code => {
    const pool = poolFor([code])
    const ids = new Map(pool.map(c => [`${c.Set}_${c.Number}`, c]))
    for (const deck of buildCoverageDecks(pool, 1).decks) {
      const report = deckReport(deck, ids)
      expect(report.violations, `${deck.name}: ${report.violations.join('; ')}`).toEqual([])
    }
  })
})
