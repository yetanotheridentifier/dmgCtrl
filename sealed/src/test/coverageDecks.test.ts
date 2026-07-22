import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { buildCoverageDecks } from '../bench/coverageDecks'
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
})
