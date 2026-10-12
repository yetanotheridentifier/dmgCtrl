import { describe, it, expect } from 'vitest'
import { loadReport, replayUpTo } from './helpers/replayReport'
import { state, player, ready, CARDS } from './helpers/engineFixtures'
import { SET_CODES, poolFor } from '../bench/setPools'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { payable } from '../engine/payment'
import { pushChoice } from '../engine/types'
import '../engine/cardDefinitions' // side-effect: registers every implemented card
import type { Action } from '../engine/actions'
import type { GameState, PendingChoice } from '../engine/types'

/**
 * **A "play a unit from your hand" choice is read against the board it is answered on.**
 *
 * The choice lists the hand units its controller could pay for when it was raised. Another of their
 * choices can be answered first and spend resources, so a listed unit may no longer be payable by the
 * time this one is answered. Only what can still be paid for is offered, and a choice with nothing
 * left to offer lapses, whether or not its card said "may".
 */

type HandPlay = Extract<PendingChoice, { kind: 'playUnitFromHand' }>
const handPlay = (s: GameState): HandPlay | undefined =>
  (s.pendingChoices ?? []).find((c): c is HandPlay => c.kind === 'playUnitFromHand')
const answers = (s: GameState, choiceId: string): Action[] =>
  legalMoves(s).filter(a => 'choiceId' in a && a.choiceId === choiceId)

describe('the dropped game: a second Plot play spends what Fully Armed and Operational was counting on', () => {
  const ALL_CARDS = poolFor(SET_CODES)
  const report = loadReport('plotSpendsBeforePlayUnit')
  /**
   * Move 95 deploys Chancellor Palpatine, whose Plot offer covers two cards in the opponent's
   * resources. Move 96 plays Fully Armed and Operational out of them, which asks for a unit from hand.
   * Move 97 answers the Plot offer again before that, playing Garindan for 2. Move 98, the last
   * recorded, answers Fully Armed and Operational with Loan Shark.
   */
  const FIRST_PLOT = 96
  const SECOND_PLOT = 97
  const LOAN_SHARK = { handIndex: 0, cardId: 'SEC_222' }
  const ISB_AGENT = { handIndex: 3, cardId: 'SEC_184' }
  const after = (move: number): GameState => replayUpTo(report, move + 1, ALL_CARDS)

  it('raises the choice with four resources ready, listing Loan Shark (4) and ISB Agent (1)', () => {
    expect(report.moves[FIRST_PLOT]).toMatchObject({ by: 'opponent', action: { type: 'acceptChoice', choiceId: 'u16-plot' } })
    const s = after(FIRST_PLOT)
    expect(payable(s, 'opponent')).toBe(4)
    expect(handPlay(s)).toMatchObject({ id: 'ev17', controller: 'opponent', candidates: [LOAN_SHARK, ISB_AGENT] })
    expect(handPlay(s)!.optional).toBeUndefined()
    expect(s.cards.SEC_222).toMatchObject({ name: 'Loan Shark', cost: 4 })
    expect(s.cards.SEC_184).toMatchObject({ name: 'ISB Agent', cost: 1 })
  })

  it('leaves two ready once Garindan is played out of the resources, with the choice still waiting', () => {
    expect(report.moves[SECOND_PLOT]).toMatchObject({ by: 'opponent', action: { type: 'acceptChoice', choiceId: 'u16-plot' } })
    const s = after(SECOND_PLOT)
    expect(s.players.opponent.units.map(u => s.cards[u.cardId].name)).toContain('Garindan')
    expect(payable(s, 'opponent')).toBe(2)
    expect(handPlay(s)).toMatchObject({ id: 'ev17', candidates: [LOAN_SHARK, ISB_AGENT] })
  })

  it('no longer offers Loan Shark, and still offers ISB Agent', () => {
    const s = after(SECOND_PLOT)
    expect(report.moves[SECOND_PLOT + 1].action).toEqual({ type: 'acceptChoice', choiceId: 'ev17', handIndex: LOAN_SHARK.handIndex })
    expect(answers(s, 'ev17')).toEqual([{ type: 'acceptChoice', choiceId: 'ev17', handIndex: ISB_AGENT.handIndex }])
  })

  it('offers only moves that resolve', () => {
    const s = after(SECOND_PLOT)
    const moves = legalMoves(s)
    expect(moves.length).toBeGreaterThan(0)
    for (const move of moves) expect(() => resolve(s, move), JSON.stringify(move)).not.toThrow()
  })
})

describe('a play-a-unit-from-hand choice answered after its controller has spent resources', () => {
  /** `TST_U1` and `TST_U2` cost 2 each. The choice was raised while both could be paid for. */
  const board = (readyResources: number, choice: Partial<HandPlay> = {}, hand = ['TST_U1', 'TST_E1', 'TST_U2']): GameState =>
    pushChoice(state({ cards: CARDS, players: { player: player({ hand, resources: ready(readyResources) }), opponent: player() } }), {
      kind: 'playUnitFromHand', id: 'ask', controller: 'player', costDelta: 0, entersReady: false,
      candidates: [{ handIndex: 0, cardId: 'TST_U1' }, { handIndex: 2, cardId: 'TST_U2' }],
      ...choice,
    })
  const play = (handIndex: number): Action => ({ type: 'acceptChoice', choiceId: 'ask', handIndex })
  const skip: Action = { type: 'skipTrigger', choiceId: 'ask' }

  it('offers every listed unit, and no way out of a mandatory play, while they can all be paid for', () => {
    expect(answers(board(2), 'ask')).toEqual([play(0), play(2)])
  })

  it('reads the price the choice plays at, not the printed one', () => {
    expect(answers(board(1, { costDelta: -1 }), 'ask')).toEqual([play(0), play(2)])
    expect(answers(board(1, { costDelta: 0 }), 'ask')).toEqual([skip])
  })

  it('lets a mandatory play lapse when nothing listed can be paid for any more', () => {
    const s = board(1)
    expect(answers(s, 'ask')).toEqual([skip])
    const done = resolve(s, skip)
    expect(done.pendingChoices ?? []).toEqual([])
    expect(done.players.player.hand).toEqual(['TST_U1', 'TST_E1', 'TST_U2'])
    expect(done.players.player.units).toEqual([])
    expect(done.players.player.resources.every(r => !r.exhausted)).toBe(true)
  })

  it('keeps the decline of a "may", and offers nothing else, when nothing listed can be paid for', () => {
    expect(answers(board(1, { optional: true }), 'ask')).toEqual([skip])
    expect(answers(board(2, { optional: true }), 'ask')).toEqual([play(0), play(2), skip])
  })

  it('does not offer a hand slot that no longer holds the listed card', () => {
    // The hand has lost its first card since the raise, so slot 0 is the event and slot 2 is gone.
    expect(answers(board(2, {}, ['TST_E1', 'TST_U2']), 'ask')).toEqual([skip])
  })
})
