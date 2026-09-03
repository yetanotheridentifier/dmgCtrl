import { describe, it, expect } from 'vitest'
import { parseArgs, solverNodesFor } from '../bench/main'
import { DEFAULT_LETHAL_LIMITS } from '../ai/lethal'

/**
 * The lethal solver has two limits and only one of them could be addressed. `--depth` set the
 * depth; the node budget was fixed at `depth x 4000`, which is roughly 50x too small at depth 4:
 * at 4,000 and at 40,000 nodes a depth-4 search reports finding LESS lethal than a depth-2 one,
 * and only 200,000 makes it monotone. A budget that binds before the depth does turns
 * `--lethal --depth N` into a measurement of the rail wearing a depth's name.
 *
 * These are parse-level tests deliberately. A solver budget is only useful if a bad one fails
 * before the run starts rather than part way through a simulation, and the mapping from flags to
 * limits is the part that decides what was actually measured.
 *
 * They live in their own file rather than in `benchLethal.test.ts` because that file is in the
 * nightly `sealed-bench` project. A CLI contract should break on the push that breaks it.
 */
describe('bench argument parsing', () => {
  describe('the lethal solver node budget', () => {
    /**
     * The containment that makes this change safe to land: absent the flag, every number already
     * recorded has to stay reproducible. These are today's values, pinned so a later tidy of the
     * expression cannot move them silently.
     */
    it('keeps the depth-scaled default when the flag is absent', () => {
      expect(solverNodesFor(undefined, undefined)).toBeUndefined()
      expect(solverNodesFor(1, undefined)).toBe(4000)
      expect(solverNodesFor(2, undefined)).toBe(8000)
      expect(solverNodesFor(4, undefined)).toBe(16_000)
      expect(solverNodesFor(10, undefined)).toBe(40_000)
    })

    /**
     * `undefined` is not "no budget", it is "whatever the solver ships with", and `runLethal`
     * resolves it that way. Pinning the floor here says why the depth-scaled expression never
     * drops below 4,000: it is the shipped default, not an arbitrary minimum.
     */
    it('never scales below the shipped default', () => {
      expect(DEFAULT_LETHAL_LIMITS.nodes).toBe(4000)
      expect(solverNodesFor(0.5, undefined)).toBe(DEFAULT_LETHAL_LIMITS.nodes)
    })

    /** The whole point of the flag: an explicit budget wins outright, at any depth or none. */
    it('takes the flag over the depth-scaled default', () => {
      expect(solverNodesFor(4, 200_000)).toBe(200_000)
      expect(solverNodesFor(undefined, 200_000)).toBe(200_000)
      expect(solverNodesFor(6, 1000)).toBe(1000)
    })

    it('parses --solver-nodes onto the args', () => {
      expect(parseArgs(['--lethal', '--depth', '4', '--solver-nodes', '200000']).solverNodes).toBe(200_000)
      expect(parseArgs(['--lethal', '--solver-nodes', '200000']).solverNodes).toBe(200_000)
    })

    it('leaves the budget unset when the flag is absent', () => {
      expect(parseArgs(['--lethal', '--depth', '4']).solverNodes).toBeUndefined()
      expect(parseArgs(['--lethal']).solverNodes).toBeUndefined()
    })

    /**
     * A sizing run is long. A budget that is silently wrong is worse than one that refuses to
     * start, because the run still produces a plausible-looking table.
     */
    it.each([
      ['zero', '0'],
      ['negative', '-1'],
      ['fractional', '1.5'],
      ['not a number', 'lots'],
      ['missing', undefined],
    ])('rejects a %s budget at parse time', (_label, value) => {
      const argv = value === undefined ? ['--lethal', '--solver-nodes'] : ['--lethal', '--solver-nodes', value]
      expect(() => parseArgs(argv)).toThrow('--solver-nodes must be a positive integer')
    })

    /** The same rule, stated once: `--depth` and `--solver-nodes` reject the same shapes alike. */
    it.each(['0', '-1', '1.5', 'lots'])('rejects a bad --depth of %s the same way', value => {
      expect(() => parseArgs(['--lethal', '--depth', value])).toThrow('--depth must be a positive integer')
    })

    it('accepts the values a sizing pass actually needs', () => {
      expect(parseArgs(['--lethal', '--depth', '6', '--solver-nodes', '1000000']).depth).toBe(6)
      expect(parseArgs(['--lethal', '--depth', '6', '--solver-nodes', '1000000']).solverNodes).toBe(1_000_000)
    })
  })

  /**
   * `--solver-nodes` is a new flag on a parser that rejects unknown ones, so this guards the
   * boring failure: a typo'd flag name silently becoming a positional AI name, which would run
   * the shipped bot under a candidate's name and report no difference.
   */
  it('still rejects an unknown flag', () => {
    expect(() => parseArgs(['--solver-node', '200000'])).toThrow('Unknown flag: --solver-node')
  })
})
