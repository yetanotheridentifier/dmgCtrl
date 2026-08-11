import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { wilsonInterval } from './stats'
import { COMMIT_ID } from '../buildIdentity'
import type { DeckSource } from './decks'

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

/** Where a run's per-shard results and logs live, one directory per run. */
export const SHARD_DIR = 'bench-results/shards'

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

const WIN_RATE = /win rate \([^)]*\)\s*:\s*([\d.]+)%/
const COMPLETED = /completed \/ dropped\s*:\s*(\d+) \/ (\d+)/

/** Read a child's report off its output, so a shard that failed to save is still counted. */
export function parseShardOutput(text: string, seed: number, exitCode: number): ShardResult {
  const rate = WIN_RATE.exec(text)
  const counts = COMPLETED.exec(text)
  return {
    seed,
    winRateA: rate ? Number(rate[1]) / 100 : 0,
    completed: counts ? Number(counts[1]) : 0,
    dropped: counts ? Number(counts[2]) : 0,
    exitCode,
    // Stamped so a later resume can tell whether this result describes the code now running.
    commitId: COMMIT_ID,
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
    if (!file.endsWith('.json')) continue
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

  const banked = loadShardResults(dir)
  const todo = pendingSeeds(config, banked)

  const jobs = todo.map(seed => {
    const args = [
      'src/bench/main.ts', '--games', String(config.games), '--seed', String(seed),
      ...(config.decks ? ['--decks', config.decks] : []),
      config.aiA, config.aiB,
    ]
    return new Promise<ShardResult>(resolve => {
      const log = createWriteStream(join(dir, `seed-${seed}.log`), { flags: 'a' })
      // `nice` so a long run yields to interactive work: the suite times out under a saturated
      // machine, and a shard that finishes an hour later costs nothing.
      const child = spawn('nice', ['-n', '10', 'npx', 'tsx', ...args], { cwd: process.cwd() })
      let out = ''
      const take = (d: unknown): void => { out += String(d); log.write(String(d)) }
      child.stdout.on('data', take)
      child.stderr.on('data', take)
      child.on('close', code => {
        log.end()
        const result = parseShardOutput(out, seed, code ?? 1)
        // Written before resolving, so a parent that dies next still leaves this shard banked.
        writeFileSync(join(dir, `seed-${seed}.json`), JSON.stringify(result, null, 2))
        resolve(result)
      })
    })
  })

  return mergeShardResults(config, banked, await Promise.all(jobs))
}
