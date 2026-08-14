import type { GameState, PlayerId } from '../engine/types'
import { opponentOf } from '../engine/types'
import { effectivePower, effectiveHp } from '../engine/stats'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { handValue, DEFAULT_HAND_WEIGHTS, type HandWeights } from './handValue'
import {
  role, canFinishThisAction, canFinishNow, lockoutSwing, reachSteady, remainingBase, type Role,
} from './race'

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
  /**
   * Per Advantage token, replacing `power` for the points those tokens contribute.
   *
   * Advantage is a 1/0 token, so it already reaches the evaluation through `power`. What is wrong is
   * the rate: **printed power is a recurring stream and a token is a single payment.** A unit with 3
   * power deals 3 every time it attacks; a token deals 1 once and is then spent, along with the rest
   * of its stack. Charging both at `power` over-values the token by roughly the attacks the unit has
   * left in it.
   *
   * **Ships equal to `power`, which is a deliberate break from the ship-at-zero convention.** Zero
   * would assert a token is worthless, which is a large change rather than a neutral one; equality
   * reproduces today's behaviour exactly and the sweep runs downward.
   *
   * Measured over 3,982 decisions before this existed: a token is in play on 20.7%, a decision turns
   * on a carrier on 8.3%, 76% of tokens are eventually spent (80% of those attacking, only 4.6%
   * defending), and 23.5% die with their unit having delivered nothing.
   */
  advantage: number
  /**
   * Per Advantage token on an **exhausted** carrier, replacing `advantage` for those.
   *
   * A ready carrier can spend the token this round; an exhausted one readies at regroup, which is a
   * round away and past the search's horizon, and the opponent gets a turn in between to kill it
   * first. Under a pessimistic reply that is what the search assumes will happen.
   *
   * The lethal side needs no help here: `canFinishThisAction` already filters exhausted units out, so
   * an exhausted carrier's tokens never counted toward finishing this round. This closes the gap in
   * the **material** term, where `presence` sums power across ready and exhausted units alike.
   *
   * Ships equal to `power`, so the split is a no-op until swept.
   */
  advantageExhausted: number
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
  /**
   * Per Shield token, ours minus theirs (#493).
   *
   * **The one token the evaluation cannot otherwise see, and its stat line is why.** Attached
   * upgrades add their printed power and HP, so Experience (1/1) and Advantage (1/0) already reach
   * the model through `power` and `hp`. A Shield is printed **0/0** and works through a
   * damage-prevention hook, so without this term it changes nothing anything reads.
   *
   * The consequence is worse than under-valuing it. A Shield absorbs a whole instance of damage, so
   * the board after a strip holds the same units at the same HP and differs only by an unscored
   * token: it scores **identically**, making the strip indistinguishable from doing nothing while the
   * attack's cost is counted in full. Measured over 420 games, the bot strips an available Shield
   * 7.4% of the time against random play's 17.9%, which is avoidance rather than indifference.
   *
   * Flat per token rather than "what it will prevent", matching how every other board term here is
   * priced. A refinement scaled by the incoming threat is only worth trying if flat measures positive.
   */
  shield: number
  /**
   * Per point of the **lockout swing**, ours minus theirs (#499). The quantity is
   * {@link lockoutSwing}: what a shielded blocker denies us plus what it deals us, over the rounds
   * the game has left.
   *
   * `reachSteady` already returns zero for a locked attacker, but zero cannot distinguish a lane shut
   * for the rest of the game from a lane that is simply empty. Without this, killing a blocker is
   * worth its body and nothing more, and the bot sits behind a shielded Sentinel indefinitely rather
   * than spend two actions clearing it.
   *
   * **Two flat versions were measured and rejected before this one**, and both failed on shape:
   *
   * - **Ungated** (any Sentinel, per round): live on 24.2% of decisions against a 2.1% lockout, and
   *   it measured **25.0%**. It was a board-wide bias against Sentinels.
   * - **Gated but flat** (shielded blockers, per round): **49.6% +/- 1.0%** over 9,600 games, missing
   *   a pre-registered 49.0% bound with 6 of 10 shards below 50%.
   *
   * The second is why the quantity is now a stream. Denied reach rises as locked units accumulate
   * while the value of clearing falls as the game runs out, so a per-round reading is loudest when the
   * bot is already dead and quietest when acting would have saved it. That ordering is backwards and
   * no weight repairs it.
   *
   * **What the bot is actually being paid to overcome.** Refusing is materially correct: the Shield
   * absorbs the whole attack so the blocker takes nothing, the counter kills the attacker, and the
   * board is a body down for a token. Measured at a steady 11 to 12 points across a filed game. The
   * bot is not blind to the Shield, it strips the moment the strip is cheap; what it cannot see is
   * that the lane pays out in later rounds, which is exactly what this quantity supplies.
   *
   * **Bent hard by role.** Grinding down a blocker while the other lane could win the race is a
   * losing habit, so this matters to the defender and barely at all to the aggressor.
   *
   * **Capped** at `blockedReachCap`, because a canny opponent blocks a lane, holds a second Sentinel
   * back, and drops it once the tempo has been spent clearing the first. Removing a blocker must
   * never be worth more than about two bodies.
   */
  blockedReach: number
  /**
   * Ceiling on the lockout swing, in points of base damage. See `blockedReach`.
   *
   * Raised from 10 with the quantity: a per-round reading topped out around 10, while a swing over
   * four rounds runs to the twenties. 24 is about two bodies at weight 1, which is the trade the term
   * exists to authorise and the most it should ever buy.
   */
  blockedReachCap: number
  /** Value of holding the initiative, i.e. of acting first next round (#394). */
  initiative: number
  /**
   * Extra value for holding the initiative when the holder is the side facing lethal next round
   * (#446), so acting first is their one chance to answer it. Zero elsewhere, which is what separates
   * it from raising `initiative`: that is flat and measured monotonically harmful.
   */
  initiativeHorizon: number
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
  /**
   * Being one enemy action away from death, and having them one action away from ours (#443).
   *
   * Applied symmetrically, so `publicScore` stays zero-sum, and it reads only the board, so it stays
   * public. Two properties make it unusually well behaved:
   *
   * - **It cancels where it cannot help.** 82% of exposed positions are exposed under EVERY legal
   *   move, and an identical penalty on every candidate changes no ranking. It discriminates only in
   *   the 18% where a real choice exists, with no special-casing.
   * - **It rewards the answer, not just the retreat.** Playing a Sentinel, exhausting the attacker or
   *   killing it all make the check false, so those moves score better for free.
   *
   * A weight rather than a prohibition: sometimes every move is exposed, and sometimes accepting it
   * is right. A winning move still scores WIN, so the bot never refuses a win to stay safe.
   */
  lethalExposure: number
  /** Private half: what the scored seat's own hand is worth (#393). See `handValue`. */
  hand: HandWeights
}

/**
 * Every weight that is a **price**: charged as `weight x quantity` and summed.
 *
 * Scaling all of them by one constant multiplies every score by it, so orderings are untouched, ties
 * stay ties and the bot plays identically. That is what lets the shipped values be doubled: it buys
 * half-step resolution for free, and `aiWeightScale.test.ts` evidences the invariance rather than
 * asserting the arithmetic.
 *
 * `saturation` and `blockedReachCap` are deliberately absent: the first is a pool SIZE (where "enough
 * resources" begins), the second caps a quantity. Scaling either is a real behaviour change. The
 * private `hand` weights are absent too, because they are squashed into `[0, 1)` and their whole
 * purpose is to sit below the public resolution.
 */
export const PRICE_KEYS = [
  'base', 'unit', 'power', 'advantage', 'advantageExhausted', 'hp', 'card', 'resource',
  'resourceSurplus', 'readyUnit', 'shield', 'blockedReach', 'initiative', 'claimCost',
  'initiativeHorizon', 'roleShift', 'lethalExposure',
] as const satisfies ReadonlyArray<keyof Omit<EvalWeights, 'hand' | 'saturation' | 'blockedReachCap'>>

/** Multiply every price by `factor`, leaving the structural numbers and the private half alone. */
export function scalePrices(w: EvalWeights, factor: number): EvalWeights {
  const out = { ...w }
  for (const key of PRICE_KEYS) out[key] = w[key] * factor
  return out
}

// Tuned by a weight sweep against the frozen baseline across the 42 coverage decks (#392): a unit
// weight of 6 over-valued raw bodies (4 beat 6 beat 8); power 2 / HP 1 are right (raising either hurt);
// base 4 edged 3 and 5. See bench/tune.ts to re-sweep.
//
// **Every price below is DOUBLE the value that sweep chose.** Scaling all prices by a constant cannot
// change a decision (see `PRICE_KEYS`), so this is a pure reparameterisation that buys half-step
// resolution: the old optimum of 1 is now 2, and 1.5 is expressible as 3. Halve a price to read it in
// the units the historical results are quoted in.
export const DEFAULT_WEIGHTS: EvalWeights = {
  base: 8,
  unit: 8,
  power: 4,
  // Equal to `power`: a no-op until swept downward. See the field docs for why not zero.
  advantage: 4,
  advantageExhausted: 4,
  hp: 2,
  card: 4,
  resource: 6,
  // MEASURED NEUTRAL AT BEST: equal to `resource`, i.e. the pool is deliberately shipped FLAT.
  // See the concavity note above `resourceValue` before changing this. While the two are equal the
  // pool collapses to `resource x pool` and `saturation` is algebraically inert, whatever it is set to.
  resourceSurplus: 6,
  // NOT a price and so NOT doubled: this is the pool size where the knee sits, in resources.
  saturation: 7,
  readyUnit: 2,
  // #493. OFF until swept, per the rule that a new weight ships at zero: shipping a default before
  // its A/B ran once inverted a whole reading, because the candidate was then the ablation.
  shield: 0,
  // #499. OFF until swept, per the rule that a new weight ships at zero.
  blockedReach: 0,
  // Two attackers' worth of denied reach. Above this, clearing a blocker starts to justify the tempo
  // that a held-back second Sentinel exists to punish. NOT a price and so NOT doubled: this caps a
  // quantity, in damage, and doubling it would double how much reach the term can ever see.
  blockedReachCap: 24,
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
  //
  // Note `claimCost` charges per READY UNIT forfeited and nothing for the cards it stops you playing,
  // so claiming while holding an affordable bomb is currently free.
  initiative: 2,
  claimCost: 4,
  // #446. OFF until swept, per the rule that a new weight ships at zero. Conditional where the flat
  // `initiative` weight above is not: it pays only on the 13.0% of claim offers where the holder is
  // the side facing lethal next round, which is the case the search cannot see across the round
  // boundary. The flat version of the same idea is monotonically harmful, so the sweep starts low.
  initiativeHorizon: 0,
  // Swept (#395) in the old units, where 1 and 2 tied and 3 and 4 were worse: so 2 here, and the
  // untested half-step is 3. The effect is modest at 51.4% +/- 0.9% over ~11,340 games (three
  // matched-power seeds: 50.2%, 52.8%, 51.2%) against a role-blind AI, roughly a third of what #393 or
  // #394 each returned.
  //
  // **The one weight measured to have woken up under search**: pivotal on 12.1% of decisions against
  // 7.7% one ply deep, and the only one of the four #430 predicted that moved. It is also the only one
  // of them whose value is about the CURRENT board rather than next round, which is the horizon the
  // search still cannot cross.
  roleShift: 2,
  // #443. Sized to outweigh a good trade (a strong unit is worth roughly 40 here) without
  // approaching a win, then swept. Measured before building: the 408 avoidable exposures across 1260
  // games carried a 22.1 point loss-rate penalty, 68.9% against a 46.8% baseline.
  lethalExposure: 48,
  hand: DEFAULT_HAND_WEIGHTS,
}

/** The three board quantities, before any weight is applied. Separated so the term breakdown and the
 *  score itself count bodies, power and HP exactly once, in one place. */
interface Presence {
  units: number
  power: number
  hp: number
  /** Advantage tokens on ready carriers, repriced off `power`. See {@link advantageCorrection}. */
  advantage: number
  /** Advantage tokens on exhausted carriers, which cannot spend them this round. */
  advantageExhausted: number
}

/**
 * `countAdvantage` is off on the hot path whenever the Advantage rates equal `power`, which is how
 * they ship. Counting tokens means walking every unit's upgrade array on **every evaluation**, and
 * the correction it feeds is provably zero at those weights: work for nothing. `blockedReach` is
 * guarded for the same reason, and it was expensive enough to time out a test before it was.
 */
function presence(state: GameState, id: PlayerId, countAdvantage: boolean): Presence {
  const out: Presence = { units: 0, power: 0, hp: 0, advantage: 0, advantageExhausted: 0 }
  for (const unit of state.players[id].units) {
    out.units++
    out.power += effectivePower(state, unit)
    out.hp += Math.max(0, effectiveHp(state, unit) - unit.damage)
    if (!countAdvantage) continue
    const tokens = unit.upgrades.filter(u => u.cardId === TOKEN_ADVANTAGE).length
    if (unit.exhausted) out.advantageExhausted += tokens
    else out.advantage += tokens
  }
  return out
}

/** Whether either Advantage rate differs from `power`, i.e. whether the correction can be non-zero. */
const advantagePriced = (w: EvalWeights): boolean =>
  w.advantage !== w.power || w.advantageExhausted !== w.power

/**
 * Reprice Advantage tokens from `power` to `advantage`.
 *
 * Written as a **correction on top of the existing power sum** rather than by excluding tokens from
 * it. Two reasons. It is provably a no-op when the weights are equal, which is how it ships, so the
 * change cannot move the bot until it is deliberately swept. And it does not assume each token
 * contributes exactly +1 to `effectivePower`: whatever the stats pipeline says power is, that stands,
 * and this only adjusts the rate the tokens within it are charged at.
 *
 * Advantage lasts until its unit next completes an attack or defence, so printed power is a recurring
 * stream and a token is a single payment. Charging both at `w.power` over-values the token by roughly
 * the number of attacks the unit has left.
 */
function advantageCorrection(p: Presence, w: EvalWeights): number {
  return (w.advantage - w.power) * p.advantage
    + (w.advantageExhausted - w.power) * p.advantageExhausted
}

/**
 * Board value of a player's units: a fixed bonus per body (unit count), plus power, plus a light
 * remaining-HP term. Deployed leaders live in `units`, so they count too. Defeating a unit removes
 * its whole contribution (the real trade swing); chipping only shaves the small HP part.
 */
function boardPresence(state: GameState, id: PlayerId, w: EvalWeights): number {
  const p = presence(state, id, advantagePriced(w))
  return w.unit * p.units + w.power * p.power + w.hp * p.hp + advantageCorrection(p, w)
}

/**
 * The lockout swing, capped. See `blockedReach` for why the ceiling is not optional.
 *
 * Exported so a diagnostic reports the quantity the evaluation actually prices. Differencing the
 * UNCAPPED value instead reported a largest quantity of 26 against a cap of 10, which is a number the
 * model never sees.
 */
export function blockedFor(state: GameState, id: PlayerId, w: EvalWeights): number {
  return Math.min(lockoutSwing(state, id), w.blockedReachCap)
}

/** Shield tokens a seat is carrying, counted per token rather than per shielded unit. */
function shields(state: GameState, id: PlayerId): number {
  return state.players[id].units.reduce(
    (n, u) => n + u.upgrades.filter(up => up.cardId === TOKEN_SHIELD).length,
    0,
  )
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
    // Race first, control second (#499). The defender cannot win the race and must remove the
    // blocker; the aggressor should be racing in the other lane rather than grinding.
    //
    // **Zero stays zero.** An additive bend on a weight shipped at 0 quietly switches it on for one
    // role, which would put an unmeasured term in the shipped model and break the rule that a new
    // weight defaults to off until swept.
    blockedReach: w.blockedReach === 0
      ? 0
      : r === 'defender' ? w.blockedReach + w.roleShift : Math.max(0, w.blockedReach - w.roleShift),
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
  return holding + horizonValue(state, me, w)
    - w.claimCost * forfeitedTempo(state, me) + w.claimCost * forfeitedTempo(state, foe)
}

/**
 * Extra value for holding the initiative when acting first next round is the difference (#446).
 *
 * The search stops dead at the round boundary, so the whole of turn order is out of sight, and "take
 * it" is the largest tie in the model at **15.3%** of 2,164 offers. Raising the flat `initiative`
 * weight is a measured dead end (4 -> 46.8%, 6 -> 35.4%, 8 -> 29.4%), because it buys turn order with
 * whole turns everywhere rather than where it matters.
 *
 * The predicate is the one that was measured: the **holder of the initiative is the side facing lethal
 * next round**, so acting first is their chance to answer it. That is 13.0% of claim offers, split
 * 10.4% denial and 2.6% conversion, and it is silent on the rest.
 *
 * **Seat-relative on purpose.** Asking "can the opponent finish me" would not survive a seat swap, and
 * `publicScore` has to stay zero-sum or a pessimistic reply is minimising a different function from
 * the one the root maximises. Written as holder-threatened, the term negates cleanly.
 *
 * Guarded at zero so the deployed configuration pays nothing: `reachSteady` and `canFinishNow` are far
 * too expensive for an unconditional call on this path.
 */
function horizonValue(state: GameState, me: PlayerId, w: EvalWeights): number {
  if (w.initiativeHorizon === 0) return 0
  const threatened = (seat: PlayerId): number => {
    if (state.initiative !== seat) return 0
    // Able to finish this round makes it moot: we would simply win rather than buy turn order.
    if (canFinishNow(state, seat)) return 0
    const other = opponentOf(seat)
    return reachSteady(state, other) >= remainingBase(state, other) ? 1 : 0
  }
  return w.initiativeHorizon * (threatened(me) - threatened(opponentOf(me)))
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
  const { full, surplus } = resourceSplit(state, id, w)
  return w.resource * full + w.resourceSurplus * surplus
}

/**
 * The pool either side of the knee. This is where `saturation` lives, and it is the reason
 * `saturation` has no term of its own: it is not a price, it decides how many resources are charged
 * at `resource` and how many at `resourceSurplus`. While those two rates are equal the split cannot
 * change any total, which is exactly why the shipped flat pool makes the knee algebraically inert.
 */
function resourceSplit(state: GameState, id: PlayerId, w: EvalWeights): { full: number; surplus: number } {
  const p = state.players[id]
  const leaderCost = state.cards[p.leader.cardId]?.cost ?? 0
  const knee = p.leader.deployed ? w.saturation : Math.max(w.saturation, leaderCost)
  const pool = p.resources.length
  const full = Math.min(pool, knee)
  return { full, surplus: pool - full }
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
    // Symmetric like every other board term, so the public half stays zero-sum: a Shield is worth
    // exactly what it costs the other seat.
    const shielding = w.shield * (shields(state, me) - shields(state, foe))
    // Guarded, unlike the other terms: `blockedReach` runs the targeting rules per unit, which is far
    // dearer than the array scans the rest do. Computing it while the weight is 0 slowed the suite
    // enough to time a test out. Same reasoning as `roleAdjusted` returning early on `roleShift: 0`.
    const denied = w.blockedReach === 0
      ? 0
      : w.blockedReach * (blockedFor(state, foe, w) - blockedFor(state, me, w))
    const initiative = initiativeValue(state, me, w)
    // Symmetric, so this stays zero-sum: being one action from killing them is worth exactly what
    // being one action from death costs.
    const exposure = w.lethalExposure
      * ((canFinishThisAction(state, me) ? 1 : 0) - (canFinishThisAction(state, foe) ? 1 : 0))

    return baseTerm + board + cards + resources + tempo + shielding + denied + initiative + exposure
  }
}

/** One linear term: the quantity on the board, and the price it is charged at. */
export interface Term {
  quantity: number
  weight: number
}

/** The linear coefficients, i.e. every public weight that prices a quantity. `saturation` and
 *  `roleShift` are absent by construction: neither is a price. See `resourceSplit` and `roleAdjusted`. */
export type LinearTermKey =
  | 'base' | 'unit' | 'power' | 'advantage' | 'advantageExhausted' | 'hp' | 'card' | 'resource'
  | 'resourceSurplus'
  | 'readyUnit' | 'shield' | 'blockedReach' | 'initiative' | 'claimCost' | 'lethalExposure'

/**
 * `publicScore` broken into `weight x quantity` per term (#430), for the term-sensitivity diagnostic.
 *
 * ## Why this exists
 *
 * One ply only ever compares candidates from a SINGLE position, so a term whose quantity is equal
 * across those candidates adds the same constant to every score and cancels exactly, whatever its
 * weight. Separating quantity from weight is what makes "this term cannot influence anything" a
 * measurable claim rather than an argument.
 *
 * ## The contract
 *
 * **Summing `weight * quantity` over these terms must equal `makePublicScore(w)(state, me, asRole)`
 * exactly**, for every undecided position. It is a second reading of the same arithmetic, kept
 * separate so scoring stays a plain sum with nothing to allocate, and `benchTerms.test.ts` pins the
 * two together over real boards rather than fixtures.
 *
 * Undecided only: a finished game short-circuits to +/-WIN before any term is computed, so there is
 * nothing to decompose.
 *
 * Weights are reported ROLE-ADJUSTED, because those are the prices actually charged.
 */
export function publicBreakdown(
  state: GameState,
  me: PlayerId,
  w0: EvalWeights,
  asRole?: Role,
): Record<LinearTermKey, Term> {
  const w = roleAdjusted(state, me, w0, asRole)
  const foe = opponentOf(me)
  // Always counted here: this is the diagnostic, not the hot path, and a term reporting a silent zero
  // because of an optimisation would be worse than the cost it saves.
  const mine = presence(state, me, true)
  const theirs = presence(state, foe, true)
  const myPool = resourceSplit(state, me, w)
  const theirPool = resourceSplit(state, foe, w)

  return {
    base: { weight: w.base, quantity: state.players[foe].base.damage - state.players[me].base.damage },
    unit: { weight: w.unit, quantity: mine.units - theirs.units },
    power: { weight: w.power, quantity: mine.power - theirs.power },
    // The correction, carried at its own rate so the identity holds: `power` already charged these
    // tokens at `w.power`, and this pays the difference. Zero quantity contribution when equal.
    advantage: { weight: w.advantage - w.power, quantity: mine.advantage - theirs.advantage },
    advantageExhausted: {
      weight: w.advantageExhausted - w.power,
      quantity: mine.advantageExhausted - theirs.advantageExhausted,
    },
    hp: { weight: w.hp, quantity: mine.hp - theirs.hp },
    card: { weight: w.card, quantity: state.players[me].hand.length - state.players[foe].hand.length },
    resource: { weight: w.resource, quantity: myPool.full - theirPool.full },
    resourceSurplus: { weight: w.resourceSurplus, quantity: myPool.surplus - theirPool.surplus },
    readyUnit: { weight: w.readyUnit, quantity: readyUnits(state, me) - readyUnits(state, foe) },
    shield: { weight: w.shield, quantity: shields(state, me) - shields(state, foe) },
    blockedReach: { weight: w.blockedReach, quantity: blockedFor(state, foe, w) - blockedFor(state, me, w) },
    initiative: { weight: w.initiative, quantity: state.initiative === me ? 1 : -1 },
    // Charged to whoever claimed, so the quantity is their forfeited tempo less ours.
    claimCost: { weight: w.claimCost, quantity: forfeitedTempo(state, foe) - forfeitedTempo(state, me) },
    lethalExposure: {
      weight: w.lethalExposure,
      quantity: (canFinishThisAction(state, me) ? 1 : 0) - (canFinishThisAction(state, foe) ? 1 : 0),
    },
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
