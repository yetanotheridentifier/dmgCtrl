import { describe, it, expect } from 'vitest'
import { runBench } from '../bench/runBench'
import type { BenchReport } from '../bench/runBench'
import { COMMIT_ID } from '../buildIdentity'

/**
 * The run layer plays N games, alternating who holds the initiative so first-player advantage
 * cancels out, and aggregates the metrics the tickets ask for: win rate (with a confidence
 * interval), base-damage margin, game length and speed. A run with any dropped game is flagged
 * PROVISIONAL so a dirty number can never be quoted as clean.
 */

/** Deterministic projection: neutralise the timing fields, which vary run to run. */
function stable(r: BenchReport) {
  return {
    ...r,
    movesPerSec: 0,
    games: r.games.map(g => ({
      seed: g.seed,
      winner: g.winner,
      rounds: g.rounds,
      margin: g.margin,
      status: g.status,
      firstPlayer: g.firstPlayer,
    })),
  }
}

describe('runBench', () => {
  it('reports a coherent aggregate over a small random-vs-random run', () => {
    const report = runBench({ games: 6, seed: 123, aiA: 'random', aiB: 'random' })
    expect(report.completed + report.dropped).toBe(6)
    expect(report.commitId).toBe(COMMIT_ID)
    expect(report.winRateA).toBeGreaterThanOrEqual(0)
    expect(report.winRateA).toBeLessThanOrEqual(1)
    expect(report.winCi).toBeGreaterThan(0)
    expect(report.avgRounds).toBeGreaterThan(0)
    expect(report.movesPerSec).toBeGreaterThan(0)
  })

  it('records every dropped game and mirrors it in the provisional flag', () => {
    // A dropped game (an engine defect that hangs or throws) must never be hidden: it is counted,
    // recorded with its seed for reproduction, and marks the run provisional. This holds however
    // clean the current engine is, so the invariant is asserted rather than a fixed drop count.
    const report = runBench({ games: 6, seed: 123, aiA: 'random', aiB: 'random' })
    expect(report.failures.length).toBe(report.dropped)
    expect(report.provisional).toBe(report.dropped > 0)
    for (const f of report.failures) {
      expect(typeof f.seed).toBe('number')
      expect(f.reason).toBeTruthy()
    }
  })

  /**
   * **Seat and first player vary on independent cycles**, so four games cover all four combinations
   * exactly once.
   *
   * This replaces an assertion that `firstPlayer` alternated every single game, which described the
   * old scheme: `aiA` sat in the `player` seat always and only the first move moved. That left the
   * seat advantage uncancelled, and an AI measured against itself read 49.4% to 50.0% rather than
   * 50%. Alternating both together would be no better: only two of the four combinations would ever
   * occur, and seat advantage would stay perfectly confounded with first-player advantage.
   */
  it('covers every seat and first-player combination over four games', () => {
    const report = runBench({ games: 4, seed: 55, aiA: 'random', aiB: 'random' })
    const combos = report.games.map((g, i) => `${g.firstPlayer}:${i % 2 === 1 ? 'swapped' : 'straight'}`)
    expect(new Set(combos).size, 'all four, each once').toBe(4)
    expect(report.seatsSwapped).toBe(2)
  })

  it('is reproducible: same config, identical aggregate', () => {
    const a = runBench({ games: 6, seed: 123, aiA: 'random', aiB: 'random' })
    const b = runBench({ games: 6, seed: 123, aiA: 'random', aiB: 'random' })
    expect(stable(b)).toEqual(stable(a))
  })

  /**
   * A shard reports progress while it runs (#562).
   *
   * Without this a shard is silent until its last game: an overnight `--games 2000` run left twelve
   * 0-byte logs and reported `games 0 of 24000` for eight hours before it was lost. The count is what a
   * heartbeat turns into a measured rate and a projected finish.
   */
  it('reports games played as it plays them', () => {
    const seen: number[] = []
    runBench({ games: 4, seed: 55, aiA: 'random', aiB: 'random', onProgress: n => seen.push(n) })
    expect(seen, 'counted as they finish, so a reader knows how far in it is').toEqual([1, 2, 3, 4])
  })

  /** A dropped game is still a game played, and an hour of dropped games must not read as a stall. */
  it('counts a dropped game as progress too', () => {
    const seen: number[] = []
    const report = runBench({ games: 3, seed: 8, aiA: 'random', aiB: 'random', stepCeiling: 3, onProgress: n => seen.push(n) })
    expect(report.dropped).toBeGreaterThan(0)
    expect(seen).toEqual([1, 2, 3])
  })

  it('flags a run PROVISIONAL when a game drops, recording the failing seed', () => {
    // A brutally low step ceiling forces every game to be dropped as non-terminating.
    const report = runBench({ games: 3, seed: 8, aiA: 'random', aiB: 'random', stepCeiling: 3 })
    expect(report.dropped).toBeGreaterThan(0)
    expect(report.provisional).toBe(true)
    expect(report.failures.length).toBe(report.dropped)
    expect(report.failures[0]).toHaveProperty('seed')
    expect(report.failures[0]).toHaveProperty('reason')
  })
})
