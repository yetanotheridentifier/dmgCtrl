import { describe, it, expect } from 'vitest'
import { randomAi } from '../ai/randomAi'
import { legalMoves } from '../engine/legalMoves'
import { player, state, ready } from './helpers/engineFixtures'

describe('randomAi — rung 0', () => {
  const busyState = () =>
    state({
      players: {
        player: player({ hand: ['TST_U1', 'TST_U2'], resources: ready(5) }),
        opponent: player(),
      },
    })

  it('returns one of the legal moves', () => {
    const s = busyState()
    const action = randomAi(s, Math.random)
    expect(legalMoves(s)).toContainEqual(action)
  })

  it('is deterministic given an injected rng', () => {
    const s = busyState()
    const moves = legalMoves(s)
    expect(randomAi(s, () => 0)).toEqual(moves[0])
    expect(randomAi(s, () => 0.999999)).toEqual(moves[moves.length - 1])
  })

  it('returns null when the game is over (no legal moves)', () => {
    expect(randomAi(state({ winner: 'player' }), Math.random)).toBeNull()
  })
})
