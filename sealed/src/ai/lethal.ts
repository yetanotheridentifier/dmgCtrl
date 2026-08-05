import type { GameState, PlayerId } from '../engine/types'
import type { Action } from '../engine/actions'
import { opponentOf, hasPendingChoices } from '../engine/types'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { effectivePower } from '../engine/stats'
import { unitReach, remainingBase, reachThisRound, canFinishThisAction } from './race'

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

/**
 * When to spend the search at all.
 *
 * The solver costs 200 to 350 ms a call once its budget is not binding, so it must not run where it
 * cannot pay. Every gate here is a way of NOT finding a line, so each is a potential silent failure
 * and belongs in the same category as pruning: measured, not trusted.
 */
export interface LethalGate {
  /**
   * Do not search before this round. Lethal was never once observed in rounds 1 to 3 across 36,384
   * decisions, which is arithmetic rather than luck: bases are ~30 HP and no early board approaches
   * it. Round 4 IS reachable (15, 9 and 6 cases on three of six seeds), so the default sits there
   * rather than at 5.
   */
  minRound: number
  /**
   * Skip when one ready unit already finishes the base. `evaluate` returns WIN for a decided game and
   * the driver is proven to take it (`takesLethal.test.ts`), so searching only confirms what the
   * evaluation cannot get wrong.
   */
  skipWhenSingleAction: boolean
  /**
   * Skip when the total POWER available cannot reach the base.
   *
   * **Off by default, deliberately.** It bounds damage by power, while a burn event deals damage with
   * none, and a burn event is one of the three things this solver exists to find. Enabling it trades
   * a measurable false-skip rate for compute, which is a decision to make with data rather than by
   * default.
   */
  powerBound: boolean
}

export const DEFAULT_LETHAL_GATE: LethalGate = {
  minRound: 4,
  skipWhenSingleAction: true,
  powerBound: false,
}

/**
 * An optimistic ceiling on the base damage `seat` could produce: every unit's power whether ready or
 * not, plus a leader that has yet to deploy, plus the printed power of anything in hand.
 *
 * Ignores exhaustion, Sentinels, resources and timing, so it over-counts heavily and is only useful
 * for rejecting positions that are nowhere near. It does NOT bound event damage, which is why the
 * gate that uses it is off by default.
 */
function optimisticDamage(state: GameState, seat: PlayerId): number {
  const p = state.players[seat]
  let total = 0
  for (const u of p.units) total += effectivePower(state, u)
  if (!p.leader.deployed) total += state.cards[p.leader.cardId]?.power ?? 0
  for (const id of p.hand) total += state.cards[id]?.power ?? 0
  return total
}

/** Is this position worth spending the search on? Exported so the bench can measure what it skips. */
export function shouldSearchLethal(state: GameState, seat: PlayerId, gate: LethalGate = DEFAULT_LETHAL_GATE): boolean {
  if (state.round < gate.minRound) return false
  if (gate.skipWhenSingleAction && canFinishThisAction(state, seat)) return false
  if (gate.powerBound && optimisticDamage(state, seat) < remainingBase(state, seat)) return false
  return true
}

/**
 * Whether a line exists, and the move that opens it.
 *
 * Both answers come from ONE traversal on purpose. They were briefly two entry points sharing a
 * helper, and the duplicated root immediately drifted: it lost the rule that answering an owed choice
 * does not consume depth, so the search ran a ply shallower in exactly the positions that rule exists
 * for. The bench oracle caught it as two missed lines. One function, two fields, no drift.
 *
 * `move` is null when the state is ALREADY won (nothing to play) or when it is not `seat`'s turn, so
 * a line is known to exist but cannot be named yet. `won` is the answer #446 wants; `move` is the one
 * the bot wants.
 */
interface LethalResult {
  won: boolean
  move: Action | null
}

const NO_LETHAL: LethalResult = { won: false, move: null }

/** Does a sequence of `seat`'s own actions finish the enemy base, assuming the opponent does nothing? */
export function hasLethal(state: GameState, seat: PlayerId, limits: LethalLimits = DEFAULT_LETHAL_LIMITS): boolean {
  return search(state, seat, limits.depth, { left: limits.nodes }).won
}

/**
 * The first action of the SHORTEST lethal line, or `null` if none was found.
 *
 * `hasLethal` answers #446's question ("would acting first convert to lethal"), but PLAYING a line
 * needs its opening move. One search behind both, so the bot and #446 cannot end up with different
 * ideas of what lethal means, which is the duplication this ticket was re-scoped to avoid.
 *
 * ## Why it deepens iteratively instead of searching straight to the limit
 *
 * Under the null move a 2-action win and a 5-action win are indistinguishable: the opponent does
 * nothing in either. In a real game the longer line hands them five chances to gain a Shield, drop a
 * Sentinel or kill the attacker.
 *
 * Returning whichever line `legalMoves` order reached first measured **47.8%** against the plain
 * beam, LOSING about two points, because it replaced the beam's fastest-win choice with an arbitrary
 * one. The beam has preferred the fastest win since #410, through a depth discount on decisive
 * scores; this is the same rule reached the same way, by measuring the cost of its absence.
 *
 * Each depth gets its own budget. Sharing one would let the shallow passes starve the deep one.
 *
 * ## Existence first, then the shortest line
 *
 * Deepening blindly costs **3x** a single pass (509 ms against 168 ms, measured over gate-admitted
 * positions), and almost all of that is wasted: the gate admits about 55% of decisions but a line
 * exists in only ~12% of those, so the common case deepens through every level to conclude there was
 * nothing to find. One full-depth pass answers that for a third of the price.
 *
 * The re-search is NOT cheap here, and the textbook reason it usually is does not apply. A bounded
 * search is dominated by its deepest level only when branching is high; this search prunes hard to
 * damage-relevant actions, so branching is low and the shallow levels are a real fraction of the
 * cost.
 */
export function findLethal(
  state: GameState,
  seat: PlayerId,
  limits: LethalLimits = DEFAULT_LETHAL_LIMITS,
): Action | null {
  const deepest = search(state, seat, limits.depth, { left: limits.nodes })
  if (!deepest.won) return null

  // A line exists, so it is worth paying to find the shortest one. The full depth is already known
  // to work, so it is the fallback rather than another pass.
  for (let depth = 1; depth < limits.depth; depth++) {
    const found = search(state, seat, depth, { left: limits.nodes })
    if (found.won) return found.move
  }
  return deepest.move
}

/** The attack that opens an attacks-only kill, when the ready board covers the base in budget. */
function openingAttack(state: GameState, seat: PlayerId, actionsLeft: number): Action | null {
  if (state.activePlayer !== seat || hasPendingChoices(state)) return null
  if (attacksToFinish(state, seat) > actionsLeft) return null

  const best = state.players[seat].units
    .filter(u => !u.exhausted)
    .map(u => ({ u, reach: unitReach(state, seat, u) }))
    .filter(x => x.reach > 0)
    .sort((a, b) => b.reach - a.reach)[0]
  if (!best) return null

  return { type: 'attack', attackerId: best.u.instanceId, target: { kind: 'base' } }
}

function search(state: GameState, seat: PlayerId, actionsLeft: number, budget: { left: number }): LethalResult {
  if (state.winner === seat) return { won: true, move: null } // already over, nothing left to play
  if (state.winner !== null || state.phase !== 'action') return NO_LETHAL

  // Owed answers finish the action that raised them rather than starting a new one, so they cost
  // budget but not depth. Expanded WITHOUT pruning: with a choice outstanding `legalMoves` offers
  // nothing but the answers, so a filter here could reject the whole position.
  if (hasPendingChoices(state)) {
    if (state.activePlayer !== seat) return NO_LETHAL
    for (const answer of legalMoves(state)) {
      if (budget.left <= 0) return NO_LETHAL
      budget.left--
      if (search(resolve(state, answer), seat, actionsLeft, budget).won) return { won: true, move: answer }
    }
    return NO_LETHAL
  }

  if (actionsLeft <= 0) return NO_LETHAL
  // Attacks alone, when there are enough actions left to take them all. The closed form needs no
  // search, but it does need a move, so name the biggest hitter: the same ordering the count assumes.
  if (attacksToFinish(state, seat) <= actionsLeft) {
    return { won: true, move: openingAttack(state, seat, actionsLeft) }
  }

  // The null move: their turn is skipped so our sequence continues. Never passing on our own behalf
  // is what keeps this honest, since two consecutive passes would end the phase.
  let ours = state
  if (ours.activePlayer !== seat) {
    if (budget.left <= 0) return NO_LETHAL
    budget.left--
    ours = resolve(ours, { type: 'pass' })
    if (ours.winner !== null || ours.phase !== 'action' || ours.activePlayer !== seat) return NO_LETHAL
  }

  for (const move of legalMoves(ours)) {
    if (move.type === 'pass') continue
    if (budget.left <= 0) return NO_LETHAL
    budget.left--
    const next = resolve(ours, move)
    if (move.type !== 'attack' && !hasPendingChoices(next) && !progresses(ours, next, seat)) continue
    // A move found from a state we reached by passing for the OPPONENT is still ours to play, but
    // only once it is our turn: `move` is reported, and the caller checks whose turn it is.
    if (search(next, seat, actionsLeft - 1, budget).won) return { won: true, move }
  }
  return NO_LETHAL
}
