import { describe, it, expect } from 'vitest'
import { buildMatchupDecks } from '../bench/matchupDecks'
import { runMatchupMatrix } from '../bench/matrix'
import { openDb, saveMatrix, deckStrength, leaderStrength, baseStrength } from '../bench/store'
import { randomAi } from '../ai/randomAi'

/**
 * The even matchup deck set and the deck-vs-deck matrix (#392 follow-up): every leader paired with
 * every base aspect, played round-robin under one AI, stored in SQLite for interrogation.
 */
describe('matchup deck set', () => {
  const decks = buildMatchupDecks()

  it('pairs every leader with every base aspect (18 x 4 = 72 decks)', () => {
    expect(decks).toHaveLength(72)
  })

  it('represents every leader equally (4 decks each)', () => {
    const byLeader = new Map<string, number>()
    for (const d of decks) byLeader.set(d.leaderName, (byLeader.get(d.leaderName) ?? 0) + 1)
    expect(byLeader.size).toBe(18)
    for (const n of byLeader.values()) expect(n).toBe(4)
  })

  it('represents every base aspect equally (18 decks each)', () => {
    const byBase = new Map<string, number>()
    for (const d of decks) byBase.set(d.baseAspect, (byBase.get(d.baseAspect) ?? 0) + 1)
    expect(byBase.size).toBe(4)
    for (const n of byBase.values()) expect(n).toBe(18)
  })

  it('is deterministic', () => {
    expect(buildMatchupDecks().map(d => d.label)).toEqual(decks.map(d => d.label))
  })
})

describe('matchup matrix', () => {
  const decks = buildMatchupDecks().slice(0, 3)

  it('produces every ordered deck pair (N x N cells)', () => {
    const result = runMatchupMatrix(decks, randomAi, 'random', { gamesPerCell: 2, seed: 5 })
    expect(result.cells).toHaveLength(9)
    expect(new Set(result.cells.map(c => `${c.aLabel}|${c.bLabel}`)).size).toBe(9)
  })

  it('is deterministic', () => {
    const a = runMatchupMatrix(decks, randomAi, 'random', { gamesPerCell: 2, seed: 5 })
    const b = runMatchupMatrix(decks, randomAi, 'random', { gamesPerCell: 2, seed: 5 })
    expect(b.cells.map(c => c.winRateA)).toEqual(a.cells.map(c => c.winRateA))
  })

  it('stores and summarises: deck / leader / base strength come back queryable', () => {
    const result = runMatchupMatrix(decks, randomAi, 'random', { gamesPerCell: 1, seed: 1 })
    const db = openDb(':memory:')
    const runId = saveMatrix(db, result)
    expect(deckStrength(db, runId)).toHaveLength(3)
    expect(leaderStrength(db, runId).length).toBeGreaterThan(0)
    expect(baseStrength(db, runId).length).toBeGreaterThan(0)
    for (const s of deckStrength(db, runId)) {
      expect(s.winRate).toBeGreaterThanOrEqual(0)
      expect(s.winRate).toBeLessThanOrEqual(1)
    }
  })
})
