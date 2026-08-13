import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
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
}

/** A banked shard result, with when it landed. Kept separate so the summary stays pure. */
export interface ShardObservation {
  result: ShardResult
  finishedAtMs: number
}

export interface RunProgress {
  manifest: RunManifest
  shardsDone: number
  shardsFailed: number
  shardsTotal: number
  gamesPlayed: number
  gamesTotal: number
  complete: boolean
  /** Seconds per game, measured from finished shards, or null before the first one lands. */
  secondsPerGame: number | null
  /** Projected seconds still to run, or null when unknown or already complete. */
  etaSeconds: number | null
}

/**
 * Summarise one run from its manifest and whatever has landed.
 *
 * A result counts as progress only if it is **this** run's: within the seed range, from this build,
 * exited cleanly, and actually played something. The same four conditions `pendingSeeds` uses to
 * decide what to re-run, and they must agree: a shard this counts as done but that re-runs would show
 * a run as further along than it is.
 *
 * Shards run in parallel from a common start, so one finishing after `t` seconds having played `games`
 * games gives the per-game rate directly, and every outstanding shard is expected to take the same.
 */
export function summariseRun(m: RunManifest, obs: ShardObservation[], nowMs: number): RunProgress {
  const inRun = new Set(Array.from({ length: m.shards }, (_, i) => m.baseSeed + i))
  const mine = obs.filter(o => inRun.has(o.result.seed) && o.result.commitId === m.commitId)
  const done = mine.filter(o => o.result.exitCode === 0 && o.result.completed > 0)
  const failed = mine.filter(o => o.result.exitCode !== 0 || o.result.completed === 0)

  const startedMs = Date.parse(m.startedAt)
  const rates = done.map(o => (o.finishedAtMs - startedMs) / 1000 / m.games).filter(r => r > 0)
  const secondsPerGame = rates.length === 0 ? null : rates.reduce((a, b) => a + b, 0) / rates.length

  const complete = done.length >= m.shards
  // A shard takes `games * rate` from the shared start, so the run ends when the last one does.
  const etaSeconds = complete || secondsPerGame === null
    ? null
    : startedMs / 1000 + m.games * secondsPerGame - nowMs / 1000

  return {
    manifest: m,
    shardsDone: done.length,
    shardsFailed: failed.length,
    shardsTotal: m.shards,
    gamesPlayed: done.reduce((n, o) => n + o.result.completed, 0),
    gamesTotal: m.shards * m.games,
    complete,
    secondsPerGame,
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
    const rate = r.secondsPerGame === null ? 'rate unknown' : `${r.secondsPerGame.toFixed(1)}s/game`
    const eta = r.complete ? 'done' : r.etaSeconds === null ? 'eta unknown' : `~${clock(r.etaSeconds)} left`
    lines.push(
      `  ${state}  ${m.aiA} vs ${m.aiB}${m.decks ? `  [${m.decks}]` : ''}`,
      `            shards ${r.shardsDone} of ${r.shardsTotal}` +
        (r.shardsFailed > 0 ? `  (${r.shardsFailed} FAILED)` : '') +
        `   games ${r.gamesPlayed} of ${r.gamesTotal}`,
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
    const manifestPath = join(dir, 'run.json')
    if (!existsSync(manifestPath)) continue
    let manifest: RunManifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RunManifest
    } catch {
      continue
    }
    const obs: ShardObservation[] = []
    for (const file of readdirSync(dir)) {
      if (!file.startsWith('seed-') || !file.endsWith('.json')) continue
      try {
        const result = JSON.parse(readFileSync(join(dir, file), 'utf8')) as ShardResult
        obs.push({ result, finishedAtMs: statSync(join(dir, file)).mtimeMs })
      } catch {
        // Half-written when the machine died. Not a result, and `pendingSeeds` will re-run its seed.
      }
    }
    out.push(summariseRun(manifest, obs, nowMs))
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

/** The manifest for a run about to start. */
export function makeManifest(
  config: { shards: number; games: number; baseSeed: number; aiA: string; aiB: string; decks?: string },
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
  }
}
