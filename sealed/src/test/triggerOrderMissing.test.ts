import { describe, it, expect } from 'vitest'
import { loadReport, replayUpTo } from './helpers/replayReport'
import { resolve } from '../engine/resolve'
import type { GameState, PlayerId } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * **Both trigger-order prompts, on the board they were reported missing from.**
 *
 * An upgraded Ant Droid attacked a Reanimated Night Trooper and both died. The player was offered
 * neither the who-resolves-first choice (CR 7.6.10) nor an ordering for their own two When Defeated
 * abilities (CR 7.6.9).
 *
 * The cause was the substrate. Ordering was raised from the pending-CHOICE queue, but the rules order
 * triggered **abilities**, and most abilities resolve without asking the player anything:
 *
 * | ability | effect | raises a choice? |
 * | --- | --- | --- |
 * | Ant Droid (ASH_116) | draw a card | no |
 * | Warrior's Legacy (ASH_134) | create a Mandalorian token | no |
 * | Reanimated Night Trooper (ASH_045) | look at a deck top, may discard | yes |
 *
 * So the player held two abilities and zero choices, the opponent held one of each, and the engine saw
 * only one side with anything pending. The player's two abilities had already fired, in dispatch order,
 * before any question could be asked.
 *
 * These assertions are the reported position rather than a synthetic one, because the diagnosis turned
 * on abilities that raise no choice, and a fixture built from cards that all raise one would pass
 * against the broken engine.
 */

/** The move index of `attack u5 -> u2`: the upgraded Ant Droid into the Night Trooper. */
const AFTER_THE_TRADE = 38
/** The same game one move earlier, for the counts the trade must not yet have changed. */
const BEFORE_THE_TRADE = 37

const ANT_DROID = 'ASH_116'
const WARRIORS_LEGACY = 'ASH_134'

const report = loadReport('triggerOrderNotOffered')
const before = (): GameState => replayUpTo(report, BEFORE_THE_TRADE)
const traded = (): GameState => replayUpTo(report, AFTER_THE_TRADE)

const tokens = (s: GameState, side: PlayerId): number =>
  s.players[side].units.filter(u => u.cardId.startsWith('TOKEN')).length

/** Answer a choice by id, taking option `optionIndex`. */
const accept = (s: GameState, choiceId: string, optionIndex = 0): GameState =>
  resolve(s, { type: 'acceptChoice', choiceId, optionIndex })

describe('the reported position: an upgraded Ant Droid trades with a Night Trooper', () => {
  it('replays to the trade', () => {
    const board = traded()
    expect(board.winner).toBeNull()
    expect(board.players.player.units.find(u => u.instanceId === 'u5'), 'the Ant Droid died').toBeUndefined()
    expect(board.players.opponent.units.find(u => u.instanceId === 'u2'), 'the Trooper died').toBeUndefined()
  })

  /**
   * **The defect, stated as the thing that must no longer happen.** Both of the player's abilities used
   * to resolve before anything could be asked, so the ordering question had nothing left to order.
   */
  it('resolves none of the abilities until the order is settled', () => {
    const board = traded()
    expect(tokens(board, 'player'), "Warrior's Legacy has not made its token yet").toBe(tokens(before(), 'player'))
    expect(board.players.player.hand.length, 'the Ant Droid has not drawn yet').toBe(before().players.player.hand.length)
  })

  /** CR 7.6.10, and it leads the queue because answering anything else settles the order by accident. */
  it('asks the active player which side resolves first', () => {
    const queue = traded().pendingChoices ?? []
    expect(queue[0]?.kind).toBe('chooseTriggerOrder')
    expect(queue[0]?.controller, 'the ACTIVE player decides, not the initiative holder').toBe('player')
  })

  describe('having chosen to resolve first', () => {
    const mine = (): GameState => {
      const board = traded()
      return accept(board, board.pendingChoices!.find(c => c.kind === 'chooseTriggerOrder')!.id, 0)
    }

    /** CR 7.6.9: two abilities on cards they control, so the order is theirs. */
    it('offers the order of its own two abilities, naming each source card', () => {
      const ask = (mine().pendingChoices ?? []).find(c => c.kind === 'chooseNextTrigger')
      expect(ask, 'the second prompt the report expected').toBeDefined()
      expect(ask!.controller).toBe('player')
      const sources = (ask as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId)
      expect(sources).toEqual(expect.arrayContaining([ANT_DROID, WARRIORS_LEGACY]))
      expect(sources).toHaveLength(2)
    })

    /**
     * **The opponent's ability is never on the list.** The active player picks which player goes first
     * and their own internal order, and nothing else (CR 7.6.10's worked example is explicit).
     */
    it('never offers the opponent\'s trigger among them', () => {
      const ask = (mine().pendingChoices ?? []).find(c => c.kind === 'chooseNextTrigger')!
      const sources = (ask as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId)
      expect(sources).not.toContain('ASH_045')
    })

    /**
     * **Our whole batch resolves before theirs** (CR 7.6.10: "resolves all abilities triggered on cards
     * they control ... and once they finish, the other player does the same").
     *
     * Which of our two ran first is deliberately not asserted here. Neither raises a choice, so once the
     * order is named there is no further decision and the engine resolves both without stopping: the
     * end state is identical either way. The ordering itself is observable only where an ability raises
     * a choice, which is what the synthetic CR 7.6.9 case in `nestedTriggerOrder.test.ts` covers.
     */
    it('resolves both of ours before the opponent gets theirs', () => {
      const asked = mine()
      const ask = (asked.pendingChoices ?? []).find(c => c.kind === 'chooseNextTrigger')!
      const candidates = (ask as { candidates: { cardId: string }[] }).candidates
      const ours = accept(asked, ask.id, candidates.findIndex(c => c.cardId === WARRIORS_LEGACY))

      expect(tokens(ours, 'player'), "Warrior's Legacy made its token").toBe(tokens(before(), 'player') + 1)
      expect(ours.players.player.hand.length, 'the Ant Droid drew').toBe(before().players.player.hand.length + 1)
      expect((ours.pendingChoices ?? []).some(c => c.kind === 'peekTopDiscard'), 'and only now is theirs offered')
        .toBe(true)
    })

    /** And the opponent's look-at waits until the player's side is clear. */
    it('holds the opponent\'s ability back until both of ours are done', () => {
      const asked = mine()
      expect((asked.pendingChoices ?? []).some(c => c.kind === 'peekTopDiscard'), "the Trooper's look-at waits")
        .toBe(false)
    })
  })
})
