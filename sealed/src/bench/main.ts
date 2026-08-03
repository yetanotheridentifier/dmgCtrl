import { runBench } from './runBench'
import type { BenchReport } from './runBench'
import { openDb, saveReport, DEFAULT_DB_PATH } from './store'
import { writeFailures, FAILURES_DIR } from './reports'
import { runSweep } from './sweep'
import type { SweepReport } from './sweep'
import { runDecisions } from './decisions'
import { runTerms } from './terms'
import type { TermReport } from './terms'
import { runAiMatchups } from './aiMatchups'
import type { DecisionReport } from './decisions'
import { runGeneralisation } from './generalisation'
import type { GeneralisationReport } from './generalisation'
import { buildMatchupDecks } from './matchupDecks'
import { runMatchupMatrix } from './matrix'
import { saveMatrix, deckStrength, leaderStrength, baseStrength, type StrengthRow } from './store'
import { resolveAi } from '../ai/registry'

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
  matrix: boolean
  decisions: boolean
  terms: boolean
  matchups: boolean
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
  let matrix = false
  let decisions = false
  let terms = false
  let matchups = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--games') { games = Number(argv[++i]); gamesSet = true }
    else if (arg === '--seed') seed = Number(argv[++i])
    else if (arg === '--sweep') sweep = true
    else if (arg === '--generalise') generalise = true
    else if (arg === '--matrix') matrix = true
    else if (arg === '--decisions') decisions = true
    else if (arg === '--terms') terms = true
    else if (arg === '--matchups') matchups = true
    else if (arg.startsWith('--')) throw new Error(`Unknown flag: ${arg}`)
    else positional.push(arg)
  }
  if (!Number.isFinite(games) || games < 1) throw new Error(`--games must be a positive integer`)
  if (!Number.isFinite(seed)) throw new Error(`--seed must be a number`)
  return { games, gamesSet, seed, sweep, generalise, matrix, decisions, terms, matchups, aiExplicit: positional.length > 0, aiA: positional[0] ?? 'random', aiB: positional[1] ?? 'random' }
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
  ]
  const margin = (m: number): string => `${m >= 0 ? '+' : ''}${m.toFixed(0)}`

  lines.push(`  by leader (weakest first for ${report.aiA}):`)
  for (const g of report.perLeader) {
    lines.push(`    ${pct(g.winRateA).padStart(6)}  ±${pct(g.winCi).padStart(6)}  margin ${margin(g.avgMargin).padStart(4)}   ${g.key} (${g.decks} deck${g.decks === 1 ? '' : 's'})`)
  }
  lines.push('')
  lines.push(`  by base aspect (weakest first for ${report.aiA}):`)
  for (const g of report.perBase) {
    lines.push(`    ${pct(g.winRateA).padStart(6)}  ±${pct(g.winCi).padStart(6)}  margin ${margin(g.avgMargin).padStart(4)}   ${g.key} (${g.decks} deck${g.decks === 1 ? '' : 's'})`)
  }
  lines.push('')
  lines.push(`  per deck (weakest first for ${report.aiA}):`)
  for (const d of report.perDeck) {
    lines.push(`    ${pct(d.winRateA).padStart(6)}  ±${pct(d.winCi).padStart(6)}  margin ${margin(d.avgMargin).padStart(4)}   ${d.deck}`)
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

function formatDecisions(report: DecisionReport, wallMs: number): string {
  const lines = [
    '',
    `dmgCtrl decision quality  (engine ${report.buildTag})`,
    `${report.ai}, ${report.games} games across the coverage decks`,
    '',
    '  a TIE is a decision the evaluation cannot see: every candidate scores the same, so the',
    '  seeded tie-break picks one at random. High tie rates are blind spots, not close calls.',
    '',
    '    tied   offered   avg options   decision',
  ]
  for (const s of report.stats) {
    const tieRate = s.offered === 0 ? '  n/a' : pct(s.tied / s.offered).padStart(6)
    lines.push(`  ${tieRate}   ${String(s.offered).padStart(7)}   ${s.avgCandidates.toFixed(1).padStart(11)}   ${s.label}`)
  }
  const r = report.resourcing
  const total = r.banked + r.skipped
  lines.push(
    '',
    '  regroup banking (a strict public preference, so not a tie: this is behaviour, not a gap)',
    row('banked', `${r.banked}  (avg pool ${r.avgPoolWhenBanked.toFixed(1)})`),
    row('skipped', total === 0 ? '0' : `${r.skipped} = ${pct(r.skipped / total)}  (avg pool ${r.avgPoolWhenSkipped.toFixed(1)})`),
  )
  const i = report.initiative
  lines.push(
    '',
    '  initiative (claiming forfeits the rest of your round; "cheap" = they already passed)',
    row('claimed', i.offered === 0 ? '0' : `${i.taken} of ${i.offered} = ${pct(i.taken / i.offered)}`),
    row('cheap chances taken', i.cheapOffered === 0 ? 'n/a' : `${i.cheapTaken} of ${i.cheapOffered} = ${pct(i.cheapTaken / i.cheapOffered)}`),
    row('ready units forfeited', `${i.avgForfeitedWhenClaimed.toFixed(1)} avg per mid-phase claim`),
  )
  const r2 = report.role
  lines.push(
    '',
    '  role, sampled once a round from the player seat (read off the race, not board advantage)',
    row('aggressor / defender', r2.samples === 0 ? 'n/a' : `${r2.aggressor} / ${r2.defender}  (${pct(r2.neutral / r2.samples)} neutral)`),
    row('role flips', `${r2.flipsPerGame.toFixed(2)} per game`),
    row('a side fully walled', r2.samples === 0 ? 'n/a' : `${pct(r2.walledSamples / r2.samples)} of samples (reach 0)`),
  )
  const su = report.suspended
  const rate = (n: number, d: number): string => (d === 0 ? 'n/a' : `${n} of ${d} = ${pct(n / d)}`)
  const topKinds = (ks: Array<{ kind: string; count: number }>): string =>
    ks.length === 0 ? 'none seen' : ks.slice(0, 4).map(k => `${k.kind} ${k.count}`).join(', ')
  lines.push(
    '',
    '  half-resolved scoring: a candidate move that leaves a choice owed is scored before the',
    '  action finishes. Who owes it decides the fix: theirs wants their reply resolved, ours wants',
    '  our own sequence expanded.',
    row('positions, theirs owed', rate(su.positionsWithOpponentAnswer, su.positions)),
    row('positions, ours owed', rate(su.positionsWithSelfAnswer, su.positions)),
    row('candidates, theirs owed', rate(su.opponentAnswers, su.candidates)),
    row('candidates, ours owed', rate(su.selfAnswers, su.candidates)),
    row('chosen move, theirs owed', rate(su.chosenOpponentAnswer, su.positions)),
    row('chosen move, ours owed', rate(su.chosenSelfAnswer, su.positions)),
    row('their choice kinds', topKinds(su.opponentChoiceKinds)),
    row('our choice kinds', topKinds(su.selfChoiceKinds)),
  )
  const le = report.lethal
  const early = le.byRound.filter(r => r.round <= 4).reduce((n, r) => ({ d: n.d + r.decisions, t: n.t + r.theirs }), { d: 0, t: 0 })
  lines.push(
    '',
    '  lethal availability: the ceiling on every rule built over a lethal solver. "theirs" is what a',
    '  tap-out risk gate would be protecting against.',
    row('we could finish now', rate(le.ours, le.decisions)),
    row('  in ONE action', rate(le.oursOneAction, le.decisions)),
    row('they could finish now', rate(le.theirs, le.decisions)),
    row('  in ONE action', rate(le.theirsOneAction, le.decisions)),
    row('theirs, rounds 1 to 4', rate(early.t, early.d)),
    row('by round (theirs)', le.byRound.map(r => `r${r.round} ${pct(r.decisions === 0 ? 0 : r.theirs / r.decisions)}`).join('  ')),
  )
  const ex = report.exposure
  lines.push(
    '',
    '  avoidable exposure: the headroom a tap-out risk gate could actually recover. "Unavoidable"',
    '  means every legal move led there, so the position was already lost and a gate saves nothing.',
    row('handed them lethal', rate(ex.exposed, ex.decisions)),
    row('  of which avoidable', rate(ex.avoidable, ex.exposed)),
    row('  of which unavoidable', rate(ex.unavoidable, ex.exposed)),
    '  Per SEAT (two per game): a seat that made one, against one that did not. The gap is the',
    '  finding; the raw rate on its own says nothing without the base rate beside it.',
    row('loss rate, made one', rate(ex.lostAfterAvoidable, ex.gamesWithAvoidable)),
    row('loss rate, made none', rate(ex.lostWithoutAvoidable, ex.gamesWithoutAvoidable)),
  )
  lines.push('', row('wall clock', `${(wallMs / 1000).toFixed(1)}s`), '')
  return lines.join('\n')
}

function runDecisionsMode(args: Args): void {
  const gamesPerDeck = args.gamesSet ? args.games : 3
  const start = Date.now()
  let report: DecisionReport
  try {
    report = runDecisions({ gamesPerDeck, seed: args.seed, aiName: args.aiExplicit ? args.aiA : 'greedy' })
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    process.exit(2)
    return
  }
  console.log(formatDecisions(report, Date.now() - start))
}

/**
 * Term sensitivity (#430). Two columns, because they answer different questions: a weight whose
 * quantity never varies is dead, while one that varies but is never pivotal is live and simply not
 * worth tuning. The second is the 400,000-game sweep's null result, in minutes.
 */
function runTermsMode(args: Args): void {
  const gamesPerDeck = args.gamesSet ? args.games : 1
  const start = Date.now()
  let report: TermReport
  try {
    report = runTerms({ gamesPerDeck, seed: args.seed })
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    process.exit(2)
    return
  }

  const rate = (n: number): string => pct(report.decisions === 0 ? 0 : n / report.decisions)
  const lines = [
    '',
    `dmgCtrl term sensitivity  (engine ${report.buildTag})`,
    row('games', `${report.games}`),
    row('decisions', `${report.decisions}`),
    '',
    '  VARIES: the quantity differs across candidates, so the term can influence the ranking at all.',
    '  PIVOTAL: a nudge changes the pick, i.e. the weight is worth sweeping.',
    '  BEARING: setting it to zero changes the pick, i.e. it cannot simply be deleted.',
    '  The last two differ: a tie-break whose ordering survives rescaling is bearing but not pivotal.',
    '  n/a means the weight prices no quantity: saturation splits the pool, roleShift bends other',
    '  weights, so for those only the perturbation columns are findings.',
    '',
    `  ${'weight'.padEnd(16)}${'step'.padStart(6)}${'varies'.padStart(9)}${'pivotal'.padStart(9)}` +
    `${'bearing'.padStart(9)}${'spread'.padStart(9)}   by kind (bearing)`,
  ]
  // Load-bearing first: what the model is actually using leads, and the dead weights sink.
  for (const s of [...report.stats].sort((a, b) => b.loadBearing - a.loadBearing || b.pivotal - a.pivotal)) {
    const kinds = s.byKind
      .filter(k => k.decisions > 0)
      .map(k => `${k.kind} ${pct(k.loadBearing / k.decisions)}`)
      .join('  ')
    lines.push(
      `  ${s.weight.padEnd(16)}${String(s.step).padStart(6)}${(s.hasQuantity ? rate(s.varies) : 'n/a').padStart(9)}` +
      `${rate(s.pivotal).padStart(9)}${rate(s.loadBearing).padStart(9)}` +
      `${(s.hasQuantity ? s.spread.toFixed(1) : 'n/a').padStart(9)}   ${kinds}`,
    )
  }
  lines.push('', row('wall clock', `${((Date.now() - start) / 1000).toFixed(1)}s`), '')
  console.log(lines.join('\n'))
}

function runMatchupsMode(args: Args): void {
  const aiA = args.aiExplicit ? args.aiA : 'greedy'
  const aiB = args.aiExplicit && args.aiB !== 'random' ? args.aiB : 'greedy-baseline'
  const gamesPerCell = args.gamesSet ? args.games : 4
  // One base per leader: every ORDERED pair must be played here, so 72 decks would be 5184 cells.
  const decks = buildMatchupDecks(undefined, 1)
  console.log(`\nAI matchups: ${aiA} vs ${aiB}, ${decks.length} decks (${decks.length ** 2} cells), ${gamesPerCell} games/cell, seed ${args.seed}\n`)

  const start = Date.now()
  let report
  try {
    report = runAiMatchups(decks, resolveAi(aiA), resolveAi(aiB), aiA, aiB, { gamesPerCell, seed: args.seed })
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    process.exit(2)
    return
  }

  const lines = [
    '',
    `dmgCtrl AI matchups  (engine ${report.buildTag})`,
    row(`overall (${report.aiA})`, `${pct(report.overallWinRateA)}  ± ${pct(report.overallCi)}   (${report.totalGames} games)`),
    row('dropped', `${report.dropped}`),
    row('wall clock', `${((Date.now() - start) / 1000).toFixed(0)}s`),
    '',
    `  worst matchups for ${report.aiA} (its deck vs theirs):`,
    ...report.cells.slice(0, 8).map(c => `    ${pct(c.winRateA).padStart(6)}   ${c.aLabel}  vs  ${c.bLabel}`),
    '',
    `  best matchups for ${report.aiA}:`,
    ...report.cells.slice(-8).reverse().map(c => `    ${pct(c.winRateA).padStart(6)}   ${c.aLabel}  vs  ${c.bLabel}`),
    '',
  ]
  console.log(lines.join('\n'))
  if (report.dropped > 0) process.exit(1)
}

function strengthTable(title: string, rows: StrengthRow[], limit?: number): string[] {
  const shown = limit ? rows.slice(0, limit) : rows
  const lines = [`  ${title}:`]
  for (const r of shown) {
    const margin = `${r.avgMargin >= 0 ? '+' : ''}${r.avgMargin.toFixed(1)}`
    lines.push(`    ${pct(r.winRate).padStart(6)}  margin ${margin.padStart(5)}   ${r.key}`)
  }
  return lines
}

function runMatrixMode(args: Args): void {
  const model = args.aiExplicit ? args.aiA : 'greedy'
  const gamesPerCell = args.gamesSet ? args.games : 10
  const decks = buildMatchupDecks()
  const cells = decks.length * decks.length
  console.log(`\nmatchup matrix: ${model}, ${decks.length} decks (${cells} cells), ${gamesPerCell} games/cell, seed ${args.seed}`)
  console.log(`about ${(decks.length * (decks.length + 1) / 2 * gamesPerCell).toLocaleString()} games to play; this takes a while...\n`)

  const start = Date.now()
  const result = runMatchupMatrix(decks, resolveAi(model), model, { gamesPerCell, seed: args.seed })
  const db = openDb(DEFAULT_DB_PATH)
  const runId = saveMatrix(db, result)
  const wall = ((Date.now() - start) / 1000).toFixed(0)

  const lines = [
    '',
    `dmgCtrl matchup matrix  (engine ${result.buildTag})`,
    row('model', model),
    row('decks / cells', `${result.deckCount} / ${cells}`),
    row('games per cell', `${result.gamesPerCell}`),
    row('dropped', `${result.dropped}`),
    row('wall clock', `${wall}s`),
    row('saved run', `${runId}  ->  ${DEFAULT_DB_PATH}`),
    '',
    ...strengthTable('strongest decks', deckStrength(db, runId), 8),
    '',
    ...strengthTable('weakest decks', deckStrength(db, runId).slice().reverse(), 8),
    '',
    ...strengthTable('by leader (strongest first)', leaderStrength(db, runId)),
    '',
    ...strengthTable('by base aspect', baseStrength(db, runId)),
    '',
    `  full matrix: sealed/${DEFAULT_DB_PATH}, table "matchups", run_id='${runId}'`,
    '',
  ]
  console.log(lines.join('\n'))
  if (result.dropped > 0) process.exit(1)
}

function main(): void {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    console.error('usage: npm run bench --prefix sealed -- [--games N] [--seed N] [--sweep|--generalise|--matrix|--decisions|--terms|--matchups] [aiA] [aiB]')
    process.exit(2)
    return
  }

  if (args.sweep) { runSweepMode(args); return }
  if (args.generalise) { runGeneraliseMode(args); return }
  if (args.matrix) { runMatrixMode(args); return }
  if (args.decisions) { runDecisionsMode(args); return }
  if (args.terms) { runTermsMode(args); return }
  if (args.matchups) { runMatchupsMode(args); return }

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
