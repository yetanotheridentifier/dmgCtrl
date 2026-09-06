import { describe, it, expect } from 'vitest'
import { loadReport, replay } from './helpers/replayReport'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { opponentAi } from '../config'
import '../engine/cardDefinitions'

/**
 * **The AI crashes with a stack overflow choosing a move (#571).**
 *
 * From a real game: the #558 overnight A/B dropped 8 of 3,360 games this way, and the same games threw
 * for both arms at the same seeds, so it is the engine rather than any evaluation weight.
 *
 * ## Why it is a crash rather than a slow turn
 *
 * `playGame` wraps its loop in `try`/`catch`, so the bench records a `threw` and moves on. **The app
 * has no error boundary and `useGame` calls the AI synchronously on the UI thread**, so the same
 * position takes the React tree down and loses a real player's game in progress.
 *
 * ## The mechanism
 *
 * The engine asks "would this triggered ability change anything right now?" by **running it and seeing
 * whether the board came back different** (`inertNow` in `triggerQueue.ts`). Effects are pure, so the
 * probed board is discarded and only the yes/no kept. That is what lets a card state an unmet
 * condition by returning the state it was given, with no per-card declaration to drift.
 *
 * The flaw is that **running an ability for the probe can queue more triggers, and each of those is
 * probed the same way**, so every probe nests a full drain inside it:
 *
 *     fireUpgradeAttached -> fireBatch -> drainTriggers -> filter(inertNow)
 *       -> runPendingTrigger -> runEffect -> effect -> giveToken -> giveTokens -> (round again)
 *
 * On an ordinary board that bottoms out at once. Here it does not.
 *
 * ## What this test asserts
 *
 * That the bot can pick a move at all. It deliberately does **not** assert which move: the fix is
 * about not crashing, and pinning the choice would make this fail on any unrelated evaluation change
 * while saying nothing about the defect.
 */

describe('choosing a move on a trigger-dense board', () => {

  const report = loadReport('triggerProbeOverflow')

  /** The fixture has to reach a live position, or the rest proves nothing. */
  it('replays to a position with the game still running', () => {
    const end = replay(report)
    expect(end.winner, 'the game must still be live').toBeNull()
    expect(legalMoves(end).length, 'and there must be something to decide').toBeGreaterThan(0)
  })

  /**
   * **The defect.** The shipped AI is the one the app runs, so this is the configuration that matters.
   */
  it('does not overflow the stack', () => {
    const end = replay(report)
    expect(() => opponentAi(end)).not.toThrow()
  })

  /** And the move it picks must be playable, so "returned something" is not passing on a null. */
  it('returns a move the engine accepts', () => {
    const end = replay(report)
    const move = opponentAi(end)
    expect(move).not.toBeNull()
    expect(() => resolve(end, move!)).not.toThrow()
  })
})
