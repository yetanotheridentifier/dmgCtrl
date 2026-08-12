import { runBench } from './runBench'
import type { BenchReport } from './runBench'
import { openDb, saveReport, DEFAULT_DB_PATH } from './store'
import { writeFailures, FAILURES_DIR } from './reports'
import { runSweep } from './sweep'
import type { SweepReport } from './sweep'
import { runDecisions, TIE_FANOUT_CAP } from './decisions'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import { runTerms } from './terms'
import type { TermReport } from './terms'
import { runCost } from './cost'
import { runBudget, type BudgetReport } from './budget'
import { join } from 'node:path'
import { runShards, poolShards, pendingSeeds, loadShardResults, shardRunKey, SHARD_DIR } from './shard'
import type { CostReport } from './cost'
import type { DeckSource } from './decks'
import { runLethal } from './lethal'
import type { LethalReport } from './lethal'
import { runAiMatchups } from './aiMatchups'
import type { DecisionReport } from './decisions'
import { runGeneralisation } from './generalisation'
import type { GeneralisationReport } from './generalisation'
import { buildMatchupDecks } from './matchupDecks'
import { runMatchupMatrix } from './matrix'
import { saveMatrix, deckStrength, leaderStrength, baseStrength, type StrengthRow } from './store'
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
  matchups: boolean
  /** Run the head-to-head as N parallel single-threaded processes over N seeds, and pool them. */
  shards?: number
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

function parseArgs(argv: string[]): Args {
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
  let matchups = false
  let shards: number | undefined
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
    else if (arg === '--matchups') matchups = true
    else if (arg === '--shard') shards = Number(argv[++i])
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
  if (depth !== undefined && (!Number.isFinite(depth) || depth < 1)) throw new Error('--depth must be a positive integer')
  if (triage && positional.length === 0) throw new Error('--triage needs at least one set code, e.g. --triage LAW SEC')
  if (shards !== undefined && (!Number.isFinite(shards) || shards < 1)) throw new Error('--shard must be a positive integer')
  return { games, gamesSet, seed, seeds, sweep, generalise, matrix, decisions, terms, cost, budget, lethal, depth, matchups, shards, triage, decks, sets: positional.map(s => s.toUpperCase()), aiExplicit: positional.length > 0, ais: positional, aiA: positional[0] ?? 'random', aiB: positional[1] ?? 'random' }
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
const row = (label: string, value: string): string => `  ${label.padEnd(22)}: ${value}`

function format(report: BenchReport, wallMs: number): string {
  const totalMoves = report.games.reduce((n, g) => n + g.moveCount, 0)
  const lo = Math.max(0, report.winRateA - report.winCi)
  const hi = Math.min(1, report.winRateA + report.winCi)
  const lines = [
    '',
    `dmgCtrl AI bench  (engine ${report.commitId})`,
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
    `dmgCtrl term sensitivity  (engine ${report.commitId})`,
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
    // The node budget scales with depth. A fixed rail would bind before the depth did and the sweep
    // would report a flat curve for the wrong reason, which is exactly what the #410 screen did.
    report = runLethal({
      gamesPerDeck,
      seed: args.seed,
      oracleSamples: 400,
      oracleStride: 5,
      solverDepth: args.depth,
      solverNodes: args.depth === undefined ? undefined : Math.max(4000, args.depth * 4000),
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
  lines.push(
    '',
    row(`pooled win rate (${args.aiA})`, `${pct(pooled.winRateA)}  ± ${pct(pooled.winCi)}   (${pct(lo)} – ${pct(hi)})`),
    row('games pooled', `${pooled.wins} wins of ${pooled.completed}`),
    row('shards failed', `${failed.length} of ${results.length}`),
    row('wall clock', `${((Date.now() - start) / 1000).toFixed(1)}s`),
    '',
  )
  console.log(lines.join('\n'))
  if (failed.length > 0) process.exit(1)
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
    `  full matrix: sealed/${DEFAULT_DB_PATH}, table "matchups", run_id='${runId}'`,
    '',
  ]
  console.log(lines.join('\n'))
  if (result.dropped > 0) process.exit(1)
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
  if (args.matrix) { runMatrixMode(args); return }
  if (args.decisions) { runDecisionsMode(args); return }
  if (args.terms) { runTermsMode(args); return }
  if (args.cost) { runCostMode(args); return }
  if (args.budget) { runBudgetMode(args); return }
  if (args.lethal) { runLethalMode(args); return }
  if (args.matchups) { runMatchupsMode(args); return }
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

  const runId = saveReport(openDb(DEFAULT_DB_PATH), report)
  const written = writeFailures(runId, report.games)
  console.log(row('saved run', `${runId}  →  ${DEFAULT_DB_PATH}`))
  if (written.length > 0) console.log(row('reproductions', `${written.length} file(s) in ${FAILURES_DIR}/`))
  console.log('')

  if (report.provisional) process.exit(1)
}

main()
