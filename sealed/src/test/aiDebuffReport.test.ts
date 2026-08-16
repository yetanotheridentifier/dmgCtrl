import { describe, it, expect } from 'vitest'
import { makeBeamAi, lastSearchTrace, clearSearchTrace, DEFAULT_BEAM_LIMITS, type BeamLimits } from '../ai/search'
import { BEAM_REPLY_LIMITS } from '../ai/greedyAi'
import { evaluate } from '../ai/evaluate'
import { legalMoves } from '../engine/legalMoves'
import { loadReport, replayUpTo } from './helpers/replayReport'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * The reported position from #509, walked rather than reasoned about.
 *
 * Two explanations were offered for this report and both were refuted by tests written to confirm
 * them: that the board term is blind to a conditional debuff so the targets tie (measured 0 of 5 onto
 * our own units over 126 games), and that the tie appears when the host is exhausted and cannot attack
 * inside the horizon (measured 4 against 16, still separated). This project's rule is that two failed
 * explanations is where reasoning stops and the attached replay gets walked.
 *
 * Move 49 is `Opp Play Pointless to Resist (1) on Mandalorian Scout`. Replaying to 49 leaves the board
 * exactly as the bot saw it when it made that decision.
 *
 * **The bot is reconstructed as it shipped at the reported commit** (`d83afd8`, release 381), where
 * `beamReplyAi = makeBeamGreedy(DEFAULT_WEIGHTS, { ...DEFAULT_BEAM_LIMITS, reply: 'pessimistic' })` and
 * `DEFAULT_BEAM_LIMITS` carried no `chainNodes`. Against today's bot that is four differences: no
 * tie-break, no pass penalty, no per-chain allowance and no regroup redaction.
 *
 * The engine is current, not period-accurate, so an engine fix since the report (Sentinel arena
 * scoping, the search-count multiplier) applies to both sides of this comparison. That isolates the AI
 * changes, which is the question being asked; a fully period-accurate replay would need the old commit
 * checked out.
 */

/** The offending decision: the move index of `playUpgrade` onto the just-played Mandalorian Scout. */
const AT_THE_DECISION = 49

/** `beam-reply` exactly as it shipped at d83afd8. Weights are omitted deliberately: the price doubling
 *  since then is a scale change, and a linear evaluation's argmax is invariant under it. */
const AS_SHIPPED: BeamLimits = {
  width: 4, depth: 3, nodes: 10_000, reply: 'pessimistic', chainNodes: undefined, redactRegroup: false,
}

function candidates(s: GameState, limits: BeamLimits): { ours: number; best: number; chosen: string } {
  const moves = legalMoves(s)
  const ourIndex = moves.findIndex(m => m.type === 'playUpgrade' && m.targetInstanceId === 'u9')
  expect(ourIndex, 'attaching to our own Scout must be on offer').toBeGreaterThanOrEqual(0)
  clearSearchTrace()
  const chosen = makeBeamAi(evaluate, { ...limits, nodes: 200_000 })(s)
  const values = lastSearchTrace()!.candidates
  return {
    ours: values[ourIndex],
    best: Math.max(...values),
    chosen: chosen === null ? 'none' : `${chosen.type}${'targetInstanceId' in chosen ? ` -> ${String(chosen.targetInstanceId)}` : ''}`,
  }
}

describe('the reported debuff-on-own-unit position (#509)', () => {
  const report = loadReport('debuffOnOwnUnit')
  const board = replayUpTo(report, AT_THE_DECISION)

  /** Without this the rest is measuring some other position entirely. */
  it('replays to the decision the report is about', () => {
    expect(board.winner).toBeNull()
    expect(board.activePlayer, 'the bot is to move').toBe('opponent')
    const scout = board.players.opponent.units.find(u => u.instanceId === 'u9')
    expect(scout, 'the Scout must be in play and ours').toBeDefined()
    expect(scout!.exhausted, 'it was played this action, so it is exhausted').toBe(true)
    expect(board.players.opponent.hand, 'Pointless to Resist must still be in hand').toContain('ASH_054')
  })

  /**
   * The bot as it shipped when the report was filed. Whatever it does here is the behaviour the
   * reporter saw, so this is the assertion that says what actually went wrong.
   */
  it('records what the shipped bot did at the time', () => {
    const v = candidates(board, AS_SHIPPED)
    expect(Number.isFinite(v.ours)).toBe(true)
    expect(Number.isFinite(v.best)).toBe(true)
  })

  /**
   * And today's bot on the same board. The comparison is the point: if the current bot no longer rates
   * the friendly attachment at the lead, something shipped since has fixed it, and #509 closes on
   * evidence rather than on a rate measured elsewhere.
   */
  it('records what the current bot does', () => {
    const v = candidates(board, BEAM_REPLY_LIMITS)
    expect(Number.isFinite(v.ours)).toBe(true)
    expect(Number.isFinite(v.best)).toBe(true)
  })

  /**
   * **The defect, and the whole of it: the two targets score identically.**
   *
   * Read off the principal variation rather than inferred. Both peak at depth 1 on the attachment
   * itself, both at the same value, so nothing below separates them and the seeded pick decides. The
   * original diagnosis on the ticket was right; the two later refutations of it were mine, and both
   * came from positions where a unit involved could still attack.
   *
   * The condition is narrower than "the board term is blind". The blindness only BITES when neither
   * the host nor the enemy target can attack a base inside the horizon. Here every relevant unit is
   * exhausted, so the -3 cannot materialise on either side.
   *
   * That also explains why the tie-break does not save it: the second opinion is an OPTIMISTIC search
   * in which the opponent does nothing, so a debuff on an enemy unit has no visible effect there either.
   */
  it('scores attaching to our unit and to theirs identically', () => {
    const moves = legalMoves(board)
    clearSearchTrace()
    makeBeamAi(evaluate, { ...BEAM_REPLY_LIMITS, nodes: 200_000, explain: true })(board)
    const lines = lastSearchTrace()!.lines!
    const valueFor = (target: string): number => {
      const i = moves.findIndex(m => m.type === 'playUpgrade' && m.targetInstanceId === target)
      expect(i, `${target} must be a legal target`).toBeGreaterThanOrEqual(0)
      return lines[i].value
    }
    expect(valueFor('u9'), 'our own Scout against their Outland Protector').toBe(valueFor('u1'))
    expect(valueFor('u9'), 'and against their other unit').toBe(valueFor('u7'))
  })

  /**
   * **Nothing shipped since the report changes this decision.** Same value, same chosen move, under the
   * bot as it was and the bot as it is.
   *
   * Worth pinning because four separate things landed in between that might plausibly have helped: the
   * search tie-break, the pass penalty, the per-chain allowance and regroup redaction. None of them
   * touches a tie that exists because a conditional modifier is invisible to the board term.
   */
  /**
   * **The fix, asserted on the reported board itself.** With the tie policy on, the debuff goes to an
   * enemy unit instead of our own Scout.
   *
   * The policy only ranks candidates the search has already declared equal, so on this board it is
   * choosing between moves worth an identical 144.12. It cannot have overruled anything.
   */
  it('is fixed by the upgrade tie policy', () => {
    const fixed = candidates(board, { ...BEAM_REPLY_LIMITS, upgradeTie: true })
    expect(fixed.chosen).not.toBe('playUpgrade -> u9')
    expect(fixed.chosen, 'onto one of their units').toMatch(/playUpgrade -> u(1|7)$/)
  })

  it('was unchanged by everything else shipped since the report', () => {
    const then = candidates(board, AS_SHIPPED)
    // Today's bot with the tie policy switched off: the search tie-break, the pass charge, the
    // per-chain allowance and regroup redaction, all of which landed between the report and the fix.
    const withoutTheFix = candidates(board, { ...BEAM_REPLY_LIMITS, upgradeTie: false })
    expect(withoutTheFix.ours).toBe(then.ours)
    expect(withoutTheFix.chosen).toBe(then.chosen)
    expect(withoutTheFix.chosen, 'still on our own unit without the fix').toBe('playUpgrade -> u9')
    expect(DEFAULT_BEAM_LIMITS.depth).toBe(3)
  })
})
