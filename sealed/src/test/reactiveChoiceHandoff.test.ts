import { describe, it, expect } from 'vitest'
import { benchInputs } from '../bench/decks'
import { randomAi } from '../ai/randomAi'
import { setupAi } from '../ai/setupAi'
import { initGame } from '../engine/initGame'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { seededShuffle, nextSeed } from '../engine/rng'
import { hasPendingChoices } from '../engine/types'
import type { GameState } from '../engine/types'

/**
 * A reactive defeat trigger owned by the NON-active player must hand control to that player, or the
 * game hangs. `resolve` settles state-based defeats after every action (Morgan Elsbeth style HP
 * reduction, or a debuff pushing a unit to lethal). That sweep can fire `whenFriendlyUnitDefeated`
 * etc. for the inactive player and raise a "may" choice they control (Bothan-5's capture). Nothing
 * downstream of that final sweep handed `activePlayer` over, so `legalMoves` (which only serves the
 * active player's choices) came back empty and neither side could move. Found by the AI bench (#390).
 */

/** The engine invariant this guards: a live position always offers the active player a legal move. */
function assertNeverStuck(from: GameState): GameState {
  let state = from
  for (let i = 0; i < 50_000 && state.winner === null; i++) {
    if (legalMoves(state).length === 0) {
      throw new Error(
        `stuck at round ${state.round}, active ${state.activePlayer}, ` +
          `choices ${JSON.stringify(state.pendingChoices?.map(c => `${c.kind}/${(c as { controller?: string }).controller}`))}`,
      )
    }
    const action = setupAi(state) ?? randomAi(state)
    if (!action) break
    state = resolve(state, action)
    // A pending choice must always be answerable by whoever is active.
    if (hasPendingChoices(state) && state.winner === null) {
      expect(legalMoves(state).length, 'active player has no move for a pending choice').toBeGreaterThan(0)
    }
  }
  return state
}

describe('reactive choice handoff (Bothan-5 top-level sweep)', () => {
  it('plays the reproducing mirror game to a result without ever hanging', () => {
    const { deck, cardDb } = benchInputs()
    const s = nextSeed(123)
    const shuffleSeed = { v: s }
    const shuffle = <T,>(arr: T[]): T[] => {
      shuffleSeed.v = nextSeed(shuffleSeed.v)
      return seededShuffle(arr, shuffleSeed.v)
    }
    const start = initGame(deck, deck, cardDb, { firstPlayer: 'player', shuffle, rngSeed: s })
    const end = assertNeverStuck(start)
    expect(end.winner).not.toBeNull()
  })
})
