import { runBench } from './runBench'
import type { BenchReport } from './runBench'
import { openDb, saveReport, DEFAULT_DB_PATH } from './store'
import { writeFailures, FAILURES_DIR } from './reports'
import { runSweep } from './sweep'
import type { SweepReport } from './sweep'
import { runGeneralisation } from './generalisation'
import type { GeneralisationReport } from './generalisation'

/**
 * The bench command line: `npm run bench --prefix sealed -- [--games N] [--seed N] [aiA] [aiB]`.
 *
 * This is the only impure file in the harness (it reads argv, prints, and persists); everything it
 * calls to actually play games is pure and seeded, so a run is fully reproducible from its --seed.
 * The report is written to a local SQLite database for later querying, each dropped game is written
 * as a replayable fixture, and the process exits non-zero if any game was dropped so a provisional
 * result can never be mistaken for a clean one.
 */

// node:sqlite is stable enough for our needs but still prints a one-time experimental warning on
// first use. Hide just that line so the report reads cleanly; every other warning passes through.
const passWarning = process.emitWarning
process.emitWarning = ((warning: string | Error, ...rest: unknown[]): void => {
  const text = typeof warning === 'string' ? warning : warning.message
  if (text.includes('SQLite is an experimental feature')) return
  ;(passWarning as (w: string | Error, ...r: unknown[]) => void)(warning, ...rest)
}) as typeof process.emitWarning

interface Args {
  games: number
  gamesSet: boolean
  seed: number
  sweep: boolean
  generalise: boolean
  aiExplicit: boolean
  aiA: string
  aiB: string
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  let games = 100
  let gamesSet = false
  let seed = 1
  let sweep = false
  let generalise = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--games') { games = Number(argv[++i]); gamesSet = true }
    else if (arg === '--seed') seed = Number(argv[++i])
    else if (arg === '--sweep') sweep = true
    else if (arg === '--generalise') generalise = true
    else if (arg.startsWith('--')) throw new Error(`Unknown flag: ${arg}`)
    else positional.push(arg)
  }
  if (!Number.isFinite(games) || games < 1) throw new Error(`--games must be a positive integer`)
  if (!Number.isFinite(seed)) throw new Error(`--seed must be a number`)
  return { games, gamesSet, seed, sweep, generalise, aiExplicit: positional.length > 0, aiA: positional[0] ?? 'random', aiB: positional[1] ?? 'random' }
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
const row = (label: string, value: string): string => `  ${label.padEnd(22)}: ${value}`

function format(report: BenchReport, wallMs: number): string {
  const totalMoves = report.games.reduce((n, g) => n + g.moveCount, 0)
  const lo = Math.max(0, report.winRateA - report.winCi)
  const hi = Math.min(1, report.winRateA + report.winCi)
  const lines = [
    '',
    `dmgCtrl AI bench  (engine ${report.buildTag})`,
    `${report.aiA} vs ${report.aiB}   ${report.gamesRequested} games   seed ${report.seed}`,
    '',
    row(`win rate (${report.aiA}/A)`, `${pct(report.winRateA)}  ± ${pct(report.winCi)}   (${pct(lo)} – ${pct(hi)})`),
    row('draw rate', pct(report.drawRate)),
    row('base-damage margin', `${report.avgMargin >= 0 ? '+' : ''}${report.avgMargin.toFixed(1)}  (A's view)`),
    row('game length', `${report.avgRounds.toFixed(1)} rounds avg`),
    row('throughput', `${Math.round(report.movesPerSec).toLocaleString()} moves/s   (${totalMoves.toLocaleString()} moves)`),
    row('completed / dropped', `${report.completed} / ${report.dropped}`),
    row('wall clock', `${(wallMs / 1000).toFixed(1)}s`),
    '',
  ]
  if (report.provisional) {
    lines.push(`  ⚠ PROVISIONAL: ${report.dropped} game(s) dropped; win rate is over completed games only`)
    for (const f of report.failures) lines.push(`    game ${f.gameIndex}  seed ${f.seed}  ${f.reason}`)
  } else {
    lines.push('  ✓ clean run')
  }
  lines.push('')
  return lines.join('\n')
}

function formatSweep(report: SweepReport, wallMs: number, aiName: string): string {
  const lines = [
    '',
    `dmgCtrl coverage sweep  (engine ${report.buildTag})`,
    `${report.decks} decks × ${report.gamesPerDeck} games   ${aiName} mirror`,
    '',
    row('total games', `${report.totalGames}`),
    row('completed / dropped', `${report.completed} / ${report.dropped}`),
    row('cards exercised', `${report.cardsExercised}`),
    row('wall clock', `${(wallMs / 1000).toFixed(1)}s`),
    '',
  ]
  if (report.dropped > 0) {
    lines.push(`  ⚠ ${report.dropped} game(s) dropped across the pool:`)
    for (const f of report.failures.slice(0, 40)) lines.push(`    ${f.deck}  seed ${f.seed}  ${f.reason}`)
    if (report.failures.length > 40) lines.push(`    ... and ${report.failures.length - 40} more`)
  } else {
    lines.push('  ✓ no failures across the whole card pool')
  }
  lines.push('')
  return lines.join('\n')
}

function runSweepMode(args: Args): void {
  const gamesPerDeck = args.gamesSet ? args.games : 5
  const start = Date.now()
  let report: SweepReport
  try {
    report = runSweep({ gamesPerDeck, seed: args.seed, aiName: args.aiA })
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    process.exit(2)
    return
  }
  console.log(formatSweep(report, Date.now() - start, args.aiA))
  const written = writeFailures(`sweep-${new Date().toISOString()}`, report.droppedGames)
  if (written.length > 0) console.log(row('reproductions', `${written.length} file(s) in ${FAILURES_DIR}/`))
  console.log('')
  if (report.dropped > 0) process.exit(1)
}

function formatGeneralisation(report: GeneralisationReport, wallMs: number): string {
  const lo = Math.max(0, report.overallWinRateA - report.overallCi)
  const hi = Math.min(1, report.overallWinRateA + report.overallCi)
  const lines = [
    '',
    `dmgCtrl generalisation  (engine ${report.buildTag})`,
    `${report.aiA} vs ${report.aiB}   ${report.decks} decks × ${report.gamesPerDeck} games`,
    '',
    row(`overall win rate (${report.aiA})`, `${pct(report.overallWinRateA)}  ± ${pct(report.overallCi)}   (${pct(lo)} – ${pct(hi)})`),
    row('completed / dropped', `${report.completed} / ${report.dropped}`),
    row('wall clock', `${(wallMs / 1000).toFixed(1)}s`),
    '',
    `  per deck (weakest first for ${report.aiA}):`,
  ]
  for (const d of report.perDeck) {
    const margin = `${d.avgMargin >= 0 ? '+' : ''}${d.avgMargin.toFixed(0)}`
    lines.push(`    ${pct(d.winRateA).padStart(6)}  ±${pct(d.winCi).padStart(6)}  margin ${margin.padStart(4)}   ${d.deck}`)
  }
  lines.push('')
  return lines.join('\n')
}

function runGeneraliseMode(args: Args): void {
  // Default to "the AI under test vs random"; explicit names override.
  const aiA = args.aiExplicit ? args.aiA : 'greedy'
  const aiB = args.aiExplicit ? args.aiB : 'random'
  const gamesPerDeck = args.gamesSet ? args.games : 20
  const start = Date.now()
  let report: GeneralisationReport
  try {
    report = runGeneralisation({ gamesPerDeck, seed: args.seed, aiA, aiB })
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    process.exit(2)
    return
  }
  console.log(formatGeneralisation(report, Date.now() - start))
  const written = writeFailures(`generalise-${new Date().toISOString()}`, report.droppedGames)
  if (written.length > 0) console.log(row('reproductions', `${written.length} file(s) in ${FAILURES_DIR}/`))
  console.log('')
  if (report.dropped > 0) process.exit(1)
}

function main(): void {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    console.error('usage: npm run bench --prefix sealed -- [--games N] [--seed N] [--sweep|--generalise] [aiA] [aiB]')
    process.exit(2)
    return
  }

  if (args.sweep) { runSweepMode(args); return }
  if (args.generalise) { runGeneraliseMode(args); return }

  let report: BenchReport
  const start = Date.now()
  try {
    report = runBench({ games: args.games, seed: args.seed, aiA: args.aiA, aiB: args.aiB })
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    process.exit(2)
    return
  }
  console.log(format(report, Date.now() - start))

  const runId = saveReport(openDb(DEFAULT_DB_PATH), report)
  const written = writeFailures(runId, report.games)
  console.log(row('saved run', `${runId}  →  ${DEFAULT_DB_PATH}`))
  if (written.length > 0) console.log(row('reproductions', `${written.length} file(s) in ${FAILURES_DIR}/`))
  console.log('')

  if (report.provisional) process.exit(1)
}

main()
