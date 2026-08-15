import { describe, it, expect } from 'vitest'
import { runDecisions } from '../bench/decisions'
import { makeBeamAi, settleInitiativeTie, lastSearchTrace, clearSearchTrace, DEFAULT_BEAM_LIMITS } from '../ai/search'
import type { Action } from '../engine/actions'
import { evaluate } from '../ai/evaluate'
import { legalMoves } from '../engine/legalMoves'
import { state, player, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * The initiative tie metric, and the defect it replaces.
 *
 * "Tied" was implemented as `init.v === max(every candidate INCLUDING claiming)`, which is satisfied
 * whenever claiming WINS. So a decisive result was counted as a blind spot, and the finding that "the
 * initiative tie is the largest blind spot in the model" was built on it. Every other decision kind
 * uses the strict definition (the whole candidate set level), which is why only this one drifted.
 *
 * The arithmetic that exposed it needs no instrument at all: the bot claims 15.3% of offers, and every
 * claim requires claiming to be at the maximum, so a metric reading 18.0% cannot be mostly ties. A
 * two-way tie is taken half the time, so 18% of genuine ties would produce at most 9% of claims.
 */

describe('the initiative tie metric', () => {
  const report = runDecisions({ gamesPerDeck: 1, seed: 4242, aiName: 'beam:4x2', deckLimit: 3 })
  const t = report.initiativeTies

  it('partitions every claim decision exactly once', () => {
    expect(t.decisions).toBeGreaterThan(0)
    expect(t.uniquelyBest + t.tiedWithBest + t.beaten).toBe(t.decisions)
  })

  /**
   * The regression guard. Under the old definition these two were the same number, because winning
   * outright satisfied it. If they ever coincide again the metric has been folded back.
   */
  it('does not count winning outright as a tie', () => {
    expect(t.uniquelyBest, 'claiming must sometimes simply be the best move').toBeGreaterThan(0)
    const stat = report.stats.find(s => s.label === 'initiative: take it')!
    expect(stat.tiedSearch).toBeLessThan(t.uniquelyBest + t.tiedWithBest)
  })

  /**
   * The reported tie rate must not exceed what the claim rate allows. This is the arithmetic that
   * caught the original defect, kept as an assertion so it catches the next one.
   */
  it('reports a tie rate the claim rate can support', () => {
    const claims = report.initiative.taken
    // Every claim needs claiming at the lead, so wins plus a share of the ties must cover them.
    expect(t.uniquelyBest + t.tiedWithBest).toBeGreaterThanOrEqual(claims)
  })

  it('never reports more unresolved ties than ties', () => {
    expect(t.unresolved).toBeLessThanOrEqual(t.tiesOffered)
    expect(t.tiesOffered).toBeLessThanOrEqual(t.decisions)
  })

  /** One entry per tying candidate, so a tie against two alternatives contributes two. Never more
   *  entries than there were ties to attribute them to, times the candidates available. */
  it('attributes the ties it counts', () => {
    const total = t.tyingKinds.reduce((n, k) => n + k.count, 0)
    if (t.tiedWithBest > 0) expect(total).toBeGreaterThanOrEqual(t.tiedWithBest)
    else expect(total).toBe(0)
    expect(t.tyingKinds.every(k => k.kind !== 'takeInitiative'), 'claiming cannot tie with itself').toBe(true)
  })
})

/**
 * The tie policies, which exist to be measured rather than believed.
 *
 * Asserted on the primitive rather than through a played game: the policy only fires on candidates that
 * are already level, which is a condition a scripted position cannot reliably produce, and a test that
 * hunted for one would be testing the fixture.
 */
describe('settling a tied initiative', () => {
  const claim: Action = { type: 'takeInitiative' }
  const pass: Action = { type: 'pass' }
  const attack: Action = { type: 'attack', attackerId: 'a', target: { kind: 'base' } }

  it('leaves the decision alone when no policy is set', () => {
    expect(settleInitiativeTie([claim, pass], undefined)).toEqual([claim, pass])
  })

  it('takes it, and declines it', () => {
    expect(settleInitiativeTie([pass, claim, attack], 'take')).toEqual([claim])
    expect(settleInitiativeTie([pass, claim, attack], 'avoid')).toEqual([pass, attack])
  })

  /** Never touches a decision the search actually made: one candidate is a result, not a tie. */
  it('does nothing to an untied decision', () => {
    expect(settleInitiativeTie([claim], 'avoid')).toEqual([claim])
    expect(settleInitiativeTie([claim], 'take')).toEqual([claim])
  })

  it('does nothing when claiming was not among the candidates', () => {
    expect(settleInitiativeTie([pass, attack], 'take')).toEqual([pass, attack])
    expect(settleInitiativeTie([pass, attack], 'avoid')).toEqual([pass, attack])
  })

  /** "Never claim" must not become "never move". */
  it('still returns something when claiming is all there is', () => {
    expect(settleInitiativeTie([claim, claim], 'avoid')).toEqual([claim, claim])
  })
})

/**
 * `finalists` on the trace, which is what makes the coin-flip rate measurable at all.
 *
 * Without it the only visible number is the tie the second opinion is HANDED, and a tie-break that
 * separates nothing looks identical to one that separates everything.
 */
describe('the trace records what survived the tie-break', () => {
  const board = (): GameState => state({
    cards: CARDS,
    players: {
      player: player({ resources: ready(3), units: [unit('a', 'TST_U1'), unit('b', 'TST_U2')] }),
      opponent: player({ resources: ready(3), units: [unit('e', 'TST_U1')] }),
    },
  })

  const run = (limits = DEFAULT_BEAM_LIMITS): { tied: number; finalists: number } => {
    clearSearchTrace()
    makeBeamAi(evaluate, { ...limits, nodes: 200_000 })(board())
    const t = lastSearchTrace()!
    return { tied: t.tiedCandidates, finalists: t.finalists }
  }

  it('reports both counts, and finalists never exceeds the tie', () => {
    const r = run()
    expect(r.tied).toBeGreaterThan(0)
    expect(r.finalists).toBeGreaterThan(0)
    expect(r.finalists).toBeLessThanOrEqual(r.tied)
  })

  /** With no second opinion configured there is nothing to survive, so the two must agree exactly.
   *  That is what makes a gap, when a tie-break IS configured, mean something. */
  it('agrees with the tie when no second opinion is configured', () => {
    const r = run({ ...DEFAULT_BEAM_LIMITS, tieBreak: undefined })
    expect(r.finalists).toBe(r.tied)
  })

  it('still reports a legal move when everything is decided by the seeded pick', () => {
    const s = board()
    clearSearchTrace()
    const move = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 200_000 })(s)
    expect(legalMoves(s)).toContainEqual(move)
  })
})
