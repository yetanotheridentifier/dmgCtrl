import { describe, it, expect } from 'vitest'
import { hasLethal, attacksToFinish, DEFAULT_LETHAL_LIMITS } from '../ai/lethal'
import { canFinishNow, canFinishThisAction } from '../ai/race'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { GameState, PlayerId } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Lethal solver (#433): can `seat` win from here using only its own actions.
 *
 * ## "This turn" does not exist, so this is the null-move question
 *
 * Players alternate single actions, so a sequence of three of our actions has three of theirs in
 * between. "Can I win this turn" is therefore shorthand for "can I win if the opponent does nothing",
 * which is #410's null-move assumption with a different finish line.
 *
 * ## Most of it already existed
 *
 * Under that assumption, aggregate ready reach IS a kill: we simply take the attacks consecutively
 * while they pass. So `canFinishNow` already answers attacks-only lethal, and what a solver adds is
 * the parts it cannot see:
 *
 *   - the HAND: a burn event, a pump lifting a unit over the line, a when-played base hit;
 *   - the LEADER, which deploys READY and is not in `units` until it does;
 *   - SENTINEL clearing, where one attack removes a blocker so the rest can reach. `unitReach` reads
 *     a Sentinel-locked unit as 0, so `canFinishNow` under-reads exactly these lines.
 *
 * ## A lower bound, deliberately
 *
 * Pruning and the node budget can both make it miss a line, so a `false` means "no line found within
 * budget", never "no line exists". Every other budget in `ai/search.ts` degrades the same way: to the
 * safe answer rather than a wrong one. The brute-force oracle below is what stops the pruning from
 * turning that into a silent lie.
 */

const cards = {
  ...CARDS,
  FINISHER: card({ id: 'FINISHER', type: 'unit', arena: 'ground', cost: 2, power: 9, hp: 9 }),
  HALF: card({ id: 'HALF', type: 'unit', arena: 'ground', cost: 2, power: 5, hp: 5 }),
  SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 1, power: 3, hp: 5 }),
  // Low power so it does not kill our attackers: this is about reach, not trades.
  WALL: card({ id: 'WALL', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 3, keywords: [{ name: 'Sentinel' }] }),
  TOUGH_WALL: card({ id: 'TOUGH_WALL', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 30, keywords: [{ name: 'Sentinel' }] }),
  TINY_BASE: card({ id: 'TINY_BASE', type: 'base', hp: 9 }),
}

/** `mine` ready in the player seat, `theirs` opposing, enemy base on 9 HP unless said otherwise. */
function position(mine: string[], theirs: string[] = [], opts: { resources?: number; baseDamage?: number } = {}): GameState {
  return state({
    cards,
    players: {
      player: player({
        resources: ready(opts.resources ?? 0),
        units: mine.map((c, i) => unit(`u${i}`, c)),
      }),
      opponent: player({
        base: { cardId: 'TINY_BASE', damage: opts.baseDamage ?? 0 },
        units: theirs.map((c, i) => unit(`e${i}`, c)),
      }),
    },
  })
}

/**
 * The oracle: exhaustive, unpruned, no short-circuits. Slow and obviously correct, which is the only
 * combination worth testing a fast search against.
 *
 * It takes the same null move as the real search (the opponent passes so our sequence continues) and
 * the same action budget, so any disagreement is the PRUNING rather than a difference of question.
 */
function bruteForceLethal(s: GameState, seat: PlayerId, actionsLeft: number): boolean {
  if (s.winner === seat) return true
  if (s.winner !== null || actionsLeft <= 0 || s.phase !== 'action') return false

  let ours = s
  if (ours.activePlayer !== seat) {
    ours = resolve(ours, { type: 'pass' })
    if (ours.winner !== null || ours.phase !== 'action' || ours.activePlayer !== seat) return false
  }

  for (const move of legalMoves(ours)) {
    if (move.type === 'pass') continue
    if (bruteForceLethal(resolve(ours, move), seat, actionsLeft - 1)) return true
  }
  return false
}

describe('attacksToFinish', () => {
  /**
   * The reason this exists rather than a bare `canFinishNow` short-circuit: aggregate reach may need
   * five attacks while the budget allows three, and then "lethal" would be claimed for a line the
   * search is not allowed to play. Counting the attacks keeps the answer exact under the budget.
   */
  it('counts the fewest ready attackers that cover the base', () => {
    expect(attacksToFinish(position(['FINISHER']), 'player')).toBe(1) // 9 into 9
    expect(attacksToFinish(position(['HALF', 'HALF']), 'player')).toBe(2) // 5 + 5 = 10
    expect(attacksToFinish(position(['HALF', 'SMALL', 'SMALL']), 'player')).toBe(3) // 5 + 3 + 3, since 5 + 3 falls short
  })

  /** Biggest reach first, because the count is what the budget is spent on: three small attackers
   *  and two large ones covering the same total are not the same line. */
  it('takes the largest attackers first, so the count is the minimum', () => {
    expect(attacksToFinish(position(['SMALL', 'HALF', 'SMALL', 'HALF']), 'player')).toBe(2)
  })

  it('is Infinity when the ready board cannot get there at all', () => {
    expect(attacksToFinish(position(['SMALL']), 'player')).toBe(Infinity)
    expect(attacksToFinish(position([]), 'player')).toBe(Infinity)
  })

  /** A Sentinel locks every attacker onto itself, so nothing reaches the base until it is gone. */
  it('is Infinity behind a Sentinel, even with plenty of power', () => {
    expect(attacksToFinish(position(['FINISHER'], ['WALL']), 'player')).toBe(Infinity)
  })
})

describe('hasLethal on the board alone', () => {
  it('finds a one-attack kill', () => {
    expect(hasLethal(position(['FINISHER']), 'player')).toBe(true)
  })

  it('finds a kill needing several attacks, because the opponent does nothing in between', () => {
    const s = position(['HALF', 'HALF'])
    expect(canFinishThisAction(s, 'player'), 'no single unit gets there').toBe(false)
    expect(canFinishNow(s, 'player'), 'but the aggregate does').toBe(true)
    expect(hasLethal(s, 'player')).toBe(true)
  })

  it('says no when the board simply cannot get there', () => {
    expect(hasLethal(position(['SMALL']), 'player')).toBe(false)
    expect(hasLethal(position([]), 'player')).toBe(false)
  })

  /** The budget is real: a line needing more actions than allowed is not a line we can play. */
  it('will not claim a kill that needs more attacks than the budget allows', () => {
    const s = position(['SMALL', 'SMALL', 'SMALL']) // 3 + 3 + 3 = 9, exactly lethal in three
    expect(hasLethal(s, 'player', { ...DEFAULT_LETHAL_LIMITS, depth: 3 })).toBe(true)
    expect(hasLethal(s, 'player', { ...DEFAULT_LETHAL_LIMITS, depth: 2 })).toBe(false)
  })
})

describe('hasLethal finds what the board-only predicates cannot', () => {
  /**
   * The leader is the clearest gap. It deploys READY (CR 3.4.4) and is not in `units` until it does,
   * so `reachThisRound` cannot see it and every board-only predicate reads this position as safe.
   */
  it('deploys the leader and swings with it', () => {
    // TST_L is a 4/7 costing 5. Board is empty, so the only line is deploy then attack.
    const s = position([], [], { resources: 6, baseDamage: 5 }) // 4 HP left, leader hits for 4
    expect(canFinishNow(s, 'player'), 'the board says nothing is coming').toBe(false)
    expect(hasLethal(s, 'player')).toBe(true)
  })

  /**
   * Clearing a blocker is the other. `unitReach` reads a Sentinel-locked unit as zero, so aggregate
   * reach says no, while killing the wall first opens the whole board.
   */
  it('kills the Sentinel first, then swings for lethal', () => {
    const s = position(['SMALL', 'FINISHER'], ['WALL'])
    expect(canFinishNow(s, 'player'), 'everything is locked onto the wall').toBe(false)
    expect(hasLethal(s, 'player')).toBe(true)
  })

  it('says no when the Sentinel cannot be cleared in the budget', () => {
    expect(hasLethal(position(['SMALL', 'FINISHER'], ['TOUGH_WALL']), 'player')).toBe(false)
  })
})

describe('hasLethal agrees with brute force', () => {
  /**
   * Pruning is the entire risk in this ticket. A missed line makes the answer WRONG rather than
   * merely imprecise, and it fails silently. So the pruned search is checked against an exhaustive
   * one on every position above, at a matched action budget.
   */
  const positions: Array<[string, GameState]> = [
    ['one-shot', position(['FINISHER'])],
    ['two attacks', position(['HALF', 'HALF'])],
    ['three attacks', position(['SMALL', 'SMALL', 'SMALL'])],
    ['not enough', position(['SMALL'])],
    ['empty board', position([])],
    ['sentinel, clearable', position(['SMALL', 'FINISHER'], ['WALL'])],
    ['sentinel, hopeless', position(['SMALL', 'FINISHER'], ['TOUGH_WALL'])],
    ['leader deploy', position([], [], { resources: 6, baseDamage: 5 })],
    ['leader deploy, out of reach', position([], [], { resources: 6, baseDamage: 0 })],
    ['already damaged', position(['HALF'], [], { baseDamage: 5 })],
  ]

  for (const [name, s] of positions) {
    it(`matches the oracle: ${name}`, () => {
      const depth = 3
      expect(hasLethal(s, 'player', { ...DEFAULT_LETHAL_LIMITS, depth })).toBe(bruteForceLethal(s, 'player', depth))
    })
  }
})

describe('hasLethal behaves like the rest of the search', () => {
  /** Budget exhaustion degrades to the safe answer, never to a false claim of a win. */
  it('returns false rather than guessing when the node budget is gone', () => {
    // Needs a line found by SEARCH: clear the Sentinel, then swing.
    const s = position(['SMALL', 'FINISHER'], ['WALL'])
    expect(hasLethal(s, 'player'), 'the line exists').toBe(true)
    expect(hasLethal(s, 'player', { depth: 4, nodes: 0 }), 'but is not reachable on no budget').toBe(false)
  })

  /**
   * The node budget bounds SEARCH, not arithmetic. Attacks-only lethal is a closed form over the
   * ready board, so it costs nothing and is still answered at zero nodes. Worth pinning, because
   * making the budget gate it would quietly turn the cheapest and most common lethal into a miss.
   */
  it('still answers an attacks-only kill with no budget at all', () => {
    expect(hasLethal(position(['HALF', 'HALF']), 'player', { depth: 4, nodes: 0 })).toBe(true)
  })

  it('does not touch the state it was given', () => {
    const s = position(['SMALL', 'FINISHER'], ['WALL'])
    const before = JSON.stringify(s)
    hasLethal(s, 'player')
    expect(JSON.stringify(s)).toBe(before)
  })

  it('is deterministic', () => {
    const s = position(['SMALL', 'FINISHER'], ['WALL'])
    expect(hasLethal(s, 'player')).toBe(hasLethal(s, 'player'))
  })

  /** It answers for a named seat, not for whoever happens to be active. */
  it('answers for the seat asked about, whoever is to move', () => {
    const s = position(['FINISHER'])
    expect(hasLethal(s, 'player')).toBe(true)
    expect(hasLethal({ ...s, activePlayer: 'opponent' }, 'player')).toBe(true)
    expect(hasLethal(s, 'opponent')).toBe(false)
  })
})
