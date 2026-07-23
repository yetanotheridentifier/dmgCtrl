import { DEFAULT_WEIGHTS, makeEvaluate } from '../ai/evaluate'
import { makeGreedyAi, greedyBaselineAi } from '../ai/greedyAi'
import { runGeneralisationWith } from './generalisation'

/**
 * Weight tuner (#392): measure candidate evaluation weights against the frozen `greedy-baseline`
 * across the coverage decks, so a weight sweep can pick the best without hand-editing and re-running.
 *
 * Usage: `npm run tune --prefix sealed -- [--games N] [--seed N] unit,power,hp,base [unit,power,hp,base ...]`
 * Each config overrides those four board-term weights on the default set; the rest are held fixed.
 * Prints one line per config: the weights, win rate vs baseline (higher = better), and wall clock.
 */

interface Config {
  unit: number
  power: number
  hp: number
  base: number
}

function parse(argv: string[]): { games: number; seed: number; configs: Config[] } {
  let games = 100
  let seed = 42
  const configs: Config[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--games') games = Number(argv[++i])
    else if (arg === '--seed') seed = Number(argv[++i])
    else {
      const [unit, power, hp, base] = arg.split(',').map(Number)
      if ([unit, power, hp, base].some(n => !Number.isFinite(n))) throw new Error(`bad config "${arg}", expected unit,power,hp,base`)
      configs.push({ unit, power, hp, base })
    }
  }
  if (configs.length === 0) throw new Error('no weight configs given (e.g. 6,2,1,3)')
  return { games, seed, configs }
}

function main(): void {
  let parsed
  try {
    parsed = parse(process.argv.slice(2))
  } catch (err) {
    console.error(`tune: ${(err as Error).message}`)
    process.exit(2)
    return
  }
  const { games, seed, configs } = parsed
  console.log(`\ntuning ${configs.length} config(s) vs greedy-baseline, ${games} games/deck, seed ${seed}\n`)
  console.log('  unit power hp base    win% vs baseline   time')
  for (const c of configs) {
    const weights = { ...DEFAULT_WEIGHTS, unit: c.unit, power: c.power, hp: c.hp, base: c.base }
    const candidate = makeGreedyAi(makeEvaluate(weights))
    const start = Date.now()
    const report = runGeneralisationWith(candidate, greedyBaselineAi, 'candidate', 'baseline', { gamesPerDeck: games, seed })
    const secs = ((Date.now() - start) / 1000).toFixed(0)
    const win = (report.overallWinRateA * 100).toFixed(1)
    const ci = (report.overallCi * 100).toFixed(1)
    const drop = report.dropped > 0 ? `  (${report.dropped} dropped)` : ''
    console.log(`  ${String(c.unit).padStart(4)} ${String(c.power).padStart(5)} ${String(c.hp).padStart(2)} ${String(c.base).padStart(4)}    ${win.padStart(5)}% ± ${ci}%      ${secs}s${drop}`)
  }
  console.log('')
}

main()
