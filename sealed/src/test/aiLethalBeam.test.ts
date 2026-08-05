import { describe, it, expect } from 'vitest'
import { makeLethalBeam } from '../ai/greedyAi'
import { beamAi } from '../ai/greedyAi'
import { resolveAi } from '../ai/registry'
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
 * decisions at matched depth, rising to 1.15% when the solver is allowed depth 6. The override is
 * only worth anything in that slice, so everything here is about it changing NOTHING elsewhere.
 *
 * The gate matters as much as the search. At 200 to 350 ms a call the solver cannot run on every
 * decision, and each gate is a way of not finding a line, so a gate that fires too eagerly disables
 * the feature while looking like a free speedup.
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
  })

  it('rejects a malformed spec rather than falling back to defaults', () => {
    expect(() => resolveAi('beam-lethal:4x3:0')).toThrow()
    expect(() => resolveAi('beam-lethal:x')).toThrow()
  })
})
