// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDb, saveReport, listRuns, gamesForRun } from '../bench/store'
import { runBench } from '../bench/runBench'

/** Read a pragma back, which is how the connection settings are asserted rather than assumed. */
const pragma = (db: DatabaseSync, name: string): unknown =>
  Object.values(db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[0]

/**
 * Bench results are written to a local SQLite database (Node's built-in `node:sqlite`, no dependency)
 * so a run can be queried and compared later rather than scrolling console output. One row per run
 * holds the headline metrics, one row per game holds the detail, linked by run id. Tested against an
 * in-memory database so nothing touches disk.
 */
describe('bench store', () => {
  const report = runBench({ games: 3, seed: 1, aiA: 'random', aiB: 'random' })

  it('stores one run row carrying the headline metrics', () => {
    const db = openDb(':memory:')
    const runId = saveReport(db, report)
    const runs = listRuns(db)
    expect(runs).toHaveLength(1)
    expect(runs[0].runId).toBe(runId)
    // The column is still `build_tag`, but it now holds a commit id rather than the old counter.
    // Renaming it needs a migration, and pre-change rows hold `bN` values that cannot be mapped to a
    // commit, so those rows stay engine-ambiguous by design (#480).
    expect(runs[0].commitId).toBe(report.commitId)
    expect(runs[0].gamesRequested).toBe(3)
    expect(runs[0].completed + runs[0].dropped).toBe(3)
    expect(runs[0].winRateA).toBeCloseTo(report.winRateA, 5)
  })

  it('stores one row per game, linked to the run', () => {
    const db = openDb(':memory:')
    const runId = saveReport(db, report)
    const games = gamesForRun(db, runId)
    expect(games).toHaveLength(3)
    expect(games.map(g => g.gameIndex).sort((a, b) => a - b)).toEqual([0, 1, 2])
    for (const g of games) expect(['player', 'opponent', 'draw', null]).toContain(g.winner)
  })

  it('keeps successive runs as distinct rows', () => {
    const db = openDb(':memory:')
    const first = saveReport(db, report)
    const second = saveReport(db, report)
    expect(second).not.toBe(first)
    expect(listRuns(db)).toHaveLength(2)
  })
})

/**
 * Surviving a sharded run.
 *
 * The bench is single-threaded, so a long A/B is run as N processes over N seeds and the results
 * pooled, exactly as the existing three-seed runs pool. Every one of those processes writes to the
 * same database at the end, and with the defaults **half of them lose their results**: twelve
 * concurrent three-game runs produced six `SQLITE_BUSY` failures at `saveReport`, after the games had
 * been played. On a five-hour shard that is five hours discarded at the final step.
 *
 * Three things were wrong, and the third is a correctness bug on its own:
 *
 * - **No busy timeout**, so a writer that finds the database locked fails instantly instead of
 *   waiting a moment for a write that takes milliseconds.
 * - **The rollback journal** takes a whole-database lock. WAL lets readers continue during a write
 *   and shortens the exclusive window.
 * - **No transaction**, so a run was written as one row plus up to a thousand separate inserts, each
 *   taking and releasing a lock. That is the widest possible collision window, and a failure part way
 *   through left a run row with only some of its games: a partial run that reads as a complete one.
 */
describe('concurrent writers', () => {
  const report = runBench({ games: 3, seed: 1, aiA: 'random', aiB: 'random' })
  const tmp = (): string => join(mkdtempSync(join(tmpdir(), 'benchdb-')), 'bench.db')

  it('waits for a busy database rather than failing on the spot', () => {
    const db = openDb(tmp())
    expect(Number(pragma(db, 'busy_timeout'))).toBeGreaterThanOrEqual(5_000)
  })

  it('uses WAL, so a reader is not blocked by the writer', () => {
    const db = openDb(tmp())
    expect(String(pragma(db, 'journal_mode')).toLowerCase()).toBe('wal')
  })

  /** An in-memory database cannot be WAL, and asking for it must not take the whole store down: the
   *  test suite uses `:memory:` throughout. */
  it('still opens an in-memory database', () => {
    const db = openDb(':memory:')
    expect(saveReport(db, report)).toBeTruthy()
  })

  /** Atomicity matters beyond concurrency: a half-written run is worse than a missing one, because
   *  it is indistinguishable from a complete run with fewer games. */
  it('writes a run and its games as one transaction', () => {
    const db = openDb(':memory:')
    // A game whose NOT NULL column is null fails at insert time, part way through the batch.
    const broken = { ...report, games: [report.games[0], { ...report.games[1], rounds: null }] as typeof report.games }
    expect(() => saveReport(db, broken)).toThrow()
    expect(listRuns(db)).toHaveLength(0)
  })
})
