import { describe, it, expect } from 'vitest'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs, parseAssignments, expandAxes, weightsFrom, describeConfig, appendRow, appendTsv, specOf } from '../bench/tune'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import { DEFAULT_HAND_WEIGHTS } from '../ai/handValue'

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

  /** Defaults matter: they are what an unattended overnight sweep inherits. */
  it('defaults to the deployed model as the reference, so 50% means no change', () => {
    const args = parseArgs([])
    expect(args.vs).toBe('greedy')
    expect(args.games).toBe(20)
    expect(args.configs).toHaveLength(1)
    expect(describeConfig(args.configs[0])).toBe('(defaults)')
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
