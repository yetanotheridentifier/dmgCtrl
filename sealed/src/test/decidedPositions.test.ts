import { describe, it, expect } from 'vitest'
import { tallyDecided } from '../bench/decisions'

/**
 * How much of a game is played after it is decided (#537).
 *
 * "Decided" is a seat's first action-phase decision where every legal move hands the opponent a
 * one-action kill on their turn. Two questions hang on it. How many actions follow, which is what stopping
 * a decided bench game early could save. And whether the seat then actually lost, which is whether
 * conceding at that point would ever throw away a game.
 */
describe('tallyDecided', () => {
  it('counts nothing for a game where neither seat was ever decided', () => {
    expect(tallyDecided({ player: null, opponent: null }, 50, 'player'))
      .toEqual({ decided: 0, lostAfter: 0, actionsAfter: 0 })
  })

  /** Index 40 of 50 actions: the decision itself and the nine after it are what a concession saves. */
  it('counts the actions from the loser\'s first unavoidable decision to the end', () => {
    expect(tallyDecided({ player: 40, opponent: null }, 50, 'opponent'))
      .toEqual({ decided: 1, lostAfter: 1, actionsAfter: 10 })
  })

  /** The case that would make conceding wrong: decided, and won anyway. It saves nothing either. */
  it('counts a seat that was decided and did not lose, without crediting any saving', () => {
    expect(tallyDecided({ player: 40, opponent: null }, 50, 'player'))
      .toEqual({ decided: 1, lostAfter: 0, actionsAfter: 0 })
  })

  it('counts each seat that was decided, saving only from the loser\'s', () => {
    // The player lost, decided at 30: twenty actions follow. The opponent's 45 saves nothing, it won.
    expect(tallyDecided({ player: 30, opponent: 45 }, 50, 'opponent'))
      .toEqual({ decided: 2, lostAfter: 1, actionsAfter: 20 })
  })

  /** A game cut off at the action ceiling has no loser, so nothing in it was a correct concession. */
  it('credits no loss and no saving to an unfinished or drawn game', () => {
    expect(tallyDecided({ player: 40, opponent: null }, 50, null))
      .toEqual({ decided: 1, lostAfter: 0, actionsAfter: 0 })
    expect(tallyDecided({ player: 40, opponent: null }, 50, 'draw'))
      .toEqual({ decided: 1, lostAfter: 0, actionsAfter: 0 })
  })
})
