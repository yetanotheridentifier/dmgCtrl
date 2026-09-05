import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
// `readFileSync` is used for both banked results and a child's `--out` payload.
import { join } from 'node:path'
import { wilsonInterval, firstPlayerSplit, type FirstPlayerSplit } from './stats'
import { COMMIT_ID } from '../buildIdentity'
import type { DeckSource } from './decks'
import { SHARD_DIR, MANIFEST_FILE, makeManifest, writeStatusFile, clearHeartbeat, heartbeatPathFor } from './status'

export { SHARD_DIR }

/**
 * Run one A/B as N single-threaded processes and pool the result (#447, #488).
 *
 * The bench is single-threaded and the dev machine has 16 cores, so a run that would take 58 or 416
 * core-hours takes a twelfth of that in wall clock for the cost of a loop. This is what removed the
 * case for cloud compute (#449): the experiments were never large, they were just serial.
 *
 * Sharding by **seed** rather than by splitting one seed's games keeps every shard a valid standalone
 * run, which is exactly what the existing three-seed results already are. It also preserves the
 * property those runs lean on: a finding that holds across independent seeds is much stronger than
 * one from a single long run, so the shards are worth reading individually as well as pooled.
 *
 * Children are spawned as `tsx src/bench/main.ts` rather than `npm run bench`, deliberately. The npm
 * script has a `prebench` step that regenerates `src/buildIdentity.ts`, and twelve processes
 * rewriting one file while others import it is a race that would eventually read a half-written
 * module. The parent has already generated it once, and it does not change during the run.
 */

export interface ShardResult {
  seed: number
  winRateA: number
  completed: number
  dropped: number
  /** Non-zero means the shard failed outright and contributed nothing. */
  exitCode: number
  /**
   * The engine build that produced this result.
   *
   * Load-bearing for resuming, not decoration. The run key is built from the AI names, the game count
   * and the seed, none of which change when the code does, so without this a re-run after an
   * evaluation change finds every shard complete, replays the old numbers in 0.0s and reports them as
   * the new measurement. Absent on results banked before this field existed.
   */
  commitId?: string
  /** aiA's on-play half, when this shard recorded one. Absent on results banked before it existed. */
  gamesOnPlay?: number
  winsOnPlay?: number
}

export interface PooledResult {
  winRateA: number
  /** Half-width of the 95% band on the pooled total. */
  winCi: number
  wins: number
  completed: number
}

/**
 * Pool shards by summing games, never by averaging rates.
 *
 * An unweighted mean of the shards' win rates is only correct when every shard completed the same
 * number of games, and shards drop games: a dropped game leaves its shard's denominator, so the mean
 * silently over-weights whichever shard lost the most. Summing the counts and recomputing is both
 * correct and the only way to get an interval over the whole run rather than a mean of N wide ones.
 */
export function poolShards(shards: Array<{ winRateA: number; completed: number }>): PooledResult {
  const completed = shards.reduce((n, s) => n + s.completed, 0)
  // `winRateA` is `winsA / completed` by construction, so this recovers an exact integer count.
  const wins = shards.reduce((n, s) => n + Math.round(s.winRateA * s.completed), 0)
  const { rate, halfWidth } = wilsonInterval(wins, completed)
  return { winRateA: completed === 0 ? 0 : rate, winCi: halfWidth, wins, completed }
}

/**
 * Pool the first-player split across shards, or refuse.
 *
 * This is where the sample that makes the split readable comes from: a sharded run is the only path
 * that plays tens of thousands of games. But shards are **resumed from results banked on disk**, and
 * a banked result from before this field existed carries no halves. Treating a missing half as zero
 * would report a first-player rate over a fraction of the games while looking like a whole run, which
 * is the same failure the pooled total is guarded against, so one absent half refuses the pool.
 */
export function poolFirstPlayer(
  shards: Array<{ winRateA: number; completed: number; gamesOnPlay?: number; winsOnPlay?: number }>,
): FirstPlayerSplit | null {
  if (shards.length === 0) return null
  if (shards.some(s => s.gamesOnPlay === undefined || s.winsOnPlay === undefined)) return null
  const gamesOnPlay = shards.reduce((n, s) => n + s.gamesOnPlay!, 0)
  const winsOnPlay = shards.reduce((n, s) => n + s.winsOnPlay!, 0)
  const completed = shards.reduce((n, s) => n + s.completed, 0)
  // `winRateA` is `winsA / completed` by construction, as in `poolShards`.
  const wins = shards.reduce((n, s) => n + Math.round(s.winRateA * s.completed), 0)
  return firstPlayerSplit(winsOnPlay, gamesOnPlay, wins - winsOnPlay, completed - gamesOnPlay)
}

export interface ShardConfig {
  shards: number
  /** Games per shard. Total games is this times `shards`. */
  games: number
  /** First seed; shard `i` runs seed `baseSeed + i`, so a batch is reproducible. */
  baseSeed: number
  aiA: string
  aiB: string
  /**
   * Deck population. Part of the run key, because results from different populations must never pool:
   * a term absent from the mirror deck reports neutral there and fires on the coverage decks, so
   * merging the two would average a real measurement with a vacuous one.
   */
  decks?: DeckSource
}

/**
 * Identify a run by what makes it that run: the two AIs, the games per shard, and the first seed.
 *
 * **Shard count is deliberately excluded.** Resuming an interrupted run with a different shard count
 * is a reasonable thing to want (memory pressure is the obvious reason), and keying on it would
 * orphan every result already on disk.
 *
 * AI specs carry colons, which are legal in a name and a nuisance in a path, so everything outside a
 * conservative set is replaced rather than escaped.
 */
export function shardRunKey(config: ShardConfig): string {
  const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, '_')
  // The deck source is only in the key when it is not the default, so every existing run directory
  // keeps its name and remains resumable.
  const decks = config.decks && config.decks !== 'mirror' ? `__d${safe(config.decks)}` : ''
  return `${safe(config.aiA)}__vs__${safe(config.aiB)}__g${config.games}__s${config.baseSeed}${decks}`
}

/**
 * Which seeds still need playing, given what is already on disk.
 *
 * A shard counts as done only if it exited cleanly **and played something**. An OOM kill can leave a
 * process that exited zero having completed nothing, and treating that as finished would silently
 * shrink the pooled total, which is the failure this whole mechanism exists to prevent.
 *
 * Results for seeds outside the current run are ignored rather than trusted: a longer earlier run
 * leaves files behind, and letting them satisfy a shorter one would pool two different experiments.
 *
 * **And neither may results produced by different code.** The run key cannot see a code change, so a
 * re-run after editing an evaluation term found ten complete shards, replayed the previous numbers in
 * 0.0s and presented them as the new measurement. It matched the earlier run's win rate to the game,
 * which is the only reason it was noticed. A mismatched or missing stamp re-runs the shard: resuming
 * an interrupted run of the SAME code, which is what this exists for, is unaffected.
 */
export function pendingSeeds(config: ShardConfig, done: ShardResult[]): number[] {
  const finished = new Set(
    done.filter(r => r.exitCode === 0 && r.completed > 0 && r.commitId === COMMIT_ID).map(r => r.seed),
  )
  return Array.from({ length: config.shards }, (_, i) => config.baseSeed + i)
    .filter(seed => !finished.has(seed))
}

/** What a child writes with `--out`: the numbers a parent needs to pool and to resume, nothing more.
 *  The per-game rows are already in the database and no parent reads them. */
export interface ShardPayload {
  seed: number
  winRateA: number
  completed: number
  dropped: number
  commitId: string
  /** aiA's on-play half. Absent on results banked before the split existed. */
  gamesOnPlay?: number
  winsOnPlay?: number
}

/** Project a finished report down to what the parent will read back. */
export function shardPayload(
  report: { winRateA: number; completed: number; dropped: number; commitId: string; gamesOnPlay?: number; winsOnPlay?: number },
  seed: number,
): ShardPayload {
  return {
    seed,
    winRateA: report.winRateA,
    completed: report.completed,
    dropped: report.dropped,
    commitId: report.commitId,
    gamesOnPlay: report.gamesOnPlay,
    winsOnPlay: report.winsOnPlay,
  }
}

const isPayload = (v: unknown): v is ShardPayload => {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return typeof p.winRateA === 'number' && typeof p.completed === 'number' && typeof p.dropped === 'number'
}

/**
 * Turn a child's payload into this run's result, adding the exit code only the parent knows.
 *
 * **Replaces regexing the child's printed report.** That worked for two numbers and could not scale to
 * a mode returning 2,628 cells, and it silently coupled what a run measured to how the report was
 * worded. A missing or malformed payload is recorded as a failed shard with no games rather than
 * guessed at: `pendingSeeds` then re-runs it, where inventing a rate would quietly shrink the pooled
 * total, which is the failure this whole mechanism exists to prevent.
 *
 * The parent's seed wins over the payload's. The file is named for the seed the parent asked for, so a
 * disagreement is a mismatch to correct rather than to propagate.
 */
export function shardResultFrom(payload: unknown, seed: number, exitCode: number): ShardResult {
  if (!isPayload(payload)) {
    return { seed, winRateA: 0, completed: 0, dropped: 0, exitCode, commitId: COMMIT_ID }
  }
  return {
    seed,
    winRateA: payload.winRateA,
    completed: payload.completed,
    dropped: payload.dropped,
    exitCode,
    // Stamped so a later resume can tell whether this result describes the code now running.
    commitId: typeof payload.commitId === 'string' ? payload.commitId : COMMIT_ID,
    gamesOnPlay: typeof payload.gamesOnPlay === 'number' ? payload.gamesOnPlay : undefined,
    winsOnPlay: typeof payload.winsOnPlay === 'number' ? payload.winsOnPlay : undefined,
  }
}

/**
 * Combine banked results with freshly run ones into the run's full set.
 *
 * Kept separate from `runShards` and tested directly, because getting it wrong is **silent**: a
 * resumed run that pooled only its fresh shards would report a win rate over a fraction of the games,
 * with a plausibly wider interval and nothing to indicate anything was missing. That is a worse
 * failure than the crash it is recovering from.
 *
 * Fresh always wins over banked for the same seed, since a seed is only re-run because its banked
 * result was unusable.
 */
export function mergeShardResults(
  config: ShardConfig,
  banked: ShardResult[],
  fresh: ShardResult[],
): ShardResult[] {
  const inRun = new Set(Array.from({ length: config.shards }, (_, i) => config.baseSeed + i))
  const bySeed = new Map<number, ShardResult>()
  for (const r of banked) if (inRun.has(r.seed)) bySeed.set(r.seed, r)
  for (const r of fresh) if (inRun.has(r.seed)) bySeed.set(r.seed, r)
  return [...bySeed.values()].sort((a, b) => a.seed - b.seed)
}

/** Read whatever this run has already completed, ignoring anything unreadable. */
export function loadShardResults(dir: string): ShardResult[] {
  if (!existsSync(dir)) return []
  const out: ShardResult[] = []
  for (const file of readdirSync(dir)) {
    // The manifest shares the directory and the extension, and is not a result.
    if (!file.endsWith('.json') || file === MANIFEST_FILE) continue
    try {
      out.push(JSON.parse(readFileSync(join(dir, file), 'utf8')) as ShardResult)
    } catch {
      // A file half-written when the machine died is not a result. Re-running its seed is correct.
    }
  }
  return out
}

/**
 * Spawn the outstanding shards and resolve when all have finished.
 *
 * Two things a long run cannot do without, both learned from the 8.7-hour width A/B and both aimed at
 * the 65 to 75 hour depth run:
 *
 * - **Each shard's output is streamed to a file as it arrives.** Buffering it in memory until exit
 *   meant a multi-day run gave no signal at all: no way to tell 20% done from 80%, or slow from hung.
 * - **Each result is written the moment its shard finishes.** Losing sixty hours because shard nine
 *   was OOM-killed is bad; losing it silently, as a pooled total quietly short of the games
 *   requested, is worse.
 *
 * Re-running the identical command resumes: finished shards are skipped, failed ones repeat.
 */
export async function runShards(config: ShardConfig): Promise<ShardResult[]> {
  const dir = join(SHARD_DIR, shardRunKey(config))
  mkdirSync(dir, { recursive: true })

  // The manifest is what makes progress readable by anything other than this process. The run key
  // deliberately excludes the shard count so a run can resume at a different one, which means the
  // result files alone can never say how many shards were expected, and a subset of them looks exactly
  // like a finished run. Written before the first child starts, so `--status` sees a run immediately.
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(makeManifest(config, shardRunKey(config)), null, 2))

  const banked = loadShardResults(dir)
  const todo = pendingSeeds(config, banked)

  const outcomes = await spawnShards(dir, seedJobs(config, todo, dir), outcome => {
    // Banked the moment its shard lands, so a parent that dies next still leaves the work done, and
    // the at-a-glance view tracks a multi-hour run without anyone having to ask it to.
    const seed = Number(outcome.id.replace('seed-', ''))
    const result = shardResultFrom(outcome.payload, seed, outcome.exitCode)
    writeFileSync(join(dir, `${outcome.id}.json`), JSON.stringify(result, null, 2))
    // The shard is no longer in flight, and a heartbeat left behind would report its games as both
    // banked and outstanding.
    clearHeartbeat(heartbeatPathFor(shardPayloadPath(dir, outcome.id)))
    writeStatusFile()
  })

  const fresh = outcomes.map(o => shardResultFrom(o.payload, Number(o.id.replace('seed-', '')), o.exitCode))
  return mergeShardResults(config, banked, fresh)
}

/**
 * One child process: what to name its files, and what to pass it.
 *
 * Deliberately just an id and an argv. A mode supplies its own jobs, so the spawning below knows
 * nothing about seeds, deck pairs or win rates, which is what stops every new mode inheriting the
 * head-to-head's split and merge.
 */
export interface ShardJob {
  /** Names the log and the payload file, so a job is independently re-runnable and inspectable. */
  id: string
  /** Argv after the `tsx` invocation, including the script path. */
  args: string[]
}

export interface ShardOutcome {
  id: string
  exitCode: number
  /** Whatever the child wrote with `--out`, or null if it wrote nothing readable. */
  payload: unknown
}

/**
 * Where a job's child writes its result, and where the parent reads it back.
 *
 * **One definition used by both sides.** The job builder passes this as `--out` and the runner reads
 * it after the child exits; if those two ever computed it differently the payload would never be
 * found, every shard would read as failed with no games, and the run would report a confident total
 * over nothing.
 *
 * Deliberately not a `.json` extension: `loadShardResults` and the progress scanner both glob `*.json`
 * in the run directory, and a payload picked up as a banked result would carry no exit code.
 */
export const shardPayloadPath = (dir: string, id: string): string => join(dir, `${id}.out`)

/**
 * Split a head-to-head into one job per outstanding seed.
 *
 * The head-to-head's partition, and now just one of several a mode could supply. Sharding by **seed**
 * rather than by dividing one seed's games keeps every shard a valid standalone run, which is what
 * makes the per-shard column worth reading and a single disagreeing shard a signal.
 *
 * **No `--shard` or `--control` in the argv.** A child told to shard would spawn its own children and
 * fork the machine until it died.
 */
export function seedJobs(config: ShardConfig, seeds: number[], dir: string): ShardJob[] {
  return seeds.map(seed => ({
    id: `seed-${seed}`,
    args: [
      'src/bench/main.ts', '--games', String(config.games), '--seed', String(seed),
      '--out', shardPayloadPath(dir, `seed-${seed}`),
      ...(config.decks ? ['--decks', config.decks] : []),
      config.aiA, config.aiB,
    ],
  }))
}

/**
 * Run every job as a child process and resolve when all have finished.
 *
 * Mode-agnostic: it spawns what it is given and reads back what each child wrote. Two properties a
 * long run cannot do without, both learned from the 8.7-hour width A/B:
 *
 * - **Each child's output is streamed to a file as it arrives.** Buffering until exit meant a
 *   multi-day run gave no signal at all: no way to tell 20% done from 80%, or slow from hung. It is
 *   streamed but no longer PARSED, because what a run measured must not depend on how its report is
 *   worded.
 * - **`onDone` fires the moment a child exits**, so a caller can bank the result before the parent has
 *   any chance to die. Losing sixty hours because shard nine was OOM-killed is bad; losing it
 *   silently, as a pooled total quietly short of the games requested, is worse.
 *
 * Children are spawned as `tsx src/bench/main.ts` rather than `npm run bench`, deliberately. The npm
 * script has a `prebench` step that regenerates `src/buildIdentity.ts`, and a dozen processes
 * rewriting one file while others import it is a race that would eventually read a half-written
 * module. The parent has already generated it once and it does not change during the run.
 */
export async function spawnShards(
  dir: string,
  jobs: ShardJob[],
  onDone?: (outcome: ShardOutcome) => void,
): Promise<ShardOutcome[]> {
  return Promise.all(jobs.map(job => new Promise<ShardOutcome>(resolve => {
    const log = createWriteStream(join(dir, `${job.id}.log`), { flags: 'a' })
    // `nice` so a long run yields to interactive work: the suite times out under a saturated machine,
    // and a shard that finishes an hour later costs nothing.
    const child = spawn('nice', ['-n', '10', 'npx', 'tsx', ...job.args], { cwd: process.cwd() })
    const take = (d: unknown): void => { log.write(String(d)) }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('close', code => {
      log.end()
      let payload: unknown = null
      try {
        payload = JSON.parse(readFileSync(shardPayloadPath(dir, job.id), 'utf8'))
      } catch {
        // Never written, or written half way. Either way this job produced no result.
      }
      const outcome: ShardOutcome = { id: job.id, exitCode: code ?? 1, payload }
      onDone?.(outcome)
      resolve(outcome)
    })
  })))
}
