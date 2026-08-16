import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { hasPendingChoices, pushChoice } from '../engine/types'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * A decided game resolves nothing (#523).
 *
 * **CR 6.6.2**: "Once a player's base has 0 remaining HP, they cannot take any actions, and cannot
 * resolve any abilities or effects." CR 1.16.5 ranks base defeat first among the state-based situations
 * that take priority over waiting triggered abilities.
 *
 * Reported from live play: an attack that finished the game also triggered Camtono, so the game-over
 * screen and a "look at the top card of your deck" overlay appeared together. The card could not be
 * played, because the game was over and the engine offered no moves, and it could not be dismissed,
 * so the player could not reach the menu either. An unrecoverable screen.
 *
 * Fixing that as a z-order question would have been treating the symptom. The choice should never have
 * existed: a won game has nothing pending, and the UI cannot render an overlay for a choice that is not
 * there.
 */

const cards = {
  ...CARDS,
  KILLER: card({ id: 'KILLER', type: 'unit', arena: 'ground', cost: 3, power: 30, hp: 3 }),
}

/** Our attacker can finish their base outright this action. */
const aboutToWin = (): GameState => state({
  cards,
  phase: 'action',
  activePlayer: 'player',
  players: {
    player: player({ resources: ready(3), units: [unit('a', 'KILLER')] }),
    opponent: player({ base: { cardId: 'TST_B', damage: 0 } }),
  },
})

describe('a decided game', () => {
  it('is actually decided by the fixture, or the rest proves nothing', () => {
    const won = resolve(aboutToWin(), { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(won.winner).toBe('player')
  })

  /**
   * The engine already refuses to offer moves once the game is decided, which is why the reported
   * screen was unrecoverable rather than merely wrong: the overlay asked for an answer that no legal
   * move could give.
   */
  it('offers no legal moves', () => {
    const won = resolve(aboutToWin(), { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(legalMoves(won)).toEqual([])
  })

  /**
   * The fix. A choice outstanding when the base falls is discarded rather than left waiting, so nothing
   * downstream has to special-case a pending choice that can never be answered.
   */
  it('drops any choice that was already pending', () => {
    const pending = pushChoice(aboutToWin(), {
      kind: 'mayPlayTopFree', id: 'camtono', controller: 'player', unitId: 'a', cardId: 'TST_U1',
    })
    expect(hasPendingChoices(pending), 'the fixture must start with a choice owed').toBe(true)

    const won = resolve(pending, { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(won.winner).toBe('player')
    expect(hasPendingChoices(won), 'a decided game resolves nothing (CR 6.6.2)').toBe(false)
  })

  /**
   * And the other direction: a trigger raised BY the winning action cannot install itself afterwards.
   * Clearing on the way through is not enough on its own, because whether a choice is pushed before or
   * after the win check varies by card and by code path.
   */
  it('refuses a choice pushed into an already decided game', () => {
    const won = resolve(aboutToWin(), { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    const after = pushChoice(won, {
      kind: 'mayPlayTopFree', id: 'camtono', controller: 'player', unitId: 'a', cardId: 'TST_U1',
    })
    expect(hasPendingChoices(after)).toBe(false)
  })

  /** The guard must not touch a live game, or every trigger in the set stops working. */
  it('leaves a live game alone', () => {
    const live = pushChoice(aboutToWin(), {
      kind: 'mayPlayTopFree', id: 'camtono', controller: 'player', unitId: 'a', cardId: 'TST_U1',
    })
    expect(hasPendingChoices(live)).toBe(true)
    expect(legalMoves(live).length).toBeGreaterThan(0)
  })
})
