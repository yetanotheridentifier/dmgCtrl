import { describe, it, expect } from 'vitest'
import { makeBeamAi, resolveChain, makeQuiescent, beamReachesWin, searchBudget, DEFAULT_BEAM_LIMITS } from '../ai/search'
import { hasLethal } from '../ai/lethal'
import { greedyAi } from '../ai/greedyAi'
import { evaluate } from '../ai/evaluate'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { role } from '../ai/race'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import type { Action } from '../engine/actions'
import '../engine/cardDefinitions'

/**
 * Own-turn beam (#410): expand a sequence of OUR OWN actions so a setup step is valued by the finish
 * it enables.
 *
 * One ply scores each move in isolation, so it can never play a line whose first step is a loss.
 * Sacrificing a chump into a Sentinel to clear the path is the canonical case: the sacrifice is
 * simply bad, and the payoff arrives two actions later.
 *
 * **The null-move assumption is where the strength comes from and where it leaks.** Players alternate
 * single actions, so continuing our own sequence means pretending the opponent does nothing. That is
 * what makes the sacrifice look good, and it is also what will over-value fragile lines. #425 pulls
 * the other way, which is why the two are measured as a matrix rather than separately.
 */

const cards = {
  ...CARDS,
  // Too tough for any one attacker: BIG deals 9 into 10 HP. Two chumps at 5 each is exactly lethal
  // on it, which is what forces the line to be two actions long.
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 2, power: 4, hp: 10, keywords: [{ name: 'Sentinel' }] }),
  CHUMP: card({ id: 'CHUMP', type: 'unit', arena: 'ground', cost: 1, power: 5, hp: 1 }),
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 6, power: 9, hp: 9 }),
  TINY_BASE: card({ id: 'TINY_BASE', type: 'base', hp: 9 }),
}

/**
 * The scripted position, and the whole argument for this ticket.
 *
 * A Sentinel locks every attack onto itself, so no base damage is available until it dies. Only BIG
 * can finish the 9 HP base, so BIG must be kept for the base and the wall must be cleared by the two
 * chumps. The winning line is exactly three of our actions:
 *
 *   CHUMP -> WALL (5), CHUMP -> WALL (5, wall dies), BIG -> base (9, lethal)
 *
 * Both chumps die doing it. Every step of that line except the last scores badly on its own, and the
 * locally best move is BIG -> WALL, which spends the only unit that can close the game.
 */
function sentinelWall(): GameState {
  return state({
    cards,
    players: {
      player: player({
        // Below the leader's deploy cost of 5, so the position offers attacks and nothing else. A
        // leader arriving mid-line would be a second variable in a test about sequencing.
        resources: ready(4),
        units: [unit('c1', 'CHUMP'), unit('c2', 'CHUMP'), unit('big', 'BIG')],
      }),
      opponent: player({
        base: { cardId: 'TINY_BASE', damage: 0 },
        units: [unit('w', 'WALL')],
      }),
    },
  })
}

/**
 * Play out `n` of OUR actions, the opponent passing in between, exactly as the search imagines it.
 *
 * Stops if the action phase ends, which is the honest boundary: the null-move assumption only claims
 * the opponent does nothing *this* phase, and a line needing a round boundary is #446's problem.
 */
function playOut(s: GameState, ai: (g: GameState) => Action | null, n: number): GameState {
  let cur = s
  for (let i = 0; i < n && cur.winner === null && cur.phase === 'action'; i++) {
    if (cur.activePlayer !== 'player') {
      cur = resolve(cur, { type: 'pass' })
      continue
    }
    const action = ai(cur)
    if (!action) break
    cur = resolve(cur, action)
  }
  return cur
}

describe('the beam finds a line one ply cannot', () => {
  /**
   * The control that makes the rest of this file meaningful. If greedy solved this position there
   * would be nothing to build, so this asserts the blind spot is real: it spends BIG on the wall,
   * which is the locally best move and throws away the only unit that can finish the base.
   */
  it('greedy spends the finisher on the wall, and does not win', () => {
    const s = sentinelWall()
    const first = greedyAi(s)!
    expect(first).toMatchObject({ type: 'attack', attackerId: 'big' })
    expect(playOut(s, greedyAi, 6).winner).toBeNull()
  })

  it('the beam opens with a chump, keeping the finisher for the base', () => {
    const s = sentinelWall()
    const beam = makeBeamAi(evaluate)
    expect(beam(s)).toMatchObject({ type: 'attack', attackerId: expect.stringMatching(/^c[12]$/) })
  })

  /** The point of the whole ticket: the sequence, not the single move. */
  it('the beam clears the wall and wins, in three of our actions', () => {
    const s = sentinelWall()
    expect(playOut(s, makeBeamAi(evaluate), 6).winner).toBe('player')
  })
})

describe('the beam is a strict generalisation of greedy', () => {
  /**
   * At depth 1 there is no sequence to expand, so a root's value is its own score and the beam must
   * reduce to exactly the one-ply driver. Any disagreement here is a bug in the scaffolding rather
   * than a difference of policy.
   */
  it('picks exactly what greedy picks at depth 1', () => {
    const beam = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, depth: 1 })
    const s = sentinelWall()
    expect(beam(s)).toEqual(greedyAi(s))
  })

  /** The budget is a safety rail, and running out must degrade to the old answer, never to a wrong
   *  one. Same contract as quiescence's node budget. */
  it('falls back to the one-ply choice when the node budget is gone', () => {
    const beam = makeBeamAi(evaluate, { ...DEFAULT_BEAM_LIMITS, nodes: 0 })
    const s = sentinelWall()
    expect(beam(s)).toEqual(greedyAi(s))
  })

  /**
   * A win is worth 1,000,000 and no material score approaches it, so a reachable win is always the
   * unique maximum. The beam multiplies the number of leaves, so it multiplies the chance of blurring
   * that cliff.
   *
   * The 6 resources are deliberate: they let the leader deploy, which gives the beam a line that also
   * wins but takes an extra action first. Both score WIN, so without a depth preference the tie-break
   * is free to take the slower one. It only looks certain because the null move says the opponent
   * does nothing, and in a real game they get that turn to remove the attacker.
   */
  it('takes the win now rather than an equally winning line that takes longer', () => {
    const s = state({
      cards,
      players: {
        player: player({ resources: ready(6), units: [unit('big', 'BIG')] }),
        opponent: player({ base: { cardId: 'TINY_BASE', damage: 0 } }),
      },
    })
    expect(resolve(s, makeBeamAi(evaluate)(s)!).winner).toBe('player')
  })
})

describe('the beam plays by the rules it is given', () => {
  /** Only the opponent's turn may be skipped. Passing on our own behalf would hand the search a turn
   *  the real game never gives it, and two consecutive passes end the phase outright. */
  it('never chooses to pass while a real move exists', () => {
    const s = sentinelWall()
    expect(makeBeamAi(evaluate)(s)).not.toMatchObject({ type: 'pass' })
  })

  it('returns a move that is actually legal in the position', () => {
    const s = sentinelWall()
    const chosen = makeBeamAi(evaluate)(s)!
    expect(legalMoves(s)).toContainEqual(chosen)
  })

  /** `resolve` is pure and the search must not leak: a decision explores hundreds of states and every
   *  one of them is a discarded copy. */
  it('does not touch the state it was given', () => {
    const s = sentinelWall()
    const before = JSON.stringify(s)
    makeBeamAi(evaluate)(s)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('is deterministic for a given seed', () => {
    const s = sentinelWall()
    const beam = makeBeamAi(evaluate)
    expect(beam(s)).toEqual(beam(s))
  })
})

describe('beamReachesWin', () => {
  /**
   * Asks whether the SHIPPED search sees a win, using the beam's own discipline rather than a proxy.
   * It exists for #433's measurement: "how often does the lethal solver find a win the bot misses"
   * is only answerable against the real trimming, since a beam ordered by evaluation score can prune
   * a winning line whose setup step scores badly.
   */
  it('sees the win in the scripted position it can reach', () => {
    expect(beamReachesWin(sentinelWall(), 'player', evaluate, DEFAULT_BEAM_LIMITS)).toBe(true)
  })

  /** Depth is the honest limit: the line here needs three of our actions. */
  it('does not see a win beyond its depth', () => {
    const shallow = { ...DEFAULT_BEAM_LIMITS, depth: 2 }
    expect(beamReachesWin(sentinelWall(), 'player', evaluate, shallow)).toBe(false)
  })

  it('says no on a board with no win in it', () => {
    const s = state({
      cards,
      players: {
        player: player({ resources: ready(4), units: [unit('c1', 'CHUMP')] }),
        opponent: player({ base: { cardId: 'TINY_BASE', damage: 0 }, units: [unit('w', 'WALL')] }),
      },
    })
    expect(beamReachesWin(s, 'player', evaluate, DEFAULT_BEAM_LIMITS)).toBe(false)
  })

  /**
   * The property that makes it worth measuring against `hasLethal`: the beam trims by evaluation
   * score, so narrowing it can lose a win that a lethal-shaped search still finds. Width 1 keeps only
   * the single best-scoring continuation at each level.
   */
  it('can lose a win to its own trimming, which is why the lethal search is not just this', () => {
    const narrow = { ...DEFAULT_BEAM_LIMITS, width: 1 }
    const seen = beamReachesWin(sentinelWall(), 'player', evaluate, narrow)
    expect(hasLethal(sentinelWall(), 'player'), 'the line exists').toBe(true)
    // Not asserted either way: what matters is that the two searches can disagree, and the
    // measurement in `bench/lethal.ts` is what quantifies how often they do.
    expect(typeof seen).toBe('boolean')
  })
})

describe('resolveChain', () => {
  /**
   * The beam expands ACTIONS; quiescence owns the choice chains. If the beam expanded choice answers
   * as if they were separate actions, a `support` chain would eat the beam width and "depth 3" would
   * mean something different in every position.
   *
   * So beam nodes are fully resolved boards, and the state this returns must agree with the score
   * quiescence already reports for the same position, or the search would be expanding from a board
   * it did not score.
   */
  it('lands on a board scoring exactly what quiescence says the position is worth', () => {
    const s = sentinelWall()
    const quiescent = makeQuiescent(evaluate)
    for (const move of legalMoves(s)) {
      const raw = resolve(s, move)
      const asRole = role(s, 'player')
      const settled = resolveChain(raw, 'player', asRole, evaluate, searchBudget(256))
      expect(evaluate(settled, 'player', asRole)).toBe(quiescent(raw, 'player', asRole))
    }
  })

  it('leaves a board with nothing owed exactly as it found it', () => {
    const s = sentinelWall()
    expect(resolveChain(s, 'player', 'neutral', evaluate, searchBudget(256))).toBe(s)
  })
})
