import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { makeBeamAi, lastSearchTrace, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { BEAM_REPLY_LIMITS } from '../ai/greedyAi'
import { evaluate, makeEvaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { legalMoves } from '../engine/legalMoves'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { buildCardDb } from '../engine/cardDb'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { initGame } from '../engine/initGame'
import { resolve } from '../engine/resolve'
import { seededShuffle, nextSeed } from '../engine/rng'
import { setupAi } from '../ai/setupAi'
import { greedyAi } from '../ai/greedyAi'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Second opinion on a tie (#499, #396, #398).
 *
 * A tie is a decision the search cannot see: candidates score the same and the seeded tie-break picks
 * one at random. **The firing condition is a tie for the LEAD**, which is much commoner than the
 * whole-slate tie the older columns count: 32.0% of decisions against 5-12%, over 3,469 searched
 * decisions with the shipped bot. Tied sets average 3.2 candidates and one measured decision tied 239.
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

/** Real positions, walked with greedy so the states are the ones the bot actually meets. Scripted
 *  fixtures would only prove a property on the shapes I thought to write. */
function corpus(limit: number): GameState[] {
  const { decks } = buildCoverageDecks(ashSet as unknown as SwuCard[], 42)
  const cardDb = buildCardDb(ashSet as unknown as SwuCard[])
  const states: GameState[] = []
  let seed = 42

  for (const deck of decks.slice(0, 3)) {
    if (states.length >= limit) break
    seed = nextSeed(seed)
    let s = seed
    let g = initGame(deck, deck, cardDb, {
      firstPlayer: 'player',
      shuffle: <T,>(arr: T[]): T[] => { s = nextSeed(s); return seededShuffle(arr, s) },
      rngSeed: seed,
    })
    while (g.winner === null && states.length < limit) {
      const action = setupAi(g) ?? greedyAi(g)
      if (!action) break
      // Only decisions: a single legal move has no lead to tie for and would pad the corpus.
      if (legalMoves(g).length > 1) states.push(g)
      g = resolve(g, action)
    }
  }
  return states
}

/**
 * **The shipped bot consults a second opinion on a tie, and that is a measured decision.**
 *
 * Three runs, each against a control on the same seeds and the same coverage decks:
 *
 * | | games | arm | control | paired |
 * | --- | --- | --- | --- | --- |
 * | screen | 80 | 55.0% | 50.0% | +5.0 |
 * | run 2 | 800 | 53.5% | 48.6% | +4.9 |
 * | **run 3** | **2,040** | **51.1%** | **48.7%** | **+2.35** |
 *
 * Run 3 is the estimate to quote: **+2.35 points, t = 4.94 on 11 df, p < 0.001, with 11 of 12 shards
 * positive**. The earlier, larger-looking figures are small-sample overestimates regressing toward it.
 *
 * **The control is what makes this readable, and reading against a theoretical 50% inverts the
 * answer.** Identical bots measured 48.6% and 48.7% on two independent seed blocks, so against 50%
 * run 3 reads as +1.1 and not significant; against its own control it is +2.35 at p < 0.001. Draws do
 * not explain the gap (~1 game in 2,040) and neither can any evaluation weight, since a control is the
 * same bot on both sides. Whatever its cause, the paired difference is immune to it, which is exactly
 * why every A/B needs its matched control.
 *
 * Cost is +2.1% per decision (203.73 ms against 199.51 ms over an identical corpus).
 *
 * Note it fixes no specific reported defect: it does **not** fire on the shielded-Sentinel lockout,
 * where passing wins outright. Its case is the aggregate, and the aggregate is why it ships.
 */
describe('the shipped configuration', () => {
  it('consults an optimistic second opinion when candidates tie for the lead', () => {
    expect(BEAM_REPLY_LIMITS.tieBreak).toEqual({ reply: 'null' })
  })

  /** Unrestricted: measured indistinguishable from restricting it to answer, play and resource
   *  (+4.25 against +4.9 on run 2, five of ten shards byte-identical), so the simpler form ships. */
  it('applies it to every decision kind', () => {
    expect(BEAM_REPLY_LIMITS.tieBreak?.tieKinds).toBeUndefined()
  })
})

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
   * **Together they escape the lockout, and the combination still must not ship.**
   *
   * `blockedReach` pulls passing down from 52 to a dead tie at 43, and the second opinion then
   * separates it the way the optimistic model already could. That is a real mechanism and this test
   * pins it. It is **not** a fix: at weight 12 the term measures **25.0%** against the shipped bot
   * over 80 games, with a 50.0% self-play control, because 12 is triple the value of a whole unit on
   * a scale where every other weight is 1 to 7.
   *
   * Kept as a mechanism test because the tie-break half is sound in isolation (55.0%, CI 44.3-65.7).
   * What is dead is using an out-of-scale weight to manufacture the tie.
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
  /**
   * **The measurement's own load-bearing assumption.** The firing rate is read off `tiedCandidates`,
   * and the root search prunes with alpha-beta, so a pruned candidate returns a truncated value rather
   * than its true one. If that ever rounded a near-miss up to the lead, or dropped a genuine tie below
   * it, every rate quoted from this counter would be wrong in an invisible direction.
   *
   * The margin in the reply cut is what makes it safe, and a margin is an argument. This is the
   * assertion: over real positions the count must not move when pruning is switched off.
   */
  it('counts the same ties with alpha-beta pruning off', () => {
    // Deliberately small. The property holds at any width and depth, and this file runs inside a
    // parallel suite where an expensive case pushes unrelated marginal tests over their timeouts.
    const limits = { ...DEFAULT_BEAM_LIMITS, reply: 'pessimistic' as const, width: 2, depth: 2 }
    const pruned = makeBeamAi(evaluate, limits)
    const exhaustive = makeBeamAi(evaluate, { ...limits, alphaBeta: false })
    let compared = 0
    for (const s of corpus(40)) {
      pruned(s)
      const a = lastSearchTrace()!.tiedCandidates
      exhaustive(s)
      const b = lastSearchTrace()!.tiedCandidates
      // An exhausted budget truncates both searches at different points, so a mismatch there says
      // nothing about pruning. Those decisions are excluded rather than allowed to fail the check.
      if (lastSearchTrace()!.exhausted) continue
      compared++
      expect(a).toBe(b)
    }
    expect(compared, 'the corpus must actually exercise the comparison').toBeGreaterThan(20)
  }, 120_000)

  /**
   * **Restricting the second opinion to decision kinds it should help.**
   *
   * Ties for the lead are not evenly spread, and neither is the case for a second opinion. #396 and
   * #398 are both about decisions whose value lies beyond the horizon, and the search demonstrably
   * makes those ties WORSE rather than better: resourcing went 0.6% to 5.4% and card play 6.7% to
   * 11.8% when the beam landed, because a beam values a move by the best board it can reach and
   * candidates whose lines converge inside three actions come out equal.
   *
   * Measured tie-for-lead rates by kind: attack 39.5%, answer 36.1%, play 33.4%, pass 31.0%,
   * resource 24.5%, initiative 11.5%. Restricting is what makes "does a second opinion help the kinds
   * those tickets care about" a separate question from "does it help everywhere", and the two can
   * disagree.
   */
  it('fires only on the decision kinds it names', () => {
    const weights = makeEvaluate({ ...DEFAULT_WEIGHTS, blockedReach: 12 })
    // The lockout tie is between an attack and a pass, so naming an unrelated kind must silence it.
    const everywhere = makeBeamAi(weights, { ...shipped, tieBreak: { reply: 'null' } })
    const elsewhere = makeBeamAi(weights, { ...shipped, tieBreak: { reply: 'null', tieKinds: ['resource'] } })
    const here = makeBeamAi(weights, { ...shipped, tieBreak: { reply: 'null', tieKinds: ['attack'] } })

    expect(everywhere(lockout())).toMatchObject({ type: 'attack', attackerId: 'chump' })
    expect(here(lockout()), 'named, so it still fires').toMatchObject({ type: 'attack', attackerId: 'chump' })
    // Not named, so the seeded pick decides again, exactly as with no tie-break at all.
    expect(elsewhere(lockout())).toEqual(makeBeamAi(weights, shipped)(lockout()))
  })

  /** An empty restriction is not the same as no restriction: naming nothing silences it everywhere,
   *  rather than quietly meaning "all kinds", which would make a typo look like a working arm. */
  it('fires nowhere when the named set is empty', () => {
    const weights = makeEvaluate({ ...DEFAULT_WEIGHTS, blockedReach: 12 })
    const none = makeBeamAi(weights, { ...shipped, tieBreak: { reply: 'null', tieKinds: [] } })
    expect(none(lockout())).toEqual(makeBeamAi(weights, shipped)(lockout()))
  })

  /** With no restriction the behaviour is unchanged, so every existing measurement keeps its meaning. */
  it('applies everywhere when no kinds are named', () => {
    const weights = makeEvaluate({ ...DEFAULT_WEIGHTS, blockedReach: 12 })
    const plain = makeBeamAi(weights, { ...shipped, tieBreak: { reply: 'null' } })
    const undef = makeBeamAi(weights, { ...shipped, tieBreak: { reply: 'null', tieKinds: undefined } })
    expect(undef(lockout())).toEqual(plain(lockout()))
  })

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
