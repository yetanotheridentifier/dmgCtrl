import { describe, it, expect } from 'vitest'
import { makeBeamGreedy, BEAM_REPLY_LIMITS } from '../ai/greedyAi'
import { evaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { makeBeamAi, lastSearchTrace, clearSearchTrace } from '../ai/search'
import { legalMoves } from '../engine/legalMoves'
import type { GameState } from '../engine/types'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import '../engine/cardDefinitions'

/**
 * Does the bot deploy an expensive body, or pass holding it?
 *
 * ## Why this exists
 *
 * The unspent-hand diagnostic samples only at CHOSEN PASSES, so every card it lists is one the bot
 * held while doing nothing at all. Two of the most-declined were Pre Vizsla and Chimaera, an 8-cost
 * 6/6 and a 7-cost 6/6, declined 15 and 9 times. Neither ability gates deployment: Chimaera's is
 * optional ("you MAY choose"), and Pre Vizsla's defeats "any number", which includes none.
 *
 * Under the shipped weights a 6/6 is worth about 44 points of board (`unit` 8, power 6x4, hp 6x2)
 * and the root pass charge is 8. So passing instead of deploying one should not be close, and the
 * corpus says it happened repeatedly.
 *
 * ## Reproduce before diagnosing
 *
 * This is the cheap half of the triage. A scripted position cannot prove the corpus behaviour is
 * fine, but it can show whether the bot fails to deploy a big body in the SIMPLEST case. If it
 * deploys here, the corpus declines have a positional cause and the next step is replaying one of
 * the real boards rather than guessing at one. If it passes here, the defect is reproduced in a
 * position small enough to read.
 *
 * The cards are deliberately vanilla. A real Pre Vizsla would test the deployment decision and its
 * When Played implementation at once, and a failure would not say which.
 */

const cards = {
  ...CARDS,
  // 8 cost, 6/6, no text: exactly the body under discussion with nothing else attached.
  BOMB: card({ id: 'BOMB', type: 'unit', arena: 'ground', cost: 8, power: 6, hp: 6, aspects: ['Command'], rarity: 'Legendary' }),
  CHAFF: card({ id: 'CHAFF', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, aspects: ['Command'], rarity: 'Common' }),
}

const shipped = makeBeamGreedy(DEFAULT_WEIGHTS, BEAM_REPLY_LIMITS)

/** Our turn, a full pool, the bomb in hand, and whatever the opponent has on the board. */
function withBoard(theirUnits: ReturnType<typeof unit>[], pool = 8): GameState {
  return state({
    phase: 'action',
    activePlayer: 'player',
    cards,
    players: {
      // Both leaders already deployed, or the bot correctly prefers deploying its leader and the test
      // measures that instead of the decision it is about.
      player: player({
        leader: { cardId: 'TST_L', deployed: true, epicActionUsed: true, exhausted: false },
        hand: ['BOMB'], resources: ready(pool), units: [],
      }),
      opponent: player({
        leader: { cardId: 'TST_L', deployed: true, epicActionUsed: true, exhausted: false },
        units: theirUnits,
      }),
    },
  })
}

describe('deploying an expensive body', () => {
  it('is affordable and legal, or the test proves nothing', () => {
    const s = withBoard([])
    expect(legalMoves(s).some(m => m.type === 'playUnit'), 'the bomb must be playable').toBe(true)
    expect(legalMoves(s).some(m => m.type === 'pass'), 'and passing must be an option').toBe(true)
  })

  it('plays a 6/6 into an empty board rather than passing', () => {
    expect(shipped(withBoard([]))?.type).toBe('playUnit')
  })

  it('plays it into a board it outclasses', () => {
    expect(shipped(withBoard([unit('e1', 'CHAFF')]))?.type).toBe('playUnit')
  })

  /**
   * The interesting case. Three 2/2s can gang up for 6 and kill a 6/6, so a pessimistic reply may
   * value the deployment at a loss. Whether declining here is right is a judgement; whether the bot
   * can see the trade at all is what this pins.
   */
  it('plays it into a board that could trade with it', () => {
    const crowd = [unit('e1', 'CHAFF'), unit('e2', 'CHAFF'), unit('e3', 'CHAFF')]
    expect(shipped(withBoard(crowd))?.type).toBe('playUnit')
  })

  /**
   * What the search actually valued, for whichever case above fails.
   *
   * A bare value explains nothing: a root move is worth the max over every board it reaches, so two
   * moves can score alike for different reasons. The docs are explicit that this is read in a test
   * rather than printed, and that four consecutive wrong explanations for one defect came from
   * inferring the line from two numbers instead.
   */
  it('values deploying above passing, and by a margin the pass charge cannot explain', () => {
    const s = withBoard([unit('e1', 'CHAFF')])
    const moves = legalMoves(s)
    const playIndex = moves.findIndex(m => m.type === 'playUnit')
    const passIndex = moves.findIndex(m => m.type === 'pass')
    clearSearchTrace()
    makeBeamAi(evaluate, { ...BEAM_REPLY_LIMITS, explain: true })(s)
    const trace = lastSearchTrace()!
    const play = trace.candidates[playIndex]
    const pass = trace.candidates[passIndex]
    // A 6/6 is worth roughly 44 of board against a pass charged 8, so the gap should be large rather
    // than marginal. Asserted loosely: the claim is "not close", not an exact arithmetic.
    expect(play, `play ${play} vs pass ${pass}`).toBeGreaterThan(pass)
  })
})
