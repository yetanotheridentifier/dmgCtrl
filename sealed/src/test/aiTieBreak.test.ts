import { describe, it, expect } from 'vitest'
import { makeBeamAi, lastSearchTrace, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { evaluate, makeEvaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { legalMoves } from '../engine/legalMoves'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Second opinion on a tie (#499, #396, #398).
 *
 * A tie is a decision the search cannot see: every candidate scores the same and the seeded tie-break
 * picks one at random. Measured over 420 games with the shipped bot, that is **11.3%** of choice
 * answers, 5.4% of resourcing and 11.8% of card plays.
 *
 * The shielded-Sentinel lockout showed why no evaluation term can help. Both candidates peak on the
 * **same end state at the same depth**, differing only in the route, and a max over reachable boards
 * discards the route. A term keyed on the end state cancels; a discount on later boards cancels.
 *
 * What does separate them is **a different search**. Under `reply: 'null'` the acting line scores 56.1
 * against passing's 52, while under `pessimistic` they tie at 43. So: when the worst case cannot tell
 * two moves apart, ask a model that can, and prefer the better upside.
 *
 * Deliberately pluggable rather than hardwired. `planned-work.md` proposed breaking ties with the
 * **one-ply** score for #396 and #398, and one ply gets the lockout wrong (it prefers passing, 52 to
 * 43), so the right model is a per-case question that has to be measurable.
 */

const cards = {
  ...CARDS,
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 5, keywords: [{ name: 'Sentinel' }] }),
  CHUMP: card({ id: 'CHUMP', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 5, power: 5, hp: 6 }),
  GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground', cost: 2, power: 3, hp: 4 }),
}

/** The reported defect: pessimistic ties the strip against the pass, null separates them. */
const lockout = (): GameState => state({
  cards,
  players: {
    player: player({ units: [unit('chump', 'CHUMP'), unit('big', 'BIG')] }),
    opponent: player({
      base: { cardId: 'TST_B', damage: 12 },
      units: [unit('wall', 'WALL', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })],
    }),
  },
})

/** An ordinary position, for checking the tie-break stays out of the way. */
const ordinary = (): GameState => state({
  cards,
  players: {
    player: player({ hand: ['GRUNT'], resources: ready(4), units: [unit('u1', 'GRUNT')] }),
    opponent: player({ units: [unit('e1', 'GRUNT')] }),
  },
})

const shipped = { ...DEFAULT_BEAM_LIMITS, reply: 'pessimistic' as const, nodes: 200_000 }

describe('breaking a tie with a second opinion', () => {
  it('changes nothing when no tie-break is configured', () => {
    const plain = makeBeamAi(evaluate, shipped)
    for (const s of [lockout(), ordinary()]) {
      expect(plain(s)).toEqual(makeBeamAi(evaluate, shipped)(s))
    }
  })

  /**
   * **A tie-break alone cannot escape the lockout, because it is not a tie.**
   *
   * Under shipped weights passing wins outright, 52 to 43. A second opinion is only ever consulted
   * between candidates that already tied for the lead, so it never runs here. This is the assumption
   * I got wrong: the tie in this position only appears once `blockedReach` is priced.
   */
  it('does not fire on the lockout, because passing wins outright', () => {
    const ai = makeBeamAi(evaluate, { ...shipped, tieBreak: { reply: 'null' } })
    ai(lockout())
    expect(lastSearchTrace()!.tiedCandidates).toBe(1)
  })

  /**
   * **Together they work, and neither does alone.** `blockedReach` pulls passing down from 52 to a
   * dead tie at 43; the second opinion then separates the tie the way the optimistic model already
   * could. That is the fix, and it is why five single-lever attempts all failed.
   */
  it('escapes the lockout once blocked reach has made it a tie', () => {
    const weights = makeEvaluate({ ...DEFAULT_WEIGHTS, blockedReach: 12 })
    const ai = makeBeamAi(weights, { ...shipped, tieBreak: { reply: 'null' } })
    ai(lockout())
    expect(lastSearchTrace()!.tiedCandidates, 'the term must create the tie').toBeGreaterThan(1)
    expect(ai(lockout())).toMatchObject({ type: 'attack', attackerId: 'chump' })
  })

  /**
   * **Only tied candidates are re-searched.** A second opinion that could overrule a clear winner
   * would be a different bot, not a tie-break, and would need its own A/B rather than this one.
   */
  it('never overrules a candidate that already won outright', () => {
    const s = ordinary()
    const plain = makeBeamAi(evaluate, shipped)
    const chosen = plain(s)
    const values = lastSearchTrace()!.candidates
    const winners = values.filter(v => v === Math.max(...values)).length

    if (winners === 1) {
      const broken = makeBeamAi(evaluate, { ...shipped, tieBreak: { reply: 'null' } })
      expect(broken(s)).toEqual(chosen)
    }
  })

  it('stays deterministic', () => {
    const ai = makeBeamAi(evaluate, { ...shipped, tieBreak: { reply: 'null' } })
    const s = lockout()
    expect(ai(s)).toEqual(ai(s))
  })

  /** Any limits override, not just a reply policy, so #396 and #398 can try one ply or more depth. */
  it('accepts any search override as the second opinion', () => {
    for (const tieBreak of [{ reply: 'null' as const }, { depth: 1 }, { depth: 5 }]) {
      expect(() => makeBeamAi(evaluate, { ...shipped, tieBreak })(lockout())).not.toThrow()
    }
  })

  /** If the second opinion also ties, the seeded pick still decides, so nothing becomes unstable. */
  it('falls back to the seeded pick when the second opinion ties too', () => {
    // A tie-break identical to the main search can never separate anything.
    const ai = makeBeamAi(evaluate, { ...shipped, tieBreak: { reply: 'pessimistic' } })
    const plain = makeBeamAi(evaluate, shipped)
    const s = ordinary()
    expect(ai(s)).toEqual(plain(s))
  })

  /**
   * The trace must say how often this fires, because that rate is the whole cost/benefit case: a
   * second opinion on 5% of decisions is cheap, on 60% it is a second bot.
   */
  it('reports how many candidates tied', () => {
    const ai = makeBeamAi(makeEvaluate({ ...DEFAULT_WEIGHTS, blockedReach: 12 }), {
      ...shipped, tieBreak: { reply: 'null' },
    })
    ai(lockout())
    const trace = lastSearchTrace()!
    expect(trace.tiedCandidates).toBeGreaterThan(1)
    expect(trace.tiedCandidates).toBeLessThanOrEqual(legalMoves(lockout()).length)
  })
})
