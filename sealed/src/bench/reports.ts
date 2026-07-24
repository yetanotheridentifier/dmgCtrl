import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GameState } from '../engine/types'
import type { GameResult, MoveRecord } from './selfPlay'

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
