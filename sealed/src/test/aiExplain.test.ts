import { describe, it, expect } from 'vitest'
import { makeBeamAi, lastSearchTrace, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { evaluate } from '../ai/evaluate'
import { legalMoves } from '../engine/legalMoves'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Why did the search pick that? (#499)
 *
 * The trace already reports the **value** of each root candidate, which is two numbers and no
 * reasoning. Diagnosing the shielded-Sentinel lockout burned an afternoon and four wrong hypotheses
 * precisely because that is all there was: every explanation had to be inferred from a value plus a
 * mental model of the code, and the mental model was wrong three times running.
 *
 * A root move's value is the **max over every board reachable from it**, so the two things needed to
 * explain it are **which board was the peak** and **how the search got there**. With those, "the pass
 * line recovers to 52 by killing the Sentinel one action later" is something you read rather than
 * something you argue.
 *
 * Off by default: the path tracking allocates per frontier node, and the shipped bot should not pay
 * for a diagnostic.
 */

const cards = {
  ...CARDS,
  GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground', cost: 2, power: 3, hp: 4 }),
}

function busy(): GameState {
  return state({
    cards,
    players: {
      player: player({ hand: ['GRUNT'], resources: ready(4), units: [unit('u1', 'GRUNT'), unit('u2', 'GRUNT')] }),
      opponent: player({ units: [unit('e1', 'GRUNT')] }),
    },
  })
}

const explaining = (depth: number) => makeBeamAi(evaluate, {
  ...DEFAULT_BEAM_LIMITS, depth, reply: 'pessimistic', nodes: 200_000, explain: true,
})

describe('the principal variation readout', () => {
  it('reports nothing unless asked, so the shipped bot pays nothing', () => {
    makeBeamAi(evaluate, DEFAULT_BEAM_LIMITS)(busy())
    expect(lastSearchTrace()!.lines).toBeUndefined()
  })

  it('reports one line per root candidate, aligned with legalMoves', () => {
    const s = busy()
    explaining(3)(s)
    const lines = lastSearchTrace()!.lines!
    expect(lines).toHaveLength(legalMoves(s).length)
    lines.forEach((line, i) => {
      expect(line.path[0], 'a line must open with its own root move').toEqual(legalMoves(s)[i])
    })
  })

  /** The line has to explain the number the search actually acted on, or it explains nothing. */
  it('agrees with the value the trace already reports', () => {
    const s = busy()
    explaining(3)(s)
    const trace = lastSearchTrace()!
    trace.lines!.forEach((line, i) => {
      expect(line.value).toBe(trace.candidates[i])
    })
  })

  /**
   * **The measurement that was missing.** A peak at level 1 means the move was judged on its
   * immediate result; a peak at the last level means the value rests on a multi-action plan that has
   * to survive every modelled reply on the way.
   */
  it('says at which level the peak was found, and shows the moves to reach it', () => {
    const s = busy()
    explaining(3)(s)
    for (const line of lastSearchTrace()!.lines!) {
      expect(line.peakDepth).toBeGreaterThanOrEqual(1)
      expect(line.peakDepth).toBeLessThanOrEqual(3)
      // One of OUR actions per level, so the path length is the depth it peaked at.
      expect(line.path).toHaveLength(line.peakDepth)
    }
  })

  /** At depth 1 there is nothing to explain beyond the move itself, which is the degenerate case
   *  worth pinning so the reader can trust the deeper ones. */
  it('degenerates to the move itself at depth 1', () => {
    const s = busy()
    explaining(1)(s)
    for (const line of lastSearchTrace()!.lines!) {
      expect(line.peakDepth).toBe(1)
      expect(line.path).toHaveLength(1)
    }
  })
})
