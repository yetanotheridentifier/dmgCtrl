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

  it('currently deploys the greedy model', () => {
    expect(OPPONENT_AI).toBe('greedy')
  })
})
