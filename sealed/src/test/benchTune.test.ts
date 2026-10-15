import { describe, it, expect } from 'vitest'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs, parseAssignments, expandAxes, weightsFrom, describeConfig, appendRow, appendTsv, specOf, buildCandidate } from '../bench/tune'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import { DEFAULT_HAND_WEIGHTS } from '../ai/handValue'
import { resolveAi } from '../ai/registry'
import { makeTunedGreedy } from '../ai/greedyAi'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { buildCardDb } from '../engine/cardDb'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { initGame } from '../engine/initGame'
import { seededShuffle, nextSeed } from '../engine/rng'
import { setupAi } from '../ai/setupAi'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * The tuner decides which weights ship, so a silent misparse is worse than a crash: it would spend
 * hours measuring a config nobody asked for and report the answer with a confidence interval on it.
 */
describe('tune argument parsing', () => {
  it('overrides only the named weights, leaving the rest at their shipped values', () => {
    const w = weightsFrom({ unit: 6, power: 3 })
    expect(w.unit).toBe(6)
    expect(w.power).toBe(3)
    expect(w.base).toBe(DEFAULT_WEIGHTS.base)
    expect(w.saturation).toBe(DEFAULT_WEIGHTS.saturation)
  })

  it('reaches into the nested hand weights', () => {
    const w = weightsFrom({ 'hand.canAct': 5 })
    expect(w.hand.canAct).toBe(5)
    expect(w.hand.hold).toBe(DEFAULT_HAND_WEIGHTS.hold)
    // The shipped set must not be mutated by building a candidate from it.
    expect(DEFAULT_HAND_WEIGHTS.canAct).not.toBe(5)
  })

  /** A typo silently ignored would mean sweeping an axis that never moved. */
  it('rejects an unknown weight rather than ignoring it', () => {
    expect(() => parseAssignments('untit=6')).toThrow(/unknown weight/)
    expect(() => parseAssignments('unit=x')).toThrow(/numeric/)
  })

  /**
   * Every shipped weight must be tunable. The key list was hardcoded once, and adding a weight to
   * the evaluation without adding it here meant an overnight sweep rejected every job and measured
   * nothing at all.
   */
  it('can sweep every weight the model actually ships', () => {
    for (const key of Object.keys(DEFAULT_WEIGHTS)) {
      if (key === 'hand') continue
      expect(() => parseAssignments(`${key}=1`), key).not.toThrow()
    }
    for (const key of Object.keys(DEFAULT_HAND_WEIGHTS)) {
      expect(() => parseAssignments(`hand.${key}=1`), key).not.toThrow()
    }
  })

  /**
   * The cross product is the whole point of the tool: two weights swept separately can each look
   * flat while their combination is not.
   */
  it('takes the cross product of repeated axes, first axis varying slowest', () => {
    const configs = expandAxes([
      { key: 'unit', values: [3, 4] },
      { key: 'power', values: [1, 2, 3] },
    ], {})
    expect(configs).toHaveLength(6)
    expect(configs.map(describeConfig)).toEqual([
      'unit=3 power=1', 'unit=3 power=2', 'unit=3 power=3',
      'unit=4 power=1', 'unit=4 power=2', 'unit=4 power=3',
    ])
  })

  it('applies a pinned weight to every config in the run', () => {
    const args = parseArgs(['--set', 'roleShift=0', '--axis', 'unit=3,4'])
    expect(args.configs.map(describeConfig)).toEqual(['roleShift=0 unit=3', 'roleShift=0 unit=4'])
  })

  /**
   * Defaults matter: they are what an unattended overnight sweep inherits.
   *
   * **The reference must be the bot that actually ships.** This defaulted to `greedy` and was
   * documented as "the deployed model", which stopped being true the day the beam shipped: a sweep
   * would have tuned weights for a one-ply evaluator against a one-ply reference and reported the
   * answer with a confidence interval on it.
   */
  it('defaults to the deployed model as the reference, so 50% means no change', () => {
    const args = parseArgs([])
    expect(args.vs).toBe('beam-reply')
    expect(args.model).toBe('beam-reply')
    expect(args.games).toBe(20)
    expect(args.configs).toHaveLength(1)
    expect(describeConfig(args.configs[0])).toBe('(defaults)')
  })

  /** Tuning a different model stays possible, and naming a nonsense one fails loudly rather than
   *  quietly falling back to something cheap. */
  it('can tune a named model other than the default', () => {
    expect(parseArgs(['--model', 'greedy']).model).toBe('greedy')
    expect(() => parseArgs(['--model', 'nonsense-ai'])).toThrow()
  })

  /**
   * Each row costs minutes of compute, so the write must not be able to destroy one. The first
   * version threw ENOENT on a missing directory AFTER a completed 840-game run, and took every
   * stream of an overnight sweep down with it one config in.
   */
  it('creates the results directory rather than losing a finished measurement', () => {
    const dir = join(tmpdir(), `tune-test-${process.pid}`, 'nested')
    const file = join(dir, 'out.jsonl')
    try {
      appendRow(file, { label: 'unit=6', winRate: 0.51 })
      appendRow(file, { label: 'unit=7', winRate: 0.49 })
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      expect(lines).toHaveLength(2) // appends rather than overwriting
      expect(JSON.parse(lines[0]).label).toBe('unit=6')
    } finally {
      rmSync(join(tmpdir(), `tune-test-${process.pid}`), { recursive: true, force: true })
    }
  })

  /**
   * The unattended sweep ranks this file and feeds column 3 straight back in as a config, so the
   * spec must be re-runnable rather than pretty. A display label with spaces in it would be parsed
   * as several arguments and silently measure the wrong thing.
   */
  it('writes a sortable TSV whose spec can be fed back in as a config', () => {
    const dir = join(tmpdir(), `tune-tsv-${process.pid}`)
    const file = join(dir, 'r.jsonl')
    try {
      appendTsv(file, 0.5312, 0.0198, 'unit=5,hp=1.5')
      const line = readFileSync(join(dir, 'r.tsv'), 'utf8').trim()
      const [win, ci, spec] = line.split('\t')
      expect(Number(win)).toBeCloseTo(0.5312)
      expect(Number(ci)).toBeCloseTo(0.0198)
      expect(spec).toBe('unit=5,hp=1.5')
      expect(spec).not.toMatch(/\s/) // a space would split into two argv entries
      expect(describeConfig({ overrides: parseAssignments(spec) })).toBe('unit=5 hp=1.5')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders a config as a comma-joined spec, and the shipped weights as "defaults"', () => {
    expect(specOf({ overrides: { unit: 5, hp: 1.5 } })).toBe('unit=5,hp=1.5')
    expect(specOf({ overrides: {} })).toBe('defaults')
  })

  /** The sweep ranks its own output and re-runs the winners, so every spec it emits must parse. */
  it('round-trips every spec it emits, "defaults" included', () => {
    for (const overrides of [{ unit: 5, hp: 1.5 }, { 'hand.hold': 0.25 }, {}]) {
      expect(parseAssignments(specOf({ overrides }))).toEqual(overrides)
    }
    expect(parseArgs(['defaults']).configs).toHaveLength(1)
  })

  /**
   * Three of eight validation slots once went on the same AI spelled three ways, because dedupe
   * compared spec strings while `unit=4` and `power=2` are simply the shipped values.
   */
  it('gives one spec to configs that describe the same AI', () => {
    const asShipped = { unit: DEFAULT_WEIGHTS.unit, power: DEFAULT_WEIGHTS.power }
    expect(specOf({ overrides: { ...asShipped, hp: 1.5 } })).toBe('hp=1.5')
    expect(specOf({ overrides: { unit: DEFAULT_WEIGHTS.unit, hp: 1.5 } })).toBe('hp=1.5')
    expect(specOf({ overrides: { hp: 1.5 } })).toBe('hp=1.5')
    expect(specOf({ overrides: asShipped })).toBe('defaults')
    // The nested hand weights collapse the same way.
    expect(specOf({ overrides: { 'hand.canAct': DEFAULT_HAND_WEIGHTS.canAct, hp: 1.5 } })).toBe('hp=1.5')
  })

  it('reports an unwritable path without aborting the sweep', () => {
    // A directory where a file should be: mkdir succeeds, the write cannot.
    expect(() => appendRow(tmpdir(), { label: 'x' })).not.toThrow()
    expect(existsSync(tmpdir())).toBe(true)
  })

  it('reads explicit configs, games, seed and reference', () => {
    const args = parseArgs(['--games', '50', '--seed', '7', '--vs', 'greedy-flat', 'unit=6,hp=2'])
    expect(args.games).toBe(50)
    expect(args.seed).toBe(7)
    expect(args.vs).toBe('greedy-flat')
    expect(args.configs.map(describeConfig)).toEqual(['unit=6 hp=2'])
  })
})

/**
 * **A candidate must be the shipped bot with one weight moved, not a one-ply scorer.**
 *
 * The tuner built every candidate with `makeTunedGreedy`, which is
 * `makeGreedyAi(makeQuiescent(makeEvaluate(w)))`: no beam, no opponent reply. So a sweep would have
 * sized weights for a bot we stopped shipping, which is the exact error #487 exists to correct, and
 * the file's own header asserted the opposite ("the same factory that builds the deployed bot").
 *
 * The evaluation is now the leaf of a depth-3 minimax rather than the thing that picks the move, and
 * the optimum for a leaf function is not the optimum for a bot that plays its own scores directly.
 */
describe('candidate construction', () => {
  /** Real positions, walked with the setup AI then greedy, so the states are ones the bot meets. */
  function corpus(limit: number): GameState[] {
    const { decks } = buildCoverageDecks(ashSet as unknown as SwuCard[], 7)
    const cardDb = buildCardDb(ashSet as unknown as SwuCard[])
    const out: GameState[] = []
    let seed = 7
    for (const deck of decks.slice(0, 2)) {
      if (out.length >= limit) break
      seed = nextSeed(seed)
      let s = seed
      let g = initGame(deck, deck, cardDb, {
        firstPlayer: 'player',
        shuffle: <T,>(a: T[]): T[] => { s = nextSeed(s); return seededShuffle(a, s) },
        rngSeed: seed,
      })
      while (g.winner === null && out.length < limit) {
        const action = setupAi(g) ?? resolveAi('greedy')(g)
        if (!action) break
        if (legalMoves(g).length > 1) out.push(g)
        g = resolve(g, action)
      }
    }
    return out
  }

  const positions = corpus(12)

  it('builds a no-override candidate that plays exactly like the model it names', () => {
    const candidate = buildCandidate('beam-reply', {})
    const shipped = resolveAi('beam-reply')
    expect(positions.length).toBeGreaterThan(8)
    for (const s of positions) expect(candidate(s)).toEqual(shipped(s))
  }, 120_000)

  /** And is demonstrably NOT the one-ply bot, or the fix would be invisible: the two must disagree
   *  somewhere, otherwise this test would pass against the old broken factory too. */
  it('differs from the one-ply factory the tuner used to build', () => {
    const candidate = buildCandidate('beam-reply', {})
    const onePly = makeTunedGreedy(DEFAULT_WEIGHTS)
    expect(positions.some(s => JSON.stringify(candidate(s)) !== JSON.stringify(onePly(s)))).toBe(true)
  }, 120_000)

  /**
   * The override has to reach the evaluation, or every cell of a sweep measures the same bot and
   * reports a flat result with a confidence interval on it.
   *
   * Deliberately a drastic override. A realistic one (`base: 40` against a shipped 4) changed no move
   * across these twelve early positions, which says the corpus is small and early rather than that
   * the override failed: these boards have few units and few base-damage trade-offs. Zeroing the whole
   * board term is coarse but unambiguous, and this test is asking "does the weight arrive", not "is
   * the bot sensitive to it" — that is what `--terms` measures.
   */
  it('applies the weight override to the candidate', () => {
    const base = buildCandidate('beam-reply', {})
    const bent = buildCandidate('beam-reply', { unit: 0, power: 0, hp: 0 })
    expect(positions.some(s => JSON.stringify(base(s)) !== JSON.stringify(bent(s)))).toBe(true)
  }, 120_000)
})
