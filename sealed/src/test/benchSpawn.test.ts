import { describe, it, expect } from 'vitest'
import { seedJobs, shardPayloadPath, type ShardConfig } from '../bench/shard'

/**
 * Mode-agnostic shard spawning (#492, phase 3).
 *
 * `runShards` knew three things at once: how to split a head-to-head into seeds, how to spawn a child,
 * and how to pool win rates. That is why **every other long mode is still serial** — the matrix, the
 * coverage sweep and the weight sweep cannot reach the spawning without inheriting the seed split and
 * the win-rate merge.
 *
 * The split now happens here and produces plain jobs; `spawnShards` runs whatever it is given and
 * knows nothing about seeds or win rates.
 *
 * **Job construction is the part worth testing.** A wrong argv does not crash: the child runs happily
 * with the wrong games count, the wrong deck population or the wrong AI, and the run reports a
 * confident number for an experiment nobody asked for. The spawning itself is exercised end to end by
 * every real run.
 */

const config = (over: Partial<ShardConfig> = {}): ShardConfig =>
  ({ shards: 3, games: 80, baseSeed: 100, aiA: 'beam-reply', aiB: 'greedy', ...over })

describe('seedJobs', () => {
  it('makes one job per outstanding seed, and only those', () => {
    const jobs = seedJobs(config(), [100, 102], 'dir')
    expect(jobs.map(j => j.id)).toEqual(['seed-100', 'seed-102'])
  })

  it('passes the games, the seed and both AI names through', () => {
    const [job] = seedJobs(config(), [100], 'dir')
    expect(job.args).toContain('--games')
    expect(job.args[job.args.indexOf('--games') + 1]).toBe('80')
    expect(job.args[job.args.indexOf('--seed') + 1]).toBe('100')
    // Positional and last, in order: the CLI reads aiA then aiB from the tail.
    expect(job.args.slice(-2)).toEqual(['beam-reply', 'greedy'])
  })

  /**
   * The payload path is where the parent reads the result from, and it must NOT end in `.json`:
   * `loadShardResults` and the progress scanner both glob `*.json` in the run directory, so a payload
   * picked up as a banked result would carry no exit code, inflating the progress total and reading as
   * unfinished work.
   */
  it('directs the child to write its result beside the log, not as a .json', () => {
    const [job] = seedJobs(config(), [100], 'runs/abc')
    const out = job.args[job.args.indexOf('--out') + 1]
    expect(out).toBe('runs/abc/seed-100.out')
    expect(out.endsWith('.json')).toBe(false)
  })

  /**
   * **The write path and the read path must be one definition.** The job builder passes `--out` and
   * the runner reads it back after the child exits. If those ever computed it differently the payload
   * would never be found, every shard would read as failed with no games, and the run would report a
   * confident total over nothing. Both call `shardPayloadPath`, and this pins that they agree.
   */
  it('passes exactly the path the runner will read back', () => {
    const [job] = seedJobs(config(), [100], 'runs/abc')
    expect(job.args[job.args.indexOf('--out') + 1]).toBe(shardPayloadPath('runs/abc', job.id))
  })

  /**
   * **The deck population is only passed when it is set.** Every historical run directory was created
   * without it, and the default is `mirror`; passing it unconditionally would be harmless for the
   * child but the flag belongs with the config that chose it. Getting this wrong silently swaps the
   * population, and a term absent from the mirror deck reports neutral rather than failing.
   */
  it('passes the deck source only when one was chosen', () => {
    expect(seedJobs(config(), [100], 'dir')[0].args).not.toContain('--decks')
    const coverage = seedJobs(config({ decks: 'coverage' }), [100], 'dir')[0].args
    expect(coverage[coverage.indexOf('--decks') + 1]).toBe('coverage')
  })

  /** Nothing outstanding is not an error, it is a fully resumed run. */
  it('makes no jobs when every shard is already banked', () => {
    expect(seedJobs(config(), [], 'dir')).toEqual([])
  })

  /**
   * **A child must never be told to shard.** It would recurse: each child spawning its own children,
   * forking the machine until it died. The flag simply is not in the argv, and this pins that.
   */
  it('never tells a child to shard, or to run its own control', () => {
    const [job] = seedJobs(config(), [100], 'dir')
    expect(job.args).not.toContain('--shard')
    expect(job.args).not.toContain('--control')
  })
})
