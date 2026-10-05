import { describe, it, expect } from 'vitest'
import { cancelPoint } from '../hooks/useGame'
import { state, player } from './helpers/engineFixtures'
import { nextSeed } from '../engine/rng'
import type { GameState, PendingChoice, PlayerId } from '../engine/types'

/**
 * Dismissing a choice overlay on your own trigger cancels the action that raised it: the game rewinds
 * to the state before that action, as an undo would. `cancelPoint` decides whether that is allowed and
 * which snapshot it rewinds to.
 *
 * It is refused whenever cancelling would be more than taking back your own move: when the opponent
 * has acted since, when the choice comes from the opponent's card, and when anything hidden has been
 * seen in the meantime (a draw, a search, a look at a hand), since rewinding then lets the same
 * decision be taken again knowing the cards.
 */

const mode = (over: Partial<Extract<PendingChoice, { kind: 'chooseMode' }>> = {}): PendingChoice =>
  ({ kind: 'chooseMode', id: 'm', controller: 'player', modes: ['a', 'b'], ...over })

const quiet = state({
  players: {
    player: player({ hand: ['H1'], deck: ['D1', 'D2'] }),
    opponent: player({ hand: ['O1'], deck: ['E1', 'E2'] }),
  },
})
/**
 * `base` with `choice` pending, `actions` actions on: the engine steps the random seed once per
 * action, so a state reached without drawing anything random carries the seed stepped that often.
 */
const asking = (choice: PendingChoice = mode(), base: GameState = quiet, actions = 1): GameState => {
  let rngSeed = base.rngSeed
  for (let i = 0; i < actions; i++) rngSeed = nextSeed(rngSeed)
  return { ...base, rngSeed, pendingChoices: [choice] }
}
const snap = (by: PlayerId, s: GameState) => ({ by, state: s })

describe('cancelPoint', () => {
  it('rewinds to just before your own action that raised the choice', () => {
    const history = [snap('opponent', quiet), snap('player', quiet)]
    expect(cancelPoint(history, asking())).toBe(1)
  })

  /** A second step of the same action (an answer that raised a follow-up) cancels the whole action. */
  it('rewinds past earlier answers to the start of the action', () => {
    const history = [snap('player', quiet), snap('player', asking(mode({ id: 'first' })))]
    expect(cancelPoint(history, asking(mode({ id: 'second' }), quiet, 2))).toBe(0)
  })

  it('is refused when the opponent acted after your action', () => {
    const history = [snap('player', quiet), snap('opponent', quiet)]
    expect(cancelPoint(history, asking())).toBeUndefined()
  })

  it("is refused when the choice comes from the opponent's card", () => {
    const history = [snap('player', quiet)]
    const theirs = mode({ source: { cardId: 'X', controller: 'opponent' } })
    expect(cancelPoint(history, asking(theirs))).toBeUndefined()
  })

  it('is refused when there is no choice of yours waiting', () => {
    expect(cancelPoint([snap('player', quiet)], quiet)).toBeUndefined()
    expect(cancelPoint([snap('player', quiet)], asking(mode({ controller: 'opponent' })))).toBeUndefined()
  })

  it('is refused with nothing to rewind to', () => {
    expect(cancelPoint([], asking())).toBeUndefined()
  })

  /** A draw changes the deck: rewinding would let the player act again knowing the card drawn. */
  it('is refused once a card has been drawn', () => {
    const drawn = { ...quiet, players: { ...quiet.players, player: { ...quiet.players.player, hand: ['H1', 'D1'], deck: ['D2'] } } }
    expect(cancelPoint([snap('player', quiet)], asking(mode(), drawn))).toBeUndefined()
  })

  it("is refused once the opponent's hand has changed", () => {
    const discarded = { ...quiet, players: { ...quiet.players, opponent: { ...quiet.players.opponent, hand: [] } } }
    expect(cancelPoint([snap('player', quiet)], asking(mode(), discarded))).toBeUndefined()
  })

  /** One action steps the seed once; a seed stepped further means something random was drawn. */
  it('is refused once a random outcome has been drawn', () => {
    expect(cancelPoint([snap('player', quiet)], asking(mode(), quiet, 2))).toBeUndefined()
  })

  /** Looking at cards changes nothing in the state, so the look itself has to refuse it. */
  it('is refused while a choice is showing hidden cards', () => {
    const look: PendingChoice = { kind: 'mayPlayTopFree', id: 'l', controller: 'player', unitId: 'u', cardId: 'D1' }
    expect(cancelPoint([snap('player', quiet)], asking(look))).toBeUndefined()
  })

  it('is refused once an earlier step of the action showed hidden cards', () => {
    const lookedAt: PendingChoice = { kind: 'lookAtHand', id: 'h', controller: 'player', target: 'opponent' }
    const history = [snap('player', quiet), snap('player', asking(lookedAt))]
    expect(cancelPoint(history, asking(mode(), quiet, 2))).toBeUndefined()
  })
})
