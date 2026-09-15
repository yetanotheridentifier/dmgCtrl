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

  /**
   * 52 rather than 18 x 4, because a base that doubles an aspect the leader already supplies is not a
   * deck anyone builds: this set has no card with a doubled aspect, so the overlap buys nothing and
   * one colour cannot fill a deck. Each of the 18 leaders loses the base matching a colour aspect it
   * carries, and the two with two colour aspects lose two.
   */
  it('pairs every leader with every base aspect it does not already carry (52 decks)', () => {
    expect(decks).toHaveLength(52)
  })

  it('represents every leader, 3 decks each bar the two-aspect pair', () => {
    const byLeader = new Map<string, number>()
    for (const d of decks) byLeader.set(d.leaderName, (byLeader.get(d.leaderName) ?? 0) + 1)
    expect(byLeader.size).toBe(18)
    // The Armorer (Vigilance/Command) and Fennec Shand (Aggression/Cunning) carry two colour
    // aspects, so only two bases remain for each.
    expect([...byLeader.values()].filter(n => n === 2)).toHaveLength(2)
    expect([...byLeader.values()].filter(n => n === 3)).toHaveLength(16)
  })

  /**
   * **Still even by aspect**, which is what keeps a base-strength reading meaningful. Each aspect is
   * carried by exactly five leaders, so each loses the same five decks: 18 - 5 = 13.
   */
  it('represents every base aspect equally (13 decks each)', () => {
    const byBase = new Map<string, number>()
    for (const d of decks) byBase.set(d.baseAspect, (byBase.get(d.baseAspect) ?? 0) + 1)
    expect(byBase.size).toBe(4)
    for (const n of byBase.values()) expect(n).toBe(13)
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
