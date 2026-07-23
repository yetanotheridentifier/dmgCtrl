import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GameState } from '../engine/types'
import type { GameResult, MoveRecord } from './selfPlay'
import type { MatchupCell } from './matrix'

/**
 * Turning a dropped game into a replayable fixture. The bench keeps a dropped game whole (starting
 * position plus every move); this emits it in the exact `{ initialState, moves }` shape the existing
 * replay harness reads, with the card database stripped (rebuilt from the ASH fixture on load). So a
 * bench hang or throw drops straight into `bench-results/failures/` and replays with no conversion,
 * ready to be filed as a bug.
 */

export const FAILURES_DIR = 'bench-results/failures'

export interface FailureFixture {
  initialState: Omit<GameState, 'cards'>
  moves: MoveRecord[]
}

/** The `{ initialState, moves }` fixture for one game (card database stripped). */
export function failureFixture(game: GameResult): FailureFixture {
  if (!game.initialState) throw new Error('failureFixture: game has no retained initial state (was it completed?)')
  const initialState: Partial<GameState> = { ...game.initialState }
  delete initialState.cards
  return { initialState: initialState as Omit<GameState, 'cards'>, moves: game.moves }
}

/** Filenames must survive every OS, so the ISO timestamp's colons and dots are replaced. */
const safe = (s: string): string => s.replace(/[:.]/g, '-')

/**
 * Write a fixture file for each dropped game (completed games are skipped). Returns the paths
 * written. `dir` is overridable for tests; production uses `FAILURES_DIR`.
 */
export function writeFailures(runId: string, games: GameResult[], dir: string = FAILURES_DIR): string[] {
  const written: string[] = []
  games.forEach((game, i) => {
    if (game.status !== 'dropped' || !game.initialState) return
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${safe(runId)}-g${i}.json`)
    writeFileSync(path, JSON.stringify(failureFixture(game), null, 2))
    written.push(path)
  })
  return written
}

const csvField = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/**
 * Write a matchup matrix to CSV (one row per ordered deck pair), so it can be opened in a spreadsheet
 * and pivoted (deck_a rows x deck_b columns on win_rate_a) without any SQL. The SQLite copy is the
 * queryable source of record; this is the friendly export.
 */
export function writeMatrixCsv(runId: string, cells: MatchupCell[], dir = 'bench-results'): string {
  mkdirSync(dir, { recursive: true })
  const header = 'deck_a,deck_b,leader_a,base_a,leader_b,base_b,games,win_rate_a,avg_margin'
  const rows = cells.map(c =>
    [csvField(c.aLabel), csvField(c.bLabel), csvField(c.leaderA), c.baseA, csvField(c.leaderB), c.baseB, c.games, c.winRateA.toFixed(4), c.avgMargin.toFixed(2)].join(','),
  )
  // runId already starts with "matrix-", so use it directly (no double prefix).
  const path = join(dir, `${runId.replace(/[:.]/g, '-')}.csv`)
  writeFileSync(path, [header, ...rows].join('\n'))
  return path
}
