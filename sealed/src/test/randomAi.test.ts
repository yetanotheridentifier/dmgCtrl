import { describe, it, expect } from 'vitest'
import { randomAi } from '../ai/randomAi'
import { legalMoves } from '../engine/legalMoves'
import { player, state, ready } from './helpers/engineFixtures'

describe('randomAi — rung 0', () => {
  const busyState = (rngSeed = 42) =>
    state({
      rngSeed,
      players: {
        player: player({ hand: ['TST_U1', 'TST_U2'], resources: ready(5) }),
        opponent: player(),
      },
    })

  it('returns one of the legal moves', () => {
    const s = busyState()
    expect(legalMoves(s)).toContainEqual(randomAi(s))
  })

  /**
   * The AI's move is a pure function of the state, so undo can rewind into a decision and
   * replay it identically, and a saved record replays exactly. It is NOT a fixed move: a
   * different seed — which any different line of play produces — is free to pick differently.
   */
  it('is deterministic for a given state, and driven by the state seed', () => {
    expect(randomAi(busyState())).toEqual(randomAi(busyState()))
    // Across seeds the pick varies — otherwise the AI would be frozen, not deterministic.
    const picks = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(randomAi(busyState(i)))))
    expect(picks.size).toBeGreaterThan(1)
  })

  it('returns null when the game is over (no legal moves)', () => {
    expect(randomAi(state({ winner: 'player' }))).toBeNull()
  })
})
