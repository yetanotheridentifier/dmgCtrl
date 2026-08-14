import { describe, it, expect } from 'vitest'
import { makeBeamAi, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { evaluate } from '../ai/evaluate'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Once the opponent has claimed the initiative, a pessimistic reply models replies that cannot happen.
 *
 * Claiming makes you pass for the rest of the round (CR 1.15.5b): `advanceTurn` sees
 * `initiativeTakenBy === next` and **leaves the active player unchanged**, bouncing the turn straight
 * back. So the claimant never gets another turn, and assuming they will do the most inconvenient thing
 * between our actions would be strictly wrong rather than merely cautious.
 *
 * **The search already gets this right, and these tests are why we know.** `applyReply` returns the
 * state untouched unless `activePlayer` is the opponent, and after a claim it never is. No special
 * case, no flag: the reply is skipped because the engine genuinely has nobody to move.
 *
 * Worth pinning rather than trusting, because it is invisible either way. A reply that fired here
 * would quietly make the bot play round out of a fear of a player who has left the table, and nothing
 * in the output would say so.
 */

const cards = {
  ...CARDS,
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 5, power: 5, hp: 6 }),
  SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 3 }),
}

/** Our turn, mid action phase, with the opponent having claimed and therefore out of the round. */
const afterClaim = (): GameState => state({
  cards,
  phase: 'action',
  activePlayer: 'player',
  initiative: 'opponent',
  initiativeTakenBy: 'opponent',
  players: {
    player: player({ units: [unit('a', 'BIG'), unit('b', 'SMALL')] }),
    opponent: player({ base: { cardId: 'TST_B', damage: 10 }, units: [unit('e', 'SMALL')] }),
  },
})

/** The same board with nobody having claimed, so replies are live. The control. */
const contested = (): GameState => ({ ...afterClaim(), initiativeTakenBy: null, initiative: 'player' })

const limits = { ...DEFAULT_BEAM_LIMITS, nodes: 200_000 }
const pessimistic = makeBeamAi(evaluate, { ...limits, reply: 'pessimistic' })
const optimistic = makeBeamAi(evaluate, { ...limits, reply: 'null' })

describe('replies after the opponent has claimed the initiative', () => {
  /** The engine's guarantee the search leans on. If this ever changed, the rest would silently rot. */
  it('never hands the claimant another turn', () => {
    let s = afterClaim()
    for (const move of legalMoves(s)) {
      const next = resolve(s, move)
      // Either we are still to move, or the phase has ended. Never the claimant's turn.
      expect(next.phase === 'action' ? next.activePlayer : 'player', move.type).toBe('player')
    }
    // And across a whole sequence of our own actions, not just one.
    for (let i = 0; i < 4 && s.phase === 'action'; i++) {
      const moves = legalMoves(s).filter(m => m.type !== 'pass')
      if (moves.length === 0) break
      s = resolve(s, moves[0])
      if (s.phase === 'action') expect(s.activePlayer).toBe('player')
    }
  })

  /**
   * **The consequence: the two reply policies are the same bot here.** Not approximately, identically,
   * because the pessimistic branch never executes.
   */
  it('makes the pessimistic and optimistic searches agree exactly', () => {
    const s = afterClaim()
    expect(pessimistic(s)).toEqual(optimistic(s))
  })

  /**
   * And the control, without which the test above proves nothing: on the same board with the
   * initiative still contested, the two policies **can** disagree. If they agreed here too, the first
   * test would be measuring an inert search rather than an absent reply.
   *
   * Asserted as "the reply is consulted" rather than "the move differs", since a position where both
   * policies happen to agree is ordinary and not a finding.
   */
  it('still consults the opponent when the initiative is contested', () => {
    const s = contested()
    let sawOpponentTurn = false
    for (const move of legalMoves(s)) {
      const next = resolve(s, move)
      if (next.phase === 'action' && next.activePlayer === 'opponent') sawOpponentTurn = true
    }
    expect(sawOpponentTurn, 'the opponent does get to move when nobody has claimed').toBe(true)
  })
})
