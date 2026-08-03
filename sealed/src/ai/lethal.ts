import type { GameState, PlayerId } from '../engine/types'
import { opponentOf, hasPendingChoices } from '../engine/types'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { unitReach, remainingBase, reachThisRound } from './race'

/**
 * Lethal solver (#433): can `seat` win from here using only its own actions?
 *
 * ## "This turn" does not exist, so this is the null-move question
 *
 * Players alternate single actions, so a sequence of three of our actions has three of theirs in
 * between, and they may remove the attacker, gain a Shield or drop a Sentinel at any point. "Can I
 * win this turn" is therefore shorthand for "can I win if the opponent does nothing", which is
 * #410's null-move assumption with a different finish line.
 *
 * ## Most of the question was already answered
 *
 * Under that assumption, aggregate ready reach IS a kill: we take the attacks consecutively while
 * they pass. So `canFinishNow` already settles attacks-only lethal, and `attacksToFinish` below is
 * the same reading made exact enough to respect an action budget.
 *
 * What a search adds is what neither can see:
 *
 * - **The hand**: a burn event, a pump lifting a unit over the line, a when-played base hit.
 * - **The leader**, which deploys READY (CR 3.4.4) and is not in `units` until it does, so
 *   `reachThisRound` reads a board with a deployable leader as though nothing were coming.
 * - **Sentinel clearing**, where one attack removes a blocker so the rest can reach. `unitReach`
 *   reads a locked unit as 0, so aggregate reach under-reads exactly these lines.
 *
 * ## A lower bound, deliberately
 *
 * Pruning and the node budget can each make it miss a line, so `false` means "no line found within
 * budget", never "no line exists". Every budget in the search degrades this way, to the safe answer
 * rather than a wrong one, and `aiLethal.test.ts` pins the pruning against an exhaustive oracle
 * because a missed line is a WRONG answer rather than an imprecise one, and it fails silently.
 */

export interface LethalLimits {
  /** How many of OUR actions the line may take. Answering an owed choice is part of the action that
   *  raised it, so it does not count against this. */
  depth: number
  /** Total `resolve` calls, as a safety rail rather than a tuning knob. */
  nodes: number
}

export const DEFAULT_LETHAL_LIMITS: LethalLimits = { depth: 4, nodes: 4000 }

/**
 * The fewest ready attackers whose reach covers the enemy base, or `Infinity` if the ready board
 * cannot get there however many attacks it takes.
 *
 * Taking the biggest reach first minimises the count, which is what makes this exact rather than an
 * estimate. It exists instead of a bare `canFinishNow` short-circuit because aggregate reach may need
 * five attacks while the budget allows three: claiming lethal there would assert a line the search is
 * not allowed to play, and the brute-force oracle would rightly disagree.
 *
 * Inherits the race model's targeting, so Sentinel, Saboteur, arena and Hidden all resolve through
 * the rules' own function and a wall in the way correctly makes this `Infinity`.
 */
export function attacksToFinish(state: GameState, seat: PlayerId): number {
  const remaining = remainingBase(state, seat)
  if (remaining <= 0) return 0

  const reaches = state.players[seat].units
    .filter(u => !u.exhausted)
    .map(u => unitReach(state, seat, u))
    .filter(r => r > 0)
    .sort((a, b) => b - a)

  let total = 0
  for (let i = 0; i < reaches.length; i++) {
    total += reaches[i]
    if (total >= remaining) return i + 1
  }
  return Infinity
}

/**
 * Is this action worth continuing from, for a question that is only about ending the game?
 *
 * **Attacks are always kept.** They are few (units x targets) and inherently damage-relevant, and a
 * chip that does not yet kill a Sentinel can still be the first half of clearing it. Pruning those
 * would lose real lines, which is the failure this whole ticket has to avoid.
 *
 * Everything else has to show progress: the base is closer to dead, a blocker is gone, or our ready
 * reach went up. That last one is what admits the two lines a board-only reading misses, a pump and a
 * leader deploy, while dropping the large majority of plays. A unit that arrives exhausted with no
 * when-played effect cannot contribute to a kill in this sequence, and it is most of the branching.
 */
function progresses(before: GameState, after: GameState, seat: PlayerId): boolean {
  if (after.winner !== null) return true
  const foe = opponentOf(seat)
  if (remainingBase(after, seat) < remainingBase(before, seat)) return true
  if (after.players[foe].units.length < before.players[foe].units.length) return true
  if (attacksToFinish(after, seat) < attacksToFinish(before, seat)) return true
  // A deployed leader or a pump can add reach without yet changing the attack COUNT.
  return reachThisRound(after, seat) > reachThisRound(before, seat)
}

/** Does a sequence of `seat`'s own actions finish the enemy base, assuming the opponent does nothing? */
export function hasLethal(state: GameState, seat: PlayerId, limits: LethalLimits = DEFAULT_LETHAL_LIMITS): boolean {
  return search(state, seat, limits.depth, { left: limits.nodes })
}

function search(state: GameState, seat: PlayerId, actionsLeft: number, budget: { left: number }): boolean {
  if (state.winner === seat) return true
  if (state.winner !== null || state.phase !== 'action') return false

  // Owed answers finish the action that raised them rather than starting a new one, so they cost
  // budget but not depth. Expanded WITHOUT pruning: with a choice outstanding `legalMoves` offers
  // nothing but the answers, so a filter here could reject the whole position.
  if (hasPendingChoices(state)) {
    if (state.activePlayer !== seat) return false
    for (const answer of legalMoves(state)) {
      if (budget.left <= 0) return false
      budget.left--
      if (search(resolve(state, answer), seat, actionsLeft, budget)) return true
    }
    return false
  }

  if (actionsLeft <= 0) return false
  // Attacks alone, when there are enough actions left to take them all.
  if (attacksToFinish(state, seat) <= actionsLeft) return true

  // The null move: their turn is skipped so our sequence continues. Never passing on our own behalf
  // is what keeps this honest, since two consecutive passes would end the phase.
  let ours = state
  if (ours.activePlayer !== seat) {
    if (budget.left <= 0) return false
    budget.left--
    ours = resolve(ours, { type: 'pass' })
    if (ours.winner !== null || ours.phase !== 'action' || ours.activePlayer !== seat) return false
  }

  for (const move of legalMoves(ours)) {
    if (move.type === 'pass') continue
    if (budget.left <= 0) return false
    budget.left--
    const next = resolve(ours, move)
    if (move.type !== 'attack' && !hasPendingChoices(next) && !progresses(ours, next, seat)) continue
    if (search(next, seat, actionsLeft - 1, budget)) return true
  }
  return false
}
