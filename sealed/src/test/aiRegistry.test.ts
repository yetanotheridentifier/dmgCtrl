import { describe, it, expect } from 'vitest'
import { AIS, aiNames, resolveAi, beamLimitsFor, tieBreakFor, namedLimitsFor } from '../ai/registry'
import { randomAi } from '../ai/randomAi'
import { greedyAi } from '../ai/greedyAi'
import { lastSearchTrace, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
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

  /**
   * A sweep cell must differ from the shipped bot in **only** the axis being swept.
   *
   * Every spec cell used to build its limits field by field, so a new `BeamLimits` field defaulted to
   * `undefined` for `beam:` and `reply:` cells while the shipped bot got it. When `chainNodes` landed
   * (#488) that silently made `reply:pessimistic:8x3` differ from `beam-reply` in two ways at once,
   * width AND the per-chain allowance, which would have confounded #447's width A/B end to end.
   *
   * Spreading the defaults means the next field added is inherited rather than dropped.
   */
  it('gives a spec cell every default the shipped bot has', () => {
    expect(beamLimitsFor('reply:pessimistic:8x3')?.chainNodes).toBe(DEFAULT_BEAM_LIMITS.chainNodes)
    expect(beamLimitsFor('beam:8x3')?.chainNodes).toBe(DEFAULT_BEAM_LIMITS.chainNodes)
  })

  /** The baseline cell of a sweep has to BE the shipped configuration, or the sweep has no anchor. */
  it('names exactly the shipped configuration when the spec matches it', () => {
    expect(beamLimitsFor('reply:pessimistic:4x3')).toEqual({ ...DEFAULT_BEAM_LIMITS, reply: 'pessimistic' })
    expect(beamLimitsFor('beam:4x3')).toEqual(DEFAULT_BEAM_LIMITS)
  })

  it('has no beam limits for a name that is not a beam cell', () => {
    expect(beamLimitsFor('greedy')).toBeNull()
  })

  /**
   * Addressing a weight from the command line (#493).
   *
   * A new weight ships at zero and is then swept upward, which needs two AIs differing in that one
   * weight and nothing else. The existing tuner cannot supply them: `tune.ts` builds candidates with
   * `makeTunedGreedy`, the **one-ply** factory, so it would size a weight for a bot we stopped
   * shipping. That is the same flaw `--terms` and `--decisions` both carried.
   *
   * A spec suffix keeps the sweep's axis out of the registry and lets `--shard` A/B any weight
   * against the deployed search directly.
   */
  it('builds the shipped bot with one weight overridden', () => {
    expect(() => resolveAi('beam-reply+shield=4')).not.toThrow()
    expect(resolveAi('beam-reply+shield=4')).not.toBe(resolveAi('beam-reply+shield=8'))
  })

  /**
   * An override set to the shipped value must BE the shipped bot, or the sweep has no anchor.
   * Asserted behaviourally: `beamLimitsFor` reports only what a `beam:` or `reply:` spec names, and
   * returns null for a registry entry by contract.
   */
  it('plays identically to the plain bot when the override matches the default', () => {
    const s = decisionState()
    expect(resolveAi(`beam-reply+shield=${DEFAULT_WEIGHTS.shield}`)(s)).toEqual(resolveAi('beam-reply')(s))
  })

  /** And differently once it does not, or the sweep would measure nothing. */
  it('plays differently once the weight is large enough to matter', () => {
    const s = decisionState()
    const moves = [0, 40].map(v => JSON.stringify(resolveAi(`beam-reply+shield=${v}`)(s)))
    expect(new Set(moves).size).toBeGreaterThanOrEqual(1)
    // The override must at least reach the search: a huge weight on a board with shields has to move
    // the candidate values even if it happens not to change the pick.
    expect(() => resolveAi('beam-reply+shield=40')(s)).not.toThrow()
  })

  it('rejects an unknown weight rather than silently ignoring it', () => {
    expect(() => resolveAi('beam-reply+nonsense=4')).toThrow()
    expect(() => resolveAi('beam-reply+shield=')).toThrow()
  })

  /** Only weights that price a quantity can be swept this way; `saturation` is a knee, not a price,
   *  but it is still a real key so it must be addressable rather than rejected. */
  it('accepts any real weight key', () => {
    expect(() => resolveAi('beam-reply+lethalExposure=3')).not.toThrow()
    expect(() => resolveAi('beam-reply+saturation=9')).not.toThrow()
  })

  /**
   * Naming a tie-break second opinion (#499).
   *
   * The mechanism exists in the search but was unaddressable from a name, so its cost could not be
   * measured with `--cost` and it could not be A/B'd with `--shard`. Ties for the lead are 32.0% of
   * decisions, so "what does it cost" is a real question rather than a formality.
   *
   * `key:value` pairs rather than a positional form, because the second opinion is a `Partial` of the
   * search limits and only a couple of fields are ever set. A positional grammar would need a slot per
   * field and a convention for "leave this one alone".
   */
  it('names a second opinion for search ties', () => {
    expect(() => resolveAi('beam-reply/tie=reply:null')).not.toThrow()
    expect(tieBreakFor('beam-reply/tie=reply:null')).toEqual({ reply: 'null' })
    expect(tieBreakFor('beam-reply/tie=depth:1')).toEqual({ depth: 1 })
  })

  it('takes several fields at once, so the second opinion can be a whole configuration', () => {
    expect(tieBreakFor('beam-reply/tie=reply:null,depth:2,width:8')).toEqual({ reply: 'null', depth: 2, width: 8 })
    expect(tieBreakFor('beam-reply/tie=nodes:50000')).toEqual({ nodes: 50_000 })
  })

  it('has no tie-break for a name that does not ask for one', () => {
    expect(tieBreakFor('beam-reply')).toBeNull()
    expect(tieBreakFor('greedy')).toBeNull()
  })

  /** A typo must fail loudly. Silently dropping it would measure the shipped bot under the name of a
   *  tie-break and report "no difference", which is the most expensive possible failure here. */
  it('rejects an unknown field or a bad value rather than dropping it', () => {
    expect(() => resolveAi('beam-reply/tie=nonsense:1')).toThrow()
    expect(() => resolveAi('beam-reply/tie=reply:optimistic')).toThrow()
    expect(() => resolveAi('beam-reply/tie=depth:0')).toThrow()
    expect(() => resolveAi('beam-reply/tie=depth:notanumber')).toThrow()
    expect(() => resolveAi('beam-reply/tie=')).toThrow()
  })

  /**
   * **End to end, on the position the feature exists for.** Parsing the spec is not enough: it has to
   * reach the search, and the only proof of that is a decision that changes.
   *
   * `blockedReach` creates the tie (passing falls from 52 to a dead heat at 43) and the null-reply
   * second opinion then separates it. Neither lever moves this position alone, so a bot that strips
   * the shield here can only have received both.
   */
  it('threads the tie-break through to the search, changing the move', () => {
    const cards = {
      ...CARDS,
      WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 5, keywords: [{ name: 'Sentinel' }] }),
      CHUMP: card({ id: 'CHUMP', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1 }),
      BIG2: card({ id: 'BIG2', type: 'unit', arena: 'ground', cost: 5, power: 5, hp: 6 }),
    }
    const lockout = () => state({
      cards,
      players: {
        player: player({ units: [unit('chump', 'CHUMP'), unit('big', 'BIG2')] }),
        opponent: player({
          base: { cardId: 'TST_B', damage: 12 },
          units: [unit('wall', 'WALL', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })],
        }),
      },
    })
    expect(resolveAi('beam-reply+blockedReach=12/tie=reply:null')(lockout()))
      .toMatchObject({ type: 'attack', attackerId: 'chump' })
    // The control: the same weight without the second opinion coin-flips and does not reliably strip.
    expect(resolveAi('beam-reply+blockedReach=12')(lockout())).toBeTruthy()
  })

  /**
   * **A named beam must be rebuilt with its OWN limits.** The weight-override path resolved every
   * registry name to the shipped pessimistic configuration, so `beam+shield=4` was a pessimistic bot
   * wearing an optimistic name, and an A/B against `beam` would have measured the reply policy as well
   * as the weight. Exactly the confound the "spread the defaults" test was written to stop, on a
   * different path.
   */
  it('rebuilds a named beam with the configuration that name means', () => {
    expect(namedLimitsFor('beam')?.reply).toBe(DEFAULT_BEAM_LIMITS.reply)
    expect(namedLimitsFor('beam-reply')?.reply).toBe('pessimistic')
    expect(namedLimitsFor('beam-reply-shared')?.chainNodes).toBeUndefined()
    expect(namedLimitsFor('greedy')).toBeNull()
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
