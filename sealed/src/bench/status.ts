import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { COMMIT_ID } from '../buildIdentity'
import type { ShardResult } from './shard'
import { SEATING_CYCLE } from './runBench'

/**
 * Where a run's per-shard results and logs live, one directory per run.
 *
 * Declared here rather than in `shard.ts` so the dependency runs one way: this module is pure reading
 * and formatting, `shard.ts` spawns processes and calls into it. `shard.ts` re-exports it, so every
 * existing importer is unaffected. The `ShardResult` import above is type-only and therefore erased,
 * leaving no runtime edge back.
 */
export const SHARD_DIR = 'bench-results/shards'

/** The manifest a run writes at launch, named once so the scan that skips it cannot drift. */
export const MANIFEST_FILE = 'run.json'

/**
 * Progress of a long run, without stopping it (#492, phase 0).
 *
 * Two failures this exists to prevent, both of which happened:
 *
 * - **A partial pool read as a result.** With 9 of 12 shards on disk, the mean of those nine looks
 *   exactly like an answer. Nothing on disk says how many shards were expected, because
 *   `shardRunKey` deliberately excludes the shard count so a run can resume at a different one. That
 *   is why a **manifest** is written at launch: completeness is otherwise unknowable.
 * - **A wall clock guessed rather than measured.** A screen announced at ~30 minutes took 4.3 hours,
 *   because `--shard 10 --games 80` is 80 games *per shard*. The rate is measurable the moment the
 *   first shard lands, so it never needs guessing again.
 */

/** Written when a run starts, so its progress can be read by anything, not just its launcher. */
export interface RunManifest {
  key: string
  aiA: string
  aiB: string
  decks?: string
  /** Number of shards requested. The one fact the run key cannot carry. */
  shards: number
  /** Games per shard. Total games is this times `shards`. */
  games: number
  baseSeed: number
  startedAt: string
  commitId: string
  /**
   * The shard ids this run expects, which is what a result file on disk is matched against.
   *
   * Ids rather than a seed range, because the matrix shards by pair rather than by seed and its
   * children are `matrix-0` upwards. One mechanism then serves both modes. Absent on manifests
   * written before this field existed, where the head-to-head's `seed-N` ids are derived instead.
   */
  shardIds?: string[]
  /** What kind of run this is, so the readout names a matrix as one rather than as an AI playing
   *  itself. Absent means head-to-head. */
  kind?: 'matrix'
  /** Total games across every shard, when it is not simply `shards * games`. The matrix deals a
   *  whole number of pairs per shard, so its shards differ by a pair and the product is a rounding. */
  gamesTotal?: number
}

/** A banked shard result, with which shard it is and when it landed. Kept separate so the summary
 *  stays pure. */
export interface ShardObservation {
  id: string
  result: ShardResult
  finishedAtMs: number
}

/**
 * What a shard writes **while it is still running** (#562).
 *
 * A `--shard 12 --games 2000` run went eight hours reporting `shards 0 of 12, games 0 of 24000, rate
 * unknown, eta unknown` with all twelve logs at 0 bytes, and was then lost. Every reading above comes
 * from a shard that has finished, and at 2,000 games a shard the first one finishes at the end.
 *
 * **It carries no win rate, by construction.** A partial run showing a rate is the mistake the word
 * PARTIAL exists to prevent, and the cheapest way to keep that guarantee is for the in-flight channel
 * to have no rate in it to show. What it carries is counted games and a clock.
 */
export interface ShardHeartbeat {
  gamesDone: number
  /** Games this shard will play in total, so a reader knows how far through it is. */
  gamesTotal: number
  startedAt: string
  updatedAt: string
  commitId: string
}

/**
 * How often a running shard writes its heartbeat.
 *
 * **Throttled by time, not by game count.** A `beam-reply` game takes about 35 seconds and a `greedy`
 * mirror game takes milliseconds, so "every N games" is either silent for an hour or thousands of
 * writes a second depending on the mode. One clock covers both.
 *
 * **A minute, because that is the resolution the runs need.** The interval bounds one thing only: how
 * stale a `--status` reading can be. The first write is never throttled, so a run still reports within
 * one game of starting, and the rate is a cumulative average over the shard, so a late write delays it
 * rather than biasing it. The runs being watched are 30 minutes a shard at the short end and 20 hours
 * at the long one, which a minute resolves finely either way.
 *
 * The real cadence is `max(this, one game)`, since a heartbeat is only written on a game boundary: at
 * 35 seconds a game it lands every other game, and on a fast mode it is this interval exactly.
 */
export const HEARTBEAT_INTERVAL_MS = 60_000

/**
 * How long a heartbeat may go unchanged before its shard is called stalled.
 *
 * **The threshold scales with the shard's own games**, because a heartbeat is only written on a game
 * boundary: a search deep enough to take ten minutes a game would trip any fixed timeout and report
 * every healthy shard as hung. The floor covers a shard whose games are fast enough that ten of them
 * is no time at all.
 *
 * **The floor is what bounds how far the write interval may rise.** A healthy shard writes every
 * `max(HEARTBEAT_INTERVAL_MS, one game)`, so an interval anywhere near this floor would report working
 * shards as hung. At a minute against five the margin is 5x, and `benchStatus.test.ts` pins it.
 */
export const STALL_FLOOR_MS = 5 * 60_000
const STALL_GAMES = 10

export interface RunProgress {
  manifest: RunManifest
  shardsDone: number
  shardsFailed: number
  shardsTotal: number
  /** Games on shards that have **landed**, and therefore the games that survive a crash. */
  gamesPlayed: number
  /** Games played by shards still running. Deliberately not added to `gamesPlayed`: at hour 20 of a
   *  23-hour run the question is how much is recoverable, and these are not. */
  gamesInFlight: number
  shardsLive: number
  shardsStalled: number
  gamesTotal: number
  complete: boolean
  /** Seconds per game, or null when nothing has reported yet. */
  secondsPerGame: number | null
  /** Where the rate came from. A landed shard measures a whole shard; a heartbeat measures a prefix
   *  of one, and the readout says so rather than presenting the two as the same claim. */
  rateSource: 'landed' | 'in-flight' | null
  /** Projected seconds still to run, or null when unknown or already complete. */
  etaSeconds: number | null
}

/** Where a child writes its heartbeat, derived from the payload path it was already given.
 *
 *  **One definition, so a child cannot report its progress somewhere its parent is not reading.** It
 *  carries the same constraint as the payload: not a `.json`, because `loadShardResults` and the
 *  progress scanner both glob `*.json` in the run directory and would read it back as a banked
 *  result carrying no exit code. */
export const heartbeatPathFor = (outPath: string): string => outPath.replace(/\.out$/, '') + '.progress'

/**
 * A throttled heartbeat writer for one shard: call it after every game, it writes on a clock.
 *
 * The first call always writes. That call is what says the shard is alive at all, and holding it back
 * for the interval would leave a run looking exactly as dead as the one this exists to prevent.
 */
export function heartbeatWriter(
  gamesTotal: number,
  emit: (h: ShardHeartbeat) => void,
  opts: { clock?: () => number; intervalMs?: number } = {},
): (gamesDone: number) => void {
  const clock = opts.clock ?? Date.now
  const intervalMs = opts.intervalMs ?? HEARTBEAT_INTERVAL_MS
  const startedAt = new Date(clock()).toISOString()
  let lastMs: number | null = null
  return (gamesDone: number): void => {
    const now = clock()
    if (lastMs !== null && now - lastMs < intervalMs) return
    lastMs = now
    emit({ gamesDone, gamesTotal, startedAt, updatedAt: new Date(now).toISOString(), commitId: COMMIT_ID })
  }
}

/** Seconds a game is taking on this shard, from its own two timestamps. */
const gameSeconds = (b: ShardHeartbeat): number =>
  b.gamesDone <= 0 ? 0 : (Date.parse(b.updatedAt) - Date.parse(b.startedAt)) / 1000 / b.gamesDone

/** Hung, or merely slow. See {@link STALL_FLOOR_MS} for why the threshold is not a constant. */
const stalled = (b: ShardHeartbeat, nowMs: number): boolean =>
  nowMs - Date.parse(b.updatedAt) > Math.max(STALL_FLOOR_MS, STALL_GAMES * gameSeconds(b) * 1000)

/** The shards this run expects, by id. Derived for a manifest written before ids existed. */
const shardIdsOf = (m: RunManifest): string[] =>
  m.shardIds ?? Array.from({ length: m.shards }, (_, i) => `seed-${m.baseSeed + i}`)

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

/**
 * Summarise one run from its manifest, whatever has landed, and whatever is still running.
 *
 * A result counts as progress only if it is **this** run's: one of its shard ids, from this build,
 * exited cleanly, and actually played something. The same four conditions `pendingSeeds` uses to
 * decide what to re-run, and they must agree: a shard this counts as done but that re-runs would show
 * a run as further along than it is.
 *
 * **A landed shard and a heartbeat answer different questions and are kept apart.** Landed games are
 * the ones that survive a crash, which is what the operator of a 23-hour run actually needs; in-flight
 * games say the run is moving and how fast. Merging them into one figure would report work as banked
 * that a power cut would take.
 *
 * Shards run in parallel from a common start, so a shard finishing after `t` seconds having played
 * `games` games gives the per-game rate directly, and every outstanding shard is expected to take the
 * same. A landed shard measures a whole shard rather than a prefix of one, so it wins where both exist.
 */
export function summariseRun(
  m: RunManifest,
  obs: ShardObservation[],
  nowMs: number,
  beats: ShardHeartbeat[] = [],
): RunProgress {
  const inRun = new Set(shardIdsOf(m))
  const mine = obs.filter(o => inRun.has(o.id) && o.result.commitId === m.commitId)
  const done = mine.filter(o => o.result.exitCode === 0 && o.result.completed > 0)
  const failed = mine.filter(o => o.result.exitCode !== 0 || o.result.completed === 0)

  const startedMs = Date.parse(m.startedAt)
  const landedRates = done.map(o => (o.finishedAtMs - startedMs) / 1000 / m.games).filter(r => r > 0)
  const landedRate = landedRates.length === 0 ? null : mean(landedRates)

  // Another build's heartbeat is another run's progress, exactly as its banked results would be.
  const running = beats.filter(b => b.commitId === m.commitId)
  const moving = running.filter(b => !stalled(b, nowMs))
  const beatRates = moving.map(gameSeconds).filter(r => r > 0)
  const beatRate = beatRates.length === 0 ? null : mean(beatRates)

  const complete = done.length >= m.shards
  const etaSeconds = complete
    // A shard takes `games * rate` from the shared start, so the run ends when the last one does.
    ? null
    : landedRate !== null ? startedMs / 1000 + m.games * landedRate - nowMs / 1000
    // From heartbeats the shards are at different points, so the finish is the slowest one's, not the
    // average: a run is not done when its typical shard is.
    : moving.length > 0 && beatRate !== null
      ? Math.max(...moving.map(b => (b.gamesTotal - b.gamesDone) * gameSeconds(b)))
      : null

  return {
    manifest: m,
    shardsDone: done.length,
    shardsFailed: failed.length,
    shardsTotal: m.shards,
    gamesPlayed: done.reduce((n, o) => n + o.result.completed, 0),
    // A stalled shard's games were played and are not in doubt; only its liveness is.
    gamesInFlight: running.reduce((n, b) => n + b.gamesDone, 0),
    shardsLive: moving.length,
    shardsStalled: running.length - moving.length,
    gamesTotal: m.gamesTotal ?? m.shards * m.games,
    complete,
    secondsPerGame: landedRate ?? beatRate,
    rateSource: landedRate !== null ? 'landed' : beatRate !== null ? 'in-flight' : null,
    etaSeconds,
  }
}

const clock = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const mnt = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h${String(mnt).padStart(2, '0')}m` : `${mnt}m${String(s % 60).padStart(2, '0')}s`
}

/**
 * Render progress for a terminal or for `STATUS.md`.
 *
 * **`PARTIAL` is the load-bearing word.** An incomplete run must never be presented in a way that
 * invites reading its shards as a result, which is the mistake this phase exists to stop, so the state
 * leads every line and no pooled win rate appears here at all.
 */
export function renderStatus(runs: RunProgress[], nowMs: number): string {
  if (runs.length === 0) return 'no runs found in ' + SHARD_DIR
  const lines = [`bench runs  (${new Date(nowMs).toISOString()})`, '']
  for (const r of runs) {
    const m = r.manifest
    const state = r.complete ? 'COMPLETE' : 'PARTIAL '
    // A prefix of a shard is not the same claim as a whole one, so the reading says which it is.
    const rate = r.secondsPerGame === null
      ? 'rate unknown'
      : `${r.secondsPerGame.toFixed(1)}s/game${r.rateSource === 'in-flight' ? ' (in flight)' : ''}`
    const eta = r.complete ? 'done' : r.etaSeconds === null ? 'eta unknown' : `~${clock(r.etaSeconds)} left`
    lines.push(
      `  ${state}  ${m.kind === 'matrix' ? `matrix ${m.aiA}` : `${m.aiA} vs ${m.aiB}`}${m.decks ? `  [${m.decks}]` : ''}`,
      `            shards ${r.shardsDone} of ${r.shardsTotal}` +
        (r.shardsFailed > 0 ? `  (${r.shardsFailed} FAILED)` : '') +
        `   games ${r.gamesPlayed} of ${r.gamesTotal} banked`,
    )
    // Only when something is running: a finished run's line would otherwise read as work outstanding.
    if (r.shardsLive > 0 || r.shardsStalled > 0) {
      lines.push(
        `            ${r.gamesInFlight} more games in flight across ${r.shardsLive} shard(s)` +
          (r.shardsStalled > 0 ? `  (${r.shardsStalled} STALLED)` : ''),
      )
    }
    lines.push(
      `            ${rate}   ${eta}   started ${m.startedAt}`,
      `            ${m.key}`,
      '',
    )
  }
  const partial = runs.filter(r => !r.complete).length
  if (partial > 0) {
    lines.push(`  ${partial} run(s) still going. A partial run is not a result: do not pool it.`, '')
  }
  return lines.join('\n')
}

/**
 * Checks worth making before a run starts rather than discovering afterwards.
 *
 * `SEATING_CYCLE` is 4 and seat and first player cycle on independent axes, so a games-per-shard that
 * is not a whole number of cycles leaves a tail covering only some of the four combinations. It biases
 * an arm and its control identically, so a paired figure survives it, but it is the same class of
 * defect as the seat bias that made self-play read 48.3%.
 */
export function preflight(config: { shards: number; games: number }): string[] {
  const out: string[] = []
  if (config.games % SEATING_CYCLE !== 0) {
    out.push(
      `games per shard (${config.games}) is not a multiple of the seating cycle (${SEATING_CYCLE}): ` +
      `the last ${config.games % SEATING_CYCLE} game(s) of each shard cover only some seat and ` +
      `first-player combinations. Use ${config.games - (config.games % SEATING_CYCLE)} or ` +
      `${config.games + SEATING_CYCLE - (config.games % SEATING_CYCLE)}.`,
    )
  }
  return out
}

/** Read every run on disk, newest first. Unreadable manifests are skipped rather than fatal. */
export function loadAllProgress(root: string = SHARD_DIR, nowMs: number = Date.now()): RunProgress[] {
  if (!existsSync(root)) return []
  const out: RunProgress[] = []
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry)
    const manifestPath = join(dir, MANIFEST_FILE)
    if (!existsSync(manifestPath)) continue
    let manifest: RunManifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RunManifest
    } catch {
      continue
    }
    const obs: ShardObservation[] = []
    const beats: ShardHeartbeat[] = []
    for (const file of readdirSync(dir)) {
      // Every shard mode names its files after its shard id, so the id is the basename and no mode
      // needs its own scan. `run.json` is the manifest already read above, not a result.
      try {
        if (file.endsWith('.json') && file !== MANIFEST_FILE) {
          const result = JSON.parse(readFileSync(join(dir, file), 'utf8')) as ShardResult
          obs.push({ id: file.slice(0, -'.json'.length), result, finishedAtMs: statSync(join(dir, file)).mtimeMs })
        } else if (file.endsWith('.progress')) {
          beats.push(JSON.parse(readFileSync(join(dir, file), 'utf8')) as ShardHeartbeat)
        }
      } catch {
        // Half-written when the machine died. Not a reading, and its shard will be re-run.
      }
    }
    out.push(summariseRun(manifest, obs, nowMs, beats))
  }
  return out.sort((a, b) => Date.parse(b.manifest.startedAt) - Date.parse(a.manifest.startedAt))
}

/**
 * Rewrite the at-a-glance file, so a long run can be watched from an editor tab.
 *
 * Called every time a shard lands. Terminal output is not a reliable channel to a human watching a
 * multi-hour run: a file on disk that an editor reloads is, and it costs one write per shard.
 */
export function writeStatusFile(root: string = SHARD_DIR, nowMs: number = Date.now()): void {
  if (!existsSync(root)) return
  const body = renderStatus(loadAllProgress(root, nowMs), nowMs)
  writeFileSync(join(dirname(root), 'STATUS.md'), `# Bench runs\n\n\`\`\`\n${body}\n\`\`\`\n`)
}

/**
 * Write a shard's heartbeat, and forget it the moment the shard lands.
 *
 * **Deleting it is what keeps the readout honest.** A heartbeat's existence is the whole of "this
 * shard is still running", so one left behind by a finished shard would report games as in flight that
 * are already banked, and count them twice.
 */
export function writeHeartbeat(path: string, beat: ShardHeartbeat): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(beat))
}

export function clearHeartbeat(path: string): void {
  rmSync(path, { force: true })
}

/** The manifest for a run about to start. */
export function makeManifest(
  config: {
    shards: number
    games: number
    baseSeed: number
    aiA: string
    aiB: string
    decks?: string
    shardIds?: string[]
    kind?: 'matrix'
    gamesTotal?: number
  },
  key: string,
  startedAt: string = new Date().toISOString(),
): RunManifest {
  return {
    key,
    aiA: config.aiA,
    aiB: config.aiB,
    decks: config.decks,
    shards: config.shards,
    games: config.games,
    baseSeed: config.baseSeed,
    startedAt,
    commitId: COMMIT_ID,
    // The head-to-head's ids are its seeds, so it says nothing and they are derived.
    shardIds: config.shardIds,
    kind: config.kind,
    gamesTotal: config.gamesTotal,
  }
}
