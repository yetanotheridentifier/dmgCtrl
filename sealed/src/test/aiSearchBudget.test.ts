import { describe, it, expect } from 'vitest'
import {
  makeBeamAi, resolveChain, searchBudget, lastSearchTrace,
  DEFAULT_BEAM_LIMITS, DEFAULT_QUIESCENCE_LIMITS,
} from '../ai/search'
import { evaluate } from '../ai/evaluate'
import { legalMoves } from '../engine/legalMoves'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState, PendingChoice } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * What the node budget actually spent, and whether it ran out (#447).
 *
 * Raising `nodes` from 10,000 to 200,000 costs ten times as much per decision, at depth 3 and at
 * depth 1 alike. Off a stopwatch that reads as the search being cut short everywhere, and it is not:
 * the rail fires on 4.0% of real decisions for `beam` and 8.5% for the shipped `beam-reply`. The cost
 * is a heavy tail of enormous choice chains, and it buys no lookahead at all.
 *
 * Only the split shows that, which is why the counters are separated rather than totalled. Chain
 * resolution and beam expansion come out of one pool and the chain takes 80% to 98% of it, so on the
 * decisions that do exhaust, the search is starved exactly where the position is complicated.
 */

const cards = {
  ...CARDS,
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 2, power: 5, hp: 5 }),
  SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 1 }),
  // Playing a second copy raises a mandatory defeat choice, which is a chain the beam CREATES rather
  // than one it is handed at the root.
  UNIQ: card({ id: 'UNIQ', type: 'unit', arena: 'ground', cost: 1, power: 2, hp: 2, unique: true }),
}

/** Enough of a board that the beam has real work to do, rather than two legal moves. */
function busy(): GameState {
  return state({
    cards,
    players: {
      player: player({
        hand: ['BIG', 'SMALL', 'BIG'],
        resources: ready(6),
        units: [unit('u1', 'BIG'), unit('u2', 'SMALL'), unit('u3', 'BIG')],
      }),
      opponent: player({ units: [unit('e1', 'BIG'), unit('e2', 'SMALL')] }),
    },
  })
}

describe('search budget accounting', () => {
  it('starts a budget with nothing spent', () => {
    const b = searchBudget(500)
    expect(b).toEqual({ left: 500, chain: 0, beam: 0 })
  })

  /** Chain resolution draws on the same pool as the beam, which is the whole reason to separate the
   *  two counters rather than reporting one total. */
  it('bills driving an owed choice chain to the chain counter', () => {
    const choice: PendingChoice = { kind: 'selectUnitToDefeat', id: 'c', controller: 'player', targets: ['e1', 'e2'] }
    const s = state({
      cards,
      players: {
        player: player({ units: [unit('u1', 'SMALL')] }),
        opponent: player({ units: [unit('e1', 'BIG'), unit('e2', 'SMALL')] }),
      },
      pendingChoices: [choice],
    })

    const budget = searchBudget(256)
    resolveChain(s, 'player', undefined, evaluate, budget)

    expect(budget.chain).toBeGreaterThan(0)
    expect(budget.beam).toBe(0)
    expect(budget.left).toBe(256 - budget.chain)
  })

  it('spends nothing on a state with no chain owed', () => {
    const s = busy()
    const budget = searchBudget(256)
    expect(resolveChain(s, 'player', undefined, evaluate, budget)).toBe(s)
    expect(budget.chain).toBe(0)
    expect(budget.left).toBe(256)
  })
})

/**
 * The per-chain allowance (#488).
 *
 * `greedy` already had this right and the beam dropped it. `makeQuiescent` gives EVERY candidate its
 * own fresh 256-node budget, so one runaway chain costs 256 and the next candidate starts clean.
 * `makeBeamGreedy` passes a raw evaluator instead, so every chain in the decision draws on one pool
 * and the pool is gone by the time the lookahead wants it: 943 of 1318 nodes go on chains, and the
 * beam gets 376.
 *
 * The cap restores greedy's discipline **without raising the ceiling**. The pool stays at its old
 * size, so a decision can do no more work than before; a single chain simply cannot take all of it.
 * That is what makes this cost-neutral by construction rather than a trade of cost for correctness.
 *
 * The trade it IS making: a chain capped at 256 may pick a worse answer than one allowed thousands.
 * Beam completeness is being bought with chain thoroughness, which is why it needs an A/B and can
 * come back negative.
 */
describe('the per-chain allowance', () => {
  /** Four answers, each settling immediately, so the chain's cost is exactly countable. */
  const fourWayChoice = (): GameState => state({
    cards,
    players: {
      player: player({ units: [unit('u1', 'SMALL')] }),
      opponent: player({
        units: [unit('e1', 'BIG'), unit('e2', 'SMALL'), unit('e3', 'BIG'), unit('e4', 'SMALL')],
      }),
    },
    pendingChoices: [
      { kind: 'selectUnitToDefeat', id: 'c', controller: 'player', targets: ['e1', 'e2', 'e3', 'e4'] } as PendingChoice,
    ],
  })

  it('spends the whole chain when no cap is given', () => {
    const budget = searchBudget(256)
    resolveChain(fourWayChoice(), 'player', undefined, evaluate, budget)
    // The exact figure is engine detail (how many answers `legalMoves` offers, and whether settling
    // one raises another); what this pins is that an uncapped chain runs past the cap used below.
    expect(budget.chain).toBeGreaterThan(2)
  })

  it('caps what one chain may take from the shared pool', () => {
    const budget = searchBudget(256)
    resolveChain(fourWayChoice(), 'player', undefined, evaluate, budget, 2)
    expect(budget.chain).toBe(2)
  })

  /** The cap bounds one chain, not the decision: the parent still has the rest to spend elsewhere,
   *  which is the entire point. */
  it('leaves the rest of the pool for the beam', () => {
    const budget = searchBudget(256)
    resolveChain(fourWayChoice(), 'player', undefined, evaluate, budget, 2)
    expect(budget.left).toBe(254)
  })

  /** It can never overdraw the parent, however generous the cap. */
  it('never spends more than the pool has left', () => {
    const budget = searchBudget(3)
    resolveChain(fourWayChoice(), 'player', undefined, evaluate, budget, 1000)
    expect(budget.chain).toBeLessThanOrEqual(3)
    expect(budget.left).toBeGreaterThanOrEqual(0)
  })

  it('defaults to the same allowance one-ply quiescence already uses', () => {
    expect(DEFAULT_BEAM_LIMITS.chainNodes).toBe(DEFAULT_QUIESCENCE_LIMITS.nodes)
  })

  /** Parsing a cap is not enough: it has to reach `resolveChain` from the beam's limits, or the
   *  shipped bot keeps the shared pool under a new name. */
  it('is threaded from the beam limits into the chains it drives', () => {
    // Playing a second copy of a unique raises a MANDATORY defeat choice, so this is a chain a beam
    // candidate creates rather than one handed to it.
    const duplicateUnique = (): GameState => state({
      cards,
      players: {
        player: player({ hand: ['UNIQ'], resources: ready(4), units: [unit('u1', 'UNIQ'), unit('u2', 'BIG')] }),
        opponent: player({ units: [unit('e1', 'BIG')] }),
      },
    })

    const limits = { ...DEFAULT_BEAM_LIMITS, nodes: 1_000_000 }
    makeBeamAi(evaluate, { ...limits, chainNodes: 1 })(duplicateUnique())
    const capped = lastSearchTrace()!.chain

    makeBeamAi(evaluate, { ...limits, chainNodes: 1_000 })(duplicateUnique())
    const uncapped = lastSearchTrace()!.chain

    expect(capped).toBeLessThan(uncapped)
  })
})

describe('lastSearchTrace', () => {
  /** Expanding our own actions and the opponent's replies is beam work, so a position with no owed
   *  choices must show the spend there and nowhere else. */
  it('reports what the decision just taken spent', () => {
    const ai = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 1_000_000 })
    ai(busy())

    const trace = lastSearchTrace()
    expect(trace).not.toBeNull()
    expect(trace?.nodes).toBe(1_000_000)
    expect(trace?.beam).toBeGreaterThan(0)
    expect(trace?.exhausted).toBe(false)
  })

  /**
   * The property the sweep depends on. Without this, "the rail fired" is only observable by raising
   * it and watching the wall clock move, which is how #410 mistook a truncated depth 4 for a worse
   * one.
   */
  it('flags a decision the rail truncated', () => {
    const ai = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 5 })
    ai(busy())

    const trace = lastSearchTrace()
    expect(trace?.exhausted).toBe(true)
    expect(trace?.nodes).toBe(5)
  })

  /** A stale trace read as a fresh one would understate exhaustion across a corpus, so each decision
   *  must overwrite the last rather than accumulate into it. */
  it('describes one decision, not every decision so far', () => {
    const generous = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 1_000_000 })
    const railed = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 5 })

    railed(busy())
    expect(lastSearchTrace()?.exhausted).toBe(true)

    generous(busy())
    expect(lastSearchTrace()?.exhausted).toBe(false)
    expect(lastSearchTrace()?.nodes).toBe(1_000_000)
  })

  /**
   * The value the search gave each root candidate (#494).
   *
   * `--decisions` measures blind spots by asking "did every candidate score the same, so the
   * tie-break picked at random". It has always answered that with a **one-ply** scorer held in a
   * module constant, so pointing it at `beam-reply` would walk the shipped bot's positions while
   * still reporting one-ply's opinion of them: a third thing that answers nobody's question.
   *
   * Exposing the values the search actually computed costs nothing (the root loop already has them)
   * and lets the diagnostic report both, which is the real question #396 asks: how many of the ties
   * one ply cannot break does the search break?
   */
  it('reports a value for every root candidate', () => {
    const s = busy()
    const ai = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 1_000_000 })
    ai(s)
    expect(lastSearchTrace()!.candidates).toHaveLength(legalMoves(s).length)
  })

  /**
   * **Aligned with `legalMoves`, which is the property the diagnostic depends on.** It subsets
   * candidates by decision type (attacks, plays, resourcing), so a values array in any other order
   * would silently attribute one decision's spread to another.
   */
  it('aligns those values with legalMoves order', () => {
    const s = busy()
    const ai = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 1_000_000 })
    const chosen = ai(s)
    const trace = lastSearchTrace()!

    const index = legalMoves(s).findIndex(m => JSON.stringify(m) === JSON.stringify(chosen))
    expect(index).toBeGreaterThanOrEqual(0)
    // The move played must be one the search rated best. If the array were misordered this would
    // hold only by luck.
    expect(trace.candidates[index]).toBe(Math.max(...trace.candidates))
  })

  it('reports no candidates when there was no decision to make', () => {
    const ai = makeBeamAi(evaluate, DEFAULT_BEAM_LIMITS)
    ai(state({ cards, players: { player: player(), opponent: player() }, winner: 'player' }))
    expect(lastSearchTrace()!.candidates).toEqual([])
  })

  /** The counters have to account for the budget exactly, or the split cannot be read as a share of
   *  the spend. */
  it('accounts for every node it spent', () => {
    const ai = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 1_000_000 })
    ai(busy())

    const trace = lastSearchTrace()
    expect(trace!.chain + trace!.beam).toBe(trace!.nodes - trace!.left)
  })
})
