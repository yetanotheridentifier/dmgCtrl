import { describe, it, expect } from 'vitest'
import { OPPONENT_AI, opponentAi } from '../config'
import { resolveAi, aiNames } from '../ai/registry'

/**
 * The app's opponent is a DEPLOYMENT setting, not a user choice: `OPPONENT_AI` names the model the
 * build ships against, and shipping a new one is a one-line change here plus a redeploy. These tests
 * pin that the configured name is real (so a typo fails the build, not the user at runtime) and
 * record the current default.
 */
describe('deployment config', () => {
  it('names a registered AI', () => {
    expect(aiNames()).toContain(OPPONENT_AI)
  })

  it('resolves to that AI', () => {
    expect(opponentAi).toBe(resolveAi(OPPONENT_AI))
  })

  /**
   * Deliberately brittle. Changing the shipped model should fail this test and force the diff to be
   * reviewed, which is the whole point of keeping the setting a single reviewed constant.
   *
   * `beam` is one-ply greedy plus own-turn lookahead, and beats plain `greedy` 60.0% over three seeds
   * and 2580 games. It costs ~85 ms a decision, affordable because Sealed is a desktop browser app.
   */
  it('currently deploys the beam model', () => {
    expect(OPPONENT_AI).toBe('beam')
  })
})
