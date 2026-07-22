import { describe, it, expect } from 'vitest'
import { AIS, aiNames, resolveAi } from '../ai/registry'
import { randomAi } from '../ai/randomAi'

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
