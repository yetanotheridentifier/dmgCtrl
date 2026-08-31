import { describe, it, expect } from 'vitest'
import { loadReport, replay, replayUpTo } from './helpers/replayReport'
import '../engine/cardDefinitions'

/**
 * **A card resourced by an ability arrives exhausted.**
 *
 * **CR 1.7.7**: "If an ability instructs a player to resource a card, the card is placed facedown and
 * exhausted in that player's resource zone unless otherwise specified. The card is not considered
 * 'played' and no 'When Played' abilities trigger."
 *
 * Reported from live play: Long Live the Empire (ASH_103, "Defeat a friendly Imperial unit. If you do,
 * resource the top card of your deck") handed over a **ready** resource, so the ramp paid for itself
 * the same action instead of the next round.
 *
 * Two cards in ASH reach this path and **neither says otherwise**, so the default applies to both:
 * Long Live the Empire and The Armorer (ASH_001). The two other resource-facing cards are explicit and
 * unaffected: Emperor's Messenger readies a resource, Mandalorian Scout exhausts one.
 *
 * Asserted here against the board it was reported on rather than only against the card, because a
 * card's behaviour is a property of the card plus everything else in play. The synthetic cases in
 * `eventEffects.test.ts` and `leaderAbilities.test.ts` pin the rule itself for both cards.
 */

/** The move index of `playEvent` (Long Live the Empire) and the defeat that pays for it. */
const BEFORE_THE_EVENT = 14
const AFTER_THE_DEFEAT = 16

const report = loadReport('rampResourceReady')

describe('the reported game where a ramped resource came in ready', () => {
  it('replays to the point where the event resources a card', () => {
    const before = replayUpTo(report, BEFORE_THE_EVENT)
    const after = replayUpTo(report, AFTER_THE_DEFEAT)
    expect(after.players.player.resources.length, 'the event added one')
      .toBe(before.players.player.resources.length + 1)
  })

  /**
   * **The defect.** The card the ability put into the pool is the one that arrived ready. Read as the
   * newest entry rather than by card id, since the pool legitimately holds duplicates.
   */
  it('places the ramped card exhausted (CR 1.7.7)', () => {
    const pool = replayUpTo(report, AFTER_THE_DEFEAT).players.player.resources
    expect(pool[pool.length - 1].exhausted, 'an ability resourced it, so it enters exhausted').toBe(true)
  })

  /**
   * The tempo consequence the reporter actually noticed, stated so it can only pass for the right
   * reason: every resource added by the ability is exhausted, so the ready count moves by what was
   * SPENT and nothing else.
   *
   * A first attempt compared ready counts before and after and passed with the defect still present:
   * the event exhausts 2 to pay for itself and the bug adds 1, so the total falls either way. Kept as
   * a reminder that a passing assertion about a total is not an assertion about the part that changed.
   */
  it('adds nothing to what the player can spend this action', () => {
    const pool = replayUpTo(report, AFTER_THE_DEFEAT).players.player.resources
    const before = replayUpTo(report, BEFORE_THE_EVENT).players.player.resources
    const added = pool.slice(before.length)
    expect(added.length, 'the ability added exactly one').toBe(1)
    expect(added.every(r => r.exhausted), 'and none of it is spendable now').toBe(true)
  })

  /** The rest of the recorded game still replays, so the fix changes only what it should. */
  it('replays the whole report without diverging', () => {
    expect(() => replay(report)).not.toThrow()
  })
})
