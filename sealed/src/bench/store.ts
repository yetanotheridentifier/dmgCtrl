import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BenchReport } from './runBench'

/**
 * Bench results in a local SQLite database, via Node's built-in `node:sqlite` (no dependency). Two
 * tables: one row per run with the headline metrics, one row per game with the detail, joined on
 * `run_id`. Every number is stamped with the engine `build_tag` it was measured under, so a result
 * is always traceable to the engine state that produced it. Query it with any SQLite client, or the
 * `listRuns` / `gamesForRun` helpers here.
 */

export const DEFAULT_DB_PATH = 'bench-results/bench.db'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS runs (
    run_id          TEXT PRIMARY KEY,
    started_at      TEXT    NOT NULL,
    build_tag       TEXT    NOT NULL,
    ai_a            TEXT    NOT NULL,
    ai_b            TEXT    NOT NULL,
    seed            INTEGER NOT NULL,
    games_requested INTEGER NOT NULL,
    completed       INTEGER NOT NULL,
    dropped         INTEGER NOT NULL,
    provisional     INTEGER NOT NULL,
    win_rate_a      REAL    NOT NULL,
    win_ci          REAL    NOT NULL,
    draw_rate       REAL    NOT NULL,
    avg_margin      REAL    NOT NULL,
    avg_rounds      REAL    NOT NULL,
    moves_per_sec   REAL    NOT NULL
  );
  CREATE TABLE IF NOT EXISTS games (
    run_id        TEXT    NOT NULL,
    game_index    INTEGER NOT NULL,
    seed          INTEGER NOT NULL,
    first_player  TEXT    NOT NULL,
    winner        TEXT,
    rounds        INTEGER NOT NULL,
    move_count    INTEGER NOT NULL,
    base_damage_a INTEGER NOT NULL,
    base_damage_b INTEGER NOT NULL,
    margin        INTEGER NOT NULL,
    status        TEXT    NOT NULL,
    drop_reason   TEXT,
    PRIMARY KEY (run_id, game_index)
  );
`

export interface RunRow {
  runId: string
  startedAt: string
  buildTag: string
  aiA: string
  aiB: string
  seed: number
  gamesRequested: number
  completed: number
  dropped: number
  provisional: boolean
  winRateA: number
  winCi: number
  drawRate: number
  avgMargin: number
  avgRounds: number
  movesPerSec: number
}

export interface GameRow {
  runId: string
  gameIndex: number
  seed: number
  firstPlayer: string
  winner: string | null
  rounds: number
  moveCount: number
  baseDamageA: number
  baseDamageB: number
  margin: number
  status: string
  dropReason: string | null
}

/** Open (creating if absent) the database at `path`, ensuring the schema exists. */
export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(SCHEMA)
  return db
}

/** Persist one report as a run row plus its game rows. Returns the generated run id. */
export function saveReport(db: DatabaseSync, report: BenchReport): string {
  const startedAt = new Date().toISOString()
  const runId = `${startedAt}-${randomUUID().slice(0, 8)}`

  db.prepare(
    `INSERT INTO runs (run_id, started_at, build_tag, ai_a, ai_b, seed, games_requested, completed,
      dropped, provisional, win_rate_a, win_ci, draw_rate, avg_margin, avg_rounds, moves_per_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId, startedAt, report.buildTag, report.aiA, report.aiB, report.seed, report.gamesRequested,
    report.completed, report.dropped, report.provisional ? 1 : 0, report.winRateA, report.winCi,
    report.drawRate, report.avgMargin, report.avgRounds, report.movesPerSec,
  )

  const insertGame = db.prepare(
    `INSERT INTO games (run_id, game_index, seed, first_player, winner, rounds, move_count,
      base_damage_a, base_damage_b, margin, status, drop_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  report.games.forEach((g, i) => {
    insertGame.run(
      runId, i, g.seed, g.firstPlayer, g.winner, g.rounds, g.moveCount,
      g.baseDamage.player, g.baseDamage.opponent, g.margin, g.status, g.dropReason,
    )
  })

  return runId
}

const num = (v: unknown): number => Number(v)
const str = (v: unknown): string => String(v)

function mapRun(r: Record<string, unknown>): RunRow {
  return {
    runId: str(r.run_id), startedAt: str(r.started_at), buildTag: str(r.build_tag),
    aiA: str(r.ai_a), aiB: str(r.ai_b), seed: num(r.seed), gamesRequested: num(r.games_requested),
    completed: num(r.completed), dropped: num(r.dropped), provisional: num(r.provisional) === 1,
    winRateA: num(r.win_rate_a), winCi: num(r.win_ci), drawRate: num(r.draw_rate),
    avgMargin: num(r.avg_margin), avgRounds: num(r.avg_rounds), movesPerSec: num(r.moves_per_sec),
  }
}

function mapGame(r: Record<string, unknown>): GameRow {
  return {
    runId: str(r.run_id), gameIndex: num(r.game_index), seed: num(r.seed),
    firstPlayer: str(r.first_player), winner: r.winner === null ? null : str(r.winner),
    rounds: num(r.rounds), moveCount: num(r.move_count), baseDamageA: num(r.base_damage_a),
    baseDamageB: num(r.base_damage_b), margin: num(r.margin), status: str(r.status),
    dropReason: r.drop_reason === null ? null : str(r.drop_reason),
  }
}

/** Every run, oldest first. */
export function listRuns(db: DatabaseSync): RunRow[] {
  return (db.prepare(`SELECT * FROM runs ORDER BY started_at`).all() as Record<string, unknown>[]).map(mapRun)
}

/** Every game of one run, in play order. */
export function gamesForRun(db: DatabaseSync, runId: string): GameRow[] {
  return (db.prepare(`SELECT * FROM games WHERE run_id = ? ORDER BY game_index`).all(runId) as Record<string, unknown>[]).map(mapGame)
}
