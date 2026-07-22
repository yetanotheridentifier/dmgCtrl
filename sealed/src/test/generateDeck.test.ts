import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { buildDeckForLeader } from '../deckgen/generateDeck'
import { deckReport } from '../deckgen/rules'

/**
 * The deck generator (#408): a reusable primitive that builds one legal, penalty-free, realistically
 * shaped deck for a given leader (choosing the base itself). The strong proof is that it produces a
 * fully rule-satisfying deck for EVERY real ASH leader, and does so deterministically.
 */
const POOL = ashSet as unknown as SwuCard[]
const LEADERS = POOL.filter(c => c.Type === 'Leader')

function byId(pool: SwuCard[]): Map<string, SwuCard> {
  return new Map(pool.map(c => [`${c.Set}_${c.Number}`, c]))
}

describe('buildDeckForLeader', () => {
  it('has 18 ASH leaders to build for', () => {
    expect(LEADERS).toHaveLength(18)
  })

  for (const leader of LEADERS) {
    it(`builds a rule-satisfying deck for ${leader.Name}`, () => {
      const { deck, report } = buildDeckForLeader(leader, POOL, 1)
      expect(report.violations, `${leader.Name}: ${report.violations.join('; ')}`).toEqual([])
      // deckReport recomputed independently agrees.
      expect(deckReport(deck, byId(POOL)).ok).toBe(true)
    })
  }

  it('is deterministic for a given seed', () => {
    const a = buildDeckForLeader(LEADERS[0], POOL, 7).deck
    const b = buildDeckForLeader(LEADERS[0], POOL, 7).deck
    expect(b).toEqual(a)
  })
})
