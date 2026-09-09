import { describe, it, expect } from 'vitest'
import { makeLethalBeam } from '../ai/greedyAi'
import { beamAi } from '../ai/greedyAi'
import { resolveAi, lethalLimitsFor } from '../ai/registry'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import { DEFAULT_BEAM_LIMITS } from '../ai/search'
import { DEFAULT_LETHAL_LIMITS, DEFAULT_LETHAL_GATE } from '../ai/lethal'
import { resolve } from '../engine/resolve'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * The beam with a lethal override in front of it (#433).
 *
 * Measured over 36,384 decisions: the shipped beam at depth 3 misses a winning line in 0.31% of
 * decisions at matched depth, rising to 1.15% when the solver is allowed depth 6. Both rates were
 * taken with the node budget binding, so both are lower bounds. The override is only worth anything
 * in that slice, so everything here is about it changing NOTHING elsewhere.
 *
 * The gate matters as much as the search. A depth-4 solver costs 39 ms a call on the shipped 4,000
 * node budget and 798 ms on the 200,000 it needs to finish, so it cannot run on every decision, and
 * each gate is a way of not finding a line: a gate that fires too eagerly disables the feature while
 * looking like a free speedup.
 */

const cards = {
  ...CARDS,
  FINISHER: card({ id: 'FINISHER', type: 'unit', arena: 'ground', cost: 2, power: 9, hp: 9 }),
  SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 1, power: 3, hp: 5 }),
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 3, keywords: [{ name: 'Sentinel' }] }),
  TINY_BASE: card({ id: 'TINY_BASE', type: 'base', hp: 9 }),
}

/** Round 6, so the gate is open and the search is what decides. */
function lateGame(mine: string[], theirs: string[] = []): GameState {
  return state({
    cards,
    round: 6,
    players: {
      player: player({ resources: ready(4), units: mine.map((c, i) => unit(`u${i}`, c)) }),
      opponent: player({ base: { cardId: 'TINY_BASE', damage: 0 }, units: theirs.map((c, i) => unit(`e${i}`, c)) }),
    },
  })
}

const lethalBeam = makeLethalBeam(DEFAULT_WEIGHTS, DEFAULT_BEAM_LIMITS, DEFAULT_LETHAL_LIMITS, DEFAULT_LETHAL_GATE)

describe('the lethal override', () => {
  /** The whole point: a win the beam would have to be lucky to find, taken deterministically. */
  it('opens the winning line when one exists behind a Sentinel', () => {
    const s = lateGame(['SMALL', 'FINISHER'], ['WALL'])
    const move = lethalBeam(s)!
    // Clearing the wall is the only first step of a winning line here.
    expect(move).toMatchObject({ type: 'attack', target: { kind: 'unit', instanceId: 'e0' } })
  })

  /**
   * The property that keeps this safe to ship: outside the slice where a line exists, it must be the
   * beam and nothing else. A bot that plays differently in ordinary positions would need re-measuring
   * from scratch rather than A/B-ing one feature.
   */
  it('is exactly the beam when no line exists', () => {
    const s = lateGame(['SMALL'], ['WALL'])
    expect(lethalBeam(s)).toEqual(beamAi(s))
  })

  it('is exactly the beam before the gate opens', () => {
    const early = { ...lateGame(['SMALL', 'FINISHER'], ['WALL']), round: 2 }
    expect(lethalBeam(early)).toEqual(beamAi(early))
  })

  /**
   * A single-action win is already guaranteed by the evaluation: WIN is 1,000,000 and no material
   * score approaches it. The override must not change that, and the gate skips the search there
   * precisely because it cannot improve on a proof.
   */
  it('still wins immediately when one attack does it, without searching', () => {
    const s = lateGame(['FINISHER'])
    expect(resolve(s, lethalBeam(s)!).winner).toBe('player')
  })

  it('is deterministic', () => {
    const s = lateGame(['SMALL', 'FINISHER'], ['WALL'])
    expect(lethalBeam(s)).toEqual(lethalBeam(s))
  })

  it('does not touch the state it was given', () => {
    const s = lateGame(['SMALL', 'FINISHER'], ['WALL'])
    const before = JSON.stringify(s)
    lethalBeam(s)
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('registry', () => {
  /** Named so a run can address beam width, beam depth and solver depth, which is what the planned
   *  validation sweeps: beam@3 with solver@5 now, beam@4 with solver@6 under #447. */
  it('builds a lethal beam at a given beam and solver depth', () => {
    expect(() => resolveAi('beam-lethal:4x3:5')).not.toThrow()
    expect(() => resolveAi('beam-lethal')).not.toThrow()
    expect(() => resolveAi('beam-lethal:4x3:5:200000')).not.toThrow()
  })

  it('rejects a malformed spec rather than falling back to defaults', () => {
    expect(() => resolveAi('beam-lethal:4x3:0')).toThrow()
    expect(() => resolveAi('beam-lethal:x')).toThrow()
    expect(() => resolveAi('beam-lethal:4x3:5:0')).toThrow()
  })
})

/**
 * What the two limits resolve to, asserted rather than inferred.
 *
 * Exported for the same reason `beamLimitsFor` is: a sweep cell that silently parsed to the shipped
 * configuration would run the shipped bot under a candidate's name and report no difference, and a
 * decision trace is a weaker way to catch that than reading the limits.
 *
 * The node budget is the reason this exists at all. It is a rail, and a rail that fires routinely has
 * quietly become the real depth: at depth 4 against depth 2, both 4,000 and 40,000 nodes report the
 * DEEPER search finding less lethal, which depth alone cannot do. Sizing the solver therefore needs a
 * way to name a budget per cell, exactly as `beam:` and `reply:` already have.
 */
describe('the lethal beam solver limits', () => {
  /** The whole point of the trailing field: an explicit budget wins outright. */
  it('takes an explicit node budget over the depth-scaled rail', () => {
    expect(lethalLimitsFor('beam-lethal:8x3:4:200000')).toEqual({ depth: 4, nodes: 200_000 })
    expect(lethalLimitsFor('beam-lethal:8x3:6:1000000')).toEqual({ depth: 6, nodes: 1_000_000 })
  })

  /**
   * The containment that makes this safe to land: absent the new field, every cell keeps the budget
   * it has always had, so nothing already recorded shifts underneath.
   */
  it('keeps the depth-scaled rail when no budget is named', () => {
    expect(lethalLimitsFor('beam-lethal:8x3:1')).toEqual({ depth: 1, nodes: 4000 })
    expect(lethalLimitsFor('beam-lethal:8x3:2')).toEqual({ depth: 2, nodes: 8000 })
    expect(lethalLimitsFor('beam-lethal:8x3:4')).toEqual({ depth: 4, nodes: 16_000 })
  })

  /**
   * **The bare name does not run the scaled rail.** `beam-lethal` is the entry that measured +0.8
   * over 2,580 games, and it takes `DEFAULT_LETHAL_LIMITS`: a FLAT 4,000, a quarter of what the same
   * depth scales to through the spec. Pinned here because the difference lives in two levels of
   * default argument and is invisible at the call site, and because it decides how that +0.8 reads.
   */
  it('runs the bare name on the flat shipped rail, not the scaled one', () => {
    expect(lethalLimitsFor('beam-lethal')).toEqual(DEFAULT_LETHAL_LIMITS)
    expect(lethalLimitsFor('beam-lethal')).toEqual({ depth: 4, nodes: 4000 })
    expect(lethalLimitsFor('beam-lethal:8x3:4')!.nodes).toBe(4 * lethalLimitsFor('beam-lethal')!.nodes)
  })

  it('is null for a name that runs no solver', () => {
    expect(lethalLimitsFor('beam')).toBeNull()
    expect(lethalLimitsFor('beam:8x3')).toBeNull()
    expect(lethalLimitsFor('greedy')).toBeNull()
  })
})
