import { describe, it, expect } from 'vitest'
import { playGame } from '../bench/selfPlay'
import { benchInputs } from '../bench/decks'
import { randomAi } from '../ai/randomAi'
import type { Ai } from '../ai/types'
import type { GameResult } from '../bench/selfPlay'

/**
 * The pure heart of the harness: a whole game played headlessly between two AIs, seeded so it is a
 * function of its inputs (this is what #366 bought us). It also has to survive engine defects
 * without wedging the run, so a game that hangs, gets stuck or throws is DROPPED with a reason and a
 * seed, not silently mixed into the results.
 */

/** Compare everything except the wall-clock timing, which is not deterministic. */
function stable(r: GameResult) {
  return { ...r, durationMs: 0 }
}

const inputs = benchInputs()
const base = {
  deckPlayer: inputs.deck,
  deckOpponent: inputs.deck,
  cardDb: inputs.cardDb,
  aiPlayer: randomAi,
  aiOpponent: randomAi,
  firstPlayer: 'player' as const,
}

describe('playGame', () => {
  it('plays a full game to a result', () => {
    const r = playGame({ ...base, seed: 42 })
    expect(r.status).toBe('completed')
    expect(['player', 'opponent', 'draw']).toContain(r.winner)
    expect(r.rounds).toBeGreaterThan(0)
    expect(r.moveCount).toBeGreaterThan(1)
  })

  it('is deterministic: same seed, identical game', () => {
    const a = playGame({ ...base, seed: 7 })
    const b = playGame({ ...base, seed: 7 })
    expect(stable(b)).toEqual(stable(a))
  })

  it('a different seed generally produces a different game', () => {
    const a = playGame({ ...base, seed: 1 })
    const b = playGame({ ...base, seed: 2 })
    expect(b.moves).not.toEqual(a.moves)
  })

  it('drops a game whose AI gets stuck (returns no move mid-game)', () => {
    const stuck: Ai = () => null
    const r = playGame({ ...base, aiPlayer: stuck, aiOpponent: stuck, seed: 3 })
    expect(r.status).toBe('dropped')
    expect(r.dropReason).toBe('stuck')
    expect(r.seed).toBe(3)
  })

  it('drops a game whose AI throws, capturing the seed for reproduction', () => {
    const boom: Ai = () => {
      throw new Error('engine defect')
    }
    const r = playGame({ ...base, aiPlayer: boom, aiOpponent: boom, seed: 9 })
    expect(r.status).toBe('dropped')
    expect(r.dropReason).toBe('threw')
    expect(r.seed).toBe(9)
    // The move list up to the failure is retained so the game can be replayed.
    expect(Array.isArray(r.moves)).toBe(true)
  })

  it('drops a game that will not terminate within the step ceiling', () => {
    const r = playGame({ ...base, seed: 5, stepCeiling: 3 })
    expect(r.status).toBe('dropped')
    expect(r.dropReason).toBe('nonterminating')
  })
})
