import { describe, it, expect } from 'vitest'
import { makeQuiescent } from '../ai/search'
import { evaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { greedyAi, greedyFlatAi, makeTunedGreedy } from '../ai/greedyAi'
import { resolve } from '../engine/resolve'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState, PendingChoice } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Quiescent scoring (#400): never evaluate a half-resolved action.
 *
 * Greedy scores the state a candidate move produces, but a move that raises a choice has not
 * finished resolving, so the score is read off a partial board. Measured over 210 games, we owe the
 * outstanding answer on 42.9% of positions and 11.3% of the moves actually chosen; the opponent owes
 * it on 5.1% and 0.5%. The fix is one recursion: expand the owed chain before scoring, taking the max
 * over our answers and the min over theirs.
 */

const quiescent = makeQuiescent(evaluate)

const cards = {
  ...CARDS,
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 2, power: 5, hp: 5 }),
  SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 1 }),
}

const defeatChoice = (controller: 'player' | 'opponent', targets: string[]): PendingChoice =>
  ({ kind: 'selectUnitToDefeat', id: 'c', controller, targets })

/** Answer the `defeatChoice` above by naming its victim. */
const answer = (s: GameState, targetInstanceId: string): GameState =>
  resolve(s, { type: 'acceptChoice', choiceId: 'c', targetInstanceId })

describe('makeQuiescent', () => {
  it('leaves a fully resolved state exactly as the inner evaluation scores it', () => {
    const s = state({ cards, players: { player: player({ units: [unit('u1', 'BIG')] }), opponent: player() } })
    expect(quiescent(s, 'player')).toBe(evaluate(s, 'player'))
  })

  /**
   * Our own owed answer is an opportunity, so the score is the BEST we can reach. Scoring the
   * suspended board instead credits us with nothing for a choice we are about to make well.
   */
  it('takes the best of our own owed answers, not the half-resolved board', () => {
    const s = state({
      cards,
      players: {
        player: player({ units: [unit('u1', 'SMALL')] }),
        opponent: player({ units: [unit('e1', 'BIG'), unit('e2', 'SMALL')] }),
      },
      pendingChoices: [defeatChoice('player', ['e1', 'e2'])],
    })

    const suspended = evaluate(s, 'player')
    const defeatBig = evaluate(answer(s, 'e1'), 'player')
    const defeatSmall = evaluate(answer(s, 'e2'), 'player')

    expect(defeatBig).toBeGreaterThan(defeatSmall) // the fixture is doing what it claims
    expect(quiescent(s, 'player')).toBe(defeatBig)
    expect(quiescent(s, 'player')).toBeGreaterThan(suspended)
  })

  /**
   * Theirs is a threat, so the score is the WORST they can leave us with. Anything more optimistic
   * is the reply-blindness this is meant to remove.
   */
  it('takes the worst of the answers the opponent owes', () => {
    const s = state({
      cards,
      activePlayer: 'opponent', // the engine hands the turn over so they can answer
      players: {
        player: player({ units: [unit('u1', 'BIG'), unit('u2', 'SMALL')] }),
        opponent: player(),
      },
      pendingChoices: [defeatChoice('opponent', ['u1', 'u2'])],
    })

    const suspended = evaluate(s, 'player')
    const loseBig = evaluate(answer(s, 'u1'), 'player')

    expect(quiescent(s, 'player')).toBe(loseBig)
    expect(quiescent(s, 'player')).toBeLessThan(suspended)
  })

  /** A decided game is scored terminally; an unanswered choice on it is not a half-resolution. */
  it('does not expand a finished game', () => {
    const s = state({ cards, winner: 'player', pendingChoices: [defeatChoice('player', ['e1'])] })
    expect(quiescent(s, 'player')).toBe(evaluate(s, 'player'))
  })

  /**
   * The chain is short in practice, but `support` fans out across every ready unit and every target,
   * and a card could in principle chain further than expected. The budget makes the worst case
   * bounded rather than trusting the card pool, and falls back to scoring where it stopped.
   */
  it('falls back to the current board when the node budget runs out', () => {
    const s = state({
      cards,
      players: {
        player: player({ units: [unit('u1', 'SMALL')] }),
        opponent: player({ units: [unit('e1', 'BIG'), unit('e2', 'SMALL')] }),
      },
      pendingChoices: [defeatChoice('player', ['e1', 'e2'])],
    })
    expect(makeQuiescent(evaluate, { nodes: 0 })(s, 'player')).toBe(evaluate(s, 'player'))
  })

  it('is pure: scoring does not touch the state it was given', () => {
    const s = state({
      cards,
      players: {
        player: player({ units: [unit('u1', 'SMALL')] }),
        opponent: player({ units: [unit('e1', 'BIG'), unit('e2', 'SMALL')] }),
      },
      pendingChoices: [defeatChoice('player', ['e1', 'e2'])],
    })
    const before = JSON.stringify(s)
    quiescent(s, 'player')
    expect(JSON.stringify(s)).toBe(before)
  })
})

/**
 * The blunder that sized this ticket. `selectUniqueUnitToDefeat` accounted for 3615 of our owed
 * answers: playing a second copy of a unique raises a MANDATORY defeat, and greedy scored the board
 * with both copies still on it. A duplicate 3/3 read about 13 points too high, so the bot paid a real
 * card for a unit it was immediately forced to defeat.
 */
describe('greedy no longer pays for a duplicate unique', () => {
  const dupCards = {
    ...CARDS,
    UNIQ: card({ id: 'UNIQ', name: 'Unique Unit', type: 'unit', arena: 'ground', cost: 2, power: 3, hp: 3, unique: true }),
    OTHER: card({ id: 'OTHER', name: 'Other Unit', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }),
  }

  // Only one play is affordable, and the unit already out is exhausted so no attack competes.
  const position = (): GameState => state({
    cards: dupCards,
    players: {
      player: player({ hand: ['UNIQ', 'OTHER'], resources: ready(2), units: [unit('u1', 'UNIQ', { exhausted: true })] }),
      opponent: player(),
    },
  })

  it('plays the second unit rather than the duplicate it must then defeat', () => {
    expect(greedyAi(position())).toMatchObject({ type: 'playUnit', handIndex: 1 })
  })

  /**
   * The control picking the duplicate is what makes the test above evidence rather than an
   * assertion of the obvious. If `greedy-flat` ever stops falling for this, the A/B it exists for
   * has quietly lost its subject.
   */
  it('the same AI without quiescence still falls for it, which is the measurement', () => {
    expect(greedyFlatAi(position())).toMatchObject({ type: 'playUnit', handIndex: 0 })
  })

  /**
   * The weight tuner builds its own AI from candidate weights, so it can silently drift from the
   * shipped one: it did exactly that the moment quiescence landed, and would have spent a night
   * tuning weights for a bot nobody plays. One factory builds both, and this pins that it composes
   * quiescence rather than just the evaluation.
   */
  it('builds the tuner’s candidate the same way as the shipped bot', () => {
    expect(makeTunedGreedy(DEFAULT_WEIGHTS)(position())).toMatchObject({ type: 'playUnit', handIndex: 1 })
  })

  it('scores the duplicate below simply passing, because it is a card for nothing', () => {
    const s = position()
    const play = (handIndex: number): number => quiescent(resolve(s, { type: 'playUnit', handIndex }), 'player')
    expect(play(1)).toBeGreaterThan(play(0))
    expect(play(0), 'a card spent for no board').toBeLessThan(evaluate(s, 'player'))
  })
})
