import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BenchReport } from './runBench'
import type { MatrixResult } from './matrix'
import type { PairedResult } from './paired'
import { COMMIT_ID } from '../buildIdentity'

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
  CREATE TABLE IF NOT EXISTS matrix_runs (
    run_id         TEXT PRIMARY KEY,
    started_at     TEXT    NOT NULL,
    build_tag      TEXT    NOT NULL,
    model          TEXT    NOT NULL,
    deck_count     INTEGER NOT NULL,
    games_per_cell INTEGER NOT NULL,
    seed           INTEGER NOT NULL,
    dropped        INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS matchups (
    run_id      TEXT    NOT NULL,
    deck_a      TEXT    NOT NULL,
    deck_b      TEXT    NOT NULL,
    leader_a    TEXT    NOT NULL,
    base_a      TEXT    NOT NULL,
    leader_b    TEXT    NOT NULL,
    base_b      TEXT    NOT NULL,
    games       INTEGER NOT NULL,
    wins_a      INTEGER NOT NULL,
    win_rate_a  REAL    NOT NULL,
    avg_margin  REAL    NOT NULL,
    PRIMARY KEY (run_id, deck_a, deck_b)
  );
  CREATE TABLE IF NOT EXISTS experiments (
    experiment_id   TEXT PRIMARY KEY,
    started_at      TEXT    NOT NULL,
    build_tag       TEXT    NOT NULL,
    arm_spec        TEXT    NOT NULL,
    control_spec    TEXT    NOT NULL,
    decks           TEXT    NOT NULL,
    base_seed       INTEGER NOT NULL,
    shard_count     INTEGER NOT NULL,
    games_per_shard INTEGER NOT NULL,
    arm_wins        INTEGER NOT NULL,
    arm_games       INTEGER NOT NULL,
    control_wins    INTEGER NOT NULL,
    control_games   INTEGER NOT NULL,
    paired_mean     REAL    NOT NULL,
    paired_sd       REAL    NOT NULL,
    paired_t        REAL,
    paired_df       INTEGER NOT NULL,
    significant     INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS term_runs (
    run_id     TEXT PRIMARY KEY,
    started_at TEXT    NOT NULL,
    build_tag  TEXT    NOT NULL,
    model      TEXT    NOT NULL,
    games      INTEGER NOT NULL,
    decisions  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS term_stats (
    run_id       TEXT    NOT NULL,
    weight       TEXT    NOT NULL,
    step         REAL    NOT NULL,
    has_quantity INTEGER NOT NULL,
    varies       INTEGER NOT NULL,
    pivotal      INTEGER NOT NULL,
    load_bearing INTEGER NOT NULL,
    spread       REAL    NOT NULL,
    PRIMARY KEY (run_id, weight)
  );
  CREATE TABLE IF NOT EXISTS experiment_shards (
    experiment_id TEXT    NOT NULL,
    seed          INTEGER NOT NULL,
    arm_rate      REAL    NOT NULL,
    control_rate  REAL    NOT NULL,
    diff          REAL    NOT NULL,
    PRIMARY KEY (experiment_id, seed)
  );
`

/**
 * Columns added after the table shipped. `CREATE TABLE IF NOT EXISTS` cannot add one, so an existing
 * database needs an explicit, idempotent `ALTER`.
 *
 * `decks` is the one that matters. Without it, a mirror result and a coverage result are
 * indistinguishable in the store, and a term whose cards are absent from the mirror deck reports
 * neutral there while firing on coverage. That is a correctness hole rather than a missing field.
 */
const MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  { table: 'runs', column: 'decks', ddl: `ALTER TABLE runs ADD COLUMN decks TEXT NOT NULL DEFAULT 'mirror'` },
  { table: 'runs', column: 'games_per_shard', ddl: 'ALTER TABLE runs ADD COLUMN games_per_shard INTEGER' },
]

/** Apply any column a live database is missing. Reading the schema is cheaper than tracking a version
 *  number, and cannot disagree with what is actually there. */
function migrate(db: DatabaseSync): void {
  for (const m of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as Array<{ name: string }>
    if (cols.length > 0 && !cols.some(c => c.name === m.column)) db.exec(m.ddl)
  }
}

export interface RunRow {
  runId: string
  startedAt: string
  commitId: string
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

/**
 * How long a writer waits for a busy database before giving up.
 *
 * A long A/B is run as N single-threaded processes over N seeds and pooled, so every shard writes
 * here within moments of the others finishing. On the defaults that loses half of them: twelve
 * concurrent runs produced six `SQLITE_BUSY` failures, each one discarding a completed run at the
 * final step. A write takes milliseconds, so waiting is always the right answer; 30 seconds is far
 * beyond any real contention and still bounded.
 */
const BUSY_TIMEOUT_MS = 30_000

/** Open (creating if absent) the database at `path`, ensuring the schema exists. */
export function openDb(path: string): DatabaseSync {
  const inMemory = path === ':memory:'
  if (!inMemory) mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  // WAL is a property of the database file, so it neither applies to nor is accepted by `:memory:`,
  // which the whole test suite uses. It lets readers carry on during a write and shortens the
  // exclusive window, which is what makes concurrent shards practical.
  if (!inMemory) db.exec('PRAGMA journal_mode = WAL')
  db.exec(SCHEMA)
  migrate(db)
  return db
}

/**
 * Persist one report as a run row plus its game rows. Returns the generated run id.
 *
 * **One transaction**, for two independent reasons. A run is a row plus up to a thousand game rows,
 * and inserting them separately takes and releases the write lock a thousand times, which is the
 * widest possible window for a concurrent shard to collide with. It is also atomicity: a failure part
 * way through used to leave a run row carrying only some of its games, which reads exactly like a
 * complete run of fewer games and would quietly corrupt any comparison drawn from it.
 *
 * `BEGIN IMMEDIATE` rather than a deferred begin: it takes the write lock up front, so contention is
 * resolved by `busy_timeout` waiting here rather than by failing half way through the batch.
 */
export function saveReport(db: DatabaseSync, report: BenchReport): string {
  const startedAt = new Date().toISOString()
  const runId = `${startedAt}-${randomUUID().slice(0, 8)}`

  db.exec('BEGIN IMMEDIATE')
  try {
    writeReport(db, runId, startedAt, report)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return runId
}

function writeReport(db: DatabaseSync, runId: string, startedAt: string, report: BenchReport): void {
  db.prepare(
    `INSERT INTO runs (run_id, started_at, build_tag, ai_a, ai_b, seed, games_requested, completed,
      dropped, provisional, win_rate_a, win_ci, draw_rate, avg_margin, avg_rounds, moves_per_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId, startedAt, report.commitId, report.aiA, report.aiB, report.seed, report.gamesRequested,
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
}

const num = (v: unknown): number => Number(v)
const str = (v: unknown): string => String(v)

function mapRun(r: Record<string, unknown>): RunRow {
  return {
    runId: str(r.run_id), startedAt: str(r.started_at), commitId: str(r.build_tag),
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

// --- Matchup matrix -------------------------------------------------------

/** Persist a matchup matrix (one run) as a metadata row plus one row per ordered deck pair. */
export function saveMatrix(db: DatabaseSync, result: MatrixResult): string {
  const startedAt = new Date().toISOString()
  const runId = `matrix-${startedAt}-${randomUUID().slice(0, 8)}`
  db.prepare(
    `INSERT INTO matrix_runs (run_id, started_at, build_tag, model, deck_count, games_per_cell, seed, dropped)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(runId, startedAt, result.commitId, result.model, result.deckCount, result.gamesPerCell, result.seed, result.dropped)

  const insert = db.prepare(
    `INSERT INTO matchups (run_id, deck_a, deck_b, leader_a, base_a, leader_b, base_b, games, wins_a, win_rate_a, avg_margin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const c of result.cells) {
    insert.run(runId, c.aLabel, c.bLabel, c.leaderA, c.baseA, c.leaderB, c.baseB, c.games, c.winsA, c.winRateA, c.avgMargin)
  }
  return runId
}

export interface StrengthRow {
  key: string
  winRate: number
  avgMargin: number
  games: number
}

function strength(db: DatabaseSync, column: string, runId: string): StrengthRow[] {
  const rows = db.prepare(
    `SELECT ${column} AS key, AVG(win_rate_a) AS win_rate, AVG(avg_margin) AS avg_margin, SUM(games) AS games
     FROM matchups WHERE run_id = ? GROUP BY ${column} ORDER BY win_rate DESC`,
  ).all(runId) as Record<string, unknown>[]
  return rows.map(r => ({ key: str(r.key), winRate: num(r.win_rate), avgMargin: num(r.avg_margin), games: num(r.games) }))
}

/** Each deck's average win rate across all opponents (its overall strength under this model). */
export function deckStrength(db: DatabaseSync, runId: string): StrengthRow[] {
  return strength(db, 'deck_a', runId)
}
/** Each leader's average win rate across all decks and opponents. */
export function leaderStrength(db: DatabaseSync, runId: string): StrengthRow[] {
  return strength(db, 'leader_a', runId)
}
/** Each base aspect's average win rate across all decks and opponents. */
export function baseStrength(db: DatabaseSync, runId: string): StrengthRow[] {
  return strength(db, 'base_a', runId)
}

/**
 * One arm-versus-control comparison, which is the unit of evidence rather than the run.
 *
 * The store held runs and had no concept of this. Of the search tie-break work, the pooled 51.1% over
 * 2,040 games was in no row (each shard is its own `runs` row and the pool was computed and printed),
 * the 48.7% control was twelve rows nothing marked as a control, and the **+2.35 paired difference
 * that settled it existed nowhere**. Logging runs more diligently would have preserved the misleading
 * number and lost the decisive one.
 */
export interface ExperimentInput {
  armSpec: string
  controlSpec: string
  decks: string
  baseSeed: number
  shards: number
  gamesPerShard: number
  arm: Array<{ winRateA: number; completed: number }>
  control: Array<{ winRateA: number; completed: number }>
  paired: PairedResult
}

export interface ExperimentRow {
  experimentId: string
  startedAt: string
  buildTag: string
  armSpec: string
  controlSpec: string
  decks: string
  baseSeed: number
  shardCount: number
  gamesPerShard: number
  armWins: number
  armGames: number
  controlWins: number
  controlGames: number
  pairedMean: number
  pairedSd: number
  pairedT: number | null
  pairedDf: number
  significant: boolean
}

/** Wins recovered as an exact integer: `winRateA` is `wins / completed` by construction. */
const tally = (shards: Array<{ winRateA: number; completed: number }>): { wins: number; games: number } => ({
  wins: shards.reduce((n, s) => n + Math.round(s.winRateA * s.completed), 0),
  games: shards.reduce((n, s) => n + s.completed, 0),
})

/**
 * Persist a comparison and its per-shard pairs, in one transaction.
 *
 * The pairs are kept because **every conclusion revised today was revised on the same games**: a
 * stored experiment that cannot be re-analysed is a screenshot. `paired_t` is nullable, since a single
 * pair has no spread to estimate and inventing a `t` there would be worse than admitting it.
 */
export function saveExperiment(db: DatabaseSync, input: ExperimentInput): string {
  const startedAt = new Date().toISOString()
  const experimentId = `exp-${startedAt}-${randomUUID().slice(0, 8)}`
  const a = tally(input.arm)
  const c = tally(input.control)
  const p = input.paired

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      `INSERT INTO experiments (experiment_id, started_at, build_tag, arm_spec, control_spec, decks,
        base_seed, shard_count, games_per_shard, arm_wins, arm_games, control_wins, control_games,
        paired_mean, paired_sd, paired_t, paired_df, significant)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      experimentId, startedAt, COMMIT_ID, input.armSpec, input.controlSpec, input.decks,
      input.baseSeed, input.shards, input.gamesPerShard, a.wins, a.games, c.wins, c.games,
      p.mean, p.sd, p.t === null || !Number.isFinite(p.t) ? null : p.t, p.df, p.significant ? 1 : 0,
    )
    const insert = db.prepare(
      `INSERT INTO experiment_shards (experiment_id, seed, arm_rate, control_rate, diff) VALUES (?,?,?,?,?)`,
    )
    for (const s of p.perSeed) insert.run(experimentId, s.seed, s.arm, s.control, s.diff)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return experimentId
}

const mapExperiment = (r: Record<string, unknown>): ExperimentRow => ({
  experimentId: str(r.experiment_id),
  startedAt: str(r.started_at),
  buildTag: str(r.build_tag),
  armSpec: str(r.arm_spec),
  controlSpec: str(r.control_spec),
  decks: str(r.decks),
  baseSeed: num(r.base_seed),
  shardCount: num(r.shard_count),
  gamesPerShard: num(r.games_per_shard),
  armWins: num(r.arm_wins),
  armGames: num(r.arm_games),
  controlWins: num(r.control_wins),
  controlGames: num(r.control_games),
  pairedMean: num(r.paired_mean),
  pairedSd: num(r.paired_sd),
  pairedT: r.paired_t === null ? null : num(r.paired_t),
  pairedDf: num(r.paired_df),
  significant: num(r.significant) === 1,
})

/**
 * One term-sensitivity run: which weights could change a decision, and how often.
 *
 * Stored because the question it answers is a **time series**, not a snapshot. "Has this weight woken
 * up since the search landed?" needs the old reading beside the new one, and until now every
 * `--terms` result printed to a terminal and vanished, so answering it meant re-running an hour of
 * compute or trawling scrollback.
 *
 * `model` is part of the row rather than assumed: a weight inert one ply deep can be pivotal inside a
 * search, so two runs of different models are not comparable and must not silently pool.
 */
export interface TermRunRow {
  runId: string
  startedAt: string
  buildTag: string
  model: string
  games: number
  decisions: number
}

export function saveTermRun(db: DatabaseSync, model: string, report: {
  games: number
  decisions: number
  stats: Array<{ weight: string; step: number; hasQuantity: boolean; varies: number; pivotal: number; loadBearing: number; spread: number }>
}): string {
  const startedAt = new Date().toISOString()
  const runId = `terms-${startedAt}-${randomUUID().slice(0, 8)}`
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      `INSERT INTO term_runs (run_id, started_at, build_tag, model, games, decisions) VALUES (?,?,?,?,?,?)`,
    ).run(runId, startedAt, COMMIT_ID, model, report.games, report.decisions)
    const insert = db.prepare(
      `INSERT INTO term_stats (run_id, weight, step, has_quantity, varies, pivotal, load_bearing, spread)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    for (const s of report.stats) {
      insert.run(runId, s.weight, s.step, s.hasQuantity ? 1 : 0, s.varies, s.pivotal, s.loadBearing, s.spread)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return runId
}

/** Every term run, newest first. */
export function listTermRuns(db: DatabaseSync): TermRunRow[] {
  return (db.prepare(`SELECT * FROM term_runs ORDER BY started_at DESC`).all() as Record<string, unknown>[])
    .map(r => ({
      runId: str(r.run_id), startedAt: str(r.started_at), buildTag: str(r.build_tag),
      model: str(r.model), games: num(r.games), decisions: num(r.decisions),
    }))
}

/** One run's per-weight rows, most pivotal first, which is the order a reader wants. */
export function termStatsFor(db: DatabaseSync, runId: string): Array<{ weight: string; pivotal: number; loadBearing: number; varies: number }> {
  return (db.prepare(
    `SELECT weight, pivotal, load_bearing, varies FROM term_stats WHERE run_id = ? ORDER BY pivotal DESC, weight`,
  ).all(runId) as Record<string, unknown>[])
    .map(r => ({ weight: str(r.weight), pivotal: num(r.pivotal), loadBearing: num(r.load_bearing), varies: num(r.varies) }))
}

/** Every comparison, newest first, so the history reads as one. */
export function listExperiments(db: DatabaseSync): ExperimentRow[] {
  return (db.prepare(
    `SELECT * FROM experiments ORDER BY started_at DESC, rowid DESC`,
  ).all() as Record<string, unknown>[]).map(mapExperiment)
}

/** The per-shard pairs behind one experiment, so it can be re-analysed without re-running it. */
export function experimentsFor(db: DatabaseSync, experimentId: string): Array<{ seed: number; armRate: number; controlRate: number; diff: number }> {
  return (db.prepare(
    `SELECT seed, arm_rate, control_rate, diff FROM experiment_shards WHERE experiment_id = ? ORDER BY seed`,
  ).all(experimentId) as Record<string, unknown>[])
    .map(r => ({ seed: num(r.seed), armRate: num(r.arm_rate), controlRate: num(r.control_rate), diff: num(r.diff) }))
}
