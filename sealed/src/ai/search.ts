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
import { upgradeHostility } from './upgradeValue'

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
  /**
   * The principal variation behind each candidate, in `legalMoves` order. Only present when
   * `BeamLimits.explain` is set.
   */
  lines?: SearchLine[]
  /** How many candidates tied for the lead, so the seeded pick or the tie-break decided between them. */
  tiedCandidates: number
  /**
   * How many candidates were still level once the second opinion had spoken, so the **seeded pick**
   * chose. This, not `tiedCandidates`, is the rate at which the bot genuinely flips a coin.
   *
   * The two are the same number wherever no tie-break is configured or none applies. Where one does,
   * the gap between them is the only measure of whether it is doing anything: a second opinion that
   * ties just as often has been paid for and consulted to no effect, and nothing in the output has ever
   * said so.
   */
  finalists: number
  /**
   * What `pass` was charged, so a reader can recover the score it would have had.
   *
   * Without it the charge is invisible after the fact: `candidates` holds the value AFTER the penalty,
   * so "would this decision have gone the other way for free" cannot be answered, and that is the only
   * question that says whether the charge is buying real actions or rubbish.
   */
  passPenalty: number
}

/** How a root candidate earned its value: the best board it reached, and the moves that got there. */
export interface SearchLine {
  /** Same number as the matching entry in `candidates`. */
  value: number
  /** The level the peak was found at. 1 means the move was judged on its immediate result. */
  peakDepth: number
  /** Our own moves down to that peak, opening with the root candidate. One per level. */
  path: Action[]
  /**
   * The peak board itself.
   *
   * The path alone cannot reproduce it: the opponent's replies happen between our moves and are not
   * recorded, so replaying our own actions lands somewhere else entirely. Carrying the board is the
   * only way to ask what was actually true at the peak, which is the question that matters when two
   * candidates score alike.
   */
  board: GameState
}

/**
 * Mark a board as one being searched rather than played.
 *
 * The whole of the hidden-information guarantee at the round boundary, and it is one stamp at the root
 * rather than a check at each crossing, because there are three of those (the root candidate, the
 * modelled reply, the frontier expansion) and a fourth would be added without anyone noticing. State
 * is copied on every `resolve`, so the flag reaches every board the search can reach.
 *
 * See `GameState.simulatedRegroup` for exactly what it changes.
 */
export function asSimulation(state: GameState): GameState {
  return state.simulatedRegroup === true ? state : { ...state, simulatedRegroup: true }
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
   * Per level of depth, subtracted from every UNDECIDED board's score (#499). Zero is the behaviour
   * before this existed.
   *
   * The search has no time preference: reaching a given position at action 3 scores exactly what
   * reaching it at action 1 does, so **delay is free**. The only thing pushing the other way is the
   * reply, which charges for each action taken and therefore penalises acting rather than waiting.
   * That is the shape of the reported passivity: passing costs nothing and postpones everything.
   *
   * Decided boards keep their own `±depth` handling, which is a different concern (win soonest, lose
   * latest) and would double-count if this were applied on top.
   */
  timePreference?: number
  /**
   * Record the principal variation behind each root candidate, for diagnosis (#499). Off by default,
   * because tracking the path allocates per frontier node and the shipped bot should not pay for it.
   *
   * A root move's value is the max over every board reachable from it, so a bare value explains
   * nothing about WHY. Four wrong hypotheses about the shielded-Sentinel lockout came from having to
   * infer the line from two numbers and a mental model of this file.
   */
  explain?: boolean
  /**
   * Search overrides used to re-rank candidates that tied, or absent for no tie-break (#499).
   *
   * A tie is a decision the search cannot see: every candidate scores the same and the seeded
   * tie-break picks at random. That is 11.3% of choice answers, 5.4% of resourcing and 11.8% of card
   * plays for the shipped bot.
   *
   * No evaluation term can fix the ones that matter. In the shielded-Sentinel lockout both candidates
   * peak on the **same end state at the same depth**, differing only in the route, and a max over
   * reachable boards discards the route. What separates them is a **different search**: under
   * `reply: 'null'` the acting line beats passing 56.1 to 52, while `pessimistic` ties them at 43.
   *
   * Pluggable rather than fixed, because the right second opinion is a per-case question. `{ reply:
   * 'null' }` asks the optimist when the pessimist is silent; `{ depth: 1 }` is the one-ply tie-break
   * proposed for #396 and #398, which is measurably wrong for the lockout.
   *
   * **Only ever applied to candidates that already tied for the lead.** A second opinion allowed to
   * overrule a clear winner is a different bot, not a tie-break.
   */
  tieBreak?: Partial<BeamLimits>
  /**
   * Decision kinds this second opinion applies to, or absent for all of them.
   *
   * Ties for the lead are not spread evenly and neither is the case for consulting a second model:
   * attack 39.5%, answer 36.1%, play 33.4%, pass 31.0%, resource 24.5%, initiative 11.5%. #396 and
   * #398 are specifically about decisions whose value lies past the horizon, and the beam makes those
   * ties WORSE rather than better (resourcing 0.6% to 5.4%, card play 6.7% to 11.8%), because a
   * candidate is valued by the best board it reaches and converging lines come out equal.
   *
   * So "does a second opinion help the decisions those tickets are about" has to be askable separately
   * from "does it help everywhere". An **empty** list silences it rather than meaning all, so a typo
   * cannot quietly produce a working arm under a restricted name.
   *
   * Only meaningful inside `tieBreak`; ignored on the outer limits.
   */
  tieKinds?: string[]
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
  /**
   * How many round boundaries one line may EXPAND past (#516). **Defaults to 0, which is the search
   * without a horizon.**
   *
   * Zero does not mean the boundary is never reached. A move that ends the action phase crosses it in
   * the engine whatever this says, and that board is scored; zero means the line stops there, which is
   * where it always stopped. What redaction changed is only that the board is now honest. Splitting the
   * two here is deliberate: the leak fix must be shippable on its own, and a horizon has to be measured
   * against a control that does not have one.
   *
   * At 1 a line runs on into the opening of the next round. Beyond that is a different bot: every
   * crossing hands both sides a resource and readies everything, and `ourTurnAgain` passes for the
   * opponent to get our turn back, so under `reply: 'null'` a line can run "they pass, we claim, the
   * round ends" repeatedly and bank a resource a round from an opponent who does nothing. Left
   * unbounded, a depth-3 search reached **two** rounds ahead unprompted on the first position tried.
   *
   * The null-move assumption was always the beam's soft spot, and across a boundary it compounds:
   * the further the line runs the more of its value rests on the opponent's continued silence.
   *
   * A board past the allowance is not produced at all rather than scored and left unexpanded. Scoring
   * it would put its value into the running best, which is precisely the value being distrusted.
   */
  maxCrossings?: number
  /**
   * Redact the regroup the search crosses. On by default; `false` restores the pre-#516 behaviour of
   * scoring boards that contain cards nobody has drawn.
   *
   * **Exists only so the fix can be measured.** Redaction is a correctness change rather than a
   * strength claim, but "correct" and "no worse" are different assertions, and the second one needs a
   * control that differs in exactly this. The same role `greedy-flat` plays for quiescence and
   * `beam-reply-shared` for the per-chain allowance: a control that tracks every other change, so an
   * A/B measures one thing rather than a snapshot's worth of drift.
   *
   * Not a supported way to play. The only sanctioned reading of `false` is "the arm this is being
   * compared against".
   */
  redactRegroup?: boolean
  /**
   * How many actions the opponent may take **after we claim the initiative**, before the line assumes
   * they pass and the round ends (#516). Defaults to 0, which assumes they stop the moment we do.
   *
   * Claiming makes us pass for the rest of the round (CR 1.15.5b), and `advanceTurn` bounces the turn
   * straight back to them, so they keep acting while we cannot. **That freedom is the price of the
   * claim, and at 0 the search does not charge it.** The reply gives them one action at the level the
   * claim was made, and `ourTurnAgain` then passes on their behalf, so the line models an opponent who
   * takes a single action and gives up their remaining turn for nothing.
   *
   * Gated on `initiativeTakenBy` being US, so it never touches the ordinary between-our-actions null
   * move. Widening it there would be a different and much larger change: it would stop the beam from
   * being an own-turn search at all.
   *
   * Uses the configured reply policy rather than a policy of its own, since that is already the model
   * of the opponent this search believes in. Under `null` there is no tail, which is consistent: an
   * opponent assumed to do nothing does nothing here too.
   *
   * Costly, and deliberately capped rather than run to exhaustion: each action enumerates every legal
   * move they have, and a claim can leave a full board's worth of them.
   */
  tailActions?: number
  /**
   * What to do when claiming the initiative is still level after the second opinion. `undefined` leaves
   * it to the seeded pick, which is what ships.
   *
   * **A measurement, not a heuristic.** A coin flip is the current policy by default rather than by
   * decision, and nobody has ever asked what the two deliberate answers are worth. `take` and `avoid`
   * bracket it: if both lose to the flip then the flip is right and the tie is genuinely balanced; if
   * one wins, the search is systematically mispricing turn order in one direction and the size of the
   * gap says by how much.
   *
   * Applied only to candidates that are ALREADY level, after the tie-break, so it can never overrule a
   * decision the search actually made. That is the same discipline `tieBreak` follows, and for the same
   * reason: a rule allowed to beat a clear winner is a different bot rather than a tie policy.
   */
  initiativeTie?: 'take' | 'avoid'
  /**
   * Charged against `pass` at the root, in evaluation points (#521). Zero is the behaviour before this
   * existed.
   *
   * **The margin by which passing must win to be chosen**, which is the requirement stated directly
   * rather than approximated. Measured, the bot makes about 2.7 discretionary mid-round passes a game
   * against a competent player's ~0.15.
   *
   * It cannot be an evaluation weight. `evaluate` prices BOARDS, and passing barely changes the board:
   * the same position with the turn handed over scores almost identically, which is the whole defect.
   * So the charge belongs to the candidate, in the search, where the comparison happens.
   *
   * **Bounded from both sides, and the sweep is finding where in between.** Too small and nothing
   * changes. Too large and the bot plays a card for no benefit rather than pass, which is a worse
   * behaviour than the one being fixed: the floor is that passing must still beat burning a card for
   * nothing.
   *
   * Applied at the root only, which is the only place `pass` is ever a candidate: the frontier skips it
   * explicitly, and the pass `ourTurnAgain` makes is the OPPONENT's, which must not be charged.
   */
  passPenalty?: number
  /**
   * Among candidates the search has already declared equal, prefer putting a hostile upgrade on an
   * ENEMY unit rather than a friendly one (#509). Off by default.
   *
   * **Tie-only for a principled reason, not a cautious one.** A class of upgrades does nothing to the
   * board when played and everything later: -3 power attacking a base, doubled incoming damage, a tax
   * on readying. Where the host can act inside the horizon the search plays that out, the engine
   * applies the effect and it already chooses correctly, measured 5 of 5. Where nothing can act, the
   * effect is unreachable and every target scores the same. So "the search is blind to this" and "the
   * search returned a tie" are the SAME set of positions, and a rule confined to ties covers the whole
   * defect while being unable to overrule any judgement the search actually made.
   */
  upgradeTie?: boolean
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
  return (real: GameState): Action | null => {
    // Everything below searches the SIMULATION, so any line that ends the action phase crosses a
    // modelled regroup rather than the real one and never reads a card off the deck. The action
    // returned is ordinary data and is applied by the caller to the real board.
    const state = limits.redactRegroup === false ? real : asSimulation(real)
    const budget = searchBudget(limits.nodes)
    const moves = legalMoves(state)
    if (moves.length === 0) {
      trace = {
        nodes: limits.nodes, left: budget.left, chain: 0, beam: 0, exhausted: false,
        candidates: [], tiedCandidates: 0, finalists: 0, passPenalty: limits.passPenalty ?? 0,
      }
      return null
    }

    const me = state.activePlayer
    const asRole = role(state, me)

    let best = -Infinity
    const bestMoves: Action[] = []
    const candidates: number[] = []
    const lines: SearchLine[] = []
    for (const move of moves) {
      // `best` so far is alpha: a candidate that cannot beat it need not be finished.
      const { best: raw, line } = reachableFrom(state, move, me, asRole, inner, limits, budget, best)
      const value = chargeForPassing(raw, move, limits)
      candidates.push(value)
      if (line) lines.push(line)
      if (value > best) {
        best = value
        bestMoves.length = 0
        bestMoves.push(move)
      } else if (value === best) {
        bestMoves.push(move)
      }
    }
    const finalists = limits.tieBreak && bestMoves.length > 1
      && tieBreakApplies(state, bestMoves, limits.tieBreak.tieKinds)
      ? breakTie(state, bestMoves, me, asRole, inner, limits)
      : bestMoves

    // Recorded before returning, so a caller can ask what this decision cost and whether the rail cut
    // it short. Overwritten every decision: it describes the last one, never a running total.
    //
    // Written AFTER the tie-break so `finalists` can be reported. Safe because `breakTie` runs
    // `reachableFrom` directly rather than re-entering this function, so it never writes the trace.
    trace = {
      nodes: limits.nodes,
      left: budget.left,
      chain: budget.chain,
      beam: budget.beam,
      exhausted: budget.left <= 0,
      candidates,
      lines: limits.explain === true ? lines : undefined,
      tiedCandidates: bestMoves.length,
      finalists: finalists.length,
      passPenalty: limits.passPenalty ?? 0,
    }

    const afterInitiative = settleInitiativeTie(finalists, limits.initiativeTie)
    const afterUpgrade = limits.upgradeTie === true && afterInitiative.length > 1
      ? settleUpgradeTie(state, afterInitiative, me)
      : afterInitiative
    // Unconditional, because it restores the behaviour that existed before the ordering choice did
    // rather than introducing a new preference. See `settleTriggerOrderTie`.
    const decided = afterUpgrade.length > 1 ? settleTriggerOrderTie(state, afterUpgrade) : afterUpgrade
    return decided[Math.floor(seededUnit(state.rngSeed) * decided.length)]
  }
}

/**
 * The decision kinds a tie-break may be restricted to.
 *
 * The same vocabulary the `--decisions` tie split reports, so a rate read off that readout names the
 * arm that would act on it. Exported for the registry to validate against, rather than restated there:
 * a spec that parses to a kind the search never produces would silence the arm while looking
 * configured, which is the most expensive way this can fail.
 */
export const TIE_DECISION_KINDS = ['attack', 'answer', 'play', 'resource', 'initiative', 'pass', 'other'] as const

/** One move's kind. Matches `decisionKind` in the diagnostic, less the pending-choice case, which is
 *  a property of the position rather than of any single candidate. */
function kindOfMove(m: Action): string {
  switch (m.type) {
    case 'attack': return 'attack'
    case 'playUnit': case 'playEvent': case 'playUpgrade': return 'play'
    case 'resourceCard': case 'skipResource': return 'resource'
    case 'takeInitiative': return 'initiative'
    case 'pass': return 'pass'
    default: return 'other'
  }
}

/**
 * Whether a restricted second opinion applies to this decision.
 *
 * A pending choice classifies the whole decision as `answer` however its candidates are typed, because
 * the card handed the player a menu rather than the player choosing to have one. Otherwise a tied set
 * can hold several kinds at once (an attack against a pass is the commonest), and **any** named kind
 * being present is enough: the restriction exists to spend the second opinion where it helps, not to
 * demand a homogeneous tie, which would almost never fire.
 */
function tieBreakApplies(state: GameState, tied: Action[], kinds: string[] | undefined): boolean {
  if (kinds === undefined) return true
  if (kinds.length === 0) return false
  if (hasPendingChoices(state)) return kinds.includes('answer')
  return tied.some(m => kinds.includes(kindOfMove(m)))
}

/**
 * Re-rank candidates that tied, using a second search, and return whichever now lead.
 *
 * Given only the tied moves, so it can never overrule a candidate that already won: a second opinion
 * with that power would be a different bot rather than a tie-break.
 *
 * Its own budget, because the main search may have spent most of the pool getting here and a
 * tie-break starved of nodes would return noise.
 *
 * **It fires far more often than the whole-slate tie columns imply, and still costs little.** Ties for
 * the LEAD are 32.0% of decisions against those columns' 5-12%, because sharing the top is a much
 * weaker condition than every candidate scoring alike. Firing sets average 3.2 candidates, which comes
 * to **+13.4% more root searches** across a run: the decisions that fire are mostly small ones.
 *
 * A fan-out cap is optional rather than structural, which is the opposite of what the widest tie
 * suggests. One decision tied **239** candidates, but wide ties are 2.3% of firings and a cap at 8
 * only moves the overhead from +13.4% to +11.2%. The 239 is an answer-a-choice decision, the kind
 * where a card deals out a combinatorial menu; ordinary moves top out around 26.
 *
 * Roots overstate it badly, though, because a second opinion prices each root lower than the search
 * that found the tie. Timed over an identical corpus, `reply: 'null'` costs **+2.1%** per decision
 * (203.73 ms against 199.51 ms) and a depth-1 second opinion is inside the noise of a single timing
 * pass. Against a +13.4% bound in roots, the feature is cheap; whether it helps is the open question.
 *
 * Still deterministic. If the second opinion also ties, the survivors go back to the seeded pick.
 */
function breakTie(
  state: GameState,
  tied: Action[],
  me: PlayerId,
  asRole: Role | undefined,
  inner: Evaluator,
  limits: BeamLimits,
): Action[] {
  const second: BeamLimits = { ...limits, ...limits.tieBreak, tieBreak: undefined, explain: false }
  const budget = searchBudget(second.nodes)
  let best = -Infinity
  const winners: Action[] = []
  for (const move of tied) {
    const { best: raw } = reachableFrom(state, move, me, asRole, inner, second, budget, best)
    const value = chargeForPassing(raw, move, second)
    if (value > best) {
      best = value
      winners.length = 0
      winners.push(move)
    } else if (value === best) {
      winners.push(move)
    }
  }
  return winners.length > 0 ? winners : tied
}

/**
 * When the search cannot separate "I resolve first" from "they resolve first", resolve first.
 *
 * **A regression guard rather than a heuristic.** Before the ordering choice existed the engine always
 * made the active player go first; adding the choice (CR 7.6.10) replaced a fixed sensible answer with
 * a seeded coin flip wherever the search is indifferent, which it is on the scripted position that
 * raised this: both options score 24.
 *
 * Resolving first is the better default because your abilities act on the board as it stands, before
 * the opponent's have changed it. Applied only to a tie, so the search overrules it whenever it can
 * actually see a difference, which is the whole point of asking.
 */
export function settleTriggerOrderTie(state: GameState, tied: Action[]): Action[] {
  const isOrder = (m: Action): boolean =>
    m.type === 'acceptChoice'
    && (state.pendingChoices ?? []).some(c => c.id === m.choiceId && c.kind === 'chooseTriggerOrder')
  if (!tied.every(isOrder)) return tied
  const first = tied.filter(m => m.type === 'acceptChoice' && (m.optionIndex ?? 0) === 0)
  return first.length > 0 ? first : tied
}

/**
 * Break a tie by where a hostile upgrade would land.
 *
 * Ranks the tied candidates and keeps the joint best, so it narrows rather than picks: if nothing
 * separates them the seeded choice still decides, and the search stays deterministic.
 *
 * A non-upgrade candidate scores 0, which is deliberately BETWEEN putting a hostile upgrade on an enemy
 * (positive) and on a friendly unit (negative). Doing something else entirely is better than making our
 * own unit worse, and worse than a free debuff on theirs.
 */
export function settleUpgradeTie(state: GameState, tied: Action[], me: PlayerId): Action[] {
  const foe = opponentOf(me)
  const rank = (move: Action): number => {
    if (move.type !== 'playUpgrade' || move.targetInstanceId === undefined) return 0
    const card = state.players[me].hand[move.handIndex]
    if (card === undefined) return 0
    const mine = state.players[me].units.find(u => u.instanceId === move.targetInstanceId)
    const theirs = state.players[foe].units.find(u => u.instanceId === move.targetInstanceId)
    const host = mine ?? theirs
    if (!host) return 0
    const hostility = upgradeHostility(state, host, card)
    return mine ? -hostility : hostility
  }
  let best = -Infinity
  const winners: Action[] = []
  for (const move of tied) {
    const score = rank(move)
    if (score > best) { best = score; winners.length = 0; winners.push(move) }
    else if (score === best) winners.push(move)
  }
  return winners.length > 0 ? winners : tied
}

/**
 * Charge a root candidate for doing nothing.
 *
 * A function rather than an inline subtraction because it is applied in two places, the main search and
 * the tie-break's second opinion, and a penalty missing from the second would let `pass` win a tie it
 * had already been charged out of.
 */
function chargeForPassing(value: number, move: Action, limits: BeamLimits): number {
  const penalty = limits.passPenalty ?? 0
  return penalty !== 0 && move.type === 'pass' ? value - penalty : value
}

/**
 * Settle a tie that still contains `takeInitiative`, under a deliberate policy instead of a coin flip.
 *
 * Returns the survivors rather than a move, so the seeded pick still chooses among whatever is left and
 * the search stays deterministic. A no-op unless a policy is set AND claiming is actually among the
 * tied candidates, so it cannot touch a decision that was decided on merit.
 *
 * `avoid` falls back to the untouched list when claiming is the ONLY survivor: removing the last
 * candidate would leave nothing to play, and "never claim" cannot mean "never move".
 */
export function settleInitiativeTie(tied: Action[], policy: 'take' | 'avoid' | undefined): Action[] {
  if (policy === undefined || tied.length < 2) return tied
  const claim = tied.find(m => m.type === 'takeInitiative')
  if (claim === undefined) return tied
  if (policy === 'take') return [claim]
  const others = tied.filter(m => m.type !== 'takeInitiative')
  return others.length > 0 ? others : tied
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
function valueAt(
  board: GameState,
  me: PlayerId,
  asRole: Role | undefined,
  inner: Evaluator,
  depth: number,
  timePreference = 0,
): number {
  const raw = inner(board, me, asRole)
  // An undecided board is worth slightly less the later it arrives, so the same outcome reached
  // sooner wins. Without it, delay is free and the search has no reason to hurry.
  if (board.winner === null) return raw - timePreference * depth
  // A draw scores 0 from either side, so there is no sign to preserve and nothing to prefer.
  if (raw === 0) return raw
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

/**
 * Let the opponent spend the rest of the round, once WE have claimed and cannot act.
 *
 * The asymmetry this prices is real and is the reason the claim decision has been unreadable. Claiming
 * buys turn order next round and pays for it with every action we still had, plus a free run for the
 * opponent while we sit out. The search could see neither half: the payoff was past the round boundary,
 * and the cost was modelled as a single action followed by them politely passing.
 *
 * Stops early on any of: the allowance, the budget, the phase ending (their own pass ends it, since we
 * are already passing), or the reply declining to move. Returning the board unchanged is always safe,
 * and is exactly the behaviour before this existed.
 */
function opponentTail(
  state: GameState,
  me: PlayerId,
  asRole: Role | undefined,
  inner: Evaluator,
  limits: BeamLimits,
  budget: SearchBudget,
  chainCap: number,
): GameState {
  const allowance = limits.tailActions ?? 0
  // ONLY where we have claimed. Anywhere else the opponent holding the turn is the ordinary null move
  // between our own actions, and handing them extra actions there is a different search entirely.
  if (allowance === 0 || state.initiativeTakenBy !== me) return state

  const foe = opponentOf(me)
  let node = state
  for (let i = 0; i < allowance; i++) {
    if (node.winner !== null || node.phase !== 'action' || node.activePlayer !== foe) break
    if (budget.left <= 0) break
    // No alpha: a cut is only a valid bound on a board nothing is expanded past, and the whole point
    // here is that the line continues through this board into the next round.
    const next = applyReply(node, me, asRole, inner, limits.reply, budget, -Infinity, 0, chainCap)
    if (next === node) break
    node = next
  }
  return node
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
  /** Present only when `limits.explain` is set. */
  line?: SearchLine
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
  // The tail belongs INSIDE the node, not at a level of its own. A root move's value is the max over
  // the boards below it, and a max is only sound over boards we could choose to stop at. After a claim
  // we cannot act, so the opponent's free run is not optional and its cost has to be inside the board
  // being scored. Hung off the reply for the same reason it uses the reply's policy: it is the same
  // model of the opponent, applied where they have more than one turn.
  const root = opponentTail(
    applyReply(settled, me, asRole, inner, replyAt(1), budget, rootAlpha, 1, chainCap),
    me, asRole, inner, limits, budget, chainCap,
  )
  let best = valueAt(root, me, asRole, inner, 1, limits.timePreference)
  let won = root.winner === me
  // Path tracking only when explaining: it allocates per frontier node, and the shipped bot should
  // not pay for a diagnostic.
  const explaining = limits.explain === true
  let peakDepth = 1
  let peakPath: Action[] = explaining ? [move] : []
  let peakBoard = root
  let frontier: Array<{ board: GameState; path: Action[] }> = [{ board: root, path: peakPath }]

  // Boundaries are counted from the board being decided from, so the allowance covers the whole line
  // rather than resetting at each level. `round` is already on the board, so no per-node bookkeeping.
  const startRound = state.round
  const crossings = limits.maxCrossings ?? 0
  const tooFar = (board: GameState): boolean => board.round - startRound > crossings

  for (let d = 1; d < limits.depth; d++) {
    if (budget.left <= 0) break
    // The deepest level is expanded but never continued from, so its boards are ordinary leaves: the
    // frontier built from them would be discarded unread, and alpha is a real bound on them.
    const last = d === limits.depth - 1
    const children: Array<{ board: GameState; value: number; path: Action[] }> = []

    for (const entry of frontier) {
      const node = entry.board
      if (node.winner !== null || node.phase !== 'action') continue
      const ours = ourTurnAgain(node, me, budget)
      if (ours === null) continue
      // Passing for the opponent can itself end the phase, so the allowance is checked here too.
      if (tooFar(ours)) continue

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
        const board = opponentTail(
          applyReply(played, me, asRole, inner, policy, budget, leafAlpha, d + 1, chainCap),
          me, asRole, inner, limits, budget, chainCap,
        )
        if (tooFar(board)) continue
        const value = valueAt(board, me, asRole, inner, d + 1, limits.timePreference)
        const path = explaining ? [...entry.path, next] : entry.path
        if (value > best) {
          best = value
          peakDepth = d + 1
          peakPath = path
          peakBoard = board
        }
        if (board.winner === me) won = true
        if (!last) children.push({ board, value, path })
      }
    }

    if (last || children.length === 0) break
    // Sort is stable, so equal scores keep `legalMoves` order and the trim is deterministic.
    children.sort((a, b) => b.value - a.value)
    // The children already carry `board` and `path`, so reuse them rather than allocating a fresh
    // wrapper per surviving node: that re-wrap cost the shipped bot measurable time for a diagnostic
    // it never turns on.
    frontier = children.slice(0, limits.width)
  }

  return {
    best,
    won,
    line: explaining ? { value: best, peakDepth, path: peakPath, board: peakBoard } : undefined,
  }
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
  const ours = ourTurnAgain(asSimulation(state), me, budget)
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
