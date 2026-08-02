import type { GameState, PlayerId } from '../engine/types'
import { opponentOf } from '../engine/types'
import { effectivePower, effectiveHp } from '../engine/stats'
import { handValue, DEFAULT_HAND_WEIGHTS, type HandWeights } from './handValue'
import { role, type Role } from './race'

/**
 * Board evaluation for the greedy AI (#391), unit-count-centred for trades (#392): a single number,
 * higher is better for `me`.
 *
 * The board term is built around what decides trades: unit COUNT (being up a body is the biggest
 * swing), relative power, and base pressure. Remaining HP counts only lightly, so damage is
 * *progress toward removal* without either overvaluing chip or reading a surviving-but-damaged unit
 * as a big loss; only DEFEATING a unit is the real swing.
 *
 * ## Public and private halves (#393)
 *
 * `publicScore` is zero-sum ("my stuff minus their stuff"), so
 * `publicScore(s, player) === -publicScore(s, opponent)`. It reads only what both players can see,
 * including hand SIZE.
 *
 * `evaluate` adds a private half on top: what `me`'s hand is actually worth, which needs the card
 * identities. Those are hidden information, so the term is applied to the scored seat ONLY:
 * subtracting the opponent's would mean peeking at their hand. `evaluate` is therefore subjective
 * rather than zero-sum, which costs nothing at one ply, since greedy only ever scores from the
 * acting seat. Anything that scores a position from BOTH seats (#400's pessimistic minimax) must
 * call `evaluate(s, foe)` rather than negating `evaluate(s, me)`.
 *
 * The weights are parameterised (`makeEvaluate`) so a weight sweep can measure candidates against the
 * frozen baseline (see `bench/tune.ts`).
 */

/** A decisive result outweighs any reachable material score. */
const WIN = 1_000_000

/**
 * A board evaluation.
 *
 * `asRole` is the role of the seat being scored **for the whole decision**, and passing it is not
 * optional in spirit: the caller must fix the role ONCE from the position it is deciding in, then
 * score every candidate with it.
 *
 * Deriving the role per candidate instead was measured and is badly wrong. Greedy scores
 * `evaluate(resolve(state, move), me)`, and **32.5% of decisions have candidate moves landing in
 * different roles**, so their scores would be computed with different weight sets and would not be
 * comparable. That silently rewards whichever move flips the role, regardless of merit, and it gets
 * worse as `roleShift` grows: 44.2% at shift 1 down to 26.3% at shift 4 against a role-blind AI.
 * Fixing the role per decision is what makes role awareness coherent at all.
 */
export type Evaluator = (state: GameState, me: PlayerId, asRole?: Role) => number

export interface EvalWeights {
  base: number // per point of damage on a base (the win condition)
  unit: number // per unit in play (the dominant board term)
  power: number // per point of a unit's effective power
  hp: number // per point of a unit's remaining HP (light, so damage is progress not a big loss)
  card: number // per card in hand (public: hand SIZE is visible to both players)
  resource: number // per resource in the pool up to the knee (total, not ready: all ready each round)
  /**
   * Per resource ABOVE the knee. Lower than `resource`, which is what makes the pool's value
   * concave: once you can already cast what you hold, banking another card buys nothing and the card
   * is worth more. Below `card` means the bot stops banking; at or above it, it never does.
   */
  resourceSurplus: number
  /**
   * Pool size at which resources stop being fully valuable. Grounded in the pool rather than taste:
   * ASH's non-leader costs have p90 = 6, and only 21 of 238 cards cost 7 or more, so 7 resources
   * casts 91% of the set. Raised to the leader's deploy cost while it is still undeployed.
   */
  saturation: number
  readyUnit: number // per ready (unexhausted) unit, a light tempo term
  /** Value of holding the initiative, i.e. of acting first next round (#394). */
  initiative: number
  /**
   * Per ready unit forfeited by having claimed the initiative this round (#394). Claiming makes you
   * pass for the rest of the round, so this is what that costs. Scaled by ready units rather than
   * flat, because the whole judgement is how much you were giving up.
   */
  claimCost: number
  /**
   * How far the aggressor and defender roles pull the weights apart (#395). See `roleAdjusted`.
   * Zero disables role awareness entirely, which is the control the sweep measures against.
   */
  roleShift: number
  /** Private half: what the scored seat's own hand is worth (#393). See `handValue`. */
  hand: HandWeights
}

// Tuned by a weight sweep against the frozen baseline across the 42 coverage decks (#392): a unit
// weight of 6 over-valued raw bodies (4 beat 6 beat 8); power 2 / HP 1 are right (raising either hurt);
// base 4 edged 3 and 5. See bench/tune.ts to re-sweep.
export const DEFAULT_WEIGHTS: EvalWeights = {
  base: 4,
  unit: 4,
  power: 2,
  hp: 1,
  card: 2,
  resource: 3,
  // MEASURED NEUTRAL AT BEST: equal to `resource`, i.e. the pool is deliberately shipped FLAT.
  // See the concavity note above `resourceValue` before changing this.
  resourceSurplus: 3,
  saturation: 7,
  readyUnit: 1,
  // Swept twice. Turn order is worth far less than it first looks: raising `initiative` is
  // monotonically worse (4 -> 46.8%, 6 -> 35.4%, 8 -> 29.4% against the same AI with both terms at
  // 0), because the bot buys it by giving up whole turns. `claimCost: 0` is the always-claim failure
  // mode and measured 41.1%.
  //
  // The two INTERACT: the higher `initiative`, the more `claimCost` it takes to pay for it. At 3 it
  // needs a cost of 5 just to reach parity, while at 1 it is fine even at 0. Lowered from 2/3 after
  // a 146-cell grid put the best cell here, and six paired seeds at 8400 games each confirmed it at
  // +0.62% (positive on all six, 100,800 games).
  //
  // Untested: at `initiative: 1` the brake may be doing little, since `claimCost: 0` measured 50.6%
  // against this cell's 50.7%. Worth its own A/B before assuming the cost term still earns its place.
  initiative: 1,
  claimCost: 2,
  // Swept (#395). A small shift is all the data supports: 1 and 2 tie, 3 and 4 are worse, and the
  // effect is modest at 51.4% +/- 0.9% over ~11,340 games (three matched-power seeds: 50.2%, 52.8%,
  // 51.2%) against a role-blind AI. Roughly a third of what #393 or #394 each returned.
  roleShift: 1,
  hand: DEFAULT_HAND_WEIGHTS,
}

/**
 * Board value of a player's units: a fixed bonus per body (unit count), plus power, plus a light
 * remaining-HP term. Deployed leaders live in `units`, so they count too. Defeating a unit removes
 * its whole contribution (the real trade swing); chipping only shaves the small HP part.
 */
function boardPresence(state: GameState, id: PlayerId, w: EvalWeights): number {
  let total = 0
  for (const unit of state.players[id].units) {
    total += w.unit
    total += w.power * effectivePower(state, unit)
    total += w.hp * Math.max(0, effectiveHp(state, unit) - unit.damage)
  }
  return total
}

function readyUnits(state: GameState, id: PlayerId): number {
  return state.players[id].units.filter(u => !u.exhausted).length
}

/**
 * Bend the weights toward the role the scored seat is currently playing (#395).
 *
 * A single fixed evaluation cannot play both sides of a matchup: the same board is good news for the
 * aggressor and bad news for the defender. The role comes from the RACE (`ai/race.ts`), not from
 * board advantage, because board power is not damage that can reach a base. Measured over 132 games,
 * the faster clock at round 3 went on to win 68.0% of the time against 62.0% for the board leader,
 * and 80.5% by round 5.
 *
 * - The **aggressor** is winning the race, so it pushes damage and is readier to ignore trades.
 * - The **defender** is losing it, so it values trades and board clearing (the Sealed control plan,
 *   where removal is scarce) and wants the initiative, which is #394's own steer.
 *
 * Weights stay INTEGER so `publicScore` does, which is what keeps #393's private hand term a
 * tie-break. Clamped at zero so a large shift can never make a player's own units read as a
 * liability.
 */
function roleAdjusted(state: GameState, me: PlayerId, w: EvalWeights, asRole?: Role): EvalWeights {
  if (w.roleShift === 0) return w
  const r = asRole ?? role(state, me)
  if (r === 'neutral') return w
  const shift = r === 'aggressor' ? w.roleShift : -w.roleShift
  return {
    ...w,
    base: Math.max(0, w.base + shift),
    unit: Math.max(0, w.unit - shift),
    initiative: r === 'defender' ? w.initiative + w.roleShift : w.initiative,
  }
}

/**
 * Ready units a player has effectively forfeited by claiming the initiative this round.
 *
 * Claiming makes you pass for the rest of the round: `advanceTurn` (`resolve.ts`) skips the
 * claimant's turns while `initiativeTakenBy` names them. So everything still ready is wasted.
 *
 * The `phase` guard is what makes the cheap window fall out WITHOUT hardcoding CR 1.15.5c. Claiming
 * into an opponent who has already passed ends the action phase outright (`takeInitiative` calls
 * `enterRegroup` when `consecutivePasses >= 1`), so the resulting state is no longer in the action
 * phase and nobody has actions left to lose. A mid-phase claim leaves `phase === 'action'` with the
 * flag set, and is charged.
 */
function forfeitedTempo(state: GameState, id: PlayerId): number {
  if (state.phase !== 'action' || state.initiativeTakenBy !== id) return 0
  return readyUnits(state, id)
}

/**
 * What the initiative is worth to `me`: the value of acting first next round, less what claiming it
 * costs whoever claimed (#394).
 *
 * PUBLIC on both halves, so it belongs in the zero-sum score and is allowed to outrank other moves,
 * which it has to be to ever justify giving up a turn. That is the opposite of the hand term, which
 * is hidden information and therefore bounded to a tie-break.
 *
 * Note the ticket's "claiming after their pass costs nothing" is not quite right: it always costs
 * you your own remaining actions. What the cheap window avoids is the usual penalty of sitting out
 * while the opponent keeps playing, and that is what `forfeitedTempo` prices.
 */
export function initiativeValue(state: GameState, me: PlayerId, w: EvalWeights): number {
  const foe = opponentOf(me)
  const holding = w.initiative * (state.initiative === me ? 1 : -1)
  return holding - w.claimCost * forfeitedTempo(state, me) + w.claimCost * forfeitedTempo(state, foe)
}

/**
 * What a player's resource pool is worth, optionally with the marginal resource getting cheaper past
 * a knee.
 *
 * ## Shipped FLAT, and that is a measured result (#393 iteration 2)
 *
 * The theory was sound and the behaviour worked: a flat rate makes banking a card worth a fixed
 * public +1 at every regroup, so the bot banks one EVERY round of every game, which is wrong late on
 * (you draw 2 at regroup either way, so banking is "+1 resource against +1 card retained"). Setting
 * `resourceSurplus` below `card` made it skip 12.5% of regroups, all at a pool of exactly the knee.
 *
 * It did not win. Against the identical AI with a flat pool, across the coverage decks:
 *
 *   saturation 7, surplus 1  : 49.7% +/- 1.9%  (5040 games)  -> neutral
 *   saturation 8, surplus 0/1: 47.6% +/- 3.4%
 *   saturation 6, surplus 0/1: 46.1% +/- 3.4%
 *   saturation 5, surplus 0/1: 45.6% +/- 3.4%  -> significantly worse
 *
 * Monotone in the knee: the more concavity, the worse. So it is left flat (`resourceSurplus` equal
 * to `resource`, which also makes `saturation` inert) and the mechanism is kept only so the question
 * can be re-asked cheaply.
 *
 * Worth re-testing after #395: measurement showed the bot already leaves 1-2 resources UNSPENT per
 * round late on (mean spend 5.9 against pools of 7-8), so idle resources are real and the idea is
 * not obviously wrong. The likeliest reading is that resource count also proxies development and
 * tempo for every other decision, and flattening it costs more signal than the one regroup decision
 * it fixes. A role-aware evaluation may separate those.
 *
 * The knee rises to the leader's deploy cost while the leader is still in the base zone, which
 * encodes "always resource until you can deploy your leader". That gate really is a resource COUNT:
 * `legalMoves.ts` deploys on CONTROLLING resources equal to the leader's cost (CR 2.6.1, controlled
 * rather than spent). The printed cost is the right number for all 18 ASH leaders, including the two
 * with custom `deployCondition`s: Bo-Katan's gate is `resources + Mandalorians >= 10` against a
 * printed 10, and Grogu never deploys this way and costs 4, which collapses to the default.
 *
 * PUBLIC, so it belongs in the zero-sum half: you can see the opponent's resource row and their
 * leader. Each side is measured against its own leader, which keeps the term antisymmetric.
 */
export function resourceValue(state: GameState, id: PlayerId, w: EvalWeights): number {
  const p = state.players[id]
  const leaderCost = state.cards[p.leader.cardId]?.cost ?? 0
  const knee = p.leader.deployed ? w.saturation : Math.max(w.saturation, leaderCost)
  const pool = p.resources.length
  const full = Math.min(pool, knee)
  return w.resource * full + w.resourceSurplus * (pool - full)
}

/**
 * The half built only from what both players can see, including hand SIZE but never hand contents.
 *
 * Zero-sum **while both seats read the same role**, which is every neutral position and any
 * symmetric one. Role awareness (#395) deliberately breaks it otherwise: an aggressor and a defender
 * are meant to price the same board differently, and that is the entire premise of #395. Greedy only
 * ever scores from the acting seat, so one ply is unaffected; anything scoring BOTH seats (#400,
 * #425) must call `evaluate(s, foe)` rather than negating.
 *
 * Split out from `evaluate` so the remaining invariants (zero-sum in the neutral case, and
 * integer-valued always) stay directly testable now that a private term rides on top.
 */
export function makePublicScore(w0: EvalWeights): Evaluator {
  return (state, me, asRole) => {
    if (state.winner === me) return WIN
    if (state.winner === 'draw') return 0
    if (state.winner !== null) return -WIN

    // Weights are bent by the role the scored seat is playing. `asRole` is the caller's role for the
    // WHOLE decision; see the note on `Evaluator` for why deriving it per candidate is wrong.
    const w = roleAdjusted(state, me, w0, asRole)
    const foe = opponentOf(me)
    const baseTerm = w.base * (state.players[foe].base.damage - state.players[me].base.damage)
    const board = boardPresence(state, me, w) - boardPresence(state, foe, w)
    const cards = w.card * (state.players[me].hand.length - state.players[foe].hand.length)
    const resources = resourceValue(state, me, w) - resourceValue(state, foe, w)
    const tempo = w.readyUnit * (readyUnits(state, me) - readyUnits(state, foe))
    const initiative = initiativeValue(state, me, w)

    return baseTerm + board + cards + resources + tempo + initiative
  }
}

/**
 * Squash an unbounded hand value into `[0, 1)`, strictly monotonically.
 *
 * `K` sets where the curve discriminates best; typical hands score 4 to 12 raw, so 10 keeps them in
 * the responsive middle rather than saturated near 1. Its exact value only stretches the ordering,
 * never reverses it.
 */
const HAND_SQUASH = 10
const squash = (x: number): number => x / (x + HAND_SQUASH)

/**
 * Build an evaluation function for a given set of weights.
 *
 * The private hand term is admitted **as a tie-break only**, and that is a guarantee rather than a
 * tuning choice. Every public weight and every quantity it multiplies is an integer, so
 * `publicScore` is integer-valued; squashing hand value into `[0, 1)` therefore makes it strictly
 * incapable of overriding a public preference. It can only order moves the public half rates
 * equally, which is exactly the blind spot: 100% of regroup resource picks were public ties decided
 * by a coin flip.
 *
 * This was measured, not assumed. Letting the term compete on equal footing with the board score
 * cost win rate in proportion to its weight (a 1720-game sweep: 50% at hand weights near zero,
 * 39.8% at moderate, 26.0% at large), because it applies to EVERY decision while only fixing one.
 * Bounding it below the resolution of the public score keeps the fix and removes the distortion.
 */
export function makeEvaluate(w: EvalWeights): Evaluator {
  const publicHalf = makePublicScore(w)
  return (state, me, asRole) => {
    // A decided game has no hand worth valuing, and the private term must not blur the WIN cliff.
    if (state.winner !== null) return publicHalf(state, me, asRole)
    return publicHalf(state, me, asRole) + squash(handValue(state, me, w.hand))
  }
}

/** The public, zero-sum half of the default evaluation. */
export const publicScore = makePublicScore(DEFAULT_WEIGHTS)

/** How good `state` is for `me`, under the default (tuned) weights. */
export const evaluate = makeEvaluate(DEFAULT_WEIGHTS)
