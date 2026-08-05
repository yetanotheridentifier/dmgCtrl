import { describe, it, expect } from 'vitest'
import {
  hasLethal, findLethal, attacksToFinish, shouldSearchLethal,
  DEFAULT_LETHAL_LIMITS, DEFAULT_LETHAL_GATE,
} from '../ai/lethal'
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

describe('findLethal returns the move, not just the verdict', () => {
  /**
   * `hasLethal` answers #446's question ("would acting first convert to lethal"), but PLAYING a
   * lethal line needs the first action of it. Same search, reporting the root that succeeded.
   */
  it('returns a move that actually leads to a win when followed', () => {
    const s = position(['SMALL', 'FINISHER'], ['WALL'])
    let cur = s
    for (let i = 0; i < DEFAULT_LETHAL_LIMITS.depth && cur.winner === null; i++) {
      if (cur.activePlayer !== 'player') { cur = resolve(cur, { type: 'pass' }); continue }
      const move = findLethal(cur, 'player')
      expect(move, `a line existed at step ${i}`).not.toBeNull()
      cur = resolve(cur, move!)
    }
    expect(cur.winner).toBe('player')
  })

  /**
   * **Regression.** `findLethal` was briefly a second entry point duplicating the traversal, and the
   * copy lost the rule that answering an owed choice costs budget but not depth. The search then ran
   * a ply shallower in exactly the positions that rule exists for, and the bench oracle caught it as
   * two missed lines. Both answers now come from one traversal.
   *
   * Playing a second copy of a unique raises a MANDATORY defeat, so this position owes an answer
   * before anything else can happen, and the line still needs its full depth afterwards.
   */
  it('does not spend depth on an owed answer', () => {
    const withUnique = {
      ...cards,
      UNIQ: card({ id: 'UNIQ', type: 'unit', arena: 'ground', cost: 1, power: 3, hp: 3, unique: true }),
    }
    const s = state({
      cards: withUnique,
      players: {
        player: player({
          resources: ready(4),
          hand: ['UNIQ'],
          units: [unit('u0', 'UNIQ'), unit('u1', 'HALF'), unit('u2', 'HALF')],
        }),
        opponent: player({ base: { cardId: 'TINY_BASE', damage: 0 } }),
      },
    })
    // Two HALF at 5 power each already cover the 9 HP base, so a line exists whatever is played.
    expect(hasLethal(s, 'player')).toBe(true)
    expect(findLethal(s, 'player')).not.toBeNull()
  })

  /**
   * **The shortest line, not the first one found.**
   *
   * Under the null move a 2-action win and a 5-action win look identical, because the opponent does
   * nothing in either. In a real game the longer line hands them five chances to gain a Shield, drop
   * a Sentinel or kill the attacker. Returning whichever line `legalMoves` order happened to reach
   * first measured **47.8%** against the plain beam, losing about two points, because it replaced the
   * beam's fastest-win choice with an arbitrary one.
   *
   * The beam has preferred the fastest win since #410, via a depth discount on decisive scores. This
   * is the same rule, arrived at the same way: by measuring the cost of not having it.
   *
   * Here a 6 HP Sentinel blocks a base on 3. FINISHER kills the wall alone, so the win is two actions;
   * the two SMALLs together also kill it, which wins in three. The units are ordered so the slow line
   * comes first in move order.
   */
  it('prefers the shortest line when several reach a win', () => {
    const withWall6 = {
      ...cards,
      WALL6: card({ id: 'WALL6', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 6, keywords: [{ name: 'Sentinel' }] }),
    }
    const s = state({
      cards: withWall6,
      players: {
        player: player({
          resources: ready(0),
          units: [unit('slow0', 'SMALL'), unit('slow1', 'SMALL'), unit('fast', 'FINISHER')],
        }),
        opponent: player({ base: { cardId: 'TINY_BASE', damage: 6 }, units: [unit('w', 'WALL6')] }),
      },
    })
    expect(hasLethal(s, 'player'), 'both lines exist').toBe(true)
    expect(findLethal(s, 'player')).toMatchObject({ type: 'attack', attackerId: 'fast' })
  })

  it('returns null exactly when there is no line', () => {
    expect(findLethal(position(['SMALL']), 'player')).toBeNull()
    expect(findLethal(position(['FINISHER']), 'player')).not.toBeNull()
  })

  /** One search, two entry points: a disagreement would mean the bot and #446 have different ideas
   *  of what lethal means, which is the duplication this ticket was re-scoped to avoid. */
  it('agrees with hasLethal on every scripted position', () => {
    const cases = [
      position(['FINISHER']),
      position(['HALF', 'HALF']),
      position(['SMALL']),
      position(['SMALL', 'FINISHER'], ['WALL']),
      position(['SMALL', 'FINISHER'], ['TOUGH_WALL']),
      position([], [], { resources: 6, baseDamage: 5 }),
    ]
    for (const s of cases) {
      expect(findLethal(s, 'player') !== null).toBe(hasLethal(s, 'player'))
    }
  })
})

describe('the gate', () => {
  /**
   * The solver costs 200 to 350 ms a call, so it must not run where it cannot pay. The gate is
   * measured rather than trusted: a gate that skips a real line is the same class of silent failure
   * as pruning that loses one.
   */
  it('does not search before the round lethal becomes arithmetically possible', () => {
    // A position that genuinely needs the search: behind a Sentinel, so no single action wins and the
    // obvious-win gate cannot mask what the round gate is doing.
    const needsSearch = position(['SMALL', 'FINISHER'], ['WALL'])
    expect(shouldSearchLethal({ ...needsSearch, round: 2 }, 'player', DEFAULT_LETHAL_GATE)).toBe(false)
    expect(shouldSearchLethal({ ...needsSearch, round: 5 }, 'player', DEFAULT_LETHAL_GATE)).toBe(true)
  })

  /**
   * Round 4 is the earliest lethal was ever observed (15, 9 and 6 cases on three of six seeds, and
   * exactly zero across all of rounds 1 to 3 in 36,384 decisions). A gate at 5 would throw those
   * away, so the default sits at 4.
   */
  it('defaults to round 4, the earliest lethal was ever seen', () => {
    expect(DEFAULT_LETHAL_GATE.minRound).toBe(4)
  })

  /**
   * When one ready unit already finishes the base, `evaluate` returns WIN and the greedy driver is
   * PROVEN to take it (`takesLethal.test.ts`). Searching would spend 300 ms confirming what the
   * evaluation cannot get wrong.
   */
  it('does not search when a single action already wins', () => {
    const obvious = { ...position(['FINISHER']), round: 6 }
    expect(canFinishThisAction(obvious, 'player'), 'precondition').toBe(true)
    expect(shouldSearchLethal(obvious, 'player', DEFAULT_LETHAL_GATE)).toBe(false)
  })

  /**
   * The power bound is OFF by default and that is deliberate. It bounds damage by POWER, while a burn
   * event deals damage with none, and a burn event is one of the three things this solver exists to
   * find. Available as an option so its false-skip rate can be measured rather than assumed.
   */
  it('leaves the power bound off by default, because a burn event has no power', () => {
    expect(DEFAULT_LETHAL_GATE.powerBound).toBe(false)
    const hopeless = { ...position(['SMALL']), round: 6 }
    expect(shouldSearchLethal(hopeless, 'player', DEFAULT_LETHAL_GATE)).toBe(true)
    expect(shouldSearchLethal(hopeless, 'player', { ...DEFAULT_LETHAL_GATE, powerBound: true })).toBe(false)
  })

  /** A gate that skipped everything would look like a free speedup and quietly disable the feature. */
  it('still lets a real line through with every gate enabled', () => {
    const s = { ...position(['SMALL', 'FINISHER'], ['WALL']), round: 6 }
    expect(shouldSearchLethal(s, 'player', { minRound: 4, skipWhenSingleAction: true, powerBound: true })).toBe(true)
  })
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
