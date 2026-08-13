import { describe, it, expect } from 'vitest'
import { shardResultFrom, shardPayload } from '../bench/shard'
import type { BenchReport } from '../bench/runBench'

/**
 * Structured shard results instead of stdout parsing (#492, phase 2).
 *
 * A shard's numbers used to be recovered by regexing the child's **printed report**. That is tolerable
 * for two numbers and hopeless for anything else: the matrix returns 2,628 cells, and no regex is
 * going to lift those out of a formatted table. It is also silently fragile, because changing a label
 * in the report would change what a run measured.
 *
 * So the child writes its result as JSON and the parent reads it. The parent still owns `exitCode`,
 * which only it knows, and a child that died before writing anything is recorded as a failure rather
 * than guessed at.
 */

const report = (over: Partial<BenchReport> = {}): BenchReport => ({
  winRateA: 0.625,
  drawRate: 0,
  winCi: 0.1,
  completed: 80,
  dropped: 2,
  provisional: true,
  avgMargin: 1.5,
  avgRounds: 7,
  movesPerSec: 100,
  commitId: 'abc123',
  games: [],
  failures: [],
  ...over,
} as BenchReport)

describe('shardPayload', () => {
  /** Only what pooling and resuming need. A shard file is read by a parent that has no interest in
   *  the per-game rows, which are already in the database. */
  it('carries the numbers a parent needs and nothing else', () => {
    expect(shardPayload(report(), 9001)).toEqual({
      seed: 9001, winRateA: 0.625, completed: 80, dropped: 2, commitId: 'abc123',
    })
  })
})

describe('shardResultFrom', () => {
  it('adopts a payload the child wrote, adding the exit code only the parent knows', () => {
    const payload = { seed: 9001, winRateA: 0.625, completed: 80, dropped: 2, commitId: 'abc123' }
    expect(shardResultFrom(payload, 9001, 0)).toEqual({
      seed: 9001, winRateA: 0.625, completed: 80, dropped: 2, exitCode: 0, commitId: 'abc123',
    })
  })

  /**
   * **A child that died before writing is a failure, not a zero.** Recording it as `completed: 0` with
   * its real exit code is what makes `pendingSeeds` re-run it; inventing a rate would quietly shrink
   * the pooled total, which is the exact failure the shard mechanism exists to prevent.
   */
  it('records a missing payload as a failed shard', () => {
    const r = shardResultFrom(null, 9002, 137)
    expect(r).toMatchObject({ seed: 9002, completed: 0, exitCode: 137, winRateA: 0 })
  })

  /** A half-written file parses to something that is not a result. Treat it as absent. */
  it('rejects a malformed payload rather than trusting it', () => {
    for (const bad of [undefined, 'nonsense', 42, {}, { winRateA: 'x', completed: 1 }, { winRateA: 0.5 }]) {
      expect(shardResultFrom(bad, 9003, 0).completed, JSON.stringify(bad)).toBe(0)
    }
  })

  /**
   * **A clean exit that played nothing is still a failure.** An OOM kill can leave a process exiting
   * zero having completed no games, and `pendingSeeds` already refuses to treat that as done; the two
   * must agree or a run reports itself complete over fewer games than requested.
   */
  it('keeps a zero-game shard distinguishable even on a clean exit', () => {
    const r = shardResultFrom({ seed: 9004, winRateA: 0, completed: 0, dropped: 0, commitId: 'abc' }, 9004, 0)
    expect(r.completed).toBe(0)
    expect(r.exitCode).toBe(0)
  })

  /** The parent's seed wins: the file is named for the seed the parent asked for, and a payload
   *  claiming another one is a mismatch to correct rather than to propagate. */
  it('trusts the seed the parent asked for', () => {
    const r = shardResultFrom({ seed: 1, winRateA: 0.5, completed: 8, dropped: 0, commitId: 'abc' }, 9005, 0)
    expect(r.seed).toBe(9005)
  })
})
