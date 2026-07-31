import { describe, it, expect } from 'vitest'
import { parseArgs, parseAssignments, expandAxes, weightsFrom, describeConfig } from '../bench/tune'
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

  it('reads explicit configs, games, seed and reference', () => {
    const args = parseArgs(['--games', '50', '--seed', '7', '--vs', 'greedy-flat', 'unit=6,hp=2'])
    expect(args.games).toBe(50)
    expect(args.seed).toBe(7)
    expect(args.vs).toBe('greedy-flat')
    expect(args.configs.map(describeConfig)).toEqual(['unit=6 hp=2'])
  })
})
