import { describe, it, expect } from 'vitest'
import { runBench } from '../bench/runBench'
import type { BenchReport } from '../bench/runBench'
import { BUILD_TAG } from '../buildTag'

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
    expect(report.buildTag).toBe(BUILD_TAG)
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

  it('alternates who moves first across games', () => {
    const report = runBench({ games: 4, seed: 55, aiA: 'random', aiB: 'random' })
    expect(report.games[0].firstPlayer).not.toBe(report.games[1].firstPlayer)
    expect(report.games[1].firstPlayer).not.toBe(report.games[2].firstPlayer)
  })

  it('is reproducible: same config, identical aggregate', () => {
    const a = runBench({ games: 6, seed: 123, aiA: 'random', aiB: 'random' })
    const b = runBench({ games: 6, seed: 123, aiA: 'random', aiB: 'random' })
    expect(stable(b)).toEqual(stable(a))
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
