import { describe, it, expect } from 'vitest'
import { openDb, saveReport, listRuns, gamesForRun } from '../bench/store'
import { runBench } from '../bench/runBench'

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
    expect(runs[0].buildTag).toBe(report.buildTag)
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
