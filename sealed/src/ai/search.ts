import type { GameState, PlayerId } from '../engine/types'
import type { Action } from '../engine/actions'
import type { Evaluator } from './evaluate'
import type { Ai } from './types'
import type { Role } from './race'
import { hasPendingChoices, opponentOf } from '../engine/types'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { seededUnit } from '../engine/rng'
import { role } from './race'

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
 * The shared node budget, and where it went.
 *
 * `left` is the rail. The two counters exist because the pool is shared between driving owed choice
 * chains and expanding the beam, and **the chain wins it**: measured over 200 real decisions, `beam`
 * spends 510 of its 638 nodes on chains and only 128 on lookahead, and raising the rail twentyfold
 * moves the beam's share to 135 while the chain's grows to 6885.
 *
 * That is why a raised budget costs ten times as much and plays no better. It also means the rail,
 * when it does fire (4.0% of decisions for `beam`, 8.5% for `beam-reply`), starves the search rather
 * than trimming it: the candidates reached with nothing left are scored by a bare `resolve`, which is
 * the half-resolved reading quiescence exists to prevent.
 */
export interface SearchBudget {
  left: number
  /** Nodes spent driving owed choice chains: `resolveChain` and the quiescence inside it. */
  chain: number
  /** Nodes spent expanding our own follow-up actions and the opponent's replies. */
  beam: number
}

export function searchBudget(nodes: number): SearchBudget {
  return { left: nodes, chain: 0, beam: 0 }
}

function spendChain(budget: SearchBudget): void {
  budget.left--
  budget.chain++
}

function spendBeam(budget: SearchBudget): void {
  budget.left--
  budget.beam++
}

/** What the last `makeBeamAi` decision cost, so a run can report the rail instead of inferring it. */
export interface SearchTrace {
  /** The budget the decision started with. */
  nodes: number
  /** What was left of it. */
  left: number
  chain: number
  beam: number
  /** The budget ran out, so the move returned is the truncated search's answer. */
  exhausted: boolean
  /**
   * What the search valued each root candidate at, in `legalMoves` order.
   *
   * For the blind-spot diagnostic (#494), which asks whether every candidate scored the same and the
   * tie-break therefore chose at random. That question has always been answered with a separate
   * one-ply scorer, so it described a bot we stopped shipping; these are the numbers the deployed
   * search actually acted on.
   *
   * **The ordering is load-bearing.** The diagnostic subsets candidates by decision type, so any
   * order other than `legalMoves`' would attribute one decision's spread to another.
   */
  candidates: number[]
}

let trace: SearchTrace | null = null

/**
 * The budget accounting for the most recent decision, or `null` before any.
 *
 * Module state rather than a parameter on purpose: it keeps the hot path's signatures unchanged, and
 * it works for every AI the registry can build, including the pre-constructed named ones. Single
 * threaded and overwritten per decision, so a reader must take it immediately after the move.
 */
export function lastSearchTrace(): SearchTrace | null {
  return trace
}

/**
 * Forget the last decision's accounting.
 *
 * A measurement needs to tell "this AI ran no beam search" from "it ran one and left the trace
 * looking healthy". Clearing before each decision makes a `null` afterwards mean the first.
 */
export function clearSearchTrace(): void {
  trace = null
}

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
    return quiesce(state, me, asRole, inner, searchBudget(limits.nodes))
  }
}

function quiesce(
  state: GameState,
  me: PlayerId,
  asRole: Role | undefined,
  inner: Evaluator,
  budget: SearchBudget,
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
    spendChain(budget)
    const score = quiesce(resolve(state, move), me, asRole, inner, budget)
    best = maximising ? Math.max(best, score) : Math.min(best, score)
  }
  // Every branch was cut by the budget before scoring anything: fall back rather than return ±∞.
  return Number.isFinite(best) ? best : inner(state, me, asRole)
}

/**
 * Drive an owed choice chain to completion and return the BOARD, where `quiesce` returns the score.
 *
 * The own-turn beam expands separate ACTIONS and leaves the chains to quiescence. Without this it
 * would expand choice answers as though they were actions, and a `support` chain (1762 of them across
 * 210 games) would eat the beam width, so "depth 3" would mean something different in every position.
 *
 * At each step it takes the answer whose full `quiesce` score is best (ours) or worst (theirs), so
 * the board it lands on is the one quiescence already priced. That agreement is asserted directly in
 * `aiBeam.test.ts`: expanding from a board other than the one we scored would be a quiet lie.
 */
/**
 * Drive an owed chain, spending at most `cap` of the shared pool on it.
 *
 * One-ply greedy has always worked this way: `makeQuiescent` hands EVERY candidate its own fresh
 * 256-node budget, so a runaway `support` fan-out costs 256 and the next candidate starts clean. The
 * beam dropped that by taking a raw evaluator and letting every chain in the decision draw on one
 * pool. Measured, the chain then takes 71.5% to 98% of it: 943 nodes of 1318, leaving the lookahead
 * 376, and raising the pool twentyfold moves the beam's share from 128 to 135 while the chain's goes
 * to 6885.
 *
 * The cap restores that discipline **without raising the ceiling**. The pool is unchanged, so a
 * decision can do no more work than before; a single chain simply cannot take all of it, and what it
 * does not take is still there for the search.
 *
 * The sub-budget is a real object rather than a running comparison so the cap composes with the pool:
 * a chain gets the smaller of its allowance and whatever is actually left, and can never overdraw.
 */
export function resolveChain(
  state: GameState,
  me: PlayerId,
  asRole: Role | undefined,
  inner: Evaluator,
  budget: SearchBudget,
  cap = Infinity,
): GameState {
  const sub: SearchBudget = { left: Math.min(cap, budget.left), chain: 0, beam: 0 }
  const settled = driveChain(state, me, asRole, inner, sub)
  budget.left -= sub.chain
  budget.chain += sub.chain
  return settled
}

function driveChain(
  state: GameState,
  me: PlayerId,
  asRole: Role | undefined,
  inner: Evaluator,
  budget: SearchBudget,
): GameState {
  if (state.winner !== null || !hasPendingChoices(state)) return state

  const moves = legalMoves(state)
  if (moves.length === 0 || budget.left <= 0) return state

  const maximising = state.activePlayer === me
  let chosen: GameState | null = null
  let bestScore = maximising ? -Infinity : Infinity
  for (const move of moves) {
    if (budget.left <= 0) break
    spendChain(budget)
    const child = resolve(state, move)
    const score = quiesce(child, me, asRole, inner, budget)
    if (maximising ? score > bestScore : score < bestScore) {
      bestScore = score
      chosen = child
    }
  }
  // Recurses on `driveChain`, not `resolveChain`: the allowance covers the WHOLE chain, so settling
  // one link and finding another owed must keep drawing on the same sub-budget rather than claiming a
  // fresh one and defeating the cap.
  return chosen === null ? state : driveChain(chosen, me, asRole, inner, budget)
}

/**
 * How far and how wide the own-turn beam looks.
 *
 * `depth` counts OUR OWN actions, so depth 1 is plain one-ply greedy and the beam is a strict
 * generalisation of it. `nodes` is a safety rail in the same spirit as `QuiescenceLimits`: running
 * out degrades to the shallower answer, never to a wrong one.
 */
/**
 * What the opponent is assumed to do between our actions (#425).
 *
 * - `null` they do nothing. Optimistic, and what makes a multi-step line of ours look playable. This
 *   is #410's assumption and the shipped `beam`.
 * - `pessimistic` they do the most inconvenient thing we can see: `min(evaluate(s, me))`.
 * - `selfish` they play their own read of the race: `argmax(evaluate(s, foe))`. Weaker as a safety
 *   guarantee, more realistic, and what an eventual MCTS would do.
 *
 * The last two differ because role-adjusted weights are **not** zero-sum: an aggressor and a defender
 * price the same board differently by design. Which is better is a measurement, not a principle.
 */
export type ReplyPolicy = 'null' | 'pessimistic' | 'selfish'

export interface BeamLimits {
  width: number
  depth: number
  nodes: number
  reply: ReplyPolicy
  /**
   * How many of OUR actions deep the opponent's reply is modelled, before falling back to the null
   * move (#499). `undefined` models it at every level, which is the behaviour before this existed.
   *
   * The reply assumes the opponent takes the single most inconvenient action available. Applying that
   * once is a useful safety margin; applying it three or four times in succession models a player who
   * punishes optimally every time, which is not the player being faced. Suspected of making the bot
   * refuse to act at all: in the scripted lockout it plays `pass` under `pessimistic` at any shield
   * weight, and plays the correct line under `null`.
   */
  replyDepth?: number
  /**
   * The most any ONE owed chain may take from `nodes`.
   *
   * `nodes` is the decision's whole allowance and is shared with chain resolution, which without this
   * takes 71.5% to 98% of it and leaves the lookahead starved on exactly the complicated positions.
   * The cap does not raise the ceiling: worst-case work per decision is unchanged, and what a chain
   * is not allowed to take stays available to the search.
   *
   * Defaults to the allowance one-ply quiescence has always given each candidate, since this is the
   * discipline the beam lost rather than a new parameter. Typical chains cost about 2.5 nodes, so it
   * sits ~100x above normal play and bites only on a fan-out that was going to run away.
   */
  chainNodes?: number
  /**
   * Prune replies that cannot change the answer. On by default; `false` forces the exhaustive search,
   * which exists so a test can assert the two agree.
   *
   * **Only sound for `pessimistic`, and only where a board is a leaf.** It is textbook alpha: once a
   * candidate's worst reply is already no better than the best secured elsewhere, that candidate is
   * dead and the remaining replies cannot revive it. `selfish` maximises a different function, so our
   * alpha is not a bound on it at all, and the pruning is simply not applied.
   *
   * Two places qualify, and the middle of the search does not:
   *
   * - **The root board at depth 1**, where nothing is expanded past it.
   * - **The deepest level of the beam**, whose boards feed `valueAt` and the winner check and are
   *   never continued from. That level holds most of the nodes, which makes it the only honest lever
   *   on the cost of a deep configuration.
   *
   * At any interior level a branch's value is the MAX over everything below it, so a bad immediate
   * reply bounds nothing, and cutting would also change which board the frontier continues from.
   */
  alphaBeta?: boolean
}

export const DEFAULT_BEAM_LIMITS: BeamLimits = {
  width: 4, depth: 3, nodes: 10_000, reply: 'null', chainNodes: DEFAULT_QUIESCENCE_LIMITS.nodes,
}

/**
 * Own-turn self-lookahead (#410): value a move by the best board its own follow-ups can reach.
 *
 * ## The null-move assumption
 *
 * Players alternate single actions, so continuing our own sequence means pretending the opponent does
 * nothing in between. **That assumption, not the search, is where the strength comes from and where
 * it leaks.** It is what lets a sacrifice into a Sentinel be valued by the base damage it unlocks,
 * and it is also what will over-value a line the opponent could interrupt. Since the beam maximises
 * over leaves, it systematically prefers the branch most dependent on that assumption holding.
 *
 * It is a better model of THIS format than it sounds. There is no instant-speed interaction, and a
 * played unit arrives exhausted, so an opponent cannot answer mid-sequence with a card they have just
 * cast. Their whole in-sequence toolkit is: attack with something already ready, play an event, play
 * an Ambush unit, deploy their leader (which arrives READY and is the largest of these), or claim.
 * Sealed pools are thin on all of them. The assumption should still be expected to degrade against a
 * stronger opponent, which is what the #425 matrix is for.
 *
 * The null move is the real `pass` action rather than a rewrite of `state.activePlayer`, so
 * end-of-turn processing stays honest. That is safe because every real action calls `resetPasses`
 * before handing the turn over, so alternating our-action / their-pass never reaches the two-pass
 * phase end. **The search never passes on our own behalf**; `pass` stays available at the root, where
 * it is a genuine candidate.
 *
 * ## Each root keeps its own beam
 *
 * A single global frontier would defeat the entire purpose. The lines this exists to find open with a
 * move that is BAD in isolation, so trimming the frontier by immediate score prunes exactly those
 * roots before their payoff is ever seen. The scripted position in `aiBeam.test.ts` opens with a
 * sacrifice scoring well below the locally best move, and a global beam drops it at once.
 *
 * So every root move is expanded and carries its own top-`width` frontier. That costs roughly
 * `roots x width x depth` resolves rather than `width x depth`, and it is the price of the feature
 * working at all rather than an optimisation left on the table.
 *
 * Role is fixed once at the root and threaded to every leaf (#395), and the seeded tie-break stays at
 * the root only, so the search is deterministic.
 */
export function makeBeamAi(inner: Evaluator, limits: BeamLimits = DEFAULT_BEAM_LIMITS): Ai {
  return (state: GameState): Action | null => {
    const budget = searchBudget(limits.nodes)
    const moves = legalMoves(state)
    if (moves.length === 0) {
      trace = { nodes: limits.nodes, left: budget.left, chain: 0, beam: 0, exhausted: false, candidates: [] }
      return null
    }

    const me = state.activePlayer
    const asRole = role(state, me)

    let best = -Infinity
    const bestMoves: Action[] = []
    const candidates: number[] = []
    for (const move of moves) {
      // `best` so far is alpha: a candidate that cannot beat it need not be finished.
      const { best: value } = reachableFrom(state, move, me, asRole, inner, limits, budget, best)
      candidates.push(value)
      if (value > best) {
        best = value
        bestMoves.length = 0
        bestMoves.push(move)
      } else if (value === best) {
        bestMoves.push(move)
      }
    }
    // Recorded before returning, so a caller can ask what this decision cost and whether the rail cut
    // it short. Overwritten every decision: it describes the last one, never a running total.
    trace = {
      nodes: limits.nodes,
      left: budget.left,
      chain: budget.chain,
      beam: budget.beam,
      exhausted: budget.left <= 0,
      candidates,
    }
    return bestMoves[Math.floor(seededUnit(state.rngSeed) * bestMoves.length)]
  }
}

/**
 * Score a leaf, preferring the FASTEST win and the slowest loss.
 *
 * Without this the beam is indifferent between winning now and winning in three actions, because both
 * score WIN and the tie-break then picks arbitrarily. That indifference is exactly the null-move
 * assumption showing its teeth: a deferred win is certain only if the opponent really does nothing,
 * and they get a turn in between to remove the attacker or gain the life.
 *
 * The adjustment touches DECIDED boards only, so it cannot reorder any material judgement. A whole
 * point of discount would rival `readyUnit`, which is why it is not applied to ordinary scores.
 */
function valueAt(board: GameState, me: PlayerId, asRole: Role | undefined, inner: Evaluator, depth: number): number {
  const raw = inner(board, me, asRole)
  // A draw scores 0 from either side, so there is no sign to preserve and nothing to prefer.
  if (board.winner === null || raw === 0) return raw
  return raw > 0 ? raw - depth : raw + depth
}

/**
 * Let the opponent answer, and return the board we should actually be scoring.
 *
 * Under `null` this is a no-op and the shipped beam's behaviour is untouched, which is what makes an
 * A/B between policies measure one feature. Under a reply policy it advances past their turn by
 * playing their best answer rather than passing for them, so the continuation and the leaf both see
 * a board the opponent has had a say in.
 *
 * **Never negate.** `evaluate` stopped being zero-sum when the private hand term landed: it is
 * `publicScore` plus a term applied to the scored seat alone. `-evaluate(s, me)` would read the
 * opponent's hand, so their side is scored with `evaluate(s, foe)` directly.
 *
 * Their role is fixed once from the position THEY are deciding in, the same discipline #395 imposed
 * on ours, because deriving it per candidate compares scores computed with different weight sets.
 */
function applyReply(
  state: GameState,
  me: PlayerId,
  asRole: Role | undefined,
  inner: Evaluator,
  policy: ReplyPolicy,
  budget: SearchBudget,
  alpha: number,
  margin: number,
  chainCap: number,
): GameState {
  if (policy === 'null') return state
  const foe = opponentOf(me)
  if (state.winner !== null || state.phase !== 'action' || state.activePlayer !== foe) return state

  const moves = legalMoves(state)
  if (moves.length === 0) return state

  const foeRole = policy === 'selfish' ? role(state, foe) : undefined
  const minimising = policy === 'pessimistic'
  let chosen: GameState | null = null
  let best = minimising ? Infinity : -Infinity

  for (const move of moves) {
    if (budget.left <= 0) break
    spendBeam(budget)
    const next = resolveChain(resolve(state, move), me, asRole, inner, budget, chainCap)
    const score = minimising ? inner(next, me, asRole) : inner(next, foe, foeRole)
    if (minimising ? score < best : score > best) {
      best = score
      chosen = next
    }
    // Alpha cut. The margin is not caution, it is arithmetic: the caller scores this board with
    // `valueAt`, which discounts a DECIDED board by its depth, so `best` and the value the caller
    // computes can differ by exactly that much. Cutting that much early keeps the pruning provably
    // answer-preserving rather than nearly so.
    if (minimising && best <= alpha - margin) break
  }
  return chosen ?? state
}

/** Hand the turn back to us by passing for the OPPONENT, or `null` if that ends the sequence. */
function ourTurnAgain(state: GameState, me: PlayerId, budget: SearchBudget): GameState | null {
  if (state.activePlayer === me) return state
  if (budget.left <= 0) return null
  spendBeam(budget)
  const passed = resolve(state, { type: 'pass' })
  // Their pass can end the phase outright, and a phase boundary is where this policy stops claiming
  // anything: continuing across a round is #446's problem, not this one.
  if (passed.winner !== null || passed.phase !== 'action' || passed.activePlayer !== me) return null
  return passed
}

/** What a root move reaches: its best board, and whether any leaf below it was an outright win. */
interface Reach {
  best: number
  won: boolean
}

/**
 * The best board reachable from `move` using only our own follow-up actions.
 *
 * `won` rides along rather than being computed by a second traversal, so `beamReachesWin` reports on
 * exactly the search the bot runs. A parallel implementation would drift, and the whole point of that
 * function is to measure the SHIPPED discipline against #433's lethal search.
 */
function reachableFrom(
  state: GameState,
  move: Action,
  me: PlayerId,
  asRole: Role | undefined,
  inner: Evaluator,
  limits: BeamLimits,
  budget: SearchBudget,
  alpha: number,
): Reach {
  if (budget.left <= 0) {
    const board = resolve(state, move)
    return { best: inner(board, me, asRole), won: board.winner === me }
  }
  spendBeam(budget)

  // Beam nodes are always settled boards, so depth counts actions rather than choice answers. Under a
  // reply policy the board scored is the one AFTER their answer, which is the whole of two-ply.
  const chainCap = limits.chainNodes ?? Infinity
  const settled = resolveChain(resolve(state, move), me, asRole, inner, budget, chainCap)
  // See `alphaBeta`: a cut is only a valid bound for pessimistic play, and only on a board nothing is
  // expanded past. At depth 1 the root board is such a board; deeper it is continued from.
  // Beyond `replyDepth` the opponent is assumed to do nothing rather than to punish optimally again.
  const replyAt = (level: number): ReplyPolicy =>
    (limits.replyDepth === undefined || level <= limits.replyDepth ? limits.reply : 'null')
  const cutting = limits.alphaBeta !== false && limits.reply === 'pessimistic'
  const rootAlpha = cutting && limits.depth === 1 ? alpha : -Infinity
  const root = applyReply(settled, me, asRole, inner, replyAt(1), budget, rootAlpha, 1, chainCap)
  let best = valueAt(root, me, asRole, inner, 1)
  let won = root.winner === me
  let frontier: GameState[] = [root]

  for (let d = 1; d < limits.depth; d++) {
    if (budget.left <= 0) break
    // The deepest level is expanded but never continued from, so its boards are ordinary leaves: the
    // frontier built from them would be discarded unread, and alpha is a real bound on them.
    const last = d === limits.depth - 1
    const children: Array<{ board: GameState; value: number }> = []

    for (const node of frontier) {
      if (node.winner !== null || node.phase !== 'action') continue
      const ours = ourTurnAgain(node, me, budget)
      if (ours === null) continue

      for (const next of legalMoves(ours)) {
        // Passing on our own behalf would hand the search a turn the real game never gives it.
        if (next.type === 'pass') continue
        if (budget.left <= 0) break
        spendBeam(budget)
        const played = resolveChain(resolve(ours, next), me, asRole, inner, budget, chainCap)
        // No alpha at an interior level: there a branch's value is the MAX over its leaves, so a poor
        // reply at this node says nothing about what the branch can still reach. `best` rather than
        // the caller's alpha, because it is the tighter of the two and both bound this root.
        // The cut is only a bound while this level is actually minimising; past `replyDepth` the
        // reply is a no-op and alpha would be meaningless.
        const policy = replyAt(d + 1)
        const leafAlpha = last && cutting && policy === 'pessimistic' ? best : -Infinity
        const board = applyReply(played, me, asRole, inner, policy, budget, leafAlpha, d + 1, chainCap)
        const value = valueAt(board, me, asRole, inner, d + 1)
        if (value > best) best = value
        if (board.winner === me) won = true
        if (!last) children.push({ board, value })
      }
    }

    if (last || children.length === 0) break
    // Sort is stable, so equal scores keep `legalMoves` order and the trim is deterministic.
    children.sort((a, b) => b.value - a.value)
    frontier = children.slice(0, limits.width).map(c => c.board)
  }

  return { best, won }
}

/**
 * Does the SHIPPED search find a win from here?
 *
 * Built for #433's measurement rather than for play. "How often does the lethal solver find a win the
 * bot misses" can only be answered against the beam's real discipline: it trims by evaluation score,
 * so a winning line whose setup step scores badly can be pruned even though the depth would reach it.
 * A lethal-shaped search prunes on damage relevance instead and keeps such lines.
 *
 * Answers for `me`, taking the null move first if it is not their turn, so it asks the same question
 * as `hasLethal` and the two are comparable.
 */
export function beamReachesWin(
  state: GameState,
  me: PlayerId,
  inner: Evaluator,
  limits: BeamLimits = DEFAULT_BEAM_LIMITS,
): boolean {
  const budget = searchBudget(limits.nodes)
  const ours = ourTurnAgain(state, me, budget)
  if (ours === null) return false

  // Asking whether a win EXISTS, so nothing may be pruned on value: alpha bounds the SCORE a branch
  // can reach, and a cut leaf that happened to be a win would go unrecorded. Passing `-Infinity` is
  // no longer enough on its own, since the deepest level now cuts against its own running best.
  const exhaustive = { ...limits, alphaBeta: false }
  const asRole = role(ours, me)
  for (const move of legalMoves(ours)) {
    if (move.type === 'pass') continue
    if (reachableFrom(ours, move, me, asRole, inner, exhaustive, budget, -Infinity).won) return true
  }
  return false
}
