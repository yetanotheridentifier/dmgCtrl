import { describe, it, expect } from 'vitest'
import { makeBeamAi, lastSearchTrace, clearSearchTrace } from '../ai/search'
import { BEAM_REPLY_LIMITS } from '../ai/greedyAi'
import { evaluate } from '../ai/evaluate'
import { legalMoves } from '../engine/legalMoves'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Where a "while attacking" debuff goes (#509).
 *
 * Reported: the bot attached Pointless to Resist, "attached unit gets -3/-0 while attacking a base", to
 * its own freshly played unit instead of an enemy.
 *
 * **The first explanation was wrong.** It said the board term sums `effectivePower` with no context, so
 * `ctx.attackingBase` is false, the -3 is invisible and both targets score alike. That describes a
 * ONE-PLY scorer. The shipped bot searches three of its own actions and plays the attack out, and the
 * engine applies the -3 when the attack resolves, so the search sees what the static term misses.
 * Measured over 126 games, debuffs went onto an enemy unit 5 times out of 5.
 *
 * The residual case is what these tests pin: the search only sees the penalty if the host can actually
 * ATTACK inside the horizon. A unit played this action is exhausted and cannot, so the downside never
 * materialises and the tie is real. That is the position in the report, where the Scout had just been
 * played.
 */

const cards = {
  ...CARDS,
  // The real card id, so the registered `statModifier` from `cardDefinitions.ts` applies rather than a
  // reimplementation of it here. Stats come from the fixture; the conditional comes from the registry.
  ASH_054: card({ id: 'ASH_054', type: 'upgrade', cost: 1, power: 0, hp: 0 }),
}

/** Our unit and theirs are the same card, so the only difference between the two targets is whose it
 *  is. Anything else would let a stat difference explain the result instead. */
const board = (ourUnitExhausted: boolean): GameState => state({
  cards,
  phase: 'action',
  activePlayer: 'player',
  players: {
    player: player({
      hand: ['ASH_054'],
      resources: ready(3),
      units: [unit('a', 'TST_U1', { exhausted: ourUnitExhausted })],
    }),
    opponent: player({ units: [unit('e', 'TST_U1')] }),
  },
})

/** What the search valued attaching the debuff to each unit at. */
function values(s: GameState): { ours: number; theirs: number } {
  const moves = legalMoves(s)
  const ourIndex = moves.findIndex(m => m.type === 'playUpgrade' && m.targetInstanceId === 'a')
  const theirIndex = moves.findIndex(m => m.type === 'playUpgrade' && m.targetInstanceId === 'e')
  expect(ourIndex, 'attaching to our unit must be legal').toBeGreaterThanOrEqual(0)
  expect(theirIndex, 'attaching to their unit must be legal').toBeGreaterThanOrEqual(0)
  clearSearchTrace()
  makeBeamAi(evaluate, { ...BEAM_REPLY_LIMITS, nodes: 200_000 })(s)
  const c = lastSearchTrace()!.candidates
  return { ours: c[ourIndex], theirs: c[theirIndex] }
}

describe('attaching a while-attacking debuff', () => {
  /**
   * With a READY host the search can attack with it, so the -3 is applied by the engine during the
   * search and the two targets separate. This is why the measured rate is 5 of 5 onto enemies rather
   * than the coin flip originally predicted.
   */
  it('prefers the enemy when our unit could attack', () => {
    const v = values(board(false))
    expect(v.theirs).toBeGreaterThan(v.ours)
  })

  /**
   * **And still prefers the enemy when our unit is exhausted**, which refutes the obvious follow-up
   * explanation as well as the first one.
   *
   * The reasoning that failed: a unit played this action is exhausted, cannot attack inside the
   * horizon, so the -3 never materialises and the targets tie. Measured, they do not: 4 against 16.
   *
   * The benefit is on the OTHER side of the board. Attaching the debuff to an enemy unit weakens
   * *their* attack, and the pessimistic reply plays their attack out, so the search sees that gain
   * whatever the state of our own unit. The separation never depended on our unit attacking at all.
   *
   * So the reported position is still unexplained, and it is not either of these. Two failed
   * explanations is the point at which this project stops reasoning and walks the replay attached to
   * the report.
   */
  it('still prefers the enemy when our unit is exhausted', () => {
    const v = values(board(true))
    expect(v.theirs).toBeGreaterThan(v.ours)
  })

  /**
   * **And ties when NOTHING can attack**, which is the reported position and the precise condition for
   * the defect.
   *
   * With every relevant unit exhausted the -3 cannot materialise on either side inside the horizon, so
   * the board term, which sums power with no context, sees two identical boards. The tie-break does not
   * rescue it either: the second opinion is an optimistic search where the opponent does nothing, so a
   * debuff on an enemy unit shows no effect there.
   *
   * The narrowness matters for what to do about it. It is not "the model cannot see conditional
   * modifiers" in general, it is "it cannot see them when the moment they apply is past the horizon",
   * which is the same wall that cost 3.72 points to try to move.
   */
  it('cannot tell the difference when neither side can attack', () => {
    const stalled = ((): GameState => {
      const s = board(true)
      return {
        ...s,
        players: {
          ...s.players,
          opponent: { ...s.players.opponent, units: s.players.opponent.units.map(u => ({ ...u, exhausted: true })) },
        },
      }
    })()
    const v = values(stalled)
    expect(v.ours).toBe(v.theirs)
  })
})
