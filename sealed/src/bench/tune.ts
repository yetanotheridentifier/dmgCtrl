import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { DEFAULT_WEIGHTS, type EvalWeights } from '../ai/evaluate'
import { DEFAULT_HAND_WEIGHTS } from '../ai/handValue'
import { makeTunedGreedy } from '../ai/greedyAi'
import { resolveAi } from '../ai/registry'
import { runGeneralisationWith } from './generalisation'
import { BUILD_TAG } from '../buildTag'

/**
 * Weight tuner: measure candidate evaluation weights against a reference AI across the coverage
 * decks, so weights are chosen from data rather than guessed.
 *
 * ```
 * npm run tune --prefix sealed -- [--games N] [--seed N] [--vs AI] [--out FILE]
 *                                 [--axis key=v1,v2,..] [--set key=v] [key=v,key=v ...]
 * ```
 *
 * - `--axis` names a weight and the values to try. Repeating it takes the **cross product**, which
 *   is how an interaction is measured rather than assumed: two weights swept separately can each
 *   look flat while their combination is not.
 * - `--set` pins a weight for every config in the run, so an axis can be swept at a non-default
 *   setting of another.
 * - A bare `key=v,key=v` argument is one explicit config, for hand-picked combinations.
 * - `--vs` is the reference (default `greedy`, the deployed model). **A candidate above 50% beats
 *   what ships.** The frozen `greedy-baseline` is a poor reference now that the deployed model beats
 *   it 81.9%: candidates pile up against the ceiling and their differences vanish into it.
 * - `--out` appends one JSON line per config, so a long sweep survives being interrupted and several
 *   sweeps can run in parallel into different files.
 *
 * Candidates are built by `makeTunedGreedy`, the same factory that builds the deployed bot, so the
 * tuner cannot drift from the AI it is tuning.
 */

/** Every scalar weight, including the nested hand weights addressed as `hand.canAct` / `hand.hold`. */
export type WeightKey = keyof Omit<EvalWeights, 'hand'> | 'hand.canAct' | 'hand.hold'

/**
 * Derived from the shipped weights rather than listed by hand, so a new weight is sweepable the
 * moment it exists.
 *
 * This was a hardcoded list once. Adding `lethalExposure` to the evaluation and forgetting it here
 * meant an overnight sweep rejected every job and measured nothing: the guard fired correctly, but
 * the list should never have been a second place to remember.
 */
export const SCALAR_KEYS: WeightKey[] = [
  ...Object.keys(DEFAULT_WEIGHTS).filter(k => k !== 'hand'),
  ...Object.keys(DEFAULT_HAND_WEIGHTS).map(k => `hand.${k}`),
] as WeightKey[]

export interface TuneConfig {
  overrides: Partial<Record<WeightKey, number>>
}

/** Apply named overrides onto the shipped weights, including into the nested hand set. */
export function weightsFrom(overrides: Partial<Record<WeightKey, number>>): EvalWeights {
  const hand = { ...DEFAULT_HAND_WEIGHTS }
  const flat: Record<string, number> = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue
    if (key === 'hand.canAct') hand.canAct = value
    else if (key === 'hand.hold') hand.hold = value
    else flat[key] = value
  }
  return { ...DEFAULT_WEIGHTS, ...flat, hand }
}

/** `key=v,key=v` into overrides, rejecting an unknown weight rather than silently ignoring it. */
export function parseAssignments(spec: string): Partial<Record<WeightKey, number>> {
  const out: Partial<Record<WeightKey, number>> = {}
  // `specOf` renders the shipped weights as "defaults", and an unattended sweep feeds its own
  // ranked specs back in, so the round trip has to accept it rather than die on an unknown weight.
  if (spec === 'defaults') return out
  for (const pair of spec.split(',')) {
    const [key, raw] = pair.split('=')
    const value = Number(raw)
    if (!SCALAR_KEYS.includes(key as WeightKey)) throw new Error(`unknown weight "${key}". Known: ${SCALAR_KEYS.join(', ')}`)
    if (!Number.isFinite(value)) throw new Error(`"${pair}" has no numeric value`)
    out[key as WeightKey] = value
  }
  return out
}

/**
 * Expand axes into the full cross product, in a stable order (first axis varies slowest), so a
 * printed sweep reads as a grid and two runs of the same command line agree.
 */
export function expandAxes(axes: Array<{ key: WeightKey; values: number[] }>, pinned: Partial<Record<WeightKey, number>>): TuneConfig[] {
  let configs: TuneConfig[] = [{ overrides: { ...pinned } }]
  for (const axis of axes) {
    const next: TuneConfig[] = []
    for (const config of configs) {
      for (const value of axis.values) next.push({ overrides: { ...config.overrides, [axis.key]: value } })
    }
    configs = next
  }
  return configs
}

/** How a config reads in the console and in the JSON, e.g. `unit=6 power=3`. */
export function describeConfig(config: TuneConfig): string {
  const parts = Object.entries(config.overrides).map(([k, v]) => `${k}=${v}`)
  return parts.length === 0 ? '(defaults)' : parts.join(' ')
}

/**
 * Append one measured config to the results file, creating the directory if it is missing.
 *
 * **A failed write must never lose a measurement.** Each row costs minutes of compute, so this
 * reports the problem and lets the sweep carry on rather than aborting: the first version threw
 * ENOENT after a completed 840-game run and took the whole overnight sweep down with it, one config
 * into each stream.
 *
 * Prefer an absolute `--out`: `npm run --prefix sealed` runs with `sealed/` as the working
 * directory, so a relative path lands there rather than where it was typed.
 */
export function appendRow(out: string, row: object): void {
  const file = resolvePath(out)
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(row)}\n`, { flag: 'a' })
  } catch (err) {
    console.error(`  ! could not append to ${file}: ${(err as Error).message}`)
  }
}

/**
 * A sibling `.tsv` of `winRate <tab> ci <tab> spec`, written alongside the JSON.
 *
 * It exists so an unattended sweep can pick its own validation candidates: `sort -rn` ranks it and
 * the third column is a **re-runnable config spec**, not a display label. Selecting from the JSON
 * would need a parser in the middle of a shell pipeline, which is one more thing to go wrong at 3am.
 */
export function appendTsv(out: string, winRate: number, ci: number, spec: string): void {
  const file = resolvePath(out).replace(/\.jsonl?$/, '') + '.tsv'
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${winRate.toFixed(4)}\t${ci.toFixed(4)}\t${spec}\n`, { flag: 'a' })
  } catch (err) {
    console.error(`  ! could not append to ${file}: ${(err as Error).message}`)
  }
}

/**
 * A config as it would be typed back in: `unit=5,hp=1.5`. Empty means the shipped weights.
 *
 * **Weights already at their shipped value are dropped**, so configs that describe the same AI get
 * the same spec. Without that, a sweep that ranks and re-runs its own winners spends its validation
 * budget measuring one AI several times: `unit=4,hp=1.5`, `power=2,hp=1.5` and `unit=4,power=2,hp=1.5`
 * are all just `hp=1.5` when `unit` and `power` are already 4 and 2, and three of eight validation
 * slots went on that before this existed.
 */
export function specOf(config: TuneConfig): string {
  const shipped = weightsFrom({})
  const parts: string[] = []
  for (const [key, value] of Object.entries(config.overrides)) {
    if (value === undefined) continue
    const current = key === 'hand.canAct' ? shipped.hand.canAct
      : key === 'hand.hold' ? shipped.hand.hold
      : shipped[key as keyof Omit<EvalWeights, 'hand'>]
    if (value !== current) parts.push(`${key}=${value}`)
  }
  return parts.length === 0 ? 'defaults' : parts.join(',')
}

interface Args {
  games: number
  seed: number
  vs: string
  out?: string
  configs: TuneConfig[]
}

export function parseArgs(argv: string[]): Args {
  let games = 20
  let seed = 42
  let vs = 'greedy'
  let out: string | undefined
  const axes: Array<{ key: WeightKey; values: number[] }> = []
  const pinned: Partial<Record<WeightKey, number>> = {}
  const explicit: TuneConfig[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--games') games = Number(argv[++i])
    else if (arg === '--seed') seed = Number(argv[++i])
    else if (arg === '--vs') vs = argv[++i]
    else if (arg === '--out') out = argv[++i]
    else if (arg === '--set') Object.assign(pinned, parseAssignments(argv[++i]))
    else if (arg === '--axis') {
      const [key, list] = argv[++i].split('=')
      if (!SCALAR_KEYS.includes(key as WeightKey)) throw new Error(`unknown weight "${key}". Known: ${SCALAR_KEYS.join(', ')}`)
      const values = list.split(',').map(Number)
      if (values.some(v => !Number.isFinite(v))) throw new Error(`axis "${argv[i]}" has a non-numeric value`)
      axes.push({ key: key as WeightKey, values })
    } else explicit.push({ overrides: { ...pinned, ...parseAssignments(arg) } })
  }

  const configs = axes.length > 0 ? expandAxes(axes, pinned) : explicit
  if (configs.length === 0) {
    // No axes and no explicit configs still means something useful: measure the shipped weights
    // against the reference. That is the tuner's self-check and should read ~50% against `greedy`.
    configs.push({ overrides: { ...pinned } })
  }
  return { games, seed, vs, out, configs }
}

function main(): void {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`tune: ${(err as Error).message}`)
    process.exit(2)
    return
  }

  const reference = resolveAi(args.vs)
  console.log(`\ntuning ${args.configs.length} config(s) vs ${args.vs}, ${args.games} games/deck, seed ${args.seed}  (engine ${BUILD_TAG})`)
  console.log(`above 50% beats the reference\n`)
  console.log('   win%      ci    games  time  config')

  for (const config of args.configs) {
    const candidate = makeTunedGreedy(weightsFrom(config.overrides))
    const start = Date.now()
    const report = runGeneralisationWith(candidate, reference, 'candidate', args.vs, { gamesPerDeck: args.games, seed: args.seed })
    const secs = (Date.now() - start) / 1000
    const win = report.overallWinRateA * 100
    const ci = report.overallCi * 100
    const label = describeConfig(config)
    const drop = report.dropped > 0 ? `  (${report.dropped} dropped)` : ''
    console.log(`  ${win.toFixed(1).padStart(5)}%  ± ${ci.toFixed(1)}%  ${String(report.completed).padStart(5)}  ${secs.toFixed(0).padStart(4)}s  ${label}${drop}`)

    if (args.out) {
      appendRow(args.out, {
        buildTag: BUILD_TAG, vs: args.vs, seed: args.seed, gamesPerDeck: args.games,
        config: config.overrides, label, spec: specOf(config), winRate: report.overallWinRateA,
        ci: report.overallCi, completed: report.completed, dropped: report.dropped, seconds: secs,
      })
      appendTsv(args.out, report.overallWinRateA, report.overallCi, specOf(config))
    }
  }
  console.log('')
}

// Guarded so the parsing helpers above can be imported by tests without running a sweep.
if (process.argv[1]?.endsWith('tune.ts')) main()
