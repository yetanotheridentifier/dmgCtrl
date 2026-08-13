import type { ShardResult } from './shard'

/**
 * Arm against control, paired by seed (#492, phase 1).
 *
 * **The unit of evidence in this project, which until now had no code.** A win rate read against a
 * fixed 50% inverted a real result: the search tie-break measured 51.1% over 2,040 games, which is
 * +1.1 and not significant against 50, and it was abandoned on that reading. Against its own control on
 * the same seeds it is **+2.35 at t = 4.94 on 11 df**, and it shipped. Identical bots measure 48.7%
 * over the coverage decks, so the missing 1.3 points were the whole verdict.
 *
 * Pairing by **seed** is what makes it sharp rather than merely correct. A seed fixes the decks and the
 * shuffles, and deck variance dominates the coverage pool: raw per-shard rates spanned 44.7% to 54.7%
 * while the paired differences had a standard deviation of 1.65 points. It is also immune to whatever
 * causes the sub-50 baseline, since both sides carry it equally.
 */

export interface PairedSeed {
  seed: number
  arm: number
  control: number
  diff: number
}

export interface PairedResult {
  /** Usable pairs. Both sides must have run the seed and both must have played something. */
  n: number
  perSeed: PairedSeed[]
  /** Mean difference in RATE units, so 0.0235 is +2.35 points. */
  mean: number
  sd: number
  se: number
  /** Null when there are fewer than two pairs, so there is no spread to estimate. */
  t: number | null
  df: number
  /** The two-sided 5% critical value `t` was judged against, or null when no test was possible. */
  critical: number | null
  significant: boolean
}

/** A shard that can be compared: it belongs to the run, exited cleanly, and played games. */
const usable = (r: ShardResult): boolean => r.exitCode === 0 && r.completed > 0

/**
 * Two-sided 5% critical values of the t distribution.
 *
 * A table, deliberately, rather than an incomplete beta function. Shard counts here are small (ten and
 * twelve are typical), which is exactly where t departs most from the normal, and a hand-rolled
 * approximation that is slightly generous there would flatter every marginal result this is meant to
 * judge. Above the table the normal value is the limit and is approached from above.
 */
const T95: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262,
  10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131, 16: 2.120, 17: 2.110,
  18: 2.101, 19: 2.093, 20: 2.086, 21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060,
  26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042, 40: 2.021, 50: 2.009, 60: 2.000,
  80: 1.990, 100: 1.984, 120: 1.980,
}

export function tCritical95(df: number): number {
  if (df < 1) return Infinity
  const exact = T95[df]
  if (exact !== undefined) return exact
  // Between tabulated points, take the LARGER neighbour: never claim significance the table would not.
  const keys = Object.keys(T95).map(Number).sort((a, b) => a - b)
  const below = keys.filter(k => k < df).pop()
  return below === undefined ? Infinity : (T95[below] ?? 1.96) > 1.96 && df > 120 ? 1.96 : T95[below]
}

/**
 * Difference the arm from its control, seed by seed.
 *
 * Unmatched seeds are dropped rather than compared against nothing, and a failed or empty shard takes
 * its pair with it: its rate is `winsA / completed` over zero games, which is not a measurement.
 *
 * With no spread the `t` is `Infinity` rather than `NaN`. Every shard moving by the same amount is a
 * real and very strong result, and a `NaN` would render as "no result", which is the opposite.
 */
export function pairedDifference(arm: ShardResult[], control: ShardResult[]): PairedResult {
  const bySeed = new Map<number, ShardResult>()
  for (const r of control) if (usable(r)) bySeed.set(r.seed, r)

  const perSeed: PairedSeed[] = []
  for (const a of arm) {
    if (!usable(a)) continue
    const c = bySeed.get(a.seed)
    if (c === undefined) continue
    perSeed.push({ seed: a.seed, arm: a.winRateA, control: c.winRateA, diff: a.winRateA - c.winRateA })
  }
  perSeed.sort((x, y) => x.seed - y.seed)

  const n = perSeed.length
  const mean = n === 0 ? 0 : perSeed.reduce((s, r) => s + r.diff, 0) / n
  if (n < 2) {
    return { n, perSeed, mean, sd: 0, se: 0, t: null, df: Math.max(0, n - 1), critical: null, significant: false }
  }

  const df = n - 1
  const variance = perSeed.reduce((s, r) => s + (r.diff - mean) ** 2, 0) / df
  const sd = Math.sqrt(variance)
  const se = sd / Math.sqrt(n)
  const t = se === 0 ? (mean === 0 ? 0 : Infinity * Math.sign(mean)) : mean / se
  const critical = tCritical95(df)
  return { n, perSeed, mean, sd, se, t, df, critical, significant: Math.abs(t) > critical }
}

/**
 * The comparison as a block of report lines.
 *
 * The paired difference leads, because it is the number that decides. Both raw rates are printed
 * beside it rather than instead of it: an arm at 51.1% is not a result, and an arm at 51.1% against a
 * control at 48.7% on the same seeds is.
 */
export function renderPaired(armSpec: string, controlSpec: string, p: PairedResult): string[] {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
  const pts = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}`
  const lines = [
    '',
    '  paired against the control, seed by seed. The difference is the result; the raw rates are',
    '  context. Identical bots do not measure 50% over the coverage decks, so an arm read against a',
    '  fixed 50% can invert.',
    `    ${'seed'.padStart(6)}  ${'arm'.padStart(7)}  ${'control'.padStart(7)}  ${'diff'.padStart(7)}`,
  ]
  for (const r of p.perSeed) {
    lines.push(`    ${String(r.seed).padStart(6)}  ${pct(r.arm).padStart(7)}  ${pct(r.control).padStart(7)}  ${pts(r.diff).padStart(7)}`)
  }
  const positive = p.perSeed.filter(r => r.diff > 0).length
  lines.push('')
  if (p.t === null) {
    lines.push(`  ${armSpec} vs ${controlSpec}: ${p.n} pair(s), too few to test`)
    return lines
  }
  const verdict = p.significant ? 'SIGNIFICANT at 5%' : 'not significant at 5%'
  // Padded to match `row()` in the report, so the block reads as part of it rather than beside it.
  const line = (label: string, value: string): string => `  ${label.padEnd(22)}: ${value}`
  lines.push(
    line('paired difference', `${pts(p.mean)} points  (${armSpec} minus ${controlSpec})`),
    line('spread', `sd ${(p.sd * 100).toFixed(2)}, se ${(p.se * 100).toFixed(2)} over ${p.n} shards`),
    line(`t (${p.df} df)`, `${Number.isFinite(p.t) ? p.t.toFixed(2) : '∞'} against ${p.critical?.toFixed(3)} -> ${verdict}`),
    line('shards favouring arm', `${positive} of ${p.n}`),
    '',
  )
  return lines
}
