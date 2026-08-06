import { spawn } from 'node:child_process'
import { wilsonInterval } from './stats'

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
  }
}

/** Spawn every shard at once and resolve when all have finished. */
export async function runShards(config: ShardConfig): Promise<ShardResult[]> {
  const jobs = Array.from({ length: config.shards }, (_, i) => {
    const seed = config.baseSeed + i
    const args = [
      'src/bench/main.ts', '--games', String(config.games), '--seed', String(seed),
      config.aiA, config.aiB,
    ]
    return new Promise<ShardResult>(resolve => {
      // `nice` so a long run yields to interactive work: the suite times out under a saturated
      // machine, and a shard that finishes an hour later costs nothing.
      const child = spawn('nice', ['-n', '10', 'npx', 'tsx', ...args], { cwd: process.cwd() })
      let out = ''
      child.stdout.on('data', d => { out += String(d) })
      child.stderr.on('data', d => { out += String(d) })
      child.on('close', code => resolve(parseShardOutput(out, seed, code ?? 1)))
    })
  })
  return Promise.all(jobs)
}
