import { describe, it, expect } from 'vitest'
import { runDecisions } from '../bench/decisions'
import { resolveAi } from '../ai/registry'
import { makeBeamAi, lastSearchTrace, clearSearchTrace, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { evaluate } from '../ai/evaluate'
import { legalMoves } from '../engine/legalMoves'
import { state, player, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * The pass rate (#521).
 *
 * The complaint is behavioural: the bot passes far more than a competent player, for whom a single pass
 * is roughly a one-game-in-five-to-ten event. Nothing measured it. The harness reported how often
 * `pass` TIED for the lead, which is a property of the evaluation, and never how often it was actually
 * chosen, which is the thing being complained about.
 *
 * The distinctions are what make the number actionable rather than merely large:
 *
 * - **forced passes are not decisions** and are excluded. A rate diluted by them understates the defect
 *   exactly where the board is emptiest, which is where forced passes cluster.
 * - **ending a spent round** is the defensible pass and is separated from the rest.
 * - **passing with an attack available** is the one a human notices, and needs no model of the position
 *   to call wrong.
 */
describe('the pass rate', () => {
  const report = runDecisions({ gamesPerDeck: 1, seed: 4242, aiName: 'beam:4x2', deckLimit: 3 })
  const p = report.passes

  it('counts games and passes at all', () => {
    expect(p.games).toBeGreaterThan(0)
    expect(p.offered, 'passing must be on offer somewhere').toBeGreaterThan(0)
  })

  /** Every subdivision is drawn from the passes actually taken, so none may exceed it, and taken may
   *  not exceed the decisions where passing was a choice. */
  it('keeps its subsets inside their parents', () => {
    expect(p.taken).toBeLessThanOrEqual(p.offered)
    expect(p.endedPhase).toBeLessThanOrEqual(p.taken)
    expect(p.withAttackAvailable).toBeLessThanOrEqual(p.taken)
    expect(p.dominatedByClaim).toBeLessThanOrEqual(p.taken)
  })

  /**
   * A pass that is worse than claiming must also be one that ended the phase, because the condition for
   * it is that the opponent had already passed. If it ever exceeds `endedPhase` the window is being
   * detected on the wrong side of the resolve.
   */
  it('finds dominated passes only where the round was ending', () => {
    expect(p.dominatedByClaim).toBeLessThanOrEqual(p.endedPhase)
  })

  /**
   * The exclusion that matters most, and the one that was wrong first time.
   *
   * A forced pass has no alternative by definition, so it is not a decision. `endedPhase` was counting
   * them, since it only checked the action type and the phase change, and it exceeded `taken` as a
   * result: the phase-ending pass at the end of a spent round is very often the forced one. A rate
   * diluted by forced passes understates the defect exactly where the board is emptiest.
   */
  it('separates forced passes from chosen ones', () => {
    expect(p.forced, 'a board with nothing to do must occur somewhere').toBeGreaterThan(0)
    expect(p.endedPhase, 'phase-ending passes are a subset of CHOSEN passes').toBeLessThanOrEqual(p.taken)
  })

  /**
   * The headline, asserted loosely and deliberately. This is a defect ticket, so the test pins that the
   * measurement is live and in a plausible range rather than pinning today's value, which is expected
   * to move and is the whole point of the work.
   */
  it('produces a per-game rate that is a real number', () => {
    const perGame = p.taken / p.games
    expect(Number.isFinite(perGame)).toBe(true)
    expect(perGame).toBeGreaterThanOrEqual(0)
  })

  /**
   * Mid-round and round-ending partition the chosen passes. A pass either ends the round or it does
   * not, so if these ever overlap the two are being read at different moments.
   */
  it('splits mid-round from round-ending without overlap', () => {
    expect(p.midRound + p.endedPhase).toBeLessThanOrEqual(p.taken)
    expect(p.midRound).toBeGreaterThan(0)
  })
})

/**
 * The charge against passing (#521).
 *
 * A penalty that quietly did nothing would look identical to a fix that did not help, and the sweep
 * would spend a night finding a flat curve. So the property asserted is that it MOVES the decision, and
 * that the direction is the one intended.
 */
describe('the pass penalty', () => {
  /** Our turn, nothing has been passed or claimed, and there is a real action available alongside
   *  `pass`. The position where a discretionary pass is the defect. */
  const board = (): GameState => state({
    cards: CARDS,
    phase: 'action',
    activePlayer: 'player',
    consecutivePasses: 0,
    initiativeTakenBy: null,
    players: {
      player: player({ resources: ready(3), units: [unit('a', 'TST_U1')] }),
      opponent: player({ resources: ready(3), units: [unit('e', 'TST_U3')] }),
    },
  })

  const passValue = (passPenalty: number): number => {
    const s = board()
    const index = legalMoves(s).findIndex(m => m.type === 'pass')
    expect(index, 'the fixture must offer a pass').toBeGreaterThanOrEqual(0)
    clearSearchTrace()
    makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 200_000, passPenalty })(s)
    return lastSearchTrace()!.candidates[index]
  }

  it('charges exactly what it says, and nothing when set to zero', () => {
    const free = passValue(0)
    expect(passValue(5)).toBeCloseTo(free - 5, 6)
    expect(passValue(20)).toBeCloseTo(free - 20, 6)
  })

  /** And charges only `pass`. A penalty leaking onto other candidates would shift every score by the
   *  same amount and change nothing, which is the failure that looks most like "it does not work". */
  it('leaves every other candidate untouched', () => {
    const s = board()
    const values = (passPenalty: number): number[] => {
      clearSearchTrace()
      makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 200_000, passPenalty })(s)
      return lastSearchTrace()!.candidates
    }
    const passIndex = legalMoves(s).findIndex(m => m.type === 'pass')
    const free = values(0)
    const charged = values(8)
    charged.forEach((v, i) => {
      if (i !== passIndex) expect(v, `candidate ${i} must not move`).toBeCloseTo(free[i], 6)
    })
  })

  it('is addressable from a name, so a sweep needs no registry entry', () => {
    expect(() => resolveAi('beam-reply/pass=4')).not.toThrow()
    expect(() => resolveAi('beam-reply/pass=0.5')).not.toThrow()
    expect(() => resolveAi('nonsense/pass=4')).toThrow()
  })

  /**
   * The shipped bot charges 8, and the pre-fix bot stays nameable.
   *
   * Both halves matter. The first pins the deployed value, so folding the charge into
   * `BEAM_REPLY_LIMITS` cannot be silently undone. The second keeps a control available without a
   * registry entry: every future A/B against this change is `beam-reply/pass=0`, and if that stopped
   * differing from the shipped bot the control would quietly become the arm.
   */
  it('ships charged, with the pre-fix bot still addressable', () => {
    const s = board()
    const trace = (name: string): number[] => {
      clearSearchTrace()
      resolveAi(name)(s)
      return lastSearchTrace()!.candidates
    }
    expect(trace('beam-reply/pass=8'), 'the shipped charge is 8').toEqual(trace('beam-reply'))
    expect(trace('beam-reply/pass=0'), 'the control must differ from the arm').not.toEqual(trace('beam-reply'))
  })
})
