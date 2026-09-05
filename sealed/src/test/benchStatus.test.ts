import { describe, it, expect } from 'vitest'
import {
  summariseRun, renderStatus, preflight, heartbeatWriter, HEARTBEAT_INTERVAL_MS, STALL_FLOOR_MS,
  type RunManifest, type ShardObservation, type ShardHeartbeat,
} from '../bench/status'
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
  ({ id: `seed-${seed}`, result: shard(seed, over), finishedAtMs: 1_000_000 + seconds * 1000 })

const iso = (ms: number): string => new Date(ms).toISOString()

/** A shard still running: `games` played by `seconds` after the run started. */
const beat = (games: number, seconds: number, over: Partial<ShardHeartbeat> = {}): ShardHeartbeat => ({
  gamesDone: games,
  gamesTotal: 80,
  startedAt: iso(1_000_000),
  updatedAt: iso(1_000_000 + seconds * 1000),
  commitId: 'abc123',
  ...over,
})

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

/**
 * Progress from shards that have NOT landed (#562).
 *
 * The failure this exists to stop: a `--shard 12 --games 2000` run went eight hours reporting
 * `shards 0 of 12, games 0 of 24000, rate unknown, eta unknown`, with all twelve logs at 0 bytes,
 * and was then lost. Nothing on disk could say whether it was 5% through or 95%, or whether it was
 * moving at all. Every reading above comes from a shard that has finished, and at 2,000 games a shard
 * the first one finishes at the end.
 *
 * So a running shard writes a **heartbeat**: how many games it has played and when it last said so.
 *
 * **A heartbeat carries no win rate, by construction.** A partial run showing a rate is the mistake
 * phase 0 exists to prevent, and the cheapest way to keep that guarantee is for the in-flight channel
 * to have no rate in it to show. What it carries is counted games and a clock.
 */
describe('a run still in flight', () => {
  /** The whole point: a rate within minutes, at any shard size, with nothing yet landed. */
  it('measures a rate from a shard that has not finished', () => {
    // 10 games in 100s => 10 s/game.
    const p = summariseRun(manifest(), [], 1_000_000 + 100_000, [beat(10, 100)])
    expect(p.secondsPerGame).toBeCloseTo(10, 6)
    expect(p.rateSource).toBe('in-flight')
  })

  it('projects the finish from that rate', () => {
    // 70 of the shard's 80 games remain, at 10 s/game.
    const p = summariseRun(manifest(), [], 1_000_000 + 100_000, [beat(10, 100)])
    expect(p.etaSeconds).toBeCloseTo(700, 0)
  })

  /**
   * **The rate and the finish read different things off the same shards, deliberately.** The rate is
   * how fast a typical shard is going, averaged as the landed rate already is; the finish is when the
   * last one lands. A run is not done when its typical shard is.
   */
  it('reports the rate as the average across shards', () => {
    // 10 s/game and 2.5 s/game.
    const p = summariseRun(manifest(), [], 1_000_000 + 100_000, [beat(10, 100), beat(40, 100)])
    expect(p.secondsPerGame).toBeCloseTo(6.25, 6)
  })

  /** Shards start together but do not finish together, so the run ends when the slowest one does. */
  it('projects from the slowest shard, not the average of them', () => {
    const p = summariseRun(manifest(), [], 1_000_000 + 100_000, [beat(10, 100), beat(40, 100)])
    // The slow shard has 70 games left at 10 s/game; the fast one 40 left at 2.5 s/game.
    expect(p.etaSeconds).toBeCloseTo(700, 0)
  })

  /**
   * **Banked and in-flight are different questions and must not be one number.** At hour 20 of a
   * 23-hour run the question is how much survives a crash, and that is the banked figure alone. The
   * 24,000-game run had played roughly 12,000 games and banked none of them.
   */
  it('counts games in flight separately from games banked', () => {
    const p = summariseRun(manifest(), [obs(100, 60)], 1_000_000 + 100_000, [beat(10, 100), beat(30, 100)])
    expect(p.gamesPlayed, 'banked, and therefore recoverable').toBe(80)
    expect(p.gamesInFlight, 'played but on no shard that has landed').toBe(40)
    expect(p.shardsLive).toBe(2)
  })

  /** A finished shard measures a whole shard rather than a prefix of one, so it is the better number
   *  wherever both exist. */
  it('prefers a landed shard to a heartbeat for the rate', () => {
    // 80 games in 160s => 2 s/game, against the heartbeat's 10.
    const p = summariseRun(manifest(), [obs(100, 160)], 1_000_000 + 200_000, [beat(10, 100)])
    expect(p.secondsPerGame).toBeCloseTo(2, 6)
    expect(p.rateSource).toBe('landed')
  })

  /** The same rule the banked results follow: another build's numbers are not this run's progress,
   *  because `pendingSeeds` will re-run that work. */
  it('ignores a heartbeat stamped with another commit', () => {
    const p = summariseRun(manifest(), [], 1_000_000 + 100_000, [beat(10, 100, { commitId: 'stale' })])
    expect(p.gamesInFlight).toBe(0)
    expect(p.secondsPerGame).toBeNull()
    expect(p.rateSource).toBeNull()
  })

  /**
   * **Hung and slow were indistinguishable from the files alone**, which is why the docs said the only
   * way to tell a working run from a stuck one was that its workers were still burning CPU. A
   * heartbeat that has stopped moving says it directly.
   */
  it('flags a shard whose heartbeat has stopped moving', () => {
    // 10 s/game, so the stall floor of five minutes decides: read six minutes after its last word.
    const p = summariseRun(manifest(), [], 1_000_000 + 100_000 + 360_000, [beat(10, 100)])
    expect(p.shardsStalled).toBe(1)
    expect(p.shardsLive, 'a stalled shard is not making progress').toBe(0)
  })

  /** Its games were played and are not in doubt; only its liveness is. */
  it('still counts a stalled shard\'s games, but not its rate', () => {
    const p = summariseRun(manifest(), [], 1_000_000 + 100_000 + 360_000, [beat(10, 100)])
    expect(p.gamesInFlight).toBe(10)
    expect(p.secondsPerGame, 'a stale reading is not a measurement').toBeNull()
    expect(p.etaSeconds).toBeNull()
  })

  /**
   * **The threshold has to scale with the games.** A heartbeat is written on a game boundary, so a
   * search deep enough to take ten minutes a game would trip any fixed timeout and report every
   * healthy shard as hung. The shard's own measured game time sets its threshold.
   */
  it('does not call a shard stalled while one of its own games could still be running', () => {
    // One game in 600s, read an hour after its last word: slow, but well inside ten of its games.
    const p = summariseRun(manifest(), [], 1_000_000 + 600_000 + 3_600_000, [beat(1, 600)])
    expect(p.shardsStalled).toBe(0)
    expect(p.shardsLive).toBe(1)
  })

  /** A run is finished when its shards have landed. Heartbeats say nothing about that either way. */
  it('is not made complete or incomplete by a heartbeat', () => {
    const all = [obs(100, 60), obs(101, 60), obs(102, 60), obs(103, 60)]
    expect(summariseRun(manifest(), all, 1_000_000 + 70_000, [beat(10, 60)]).complete).toBe(true)
    expect(summariseRun(manifest(), [], 1_000_000 + 70_000, [beat(10, 60)]).complete).toBe(false)
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

  /** The reading a run of any shard size can now give in its first minutes, and the one the lost
   *  24,000-game run could not give in eight hours. */
  it('shows the games in flight and the rate they are being played at', () => {
    // Both shards at 10 s/game, so the reading is about the rendering rather than about the averaging.
    const live = summariseRun(manifest(), [], 1_000_000 + 300_000, [beat(10, 100), beat(30, 300)])
    const text = renderStatus([live], 1_000_000 + 300_000)
    expect(text).toContain('40')
    expect(text).toMatch(/in flight/i)
    expect(text).toMatch(/10\.0s\/game/)
    expect(text, 'a prefix of a shard is not the same claim as a whole one').toMatch(/s\/game \(in flight\)/)
  })

  it('names a stalled shard rather than leaving it as slow progress', () => {
    const stuck = summariseRun(manifest(), [], 1_000_000 + 100_000 + 360_000, [beat(10, 100)])
    expect(renderStatus([stuck], 1_000_000 + 100_000 + 360_000)).toContain('STALLED')
  })

  /**
   * **The in-flight channel must not reintroduce the thing phase 0 removed.** A partial run showing a
   * percentage invites exactly the conclusion the word PARTIAL exists to block, and a heartbeat has no
   * rate in it to print. This pins that no future field sneaks one back in.
   */
  it('shows no percentage at all for a run that is still going', () => {
    const live = summariseRun(manifest(), [obs(100, 60)], 1_000_000 + 100_000, [beat(10, 100)])
    expect(renderStatus([live], 1_000_000 + 100_000)).not.toContain('%')
  })

  /** The matrix is a different shape of run and reads as one, rather than as an AI playing itself. */
  it('names a matrix run as a matrix', () => {
    const m = manifest({ kind: 'matrix', aiA: 'beam-reply', aiB: 'beam-reply', shardIds: ['matrix-0', 'matrix-1'], shards: 2 })
    const text = renderStatus([summariseRun(m, [], 1_000_000)], 1_000_000)
    expect(text).toMatch(/matrix/i)
    expect(text).not.toContain('beam-reply vs beam-reply')
  })
})

/**
 * Writing the heartbeat: often enough to be a signal, rarely enough to cost nothing.
 *
 * **Throttled by time, not by game count.** A `beam-reply` game takes about 35 seconds and a `greedy`
 * mirror game takes milliseconds, so "every N games" is either silent for an hour or thousands of
 * writes a second depending on the mode. One clock covers both.
 */
describe('heartbeatWriter', () => {
  const collect = (): { written: ShardHeartbeat[]; at: (ms: number) => void; tick: (n: number) => void } => {
    const written: ShardHeartbeat[] = []
    let now = 0
    const write = heartbeatWriter(80, h => written.push(h), { clock: () => now, intervalMs: 1000 })
    return { written, at: (ms: number) => { now = ms }, tick: write }
  }

  /** The first game is the one that proves the shard is alive at all, so it is never throttled. */
  it('writes the first update immediately', () => {
    const c = collect()
    c.tick(1)
    expect(c.written).toHaveLength(1)
    expect(c.written[0].gamesDone).toBe(1)
  })

  it('holds back updates inside the interval and writes the next one after it', () => {
    const c = collect()
    c.tick(1)
    c.at(500); c.tick(2)
    c.at(1500); c.tick(3)
    c.at(1600); c.tick(4)
    c.at(2600); c.tick(5)
    expect(c.written.map(h => h.gamesDone)).toEqual([1, 3, 5])
  })

  it('carries the shard total, so a reader can say how far through it is', () => {
    const c = collect()
    c.tick(1)
    expect(c.written[0].gamesTotal).toBe(80)
  })

  it('stamps when it started and when it last spoke, which is what gives the rate', () => {
    const c = collect()
    c.at(4000); c.tick(8)
    expect(Date.parse(c.written[0].startedAt)).toBe(0)
    expect(Date.parse(c.written[0].updatedAt)).toBe(4000)
  })

  /**
   * **The invariant, pinned as a field list.** A heartbeat that carried a win rate would put a partial
   * figure one `--status` away from being read as a result, which is the failure phase 0 exists to
   * prevent. Keeping the rate out of the channel is what makes that structural rather than careful.
   */
  it('carries counted games and a clock, and nothing that could be read as a result', () => {
    const c = collect()
    c.tick(1)
    expect(Object.keys(c.written[0]).sort())
      .toEqual(['commitId', 'gamesDone', 'gamesTotal', 'startedAt', 'updatedAt'])
  })

  /**
   * **The two constants are related, and only one direction of the relationship is dangerous.**
   *
   * A healthy shard writes every `max(HEARTBEAT_INTERVAL_MS, one game)`, and a shard that has not
   * written for `STALL_FLOOR_MS` is reported hung. So raising the interval towards the floor would make
   * every working shard read as stalled, and it would do so silently: nothing else about the run would
   * change. The interval is a free choice about resolution up to this bound, and this is the bound.
   */
  it('leaves a wide margin between how often a shard writes and when it is called hung', () => {
    expect(STALL_FLOOR_MS / HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(5)
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
