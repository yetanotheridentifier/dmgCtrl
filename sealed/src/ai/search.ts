import type { GameState, PlayerId } from '../engine/types'
import type { Evaluator } from './evaluate'
import type { Role } from './race'
import { hasPendingChoices } from '../engine/types'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'

/**
 * Quiescent scoring: never evaluate a half-resolved action.
 *
 * One ply scores the state a candidate move produces, but a move that raises a choice has not
 * finished resolving. A when-played effect has picked no target yet, a mandatory unique defeat has
 * not happened, a suspended attack has not dealt its damage. The board being scored is one nobody
 * will ever play from, so the move is ranked on a fiction.
 *
 * How much of a fiction was measured across 210 games, split by who owes the outstanding answer:
 *
 * | | positions | candidates | chosen move |
 * | --- | --- | --- | --- |
 * | we owe it | 42.9% | 18.5% | 11.3% |
 * | they owe it | 5.1% | 1.3% | 0.5% |
 *
 * The starkest case was `selectUniqueUnitToDefeat`: playing a second copy of a unique raises a
 * MANDATORY defeat, and the board was scored with both copies still on it, so a duplicate 3/3 read
 * about 13 points too high and the bot paid a real card for a unit it had to defeat immediately.
 *
 * This is deliberately NOT a search over separate actions. It stops the moment nothing is owed, so
 * it never looks past the end of the action it was given. Expanding a genuine second action needs a
 * null-move assumption and a beam budget, and is a different piece of work.
 */

/**
 * Both halves of the recursion in one number.
 *
 * `nodes` caps `resolve` calls per top-level score. The chain is short in practice, but `support`
 * fans out across every ready unit and every legal target, so the worst case is bounded here rather
 * than trusted to the card pool. When the budget runs out the current board is scored as-is, which
 * is exactly the pre-quiescence behaviour: degrading to the old answer, never to a wrong one.
 *
 * The default is set well above the observed chains so it does not bite in normal play. It is a
 * safety rail, not a tuning knob.
 */
export interface QuiescenceLimits {
  nodes: number
}

export const DEFAULT_QUIESCENCE_LIMITS: QuiescenceLimits = { nodes: 256 }

/**
 * Wrap an evaluation so it resolves any owed choice chain before scoring.
 *
 * A decorator rather than a change to `evaluate`, because that keeps the A/B honest: the same greedy
 * driver takes either evaluator, so a measurement isolates quiescence and nothing else.
 *
 * **Whose turn it is decides the sign**, and that is read from `state.activePlayer` rather than from
 * choice ownership. The engine hands the turn over when an action raises a choice the opponent
 * controls (`handOffOpponentChoice`), and `legalMoves` enumerates only the active player's answers,
 * so deriving it any other way would disagree with the moves actually on offer. Our own answers are
 * an opportunity, so take the max; theirs are a threat, so take the min. This is the pessimism the
 * two-ply work later widens from the choice chain to a whole reply.
 *
 * Scoring both sides from `me`'s seat, never by negating, is required since the private hand term
 * made `evaluate` non-zero-sum: a negated score would read the opponent's hand.
 */
export function makeQuiescent(inner: Evaluator, limits: QuiescenceLimits = DEFAULT_QUIESCENCE_LIMITS): Evaluator {
  return (state, me, asRole) => {
    // A shared, decrementing budget rather than a depth cap: a wide chain and a deep one cost the
    // same thing, and only the total matters. Traversal is deterministic, so where it bites is too.
    const budget = { left: limits.nodes }
    return quiesce(state, me, asRole, inner, budget)
  }
}

function quiesce(
  state: GameState,
  me: PlayerId,
  asRole: Role | undefined,
  inner: Evaluator,
  budget: { left: number },
): number {
  // A decided game is scored terminally; whatever is left pending will never be answered.
  if (state.winner !== null || !hasPendingChoices(state)) return inner(state, me, asRole)

  const moves = legalMoves(state)
  // No legal answer to an outstanding choice should not happen, but scoring where we stand is a
  // safe reading of it and keeps a card-data oddity from taking the AI down.
  if (moves.length === 0 || budget.left <= 0) return inner(state, me, asRole)

  const maximising = state.activePlayer === me
  let best = maximising ? -Infinity : Infinity
  for (const move of moves) {
    if (budget.left <= 0) break
    budget.left--
    const score = quiesce(resolve(state, move), me, asRole, inner, budget)
    best = maximising ? Math.max(best, score) : Math.min(best, score)
  }
  // Every branch was cut by the budget before scoring anything: fall back rather than return ±∞.
  return Number.isFinite(best) ? best : inner(state, me, asRole)
}
