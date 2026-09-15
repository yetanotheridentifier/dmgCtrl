import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { buildMatchupDecks } from '../bench/matchupDecks'
import { deckReport } from '../deckgen/rules'

/**
 * The even matchup deck set behind the matrix.
 *
 * Two properties matter and neither used to hold. A deck whose **base doubles an aspect the leader
 * already supplies** is not one anyone builds in sealed: this set has no card with a doubled aspect,
 * so the overlap buys nothing and one colour cannot fill a deck. Twenty of the original 72 were like
 * that, and the first matrix run measured every leader against them.
 *
 * And the set was **fixed**, built at a hardcoded seed, so a leader's rating rested on the one deck
 * the generator happened to produce for it. Several suites is how that becomes a measurable spread
 * rather than an unknown.
 */
const POOL = ashSet as unknown as SwuCard[]
const byId = new Map(POOL.map(c => [`${c.Set}_${c.Number}`, c]))
const LEADERS = POOL.filter(c => c.Type === 'Leader')

describe('buildMatchupDecks', () => {
  it('pairs every leader with every base aspect it does not already have', () => {
    const decks = buildMatchupDecks(POOL, 4, 1)
    // 18 leaders, minus one base each for a leader's own colour aspect. Two leaders (The Armorer,
    // Fennec Shand) carry two colour aspects and so lose two.
    expect(decks).toHaveLength(52)
    expect(new Set(decks.map(d => d.leaderName)).size).toBe(LEADERS.length)
  })

  it('never gives a leader a base sharing one of its aspects', () => {
    for (const d of buildMatchupDecks(POOL, 4, 1)) {
      const leader = LEADERS.find(l => l.Name === d.leaderName)!
      const baseAspects = byId.get(d.deck.base)?.Aspects ?? []
      const overlap = baseAspects.filter(a => (leader.Aspects ?? []).includes(a))
      expect(overlap, `${d.label}`).toEqual([])
    }
  })

  it('labels every deck distinctly, so the matrix can key on it', () => {
    const labels = buildMatchupDecks(POOL, 4, 1).map(d => d.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('builds rule-satisfying decks', () => {
    for (const d of buildMatchupDecks(POOL, 4, 1)) {
      const report = deckReport(d.deck, byId)
      expect(report.violations, `${d.label}: ${report.violations.join(', ')}`).toEqual([])
    }
  })

  /** The point of a seed: a different suite, same leaders and aspects, different card choices. */
  it('builds a different suite for a different seed', () => {
    const a = buildMatchupDecks(POOL, 4, 1)
    const b = buildMatchupDecks(POOL, 4, 2)
    expect(b.map(d => d.label)).toEqual(a.map(d => d.label))

    const cardsOf = (decks: ReturnType<typeof buildMatchupDecks>) =>
      decks.map(d => d.deck.cards.map(c => `${c.id}x${c.count}`).sort().join(','))
    const differing = cardsOf(a).filter((s, i) => s !== cardsOf(b)[i])
    expect(differing.length, 'every deck was identical across seeds').toBeGreaterThan(a.length / 2)
  })

  it('is deterministic for a given seed', () => {
    const a = buildMatchupDecks(POOL, 4, 7)
    const b = buildMatchupDecks(POOL, 4, 7)
    expect(b.map(d => d.deck.cards)).toEqual(a.map(d => d.deck.cards))
  })

  /** The trimmed set still exists for the AI-vs-AI grid, and still rotates its aspect. */
  it('trims to one base per leader when asked', () => {
    const decks = buildMatchupDecks(POOL, 1, 1)
    expect(decks).toHaveLength(LEADERS.length)
    expect(new Set(decks.map(d => d.baseAspect)).size).toBeGreaterThan(1)
  })
})
