import { describe, it, expect } from 'vitest'
import { publicScore, initiativeValue, makeEvaluate, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { role } from '../ai/race'
import { makeGreedyAi } from '../ai/greedyAi'
import '../engine/cardDefinitions'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState, PlayerId } from '../engine/types'

/**
 * What the initiative is worth, and what claiming it costs (#394).
 *
 * `evaluate` read neither `initiative` nor `initiativeTakenBy`, so the AI had no representation of
 * it whatsoever: 20.7% of 5651 offers tied with the best move and were settled by a coin flip. It
 * declined a cheap claim 2 times in 3 (474 chances, 148 taken) and made 465 expensive ones, each
 * forfeiting an average of 2.5 developing actions.
 *
 * Both halves are PUBLIC, so this lives in `publicScore` and is allowed to outrank other moves,
 * which it must be to ever justify giving up a turn. That is the opposite of #393's hand value,
 * which is hidden information and therefore bounded to a tie-break.
 *
 * The cost model matters more than the bonus. Claiming ALWAYS forfeits the rest of your round
 * (`advanceTurn` skips the claimant); what varies is whether the opponent gets a free run at you.
 * Claiming into a passed opponent ends the phase outright (`takeInitiative` calls `enterRegroup`
 * when `consecutivePasses >= 1`), so nobody gets anything more and the claim is cheap. The ticket
 * calls that case "costs nothing", which is not quite right: you still lose your own remaining
 * actions.
 */
const C = {
  ...CARDS,
  BODY: card({ id: 'BODY', name: 'Body', type: 'unit', arena: 'ground', cost: 2, power: 3, hp: 4, aspects: ['Command'], rarity: 'Common' }),
}

const units = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => unit(`${prefix}${i}`, 'BODY', { arena: 'ground' }))

/**
 * An action-phase board with `mine` / `theirs` ready units a side. Leaders are marked spent so a
 * deploy never competes with the decision under test.
 */
function board(over: Partial<GameState> = {}, mine = 0, theirs = 0): GameState {
  const spentLeader = { cardId: 'TST_L', deployed: false, epicActionUsed: true, exhausted: true }
  return state({
    phase: 'action',
    activePlayer: 'player',
    cards: C,
    players: {
      player: player({ leader: spentLeader, resources: ready(6), units: units('u', mine) }),
      opponent: player({ leader: spentLeader, resources: ready(6), units: units('e', theirs) }),
    },
    ...over,
  })
}

const held = (who: PlayerId, over: Partial<GameState> = {}, mine = 0, theirs = 0): GameState =>
  ({ ...board(over, mine, theirs), initiative: who })

describe('initiativeValue', () => {
  it('is worth having: holding it beats not holding it', () => {
    expect(initiativeValue(held('player'), 'player', DEFAULT_WEIGHTS))
      .toBeGreaterThan(initiativeValue(held('opponent'), 'player', DEFAULT_WEIGHTS))
  })

  it('is antisymmetric, so the public score stays zero-sum', () => {
    const s = held('player', { initiativeTakenBy: 'player' }, 3)
    expect(initiativeValue(s, 'player', DEFAULT_WEIGHTS)).toBe(-initiativeValue(s, 'opponent', DEFAULT_WEIGHTS))
  })

  /** The judgement: what you give up scales with what you still had to do. */
  it('charges more for claiming with a board of ready units than with none', () => {
    const busy = initiativeValue(held('player', { initiativeTakenBy: 'player' }, 4), 'player', DEFAULT_WEIGHTS)
    const idle = initiativeValue(held('player', { initiativeTakenBy: 'player' }, 0), 'player', DEFAULT_WEIGHTS)
    expect(busy).toBeLessThan(idle)
  })

  /**
   * The cheap window, arrived at without hardcoding CR 1.15.5c: a claim that ends the phase leaves
   * the state in regroup, where nobody has actions left to forfeit.
   */
  it('charges nothing once the phase has ended', () => {
    const claimed = { initiativeTakenBy: 'player' as const }
    const midPhase = initiativeValue(held('player', { ...claimed, phase: 'action' }, 4), 'player', DEFAULT_WEIGHTS)
    const phaseOver = initiativeValue(held('player', { ...claimed, phase: 'regroup' }, 4), 'player', DEFAULT_WEIGHTS)
    expect(phaseOver).toBeGreaterThan(midPhase)
  })

  it('charges the opponent when THEY are the ones sitting out', () => {
    const theyClaimed = initiativeValue(held('opponent', { initiativeTakenBy: 'opponent' }, 0, 3), 'player', DEFAULT_WEIGHTS)
    const nobodyClaimed = initiativeValue(held('opponent', {}, 0, 3), 'player', DEFAULT_WEIGHTS)
    expect(theyClaimed, 'their claim hands us the rest of the round').toBeGreaterThan(nobodyClaimed)
  })
})

describe('the greedy AI weighs the claim against what it forfeits', () => {
  const ai = makeGreedyAi(makeEvaluate(DEFAULT_WEIGHTS))

  /** Nothing to do and the opponent has passed: claiming is the whole point of the phase ending. */
  it('claims when the opponent has passed and it has nothing left to do', () => {
    const s = board({ initiative: 'opponent', consecutivePasses: 1 }, 0)
    expect(ai(s)?.type).toBe('takeInitiative')
  })

  /** A board of ready attackers is worth more than turn order: develop instead. */
  it('does not claim mid-phase while it still has attacks to make', () => {
    expect(ai(board({ initiative: 'opponent' }, 3, 1))?.type).not.toBe('takeInitiative')
  })
})

describe('the public half stays well formed', () => {
  /**
   * Zero-sum holds while both seats read the same ROLE (#395 bends the weights otherwise, on
   * purpose). Equal boards keep both neutral, so the initiative terms are tested against the
   * invariant rather than against role asymmetry.
   */
  it('is zero-sum with the initiative terms, including a one-sided claim', () => {
    const s = held('player', { initiativeTakenBy: 'player' }, 3, 3)
    expect(role(s, 'player')).toBe('neutral')
    expect(publicScore(s, 'player') + publicScore(s, 'opponent')).toBe(0)
  })

  /** The tie-break guarantee from #393: `publicScore` must stay integer-valued. */
  it('keeps every public weight an integer', () => {
    for (const [name, value] of Object.entries(DEFAULT_WEIGHTS)) {
      if (name === 'hand') continue // the private half, deliberately fractional
      expect(Number.isInteger(value), `${name} = ${String(value)}`).toBe(true)
    }
  })
})
