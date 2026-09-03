import { runBench } from './runBench'
import type { BenchReport } from './runBench'
import { openDb, saveReport, saveExperiment, listExperiments, saveTermRun, DEFAULT_DB_PATH } from './store'
import { writeFailures, FAILURES_DIR } from './reports'
import { runSweep } from './sweep'
import type { SweepReport } from './sweep'
import { runDecisions, TIE_FANOUT_CAP } from './decisions'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import { runTerms } from './terms'
import type { TermReport } from './terms'
import type { WeightKey } from './tune'
import { runCost } from './cost'
import { runBudget, type BudgetReport } from './budget'
import { dirname, join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  runShards, poolShards, poolFirstPlayer, pendingSeeds, loadShardResults, shardRunKey, shardPayload,
  spawnShards, shardPayloadPath, SHARD_DIR,
} from './shard'
import { renderStatus, loadAllProgress, preflight } from './status'
import { pairedDifference, renderPaired } from './paired'
import type { CostReport } from './cost'
import type { DeckSource } from './decks'
import { runLethal } from './lethal'
import type { LethalReport } from './lethal'
import { DEFAULT_LETHAL_LIMITS } from '../ai/lethal'
import { runAiMatchups } from './aiMatchups'
import type { DecisionReport } from './decisions'
import { runGeneralisation } from './generalisation'
import type { GeneralisationReport } from './generalisation'
import { buildMatchupDecks } from './matchupDecks'
import { runMatchupMatrix, dealPairs, type MatrixResult } from './matrix'
import { saveMatrix, deckStrength, leaderStrength, baseStrength, firstPlayerAdvantage, type StrengthRow } from './store'
import type { FirstPlayerSplit } from './stats'
import { resolveAi } from '../ai/registry'
import { fetchSets, formatTriage, triage } from './triage'

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
  /** Every seed given. Only the sweep uses more than the first. */
  seeds: number[]
  sweep: boolean
  generalise: boolean
  matrix: boolean
  decisions: boolean
  terms: boolean
  cost: boolean
  budget: boolean
  lethal: boolean
  /** Solver depth for `--lethal`. Undefined means the shipped default. */
  depth?: number
  /**
   * Node budget for `--lethal`'s solver. Undefined leaves it scaled with `depth`, which is what
   * every result recorded before this flag existed ran on. See `solverNodesFor`.
   */
  solverNodes?: number
  matchups: boolean
  /** Run the head-to-head as N parallel single-threaded processes over N seeds, and pool them. */
  shards?: number
  status: boolean
  control: boolean
  history: boolean
  /** Write this run's structured result here, for a parent process to read back. */
  out?: string
  /** Restrict `--terms` to these weights. A precondition for a searching model, not an optimisation. */
  weights?: WeightKey[]
  /** This child's share of a partitioned mode: it deals itself every `shardCount`-th unit of work. */
  shardIndex?: number
  shardCount?: number
  triage: boolean
  /** Deck population for the A/B: `mirror` (default) or `coverage`. See `DeckSource`. */
  decks?: DeckSource
  /** Set codes for `--triage`, taken from the positional arguments. */
  sets: string[]
  aiExplicit: boolean
  /**
   * Every AI named positionally. The head-to-head modes take the first two; `--cost` and `--budget`
   * compare a whole sweep over one corpus, which is the entire point of those modes, so they take the
   * lot. Timing a sweep two at a time would re-measure the baseline in each process and give up the
   * shared JIT warm-up.
   */
  ais: string[]
  aiA: string
  aiB: string
}

export function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  let games = 100
  let gamesSet = false
  let seed = 1
  let seeds = [1]
  let sweep = false
  let generalise = false
  let matrix = false
  let decisions = false
  let terms = false
  let cost = false
  let budget = false
  let lethal = false
  let depth: number | undefined
  let solverNodes: number | undefined
  let matchups = false
  let shards: number | undefined
  let status = false
  let control = false
  let history = false
  let out: string | undefined
  let weights: WeightKey[] | undefined
  let shardIndex: number | undefined
  let shardCount: number | undefined
  let triage = false
  let decks: DeckSource | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--games') { games = Number(argv[++i]); gamesSet = true }
    // `--seed 1,2,3` runs the sweep under each seed and unions the coverage. Other modes take the
    // first, so a list is harmless rather than an error where it has no meaning.
    else if (arg === '--seed') { seeds = argv[++i].split(',').map(Number); seed = seeds[0] }
    else if (arg === '--sweep') sweep = true
    else if (arg === '--generalise') generalise = true
    else if (arg === '--matrix') matrix = true
    else if (arg === '--decisions') decisions = true
    else if (arg === '--terms') terms = true
    else if (arg === '--cost') cost = true
    else if (arg === '--budget') budget = true
    else if (arg === '--lethal') lethal = true
    else if (arg === '--depth') depth = Number(argv[++i])
    else if (arg === '--solver-nodes') solverNodes = Number(argv[++i])
    else if (arg === '--matchups') matchups = true
    else if (arg === '--shard') shards = Number(argv[++i])
    else if (arg === '--status') status = true
    else if (arg === '--control') control = true
    else if (arg === '--history') history = true
    else if (arg === '--out') out = argv[++i]
    else if (arg === '--weights') weights = argv[++i].split(',').map(w => w.trim()).filter(Boolean) as WeightKey[]
    else if (arg === '--shard-index') shardIndex = Number(argv[++i])
    else if (arg === '--shard-count') shardCount = Number(argv[++i])
    else if (arg === '--decks') {
      const v = argv[++i]
      if (v !== 'mirror' && v !== 'coverage') throw new Error(`--decks must be mirror or coverage, got "${v}"`)
      decks = v
    }
    else if (arg === '--triage') triage = true
    else if (arg.startsWith('--')) throw new Error(`Unknown flag: ${arg}`)
    else positional.push(arg)
  }
  if (!Number.isFinite(games) || games < 1) throw new Error(`--games must be a positive integer`)
  if (!seeds.every(Number.isFinite) || seeds.length === 0) throw new Error('--seed must be a number, or a comma-separated list of numbers')
  assertPositiveInt(depth, '--depth')
  assertPositiveInt(solverNodes, '--solver-nodes')
  if (triage && positional.length === 0) throw new Error('--triage needs at least one set code, e.g. --triage LAW SEC')
  if (shards !== undefined && (!Number.isFinite(shards) || shards < 1)) throw new Error('--shard must be a positive integer')
  return { games, gamesSet, seed, seeds, sweep, generalise, matrix, decisions, terms, cost, budget, lethal, depth, solverNodes, matchups, shards, status, control, history, out, weights, shardIndex, shardCount, triage, decks, sets: positional.map(s => s.toUpperCase()), aiExplicit: positional.length > 0, ais: positional, aiA: positional[0] ?? 'random', aiB: positional[1] ?? 'random' }
}

/**
 * One rule, two flags: the solver's depth and its node budget reject the same shapes alike.
 *
 * `Number.isInteger` rather than `Number.isFinite`, which is what `--depth` used to check. The
 * message always promised an integer and the check did not enforce it, so `--depth 1.5` was
 * accepted and then silently truncated inside the search. A missing value arrives here as NaN and
 * is rejected the same way.
 */
function assertPositiveInt(value: number | undefined, flag: string): void {
  if (value === undefined) return
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer`)
}

/**
 * The node budget `--lethal`'s solver runs at.
 *
 * Absent `--solver-nodes` it scales with depth, which is the expression every result recorded
 * before the flag existed ran on, so those numbers stay reproducible. That scaling is not enough
 * on its own: `depth x 4000` is 16,000 at depth 4, and at both 4,000 and 40,000 a depth-4 search
 * reports finding LESS lethal than a depth-2 one, going monotone only around 200,000. Any run
 * where the budget binds first is measuring the rail rather than the depth its name advertises,
 * and lifting it is what this flag is for.
 *
 * `undefined` means the shipped default, which `runLethal` resolves to `DEFAULT_LETHAL_LIMITS`.
 */
export function solverNodesFor(depth: number | undefined, solverNodes: number | undefined): number | undefined {
  if (solverNodes !== undefined) return solverNodes
  if (depth === undefined) return undefined
  return Math.max(DEFAULT_LETHAL_LIMITS.nodes, depth * 4000)
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
const row = (label: string, value: string): string => `  ${label.padEnd(22)}: ${value}`

/** A rate that may not have been measured. A dash, never 0.0%, which would read as a rout. */
const pctOrDash = (x: number | null): string => (x === null ? '-' : pct(x))
/** A difference between two rates, in percentage points and always signed, so it cannot be read as one. */
const points = (x: number | null): string => (x === null ? '-' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`)
/** A band width in percentage points. Never signed: the ± in front of it already says both directions. */
const band = (x: number | null): string => (x === null ? '-' : (x * 100).toFixed(1))

/**
 * The first-player split as one line: both halves, then the gap with its band.
 *
 * The gap carries both halves' noise and each half is half the sample, so the band is what says
 * whether a gap is a finding. It is quoted everywhere the gap is.
 */
function turnOrderLine(split: FirstPlayerSplit): string {
  return `${pct(split.onPlay.rate)} on the play  /  ${pct(split.onDraw.rate)} on the draw` +
    `   gap ${points(split.gap)} ± ${band(split.gapCi)} pts` +
    `   (${split.onPlay.games.toLocaleString()} / ${split.onDraw.games.toLocaleString()} games)`
}

function format(report: BenchReport, wallMs: number): string {
  const totalMoves = report.games.reduce((n, g) => n + g.moveCount, 0)
  const lo = Math.max(0, report.winRateA - report.winCi)
  const hi = Math.min(1, report.winRateA + report.winCi)
  // A run is one shard's worth of games, so it pools through the same function a sharded run does:
  // one place recovers the win count from the rate, rather than two that could round differently.
  const split = poolFirstPlayer([report])
  const lines = [
    '',
    `dmgCtrl AI bench  (engine ${report.commitId})`,
    `${report.aiA} vs ${report.aiB}   ${report.gamesRequested} games   seed ${report.seed}`,
    '',
    row(`win rate (${report.aiA}/A)`, `${pct(report.winRateA)}  ± ${pct(report.winCi)}   (${pct(lo)} – ${pct(hi)})`),
    row('turn order', split === null ? '-' : turnOrderLine(split)),
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
    `dmgCtrl coverage sweep  (engine ${report.commitId})`,
    `${report.decks} decks × ${report.gamesPerDeck} games × ${report.seeds.length} seed(s)   ${aiName} mirror`,
    '',
    row('seeds', report.seeds.join(', ')),
    row('total games', `${report.totalGames}`),
    row('completed / dropped', `${report.completed} / ${report.dropped}`),
    row('cards decked', `${report.cardsDecked}`),
    row('cards drawn', `${report.cardsDrawn}`),
    row('cards played', `${report.cardsPlayed}  (${pct(report.cardsPlayed / Math.max(1, report.cardsDecked))} of decked)`),
    row('leaders / deployed', `${report.leaders} / ${report.leadersDeployed}`),
    row('bases', `${report.bases}`),
    row('wall clock', `${(wallMs / 1000).toFixed(1)}s`),
    '',
  ]
  if (report.uncovered.length > 0) {
    // Not a failure: a card the run never reached is a fact about the run, and the card tickets
    // assert against this list themselves.
    lines.push(`  ${report.uncovered.length} card(s) decked but never played:`)
    for (const id of report.uncovered.slice(0, 40)) lines.push(`    ${id}`)
    if (report.uncovered.length > 40) lines.push(`    ... and ${report.uncovered.length - 40} more`)
    lines.push('')
  }
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
    report = runSweep({ gamesPerDeck, seeds: args.seeds, aiName: args.aiA })
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
    `dmgCtrl generalisation  (engine ${report.commitId})`,
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
    `dmgCtrl decision quality  (engine ${report.commitId})`,
    `${report.ai}, ${report.games} games across the coverage decks`,
    '',
    '  a TIE is a decision the evaluation cannot see: every candidate scores the same, so the',
    '  seeded tie-break picks one at random. High tie rates are blind spots, not close calls.',
    '',
    '  "1-ply" is a fixed one-ply scorer, comparable with every historical run. "search" is the AI',
    '  actually being measured, read off the values its own search computed. They differ in BOTH',
    '  directions: a beam separates moves one ply cannot tell apart, and also ties moves one ply',
    '  scores differently, when their lines converge inside the horizon. "search" is the rate at',
    '  which the bot under test coin-flips, and is the one to act on.',
    '',
    '    1-ply   search   offered   avg options   decision',
  ]
  for (const s of report.stats) {
    const rate = (n: number): string => (s.offered === 0 ? '  n/a' : pct(n / s.offered).padStart(6))
    lines.push(
      `  ${rate(s.tied)}   ${rate(s.tiedSearch)}   ${String(s.offered).padStart(7)}   ` +
      `${s.avgCandidates.toFixed(1).padStart(11)}   ${s.label}`,
    )
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
  const ti = report.ties
  lines.push(
    '',
    '  search ties: how often more than one candidate tied FOR THE LEAD, so the seeded pick decided.',
    '  Not the same as the tied columns above, which need the whole slate to score alike. This is the',
    '  rate a second opinion would fire at, and the tied SET is what it re-searches, so the cost is',
    '  the fan-out rather than the rate.',
  )
  if (ti.searched === 0) {
    lines.push(row('ties for the lead', 'n/a (this AI runs no search)'))
  } else {
    lines.push(
      row('ties for the lead', rate(ti.fired, ti.searched)),
      row('candidates re-searched', `${ti.tiedTotal} = ${(ti.tiedTotal / Math.max(1, ti.fired)).toFixed(1)} avg per firing`),
      row('  as a share of roots', ti.rootsWhenFired === 0 ? 'n/a' : pct(ti.tiedTotal / ti.rootsWhenFired) + ' of the roots in those decisions'),
      // Extra root searches against the root searches the main search already does. An upper bound on
      // cost, not the cost: a cheaper second opinion (a null reply, one ply) prices each root lower.
      row('  overhead in roots', ti.rootsSearched === 0 ? 'n/a' : `+${pct(ti.tiedTotal / ti.rootsSearched)} over the whole run`),
      row('widest tie', `${ti.widest} candidates` +
        (ti.byKind.some(k => k.widest === ti.widest) ? ` (${ti.byKind.find(k => k.widest === ti.widest)!.kind})` : '')),
      row('  widest by kind', ti.byKind.filter(k => k.fired > 0).map(k => `${k.kind} ${k.widest}`).join('  ')),
      row(`  capped at ${TIE_FANOUT_CAP}`, `${ti.tiedTotalCapped} re-searches (+${pct(ti.tiedTotalCapped / Math.max(1, ti.rootsSearched))}), ` +
        `${rate(ti.firedWide, ti.fired)} of ties bite the cap`),
      row('by kind', ti.byKind.map(k => `${k.kind} ${pct(k.searched === 0 ? 0 : k.fired / k.searched)}`).join('  ')),
    )
  }

  const ih = report.initiativeHorizon
  lines.push(
    '',
    '  initiative, looking one round ahead: claiming makes you act first NEXT round, which the search',
    '  cannot see at all (it stops at the round boundary). That is why "take it" is the largest tie in',
    '  the model. These bound how often claiming could decide the game rather than merely help.',
    row('claiming offered', `${ih.offered}`),
    row('we finish next round', rate(ih.weFinishNext, ih.offered)),
    row('they finish next round', rate(ih.theyFinishNext, ih.offered)),
    row('BOTH: order decides it', rate(ih.bothFinishNext, ih.offered) + '  (the conversion case)'),
    row('  and not already won', rate(ih.conversionLive, ih.offered)),
    row('theirs only: deny or lose', rate(ih.theyOnly, ih.offered) + '  (the denial case)'),
    row('  and not already won', rate(ih.denialLive, ih.offered)),
    row('could just win this round', rate(ih.lethalNow, ih.offered)),
    '',
    '  and what the bot DID about it. Prevalence says the situation arises; only this says whether the',
    '  bot gets it wrong. "quiet" is the control: the claim rate where no horizon case is live at all,',
    '  from the same population. A denial rate at or below quiet is a blind spot; well above it means',
    '  the behaviour is already there and needs no rule.',
    row('claimed, conversion', rate(ih.conversionClaimed, ih.conversionLive)),
    row('claimed, DENIAL', rate(ih.denialClaimed, ih.denialLive)),
    row('claimed, we finish only', rate(ih.weOnlyClaimed, ih.weOnlyLive)),
    row('claimed, quiet (control)', rate(ih.quietClaimed, ih.quietOffers)),
  )

  const dn = report.denialOutcome
  const mean = (total: number, n: number): string => (n === 0 ? 'n/a' : (total / n).toFixed(1))
  // Count AND rate in one cell: a stage at 40% of 5 decisions and one at 40% of 300 are different
  // findings, and a column of bare percentages hides which is which.
  const rateCell = (n: number, d: number): string => (d === 0 ? 'n/a'.padStart(14) : `${n} ${pct(n / d)}`.padStart(14))
  lines.push(
    '',
    '  denial, followed to the end of the game. "they finish next round" is a PREDICTION, and the claim',
    '  rate alone cannot say whether claiming works. Stages are exclusive and run in time order. The',
    '  free run comes FIRST: claiming forfeits the rest of your own round, so they get a turn before the',
    '  turn order you bought ever applies. Losses there were caused by the claim, not prevented by it.',
    '',
    '  Both columns come from the same population, but the split is the BOT\'S choice, not a treatment:',
    '  it claims where it reads the position as salvageable, so declined is selected for hopelessness.',
    '  Read the funnel shape, not the difference. An effect needs the forced counterfactual.',
    `      ${'stage'.padEnd(34)}${'claimed'.padStart(14)}${'declined'.padStart(14)}`,
    `      ${'denial decisions'.padEnd(34)}${String(dn.claimed).padStart(14)}${String(dn.declined).padStart(14)}`,
    `      ${'lost on their free run'.padEnd(34)}${rateCell(dn.claimedLostFreeRun, dn.claimed)}${rateCell(dn.declinedLostFreeRun, dn.declined)}`,
    `      ${'lost to their first action'.padEnd(34)}${rateCell(dn.claimedLostFirstAction, dn.claimed)}${rateCell(dn.declinedLostFirstAction, dn.declined)}`,
    `      ${'lost later that round'.padEnd(34)}${rateCell(dn.claimedLostNextRound, dn.claimed)}${rateCell(dn.declinedLostNextRound, dn.declined)}`,
    `      ${'survived the round they bought'.padEnd(34)}${rateCell(dn.claimedSurvived, dn.claimed)}${rateCell(dn.declinedSurvived, dn.declined)}`,
    `      ${'WON the game'.padEnd(34)}${rateCell(dn.claimedWonGame, dn.claimed)}${rateCell(dn.declinedWonGame, dn.declined)}`,
    `      ${'mean rounds after the decision'.padEnd(34)}${mean(dn.claimedRoundsAfter, dn.claimed).padStart(14)}${mean(dn.declinedRoundsAfter, dn.declined).padStart(14)}`,
    '',
    '  and two splits that decide how the funnel above should be read. "hopeless" is canFinishNow, not',
    '  the bucket\'s reachSteady: they finish before this round is out, so turn order next round was',
    '  never on offer and the bot cannot be charged for declining it. "had counterplay" is whether we',
    '  gave anything up: with no other legal move, claiming is free and proves nothing about judgement.',
    `      ${'hopeless anyway'.padEnd(34)}${rateCell(dn.claimedHopeless, dn.claimed)}${rateCell(dn.declinedHopeless, dn.declined)}`,
    `      ${'had counterplay to give up'.padEnd(34)}${rateCell(dn.claimedWithCounterplay, dn.claimed)}${rateCell(dn.declinedWithCounterplay, dn.declined)}`,
  )

  const ps = report.passes
  lines.push(
    '',
    '  doing nothing. A competent player passes about once every five to ten GAMES, and only with a',
    '  read on what the opponent holds plus the answer in hand. Forced passes are excluded, since with',
    '  no other legal move passing is not a decision and counting them understates the defect exactly',
    '  where the board is emptiest.',
    '',
    '  Ending the round is NOT the defensible case. Claiming makes you done for the round rather than',
    '  passing out of it, so the only pass that ends a spent round is the forced one, already excluded.',
    '  "Worse than claiming" is the sharpest line here and needs no judgement about the position: with',
    '  the opponent already passed, passing and claiming end the phase identically, except claiming also',
    '  takes the initiative. Same board, one strictly better move.',
    row('MID-ROUND passes per game', ps.games === 0 ? 'n/a' : `${(ps.midRound / ps.games).toFixed(2)}   target ~0.15`),
    row('chosen passes per game', ps.games === 0 ? 'n/a' : (ps.taken / ps.games).toFixed(2)),
    row('passed when it had a choice', rate(ps.taken, ps.offered)),
    row('  mid-round (play continues)', rate(ps.midRound, ps.taken)),
    row('  WORSE THAN CLAIMING', rate(ps.dominatedByClaim, ps.taken)),
    row('  with an attack available', rate(ps.withAttackAvailable, ps.taken)),
    row('  ending the action phase', rate(ps.endedPhase, ps.taken)),
    row('forced (no other legal move)', `${ps.forced}`),
    '',
    '  what the charge is actually buying. These are the decisions it FLIPPED: passing led on the raw',
    '  scores and lost only because it was charged. Spending resources is free in the evaluation, so a',
    '  useless card costs only its hand value, 1 to 3 points against a charge of 8, and the bot should',
    '  prefer the useless card to passing. If these flipped into real actions the charge is working; if',
    '  they flipped into filler it has traded one bad habit for a worse one.',
    row('decisions the charge flipped', rate(ps.flipped, ps.offered)),
    row('  into', ps.flippedInto.length === 0
      ? 'none'
      : ps.flippedInto.slice(0, 6).map(k => `${k.kind} ${k.count}`).join(', ')),
    '',
    '  debuff upgrades, and whose unit they landed on. The board term sums power with no context, so a',
    '  "while attacking" debuff is invisible to it and friendly and enemy targets score alike. BOTH',
    '  sides are shown because our own count alone cannot tell "always targets correctly" from "never',
    '  came up": a correct play onto an enemy leaves no trace. Read own / (own + enemy): about half is',
    '  the coin flip, near zero is choosing correctly, and 0 of 0 means the diagnostic cannot speak.',
    row('upgrades attached', `${report.selfDebuff.onOwnUnits} on ours, ${report.selfDebuff.onEnemyUnits} on theirs`),
    row('  debuffs onto OUR unit', `${report.selfDebuff.ownWorsened}`),
    row('  debuffs onto THEIR unit', `${report.selfDebuff.enemyWorsened}`),
    row('  share landing on ours', report.selfDebuff.ownWorsened + report.selfDebuff.enemyWorsened === 0
      ? 'never arose'
      : rate(report.selfDebuff.ownWorsened, report.selfDebuff.ownWorsened + report.selfDebuff.enemyWorsened)),
  )

  const it2 = report.initiativeTies
  lines.push(
    '',
    '  claiming, decomposed. The tie column above USED to count claiming against a maximum that',
    '  included claiming itself, so winning outright counted as a tie and the "largest blind spot in',
    '  the model" was mostly the bot getting the decision right. These three partition the decision,',
    '  measured against the best ALTERNATIVE.',
    row('decisions with an alternative', `${it2.decisions}`),
    row('  claiming won outright', rate(it2.uniquelyBest, it2.decisions) + '  (not a tie)'),
    row('  claiming tied the best', rate(it2.tiedWithBest, it2.decisions)),
    row('  an alternative won', rate(it2.beaten, it2.decisions)),
    '',
    '  and what the seeded pick was left with. A tie goes to the second opinion first, so only what',
    '  survives THAT is a coin flip. The gap is the only measure of whether the tie-break, which is',
    '  shipped and paid for, separates anything here.',
    row('ties handed to the tie-break', rate(it2.tiesOffered, it2.decisions)),
    row('  still level afterwards', rate(it2.unresolved, it2.tiesOffered) + '  (the real coin flips)'),
    row('  candidates flipped between', it2.unresolved === 0 ? 'n/a' : (it2.survivors / it2.unresolved).toFixed(1)),
    '',
    '  and what claiming tied WITH. Tying with pass means the search sees nothing to do and claiming is',
    '  free; tying with an attack means it is weighing turn order against damage. Those want opposite',
    '  policies, and one rate cannot tell them apart.',
    row('tying candidates by move', it2.tyingKinds.length === 0
      ? 'none'
      : it2.tyingKinds.slice(0, 6).map(k => `${k.kind} ${k.count}`).join(', ')),
  )

  const cc = report.claimCost
  lines.push(
    '',
    '  what claiming COST, over every claim rather than the denial bucket. Claiming forfeits the rest',
    '  of your round and they spend it. A claim made when they could NOT finish next round, followed by',
    '  a round they used to make sure they could, handed them the game; that case cannot appear in the',
    '  denial bucket, which requires the threat to exist already. This is the quantity tailActions',
    '  models, so a small number here means the tail is pricing a cost that is not there.',
    row('claims made', `${cc.claims}`),
    row('  free run measurable', rate(cc.measured, cc.claims) + '  (the rest ended inside it)'),
    row('  threat already there', rate(cc.threatBefore, cc.measured)),
    row('  threat CREATED by the free run', rate(cc.threatCreated, cc.measured)),
    row('  their reach grew at all', rate(cc.reachGrew, cc.measured)),
    row('  mean growth when it grew', cc.reachGrew === 0 ? 'n/a' : (cc.reachGrowth / cc.reachGrew).toFixed(1)),
  )

  const tr = report.triggers
  lines.push(
    '',
    '  optional triggers: a "may" ability offers a decline among its answers, so declining is visible',
    '  without a table of ~70 choice kinds. The named failure mode is a bot that accepts everything,',
    '  which is what happens if declining is never scored favourably. The control is exact rather than',
    '  measured: a uniform picker takes one of n candidates and exactly one of them declines.',
    row('optional triggers offered', `${tr.offered}`),
    row('the bot accepted', rate(tr.accepted, tr.offered)),
    row('a uniform picker would', tr.offered === 0 ? 'n/a' : pct(tr.randomExpected / tr.offered)),
    row('  all answers scored alike', rate(tr.tied, tr.offered)),
    row('by kind', tr.byKind.slice(0, 4).map(k => `${k.kind} ${pct(k.offered === 0 ? 0 : k.accepted / k.offered)} of ${k.offered}`).join(', ') || 'none'),
  )

  const pn = report.pin
  lines.push(
    '',
    '  offensive pinning: holding a ready unit that would kill their leader on arrival. This is a',
    '  NON-action, so no depth reaches it: the search chooses between actions and this is the value of',
    '  not taking one. "deployed into a pin" decides whether self-play can measure it at all, since a',
    '  bench where the threat is never respected cannot reward holding it.',
    row('their leader can deploy', `${pn.decisions}`),
    row('  we hold a pin', rate(pn.pinAvailable, pn.decisions)),
    row('  mean pinning units', pn.pinAvailable === 0 ? 'n/a' : (pn.pinnersTotal / pn.pinAvailable).toFixed(1)),
    row('  and we SPENT it', rate(pn.pinSpent, pn.pinAvailable) + '  (attacked with the pinning unit)'),
    row('leader deploys seen', `${pn.deploys}`),
    row('  deployed into a pin', rate(pn.deployedIntoPin, pn.deploys)),
  )

  const ad = report.advantage
  const spent = ad.spentAttacking + ad.spentDefending + ad.spentOther
  lines.push(
    '',
    '  Advantage: a 1/0 token, so the evaluation SEES it through power. What it gets wrong is the',
    '  timing: the token lasts only until its unit next completes an attack or defence, and the whole',
    '  stack goes at once. Prevalence is the gate here, against Shield\'s 15.8%.',
    row('a token in play', rate(ad.decisionsWithAny, ad.decisions)),
    row('  a decision turns on one', rate(ad.decisionsOnCarrier, ad.decisions)),
    row('tokens seen', `${ad.tokensSeen}, largest stack ${ad.maxStack}`),
    row('spent attacking', rate(ad.spentAttacking, Math.max(1, spent))),
    row('spent DEFENDING', rate(ad.spentDefending, Math.max(1, spent)) + '  (the permanent model misses these)'),
    row('spent otherwise', rate(ad.spentOther, Math.max(1, spent))),
    row('died unspent', `${ad.diedUnspent}  (never worth anything, but scored the whole time)`),
    row('  ours, wasted', `${ad.diedUnspentOurs}`),
    row('  theirs, denied', `${ad.diedUnspentTheirs}  (killed the carrier; with "spent defending",`
      + ' this is the whole of trading to strip their Advantage)'),
    row('token grants answered', `${ad.grantChoices}`),
    row('  no preferred recipient', rate(ad.grantChoicesAllEqual, ad.grantChoices)),
  )

  const br = report.blockedReach
  lines.push(
    '',
    '  blocked reach: how often the term is LIVE, against how often the lockout it was written for',
    '  occurs. The quantity keys on sentinelLocked, true for ANY enemy Sentinel, so a wide gap here',
    '  means a board-wide bias against Sentinels rather than the narrow gate it was designed as.',
    row('term is live', rate(br.active, br.decisions)),
    row('  and a lane IS shut', rate(br.activeAndLaneShut, br.active)),
    row('mean quantity when live', br.active === 0 ? 'n/a' : (br.totalQuantity / br.active).toFixed(1)),
    row('largest quantity', `${br.widestQuantity}  (cap ${DEFAULT_WEIGHTS.blockedReachCap})`),
  )

  const sh = report.shields
  const shieldRate = (n: number, d: number): string => (d === 0 ? 'n/a' : `${n} of ${d} = ${pct(n / d)}`)
  lines.push(
    '',
    '  shields: a Shield absorbs one whole instance of damage, so a move that strips one leaves a',
    '  board scoring IDENTICALLY under an evaluation with no token term. The strip reads as a wasted',
    '  action while its cost is counted in full.',
    row('decisions facing a shield', shieldRate(sh.decisionsFacingShield, report.exposure.decisions)),
    row('  a strip was available', shieldRate(sh.removalAvailable, sh.decisionsFacingShield)),
    row('  the bot took it', shieldRate(sh.removals, sh.removalAvailable)),
    row('shields seen', `${sh.shieldsSeen} across those decisions`),
    row('holding one ourselves', shieldRate(sh.decisionsHoldingShield, report.exposure.decisions)),
    '',
    '  the lockout: a Sentinel forces every attacker in its arena onto itself, so a Shield on one',
    '  closes the lane rather than absorbing a hit. Consecutive rounds is the figure that matters:',
    '  one round is noise, four is a lost game.',
    row('shielded blockers seen', `${sh.shieldedBlockers}`),
    row('a LANE shut', shieldRate(sh.laneLocked, report.exposure.decisions)),
    row('  both lanes shut', shieldRate(sh.lockedOut, report.exposure.decisions)),
    row('rounds locked', shieldRate(sh.lockedRounds, sh.roundsSampled)),
    row('longest lockout', `${sh.longestLockout} consecutive rounds in one game`),
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
    '  leader deploys: a leader is a large investment and re-deploying costs the epic action, so',
    '  losing one straight away is among the most expensive mistakes available. #425 claims to',
    '  subsume #397 direct pinning, and this rate falling is the evidence for that claim.',
    row('leaders deployed', `${report.leader.deploys}`),
    row('  died within a round', rate(report.leader.diedSoon, report.leader.deploys)),
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
  let termRunId: string
  try {
    // Naming a searching model is ~60x a one-ply pass unless the weights are narrowed, since every
    // perturbation becomes a full search per decision. Say so before spending the evening on it.
    if (args.aiExplicit && args.weights === undefined) {
      console.log('\n  NOTE: perturbing every weight through a searching model is ~60x a one-ply pass.')
      console.log('        Narrow it with --weights key1,key2 unless you mean to run for hours.\n')
    }
    report = runTerms({ gamesPerDeck, seed: args.seed, model: args.aiExplicit ? args.aiA : undefined, weights: args.weights })
    // Persisted, because "has this weight woken up since the search landed?" is a question about two
    // readings taken months apart, and until now every one of them printed to a terminal and vanished.
    const db = openDb(DEFAULT_DB_PATH)
    termRunId = saveTermRun(db, args.aiExplicit ? args.aiA : 'one-ply', report)
    db.close()
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    process.exit(2)
    return
  }

  const rate = (n: number): string => pct(report.decisions === 0 ? 0 : n / report.decisions)
  const lines = [
    '',
    `dmgCtrl term sensitivity  (engine ${report.commitId})`,
    row('model', args.aiExplicit ? args.aiA : 'one-ply (default)'),
    row('games', `${report.games}`),
    row('decisions', `${report.decisions}`),
    row('saved run', `${termRunId}  ->  ${DEFAULT_DB_PATH}`),
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

/**
 * Lethal solver sizing (#433). The headline is `beam missed`, not `lethal found`: a win the shipped
 * bot already plays is not headroom, and attacks-only lethal is closed form rather than search.
 */
function runLethalMode(args: Args): void {
  const gamesPerDeck = args.gamesSet ? args.games : 1
  const start = Date.now()
  let report: LethalReport
  try {
    // Sampled hard: the first run checked 60 positions a seed and found three disagreements it could
    // not classify. Correctness is the risk in this ticket, so it gets the compute.
    //
    // The node budget scales with depth unless `--solver-nodes` overrides it. A fixed rail would
    // bind before the depth did and the sweep would report a flat curve for the wrong reason, and
    // the scaled one is itself too low to size a solver with. See `solverNodesFor`.
    report = runLethal({
      gamesPerDeck,
      seed: args.seed,
      oracleSamples: 400,
      oracleStride: 5,
      solverDepth: args.depth,
      solverNodes: solverNodesFor(args.depth, args.solverNodes),
    })
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    process.exit(2)
    return
  }

  const le = report.lethal
  const found = le.attacksOnly + le.searchOnly
  const rate = (n: number): string => `${pct(report.decisions === 0 ? 0 : n / report.decisions)}  (${n})`
  const lines = [
    '',
    `dmgCtrl lethal solver sizing  (engine ${report.commitId})`,
    row('games', `${report.games}`),
    row('decisions', `${report.decisions}`),
    row('solver depth / nodes', `${report.solverDepth} / ${report.solverNodes}`),
    '',
    row('lethal found', rate(found)),
    row('  attacks alone', `${rate(le.attacksOnly)}   closed form, the search added nothing`),
    row('  needed search', `${rate(le.searchOnly)}   the hand, the leader, or a Sentinel cleared`),
    '',
    row('beam already saw it', rate(le.beamSaw)),
    row('BEAM MISSED IT', `${rate(le.beamMissed)}   <- the only headroom here`),
    '',
    row('gate skipped', `${rate(report.gate.skipped)}   compute saved`),
    row('  had lethal', `${report.gate.skippedWithLethal}   fine if the beam wins them anyway`),
    row('  COST A WIN', `${report.gate.skippedCostingAWin}   <- must be zero`),
    '',
    row('oracle checked', `${report.oracle.checked}`),
    row('  SOLVER MISSED', `${report.oracle.solverMissed}   <- a real defect: pruning lost a line`),
    row('  solver found extra', `${report.oracle.solverExtra}   expected: owed answers cost it budget, not depth`),
    row('  with choice pending', `${report.oracle.disagreedWithChoicePending}   of the disagreements above`),
    row('ms per solver call', report.msPerCall.toFixed(2)),
    '',
    '  by round (decisions / lethal / beam missed):',
    `    ${report.byRound.map(r => `r${r.round} ${r.decisions}/${r.lethal}/${r.beamMissed}`).join('  ')}`,
    '',
    row('wall clock', `${((Date.now() - start) / 1000).toFixed(1)}s`),
    '',
  ]
  console.log(lines.join('\n'))
}

/**
 * Per-decision cost (#425). Ratios are the finding; absolute milliseconds depend on the machine and
 * on which positions the corpus holds, so the relative column is what travels between runs.
 */
function runCostMode(args: Args): void {
  const states = args.gamesSet ? args.games : 200
  const start = Date.now()
  let report: CostReport
  try {
    report = runCost({
      states,
      seed: args.seed,
      // Every positional name, not just the first two: a sweep is timed in one process over one
      // corpus, or the comparison it exists to make is lost.
      ais: args.aiExplicit ? args.ais : undefined,
    })
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    process.exit(2)
    return
  }

  const lines = [
    '',
    `dmgCtrl per-decision cost  (engine ${report.commitId})`,
    row('decision states', `${report.states}`),
    '',
    '  Ratios travel between machines; absolute milliseconds do not, since they depend on the box',
    '  and on which positions the corpus holds. Do NOT take these from a bench wall clock: a game',
    '  clock includes the opponent\'s cheap decisions and engine overhead, and understates the ratio.',
    '',
    `  ${'ai'.padEnd(24)}${'ms/decision'.padStart(13)}${`vs ${report.baseline}`.padStart(14)}`,
  ]
  for (const r of [...report.rows].sort((a, b) => a.msPerDecision - b.msPerDecision)) {
    lines.push(`  ${r.ai.padEnd(24)}${r.msPerDecision.toFixed(2).padStart(13)}${`${r.relative.toFixed(2)}x`.padStart(14)}`)
  }
  lines.push('', row('wall clock', `${((Date.now() - start) / 1000).toFixed(1)}s`), '')
  console.log(lines.join('\n'))
}

/**
 * Whether the node rail is firing (#447), so a sweep can carry a control cell rather than hope.
 *
 * The corpus wants to be LARGE here for the same reason `--cost` does. It is played from the opening,
 * so a small one holds only opening positions, where few units are on the board, few moves are legal
 * and the budget is never troubled. That is not evidence the rail is idle, only that it is idle on
 * turn one.
 */
function runBudgetMode(args: Args): void {
  const states = args.gamesSet ? args.games : 200
  const start = Date.now()
  let report: BudgetReport
  try {
    report = runBudget({ states, seed: args.seed, ais: args.aiExplicit ? args.ais : ['beam', 'beam-reply'] })
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    process.exit(2)
    return
  }

  const lines = [
    '',
    `dmgCtrl search budget  (engine ${report.commitId})`,
    row('decision states', `${report.states}`),
    '',
    '  "exhausted" is the share of decisions where the budget ran out, so the move played is a',
    '  truncated search\'s answer. Any cell of a depth or width sweep that exhausts is measuring the',
    '  rail rather than the axis being swept.',
    '',
    '  "chain" is budget spent resolving owed choices, "beam" is expanding actions and replies. They',
    '  share one pool, so a large chain share means the lookahead is being starved by choice',
    '  resolution and raising the rail treats the symptom.',
    '',
    `  ${'ai'.padEnd(26)}${'exhausted'.padStart(11)}${'avg spend'.padStart(12)}${'chain'.padStart(11)}${'beam'.padStart(11)}${'chain %'.padStart(10)}`,
  ]
  for (const r of report.rows) {
    lines.push(
      `  ${r.ai.padEnd(26)}${pct(r.exhaustedRate).padStart(11)}${r.avgSpend.toFixed(0).padStart(12)}` +
      `${r.avgChain.toFixed(0).padStart(11)}${r.avgBeam.toFixed(0).padStart(11)}${pct(r.chainShare).padStart(10)}`,
    )
  }
  if (report.skipped.length > 0) {
    lines.push('', `  no beam search, nothing to report: ${report.skipped.join(', ')}`)
  }
  lines.push('', row('wall clock', `${((Date.now() - start) / 1000).toFixed(1)}s`), '')
  console.log(lines.join('\n'))
}

/**
 * The head-to-head as N parallel processes over N seeds, pooled (#447, #488).
 *
 * Each shard is a valid standalone run, so the per-shard column is worth reading: a finding that
 * holds across independent seeds is much stronger than one long run, and a single shard disagreeing
 * with the rest is a signal rather than noise to be averaged away.
 */
async function runShardMode(args: Args): Promise<void> {
  const shards = args.shards ?? 1
  const start = Date.now()
  const config = { shards, games: args.games, baseSeed: args.seed, aiA: args.aiA, aiB: args.aiB, decks: args.decks }
  const dir = join(SHARD_DIR, shardRunKey(config))
  const todo = pendingSeeds(config, loadShardResults(dir))

  console.log(
    `\n${args.aiA} vs ${args.aiB}   ${shards} shards x ${args.games} games ` +
    `= ${shards * args.games} games   seeds ${args.seed} to ${args.seed + shards - 1}\n`,
  )
  // Cheap checks, stated before hours are spent rather than discovered afterwards.
  for (const warning of preflight({ shards, games: args.games })) console.log(`  WARNING: ${warning}\n`)
  // Say so loudly. A resumed run that looked like a fresh one would invite someone to wonder why a
  // three-day job finished in twenty minutes.
  if (todo.length < shards) {
    console.log(`  RESUMING: ${shards - todo.length} shard(s) already complete, ${todo.length} to run`)
  }
  console.log(`  per-shard logs and results: ${dir}/\n`)

  const results = await runShards(config)

  const good = results.filter(r => r.exitCode === 0 || r.completed > 0)
  const pooled = poolShards(good)
  const lo = Math.max(0, pooled.winRateA - pooled.winCi)
  const hi = Math.min(1, pooled.winRateA + pooled.winCi)

  const lines = ['  per shard:']
  for (const r of results) {
    const note = r.exitCode === 0 ? '' : `   <- exit ${r.exitCode}`
    lines.push(`    seed ${String(r.seed).padStart(5)}  ${pct(r.winRateA).padStart(6)}  ` +
      `${String(r.completed).padStart(5)} completed, ${r.dropped} dropped${note}`)
  }
  const failed = results.filter(r => r.exitCode !== 0)
  // Null when any shard was banked before the split existed, which a resumed run can mix in. Saying
  // nothing is right there: a partial pool would be a first-player rate over a fraction of the games.
  const split = poolFirstPlayer(good)
  lines.push(
    '',
    row(`pooled win rate (${args.aiA})`, `${pct(pooled.winRateA)}  ± ${pct(pooled.winCi)}   (${pct(lo)} – ${pct(hi)})`),
    row('turn order', split === null ? 'not recorded by every shard' : turnOrderLine(split)),
    row('games pooled', `${pooled.wins} wins of ${pooled.completed}`),
    row('shards failed', `${failed.length} of ${results.length}`),
  )

  // The control is the same baseline played against ITSELF, on the same seeds, the same games per
  // shard and the same decks: one difference between the two runs, which is the arm. It gets its own
  // run directory (its `aiA` differs), so it banks and resumes independently.
  if (args.control) {
    console.log(lines.join('\n'))
    console.log(`\n  now the control: ${args.aiB} vs ${args.aiB} on the same ${shards} seeds\n`)
    const controlResults = await runShards({ ...config, aiA: args.aiB })
    const paired = pairedDifference(results, controlResults)
    const ctlPooled = poolShards(controlResults.filter(r => r.exitCode === 0 || r.completed > 0))

    // Persisted as ONE row: the comparison is the evidence, and storing the two runs without the
    // relationship between them is what left a +2.35 result living only in a ticket comment.
    const db = openDb(DEFAULT_DB_PATH)
    const experimentId = saveExperiment(db, {
      armSpec: args.aiA,
      controlSpec: args.aiB,
      decks: args.decks ?? 'mirror',
      baseSeed: args.seed,
      shards,
      gamesPerShard: args.games,
      arm: results,
      control: controlResults,
      paired,
    })
    db.close()

    lines.length = 0
    lines.push(
      row(`pooled win rate (${args.aiB} control)`, `${pct(ctlPooled.winRateA)}  (${ctlPooled.wins} of ${ctlPooled.completed})`),
      ...renderPaired(args.aiA, args.aiB, paired),
      row('saved experiment', `${experimentId}  →  ${DEFAULT_DB_PATH}`),
    )
  }

  lines.push(row('wall clock', `${((Date.now() - start) / 1000).toFixed(1)}s`), '')
  console.log(lines.join('\n'))
  if (failed.length > 0) process.exit(1)
}

/**
 * Every comparison an arm has ever been in, newest first.
 *
 * The query that justifies storing experiments at all: **a store nobody queries is worse than none**,
 * because it implies a coverage it does not deliver. Filtered by substring so a family is one question
 * (`--history tie=reply` covers every tie-break arm ever run), and the paired difference leads, because
 * a raw win rate without its control is the reading that inverted a live result.
 */
function runHistoryMode(args: Args): void {
  const db = openDb(DEFAULT_DB_PATH)
  const needle = args.ais[0] ?? ''
  const rows = listExperiments(db).filter(r => r.armSpec.includes(needle) || r.controlSpec.includes(needle))
  db.close()

  if (rows.length === 0) {
    console.log(`\nno experiments${needle ? ` matching "${needle}"` : ''} in ${DEFAULT_DB_PATH}\n`)
    return
  }
  const lines = [`\nexperiments${needle ? ` matching "${needle}"` : ''}  (${rows.length})\n`]
  for (const r of rows) {
    const diff = `${r.pairedMean >= 0 ? '+' : ''}${(r.pairedMean * 100).toFixed(2)}`
    const t = r.pairedT === null ? 'n/a' : r.pairedT.toFixed(2)
    lines.push(
      `  ${r.significant ? 'SIGNIFICANT' : 'not sig.   '}  ${diff.padStart(7)} points   t=${t} (${r.pairedDf} df)`,
      `      ${r.armSpec}`,
      `      vs ${r.controlSpec}   [${r.decks}]   ${r.shardCount} x ${r.gamesPerShard} games   seed ${r.baseSeed}`,
      `      arm ${pct(r.armGames === 0 ? 0 : r.armWins / r.armGames)} of ${r.armGames}   ` +
        `control ${pct(r.controlGames === 0 ? 0 : r.controlWins / r.controlGames)} of ${r.controlGames}` +
        `   build ${r.buildTag}   ${r.startedAt}`,
      '',
    )
  }
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
    `dmgCtrl AI matchups  (engine ${report.commitId})`,
    row(`overall (${report.aiA})`, `${pct(report.overallWinRateA)}  ± ${pct(report.overallCi)}   (${report.totalGames} games)`),
    row('turn order', turnOrderLine(report.split)),
    row('dropped', `${report.dropped}`),
    row('wall clock', `${((Date.now() - start) / 1000).toFixed(0)}s`),
    '',
    `  worst matchups for ${report.aiA} (its deck vs theirs):`,
    ...report.cells.slice(0, 8).map(c => `    ${pct(c.winRateA).padStart(6)}   ${c.aLabel}  vs  ${c.bLabel}`),
    '',
    `  best matchups for ${report.aiA}:`,
    ...report.cells.slice(-8).reverse().map(c => `    ${pct(c.winRateA).padStart(6)}   ${c.aLabel}  vs  ${c.bLabel}`),
    '',
    // Each row is one deck against all of them, so at the default four games a cell it is 72 games
    // and each half is 36. Wide enough that the band is the point of printing it.
    `  ${report.aiA}'s decks, most dependent on moving first:`,
    ...report.byDeck.slice(0, 5).map(d =>
      `    ${points(d.split.gap).padStart(6)} ± ${band(d.split.gapCi).padStart(4)} pts   ` +
      `${pct(d.split.onPlay.rate).padStart(6)} / ${pct(d.split.onDraw.rate).padStart(6)}   ${d.label}`),
    '',
  ]
  console.log(lines.join('\n'))
  if (report.dropped > 0) process.exit(1)
}

/**
 * A strength ranking, with each row's rate split by who moved first.
 *
 * The gap's band is deliberately not in this table: a row's `± n pts` beside its gap would triple the
 * width, and the gaps worth reading are in the turn-order section below with their bands attached.
 */
function strengthTable(title: string, rows: StrengthRow[], limit?: number): string[] {
  const shown = limit ? rows.slice(0, limit) : rows
  const lines = [
    `  ${title}:`,
    `    ${'rate'.padStart(6)}   ${'margin'.padStart(6)}   ${'play'.padStart(6)}   ${'draw'.padStart(6)}   ${'gap'.padStart(6)}`,
  ]
  for (const r of shown) {
    const margin = `${r.avgMargin >= 0 ? '+' : ''}${r.avgMargin.toFixed(1)}`
    lines.push(
      `    ${pct(r.winRate).padStart(6)}   ${margin.padStart(6)}   ${pctOrDash(r.onPlay).padStart(6)}   ` +
      `${pctOrDash(r.onDraw).padStart(6)}   ${points(r.gap).padStart(6)}   ${r.key}`,
    )
  }
  return lines
}

/** The median of a set of half-widths: what a typical row in the table above carries. */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const sorted = xs.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The turn-order readout: one tight number and one wide ranking, said as such.
 *
 * Every game in the run contributes exactly one first-mover observation, so "the first mover wins X%"
 * is the tightest number the matrix produces. A single deck's gap is measured over its own row only,
 * which is a fraction of that, so the per-deck ordering is a queue of candidates to re-measure rather
 * than a ranking. The band on each is what keeps the two apart, and it is quoted rather than described.
 */
function turnOrderSection(db: ReturnType<typeof openDb>, runId: string, limit = 8): string[] {
  const pooled = firstPlayerAdvantage(db, runId)
  if (pooled.games === 0) return ['  turn order: not recorded for this run']
  const measured = deckStrength(db, runId).filter(r => r.gap !== null)
  const byGap = measured.slice().sort((a, b) => b.gap! - a.gap!)
  const typical = median(measured.map(r => r.gapCi!))
  const line = (r: StrengthRow): string =>
    `      ${points(r.gap).padStart(6)} ± ${band(r.gapCi).padStart(4)} pts   ` +
    `${pctOrDash(r.onPlay).padStart(6)} / ${pctOrDash(r.onDraw).padStart(6)}   ${r.key}`
  return [
    '  turn order:',
    `    the first mover wins   ${pct(pooled.rate)} ± ${pct(pooled.halfWidth)}   (${pooled.games.toLocaleString()} games, one observation each)`,
    typical === null
      ? '    no deck has both halves, so no gap is measurable'
      : `    a deck's gap is measured over its own row only, and carries ± ${band(typical)} pts here:` +
        ' read the order as candidates, not as a ranking',
    '',
    '    most dependent on moving first:',
    ...byGap.slice(0, limit).map(line),
    '',
    '    least dependent:',
    ...byGap.slice(-limit).reverse().map(line),
  ]
}

/**
 * The matrix across N child processes, which is what makes it affordable at all: roughly 169 hours
 * serial against about 23 sharded.
 *
 * Each child deals itself every Nth pair from `--shard-index` and `--shard-count`, so the parent never
 * has to hand over 2,628 pairs on a command line, and each child stays independently re-runnable. Per
 * pair seeds mean the merged result is identical to a serial run, cell for cell.
 */
async function runShardedMatrixMode(args: Args): Promise<void> {
  const model = args.aiExplicit ? args.aiA : 'greedy'
  const gamesPerCell = args.gamesSet ? args.games : 10
  const shards = args.shards ?? 1
  const decks = buildMatchupDecks()
  const total = dealPairs(decks.length).length
  const dir = join(SHARD_DIR, `matrix__${model.replace(/[^A-Za-z0-9._-]/g, '_')}__g${gamesPerCell}__s${args.seed}`)
  mkdirSync(dir, { recursive: true })

  console.log(
    `\nmatchup matrix: ${model}, ${decks.length} decks, ${gamesPerCell} games/cell, seed ${args.seed}` +
    `\n  ${shards} shards over ${total.toLocaleString()} pairs ` +
    `= ${(total * gamesPerCell).toLocaleString()} games\n  ${dir}/\n`,
  )

  const start = Date.now()
  const jobs = Array.from({ length: shards }, (_, k) => ({
    id: `matrix-${k}`,
    args: [
      'src/bench/main.ts', '--matrix', '--games', String(gamesPerCell), '--seed', String(args.seed),
      '--shard-index', String(k), '--shard-count', String(shards),
      '--out', shardPayloadPath(dir, `matrix-${k}`),
      ...(args.aiExplicit ? [model] : []),
    ],
  }))
  const outcomes = await spawnShards(dir, jobs)

  const failed = outcomes.filter(o => o.exitCode !== 0 || o.payload === null)
  if (failed.length > 0) {
    // Never save a partial matrix: it would be indistinguishable from a whole one with quiet gaps,
    // and every row and leader average read off it would be wrong without saying so.
    console.error(`\n  ${failed.length} of ${shards} shards failed (${failed.map(f => f.id).join(', ')}).`)
    console.error('  Nothing saved. Re-run the identical command to retry.\n')
    process.exit(1)
  }

  const parts = outcomes.map(o => o.payload as MatrixResult)
  const merged: MatrixResult = {
    ...parts[0],
    deckCount: decks.length,
    dropped: parts.reduce((n, p) => n + p.dropped, 0),
    cells: parts.flatMap(p => p.cells),
  }
  const db = openDb(DEFAULT_DB_PATH)
  const runId = saveMatrix(db, merged)
  console.log(matrixReport(merged, model, decks.length * decks.length, runId, ((Date.now() - start) / 1000).toFixed(0), db))
  db.close()
}

function runMatrixMode(args: Args): void {
  const model = args.aiExplicit ? args.aiA : 'greedy'
  const gamesPerCell = args.gamesSet ? args.games : 10
  const decks = buildMatchupDecks()
  const cells = decks.length * decks.length
  const shardIndex = args.shardIndex ?? 0
  const shardCount = args.shardCount ?? 1
  const share = shardCount > 1 ? `  [shard ${shardIndex + 1} of ${shardCount}]` : ''
  const pairs = dealPairs(decks.length, shardIndex, shardCount).length
  console.log(`\nmatchup matrix: ${model}, ${decks.length} decks (${cells} cells), ${gamesPerCell} games/cell, seed ${args.seed}${share}`)
  console.log(`about ${(pairs * gamesPerCell).toLocaleString()} games to play; this takes a while...\n`)

  const start = Date.now()
  const result = runMatchupMatrix(decks, resolveAi(model), model, { gamesPerCell, seed: args.seed, shardIndex, shardCount })

  // A child writes its cells for the parent and saves nothing: one merged run belongs in the database,
  // not N partial ones that would each look like a whole matrix with most of its cells missing.
  if (args.out !== undefined) {
    mkdirSync(dirname(args.out), { recursive: true })
    writeFileSync(args.out, JSON.stringify(result, null, 2))
    console.log(row('wrote', `${result.cells.length} cells  ->  ${args.out}`))
    return
  }

  const db = openDb(DEFAULT_DB_PATH)
  const runId = saveMatrix(db, result)
  console.log(matrixReport(result, model, cells, runId, ((Date.now() - start) / 1000).toFixed(0), db))
  if (result.dropped > 0) process.exit(1)
}

/** The matrix readout, shared by the serial and sharded paths so they cannot drift apart. */
function matrixReport(
  result: MatrixResult,
  model: string,
  cells: number,
  runId: string,
  wall: string,
  db: ReturnType<typeof openDb>,
): string {
  return [
    '',
    `dmgCtrl matchup matrix  (engine ${result.commitId})`,
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
    ...turnOrderSection(db, runId),
    '',
    `  full matrix: sealed/${DEFAULT_DB_PATH}, table "matchups", run_id='${runId}'`,
    '',
  ].join('\n')
}

/**
 * `--triage LAW SEC`: classify a card pool by what the engine cannot yet express.
 *
 * Fetches live rather than from a fixture, because the point of the tool is sizing a set on the day
 * it releases. Network failure is fatal and says which set failed.
 */
async function runTriageMode(args: Args): Promise<void> {
  let pool
  try {
    pool = await fetchSets(args.sets)
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    process.exit(2)
    return
  }
  console.log('')
  console.log(formatTriage(triage(pool)).join('\n'))
  console.log('')
}

function main(): void {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    console.error('usage: npm run bench --prefix sealed -- [--games N] [--seed N]')
    console.error('       [--sweep|--generalise|--matrix|--decisions|--terms|--cost|--budget|--lethal|--matchups] [ai ...]')
    console.error('       npm run bench --prefix sealed -- --triage SET [SET ...]')
    process.exit(2)
    return
  }

  if (args.triage) { void runTriageMode(args); return }
  if (args.sweep) { runSweepMode(args); return }
  if (args.generalise) { runGeneraliseMode(args); return }
  // `--matrix --shard N` parallelises; `--matrix` alone still runs serially, and a child carries
  // `--shard-index` rather than `--shard`, so it can never recurse into spawning its own children.
  if (args.matrix && args.shards !== undefined) { void runShardedMatrixMode(args); return }
  if (args.matrix) { runMatrixMode(args); return }
  if (args.decisions) { runDecisionsMode(args); return }
  if (args.terms) { runTermsMode(args); return }
  if (args.cost) { runCostMode(args); return }
  if (args.budget) { runBudgetMode(args); return }
  if (args.lethal) { runLethalMode(args); return }
  if (args.matchups) { runMatchupsMode(args); return }
  // Read-only, and deliberately ahead of every mode: asking what is running must never start anything.
  if (args.status) { console.log(renderStatus(loadAllProgress(), Date.now())); return }
  if (args.history) { runHistoryMode(args); return }
  if (args.shards !== undefined) { void runShardMode(args); return }

  let report: BenchReport
  const start = Date.now()
  try {
    report = runBench({ games: args.games, seed: args.seed, aiA: args.aiA, aiB: args.aiB, decks: args.decks })
  } catch (err) {
    console.error(`bench: ${(err as Error).message}`)
    process.exit(2)
    return
  }
  console.log(format(report, Date.now() - start))

  // Written before the database save, so a shard whose save fails is still counted by its parent.
  // This is what replaced regexing the printed report: what a run measured no longer depends on how
  // that report is worded.
  if (args.out !== undefined) {
    mkdirSync(dirname(args.out), { recursive: true })
    writeFileSync(args.out, JSON.stringify(shardPayload(report, args.seed), null, 2))
  }

  const runId = saveReport(openDb(DEFAULT_DB_PATH), report)
  const written = writeFailures(runId, report.games)
  console.log(row('saved run', `${runId}  →  ${DEFAULT_DB_PATH}`))
  if (written.length > 0) console.log(row('reproductions', `${written.length} file(s) in ${FAILURES_DIR}/`))
  console.log('')

  if (report.provisional) process.exit(1)
}

// Guarded so the parsing helpers above can be imported by tests without running a benchmark.
// Same guard as `tune.ts`. The npm script and the shard children both invoke this file by path
// (`tsx src/bench/main.ts`), so both still satisfy it.
if (process.argv[1]?.endsWith('main.ts')) main()
