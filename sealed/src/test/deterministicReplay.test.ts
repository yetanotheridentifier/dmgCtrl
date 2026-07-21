import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { nextSeed } from '../engine/rng'
import { randomAi } from '../ai/randomAi'
import { legalMoves } from '../engine/legalMoves'
import { state, player, ready } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * The engine's randomness stream lives on the state and advances once per action, so a
 * sequence of actions replays to exactly the same state every time. That is what lets undo
 * rewind into a decision without the AI answering differently, and what makes a saved game
 * record (initial state + moves) a faithful replay rather than a re-roll.
 */
describe('deterministic replay', () => {
  it('advances the seed on every action, so consecutive decisions differ', () => {
    const before = state()
    const after = resolve(before, { type: 'pass' })
    expect(after.rngSeed).toBe(nextSeed(before.rngSeed))
  })

  it('replays a sequence of actions to an identical state', () => {
    const start = state({
      players: { player: player({ hand: ['TST_U1', 'TST_U2'], resources: ready(5) }), opponent: player() },
    })
    // Drive both sides with the state-seeded AI: the whole game is a pure function of `start`.
    const play = (from: GameState): { final: GameState; moves: Action[] } => {
      let current = from
      const moves: Action[] = []
      for (let i = 0; i < 20 && current.winner === null; i++) {
        const action = randomAi(current)
        if (!action) break
        moves.push(action)
        current = resolve(current, action)
      }
      return { final: current, moves }
    }

    const first = play(start)
    const second = play(start)
    expect(second.moves).toEqual(first.moves)
    expect(second.final).toEqual(first.final)
    expect(first.moves.length).toBeGreaterThan(1) // the run actually exercised something
  })

  it('re-resolving a recorded move list reproduces the final state', () => {
    const start = state({
      players: { player: player({ hand: ['TST_U1', 'TST_U2'], resources: ready(5) }), opponent: player() },
    })
    const moves: Action[] = []
    let live = start
    for (let i = 0; i < 20 && live.winner === null; i++) {
      const action = randomAi(live)
      if (!action) break
      moves.push(action)
      live = resolve(live, action)
    }
    // A record stores the initial state and the move list; replaying must land on the same state.
    expect(moves.reduce(resolve, start)).toEqual(live)
  })

  it('a different line of play frees the AI to answer differently', () => {
    const start = state({
      players: { player: player({ hand: ['TST_U1', 'TST_U2'], resources: ready(5) }), opponent: player() },
    })
    const moves = legalMoves(start)
    expect(moves.length).toBeGreaterThan(1)
    // Same starting point, two different player choices → the AI is not pinned to one reply.
    const replies = moves.map(m => JSON.stringify(randomAi(resolve(start, m))))
    expect(new Set(replies).size).toBeGreaterThan(1)
  })
})
