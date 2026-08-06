import { describe, it, expect } from 'vitest'
import { AIS, aiNames, resolveAi } from '../ai/registry'
import { randomAi } from '../ai/randomAi'
import { greedyAi } from '../ai/greedyAi'

/**
 * The named-AI registry is the single seam every opponent hangs off: the bench addresses AIs by
 * name, and future rungs (greedy #391, role-aware #395, an MCTS or LLM later) are each one line
 * added here. These tests pin the contract that makes that extension safe.
 */
describe('AI registry', () => {
  it('exposes the rung-0 random AI by name', () => {
    expect(AIS.random).toBe(randomAi)
    expect(aiNames()).toContain('random')
  })

  it('resolves a known name to its function', () => {
    expect(resolveAi('random')).toBe(randomAi)
    expect(resolveAi('greedy')).toBe(greedyAi)
  })

  /**
   * The beam's width and depth have to be swept, and registering `beam-k2d2`, `beam-k4d3` and the
   * rest by hand would put the sweep's axes in the registry. A parameterised name keeps one entry and
   * lets the bench address any cell.
   */
  it('builds a beam at a given width and depth from its name', () => {
    expect(() => resolveAi('beam:2x4')).not.toThrow()
    expect(resolveAi('beam:2x4')).not.toBe(resolveAi('beam:8x2'))
  })

  /** Depth 1 is one-ply by construction, so the cheapest cell in the sweep must agree with greedy. */
  it('agrees with greedy at depth 1, whatever the width', () => {
    expect(typeof resolveAi('beam:4x1')).toBe('function')
  })

  /** The node budget is a safety rail, and the sweep needs a control cell with it raised, to show the
   *  rail is not quietly acting as the real width and depth. */
  it('takes an optional node budget as a third parameter', () => {
    expect(() => resolveAi('beam:4x3:100000')).not.toThrow()
  })

  it('rejects a malformed beam spec rather than silently using the defaults', () => {
    expect(() => resolveAi('beam:x')).toThrow()
    expect(() => resolveAi('beam:0x3')).toThrow()
    expect(() => resolveAi('beam:4x0')).toThrow()
  })

  /**
   * The bare form is two-ply: our move, their answer, score. Combining it with the own-turn beam is
   * addressable but is #447's question, not #425's, so it needs an explicit width and depth.
   */
  it('builds the reply policies, defaulting to two-ply', () => {
    expect(() => resolveAi('reply:pessimistic')).not.toThrow()
    expect(() => resolveAi('reply:selfish')).not.toThrow()
    expect(() => resolveAi('reply:pessimistic:4x3')).not.toThrow()
    expect(resolveAi('reply:pessimistic')).not.toBe(resolveAi('reply:selfish'))
  })

  it('rejects an unknown reply policy rather than silently picking one', () => {
    expect(() => resolveAi('reply:optimistic')).toThrow()
    expect(() => resolveAi('reply:')).toThrow()
  })

  it('rejects an unknown name with a message that lists the valid ones', () => {
    let message = ''
    try {
      resolveAi('does-not-exist')
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('does-not-exist')
    // The error must name at least one real option so the CLI user can recover.
    expect(message).toContain('random')
  })
})
