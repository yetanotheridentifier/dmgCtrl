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
   * `beam-reply` is own-turn lookahead with the opponent's minimising reply at every level. It beats
   * plain `beam` 67.4% over three seeds and 2580 games, at ~143 ms a decision, which a desktop
   * browser absorbs.
   */
  it('currently deploys the beam-reply model', () => {
    expect(OPPONENT_AI).toBe('beam-reply')
  })

  /** A shipped model needs a stable name, not a spec string: `resolveAi` accepts parameterised forms
   *  like `reply:pessimistic:4x3`, but those are for sweeps and would not appear here. */
  it('ships a named model rather than a sweep spec', () => {
    expect(aiNames()).toContain(OPPONENT_AI)
  })
})
