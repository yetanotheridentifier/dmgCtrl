import { describe, it, expect } from 'vitest'
import { summariseRun, renderStatus, preflight, type RunManifest, type ShardObservation } from '../bench/status'
import type { ShardResult } from '../bench/shard'

/**
 * Seeing a long run without stopping it (#492, phase 0).
 *
 * Two failures this exists to prevent, both of which happened rather than being imagined.
 *
 * **A partial pool read as a result.** With 9 of 12 shards on disk I read the mean of those nine and
 * drew a conclusion from it; the user has done the same and called it jumping the gun. Nothing on disk
 * says how many shards were expected, because `shardRunKey` deliberately excludes the shard count so a
 * run can resume at a different one. So progress cannot be inferred from the result files at all, and
 * a **manifest written at launch** is what makes completeness knowable.
 *
 * **A wall clock guessed rather than measured.** A five-arm screen was announced at ~30 minutes and
 * took 4.3 hours, because `--shard 10 --games 80` is 80 games *per shard*: 800 games, and the wall
 * clock is set by games-per-shard rather than by the total. The rate is measurable from the first
 * shard that lands, so it should never be guessed again.
 */

const manifest = (over: Partial<RunManifest> = {}): RunManifest => ({
  key: 'a__vs__b__g80__s100',
  aiA: 'a',
  aiB: 'b',
  shards: 4,
  games: 80,
  baseSeed: 100,
  startedAt: new Date(1_000_000).toISOString(),
  commitId: 'abc123',
  ...over,
})

const shard = (seed: number, over: Partial<ShardResult> = {}): ShardResult => ({
  seed, winRateA: 0.5, completed: 80, dropped: 0, exitCode: 0, commitId: 'abc123', ...over,
})

/** A shard that finished `seconds` after the run started. */
const obs = (seed: number, seconds: number, over: Partial<ShardResult> = {}): ShardObservation =>
  ({ result: shard(seed, over), finishedAtMs: 1_000_000 + seconds * 1000 })

describe('summariseRun', () => {
  it('is incomplete until every requested shard has landed', () => {
    const p = summariseRun(manifest(), [obs(100, 60), obs(101, 60)], 1_000_000 + 90_000)
    expect(p.shardsDone).toBe(2)
    expect(p.shardsTotal).toBe(4)
    expect(p.complete, 'two of four is not a result').toBe(false)
    expect(p.gamesPlayed).toBe(160)
    expect(p.gamesTotal).toBe(320)
  })

  it('is complete only when all of them have', () => {
    const p = summariseRun(manifest(), [obs(100, 60), obs(101, 61), obs(102, 62), obs(103, 63)], 1_000_000 + 70_000)
    expect(p.complete).toBe(true)
    expect(p.etaSeconds, 'nothing left to wait for').toBeNull()
  })

  /**
   * **Measured, not guessed.** Shards run in parallel from the same start, so one shard finishing after
   * `t` seconds having played `games` games gives the per-game rate directly, and the run ends when the
   * slowest shard does.
   */
  it('measures seconds per game from the shards that have finished', () => {
    // 80 games in 160s => 2 s/game.
    const p = summariseRun(manifest(), [obs(100, 160)], 1_000_000 + 200_000)
    expect(p.secondsPerGame).toBeCloseTo(2, 6)
    // The outstanding shards are expected to take the same 160s from the start, so ~0 remains at t=200.
    expect(p.etaSeconds).toBeLessThanOrEqual(0)
  })

  it('projects the remaining time from that rate', () => {
    // 80 games in 800s => 10 s/game, so a shard takes 800s and we are 200s in.
    const p = summariseRun(manifest(), [obs(100, 800)], 1_000_000 + 200_000)
    expect(p.secondsPerGame).toBeCloseTo(10, 6)
    expect(p.etaSeconds).toBeCloseTo(600, 0)
  })

  /** Before anything lands there is no rate, and inventing one is how a 30-minute estimate became
   *  4.3 hours. Report that it is unknown. */
  it('reports no rate and no estimate before the first shard lands', () => {
    const p = summariseRun(manifest(), [], 1_000_000 + 5_000)
    expect(p.secondsPerGame).toBeNull()
    expect(p.etaSeconds).toBeNull()
    expect(p.shardsDone).toBe(0)
  })

  /** A failed shard is not progress: it contributed no games and must be visible, since a run that
   *  quietly pools fewer games than requested is the failure the whole mechanism exists to prevent. */
  it('counts a failed shard separately from a finished one', () => {
    const p = summariseRun(manifest(), [obs(100, 60), obs(101, 60, { exitCode: 137, completed: 0 })], 1_000_000 + 90_000)
    expect(p.shardsFailed).toBe(1)
    expect(p.shardsDone, 'a shard that played nothing has not done anything').toBe(1)
    expect(p.gamesPlayed).toBe(80)
  })

  /** Results banked by a different build are not this run's progress: `pendingSeeds` will re-run them,
   *  so counting them would show a run as further along than it is. */
  it('ignores results stamped with another commit', () => {
    const p = summariseRun(manifest(), [obs(100, 60), obs(101, 60, { commitId: 'stale' })], 1_000_000 + 90_000)
    expect(p.shardsDone).toBe(1)
  })

  /** Seeds outside the requested range belong to a longer earlier run and are not this one's. */
  it('ignores seeds outside the run', () => {
    const p = summariseRun(manifest(), [obs(100, 60), obs(999, 60)], 1_000_000 + 90_000)
    expect(p.shardsDone).toBe(1)
  })
})

describe('renderStatus', () => {
  const partial = summariseRun(manifest(), [obs(100, 60), obs(101, 60)], 1_000_000 + 90_000)

  /** **The word PARTIAL is the whole point.** A pooled figure printed beside an incomplete run is what
   *  invites the conclusion this phase exists to stop. */
  it('marks an incomplete run and never shows it as a result', () => {
    const text = renderStatus([partial], 1_000_000 + 90_000)
    expect(text).toContain('PARTIAL')
    expect(text).toContain('2 of 4')
  })

  it('marks a finished run complete', () => {
    const done = summariseRun(manifest(), [obs(100, 60), obs(101, 60), obs(102, 60), obs(103, 60)], 1_000_000 + 70_000)
    expect(renderStatus([done], 1_000_000 + 70_000)).toContain('COMPLETE')
  })

  it('says so plainly when nothing is running', () => {
    expect(renderStatus([], Date.now())).toMatch(/no runs/i)
  })
})

describe('preflight', () => {
  /**
   * `SEATING_CYCLE` is 4 and seat and first player cycle on independent axes, so games-per-shard that
   * is not a multiple of four leaves a tail covering only some of the four combinations. Chosen 170 by
   * hand once, which left two such games in every shard.
   */
  it('warns when games per shard is not a whole number of seating cycles', () => {
    expect(preflight({ shards: 12, games: 170 }).join(' ')).toMatch(/seating/i)
    expect(preflight({ shards: 12, games: 168 })).toEqual([])
  })

  /** The 80-versus-800 confusion: the flag is per shard, and the total is the product. State both. */
  it('states the total games and that the flag is per shard', () => {
    const warnings = preflight({ shards: 10, games: 80 })
    expect(warnings).toEqual([])
    // The total belongs in the summary rather than the warnings, so it is asserted on the renderer.
    expect(renderStatus([summariseRun(manifest({ shards: 10, games: 80 }), [], 1_000_000)], 1_000_000))
      .toContain('800')
  })
})
