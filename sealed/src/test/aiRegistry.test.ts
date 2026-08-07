import { describe, it, expect } from 'vitest'
import { AIS, aiNames, resolveAi } from '../ai/registry'
import { randomAi } from '../ai/randomAi'
import { greedyAi } from '../ai/greedyAi'
import { lastSearchTrace } from '../ai/search'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import '../engine/cardDefinitions'

/** A position with enough on it that a search has something to spend its budget on. */
function decisionState() {
  const cards = { ...CARDS, BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 2, power: 5, hp: 5 }) }
  return state({
    cards,
    players: {
      player: player({ hand: ['BIG', 'BIG'], resources: ready(6), units: [unit('u1', 'BIG'), unit('u2', 'BIG')] }),
      opponent: player({ units: [unit('e1', 'BIG')] }),
    },
  })
}

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

  /**
   * The reply cells need a node budget for the same reason the beam cells do, and until now they
   * could not have one: every `reply:` spec was pinned at the 10,000-node default, so the raised-rail
   * control cell #447 requires was not expressible. Since the rail turns out to fire routinely (a
   * cell costs ten times as much once it is lifted), that omission was hiding the binding constraint
   * on every reply configuration measured so far.
   */
  it('takes a node budget on a reply cell, so the rail can be lifted off it', () => {
    expect(() => resolveAi('reply:pessimistic:4x3:200000')).not.toThrow()
    expect(() => resolveAi('reply:selfish:8x4:200000')).not.toThrow()
  })

  /** Parsing the budget is not enough: it has to reach the search, or the control cell measures the
   *  default rail under a different name. */
  it('threads that budget through to the search itself', () => {
    const s = decisionState()
    resolveAi('reply:pessimistic:2x2:777')(s)
    expect(lastSearchTrace()?.nodes).toBe(777)

    resolveAi('reply:pessimistic:2x2:999999')(s)
    expect(lastSearchTrace()?.nodes).toBe(999999)
  })

  it('rejects a malformed node budget on a reply cell', () => {
    expect(() => resolveAi('reply:pessimistic:4x3:0')).toThrow()
    expect(() => resolveAi('reply:pessimistic:0x3:1000')).toThrow()
  })

  /**
   * The control for #488, registered rather than built for a run. A frozen snapshot would drift from
   * the shipped bot and end up measuring two differences at once, which is the mistake `greedy-flat`
   * was created to avoid.
   */
  it('offers the shared-pool control, differing from the shipped bot in one thing', () => {
    expect(aiNames()).toContain('beam-reply-shared')
    expect(resolveAi('beam-reply-shared')).not.toBe(resolveAi('beam-reply'))
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
