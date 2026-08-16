import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import type { GameState, PlayerId, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'
import { opponentOf, hasPendingChoices } from '../engine/types'
import { buildCardDb } from '../engine/cardDb'
import { initGame } from '../engine/initGame'
import { legalMoves, enemyAttackTargets } from '../engine/legalMoves'
import { unitHasKeyword } from '../engine/keywords'
import { effectivePower } from '../engine/stats'
import { getCardDefinition } from '../engine/abilities'
import { resolve } from '../engine/resolve'
import { seededShuffle, nextSeed } from '../engine/rng'
import { COMMIT_ID } from '../buildIdentity'
import { evaluate, blockedFor, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { makeQuiescent, lastSearchTrace, clearSearchTrace } from '../ai/search'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { resolveAi } from '../ai/registry'
import { setupAi } from '../ai/setupAi'
import { role, reachSteady, canFinishNow, canFinishThisAction, type Role } from '../ai/race'
import { buildCoverageDecks } from './coverageDecks'

/**
 * Decision-quality diagnostics (#393).
 *
 * Win rate is a blunt instrument for a change like this: it moves a point or two over hundreds of
 * games and tells you nothing about WHY. What actually diagnosed #393 was counting how often the
 * evaluation had no opinion at all, every candidate move scoring identically, so the seeded
 * tie-break picked one at random. That number was 100% of regroup resource picks, and it is the
 * number a fix has to move.
 *
 * Kept as a permanent instrument rather than a throwaway probe, because the same measurement
 * applies to every later ticket in the AI series: a decision the evaluation cannot see shows up
 * here as a tie long before it shows up in a win rate.
 */

const POOL = ashSet as unknown as SwuCard[]

export interface DecisionConfig {
  gamesPerDeck: number
  seed: number
  aiName?: string
  stepCeiling?: number
  /**
   * Play only the first N coverage decks. For tests, which need the mechanism exercised rather than
   * the rates: a searching AI over all 44 decks is a quarter-hour, which does not belong in a suite.
   * Omit it for a real run, where the whole pool is the point.
   */
  deckLimit?: number
}

/** One kind of decision, and how often the evaluation had nothing to say about it. */
export interface DecisionStat {
  label: string
  /** Positions where this decision was offered with more than one candidate. */
  offered: number
  /** Of those, how many had every candidate scoring identically under **one ply** (a coin flip). */
  tied: number
  /**
   * The same count under the **AI actually being diagnosed**, taken from the values its search
   * computed rather than from a separate scorer.
   *
   * Equal to `tied` for a one-ply AI, which has no search to break anything. For a searching AI the
   * gap between the columns is the measurement, and it runs **both ways**: a beam values a move by
   * the best board its follow-ups reach, so it separates moves one ply cannot tell apart AND ties
   * moves one ply scores differently, when their lines converge inside the horizon.
   *
   * So this is not a refinement of `tied` and is not bounded by it. It is the rate at which the
   * **shipped bot** coin-flips, which is the blind spot that matters. #396 and #398 were told to
   * re-ask that question once the search landed, and it could not be asked before, because the tie
   * was always computed one-ply whatever AI was named.
   */
  tiedSearch: number
  /** Mean number of candidates, so a tie rate can be read against how much was at stake. */
  avgCandidates: number
}

/**
 * Whether the AI banks a card at regroup, and at what pool size. Separate from the tie counts
 * because this is not a blind spot: it is a strict public preference, so it reads as a behaviour
 * rather than an absence of one.
 *
 * Counts only regroups where there was actually a card to bank. An empty hand leaves `skipResource`
 * as the sole legal move (`legalMoves.ts: regroupPhaseMoves`), and a forced move is not a decision:
 * including those put a few percent of phantom "skips" in the numbers at absurd pool sizes.
 */
export interface ResourcingStat {
  banked: number
  skipped: number
  avgPoolWhenBanked: number
  avgPoolWhenSkipped: number
}

/**
 * What the AI does with the initiative (#394). Claiming makes you pass for the rest of the round, so
 * the question is always "is turn order worth more than what I still had to do".
 *
 * `cheap` is the window where the opponent has already passed: claiming then ends the phase
 * outright, so they gain nothing from your silence. It still costs your own remaining actions, which
 * is why it is called cheap rather than free.
 *
 * The named failure modes are never-claim and always-claim, so both raw counts are reported rather
 * than a rate alone.
 */
export interface InitiativeStat {
  offered: number
  taken: number
  cheapOffered: number
  cheapTaken: number
  /** Mean ready units the claimant still had when it claimed mid-phase: what it gave up. */
  avgForfeitedWhenClaimed: number
}

/**
 * Which role the AI is playing, sampled once per round (#395), and #319's evidence that the role is
 * read off the live board rather than fixed at deck load.
 *
 * `flipsPerGame` is the thrash detector: the role is meant to move when the race genuinely changes,
 * not every time a point of damage lands. `walledSamples` counts positions where a side's reach is
 * zero, which is the case board advantage is blindest to and the reason the role is read off the
 * clock instead.
 */
export interface RoleStat {
  aggressor: number
  defender: number
  neutral: number
  flipsPerGame: number
  walledSamples: number
  samples: number
}

/**
 * How far a candidate move actually resolved. Greedy scores the state a move produces, but not every
 * move finishes: some leave a choice owed before the action is complete, so the score is read off a
 * half-resolved board.
 *
 * Who owes it decides which fix applies, so the two are never merged. An opponent-owed answer needs
 * their reply resolved pessimistically; a self-owed one needs the mover's own sequence expanded.
 */
export type Resolution =
  | { kind: 'complete' }
  | { kind: 'self'; choiceKind: string }
  | { kind: 'opponent'; choiceKind: string }

/**
 * Classify the state a candidate move produced, from the mover's seat.
 *
 * `activePlayer` alone cannot answer this. The engine hands the turn to the opponent when an action
 * raises a choice they control (`handOffOpponentChoice`), so a state with them to move may be an
 * unfinished action rather than a completed one. Read the choice owners instead.
 *
 * A finished game is complete whatever is left pending: `evaluate` scores it terminally, so nothing
 * downstream would look at the choice.
 */
export function classifyResolution(next: GameState, me: PlayerId): Resolution {
  if (next.winner !== null) return { kind: 'complete' }
  const choices = next.pendingChoices ?? []
  // The opponent's is the one that BLOCKS, so it classifies the state when both are owed.
  const theirs = choices.find(c => c.controller === opponentOf(me))
  if (theirs) return { kind: 'opponent', choiceKind: theirs.kind }
  const mine = choices.find(c => c.controller === me)
  return mine ? { kind: 'self', choiceKind: mine.kind } : { kind: 'complete' }
}

/**
 * How often the evaluation is applied to a half-resolved board, which sizes the search work before
 * any of it is built.
 *
 * Candidate-level counts say how much of the search space is affected; position-level counts say how
 * many DECISIONS could be mis-ranked by it, which is the number that matters, since a position where
 * nothing suspends is scored correctly however many suspending moves exist elsewhere. `chosen*`
 * counts how often the AI committed to such a move, the narrowest reading of the same thing.
 */
export interface SuspendedStat {
  /** Candidate moves scored, across decisions with more than one option. */
  candidates: number
  /** Of those, how many left the OPPONENT owing an answer. */
  opponentAnswers: number
  /** Of those, how many left the mover owing an answer. */
  selfAnswers: number
  /** Decisions with more than one candidate. */
  positions: number
  /** Of those, how many had at least one opponent-owed candidate. */
  positionsWithOpponentAnswer: number
  /** Of those, how many had at least one self-owed candidate. */
  positionsWithSelfAnswer: number
  /** Decisions where the move actually chosen left the opponent owing an answer. */
  chosenOpponentAnswer: number
  /** Decisions where the move actually chosen left the mover owing an answer. */
  chosenSelfAnswer: number
  /** Opponent-owed choice kinds, most frequent first. One card driving it all is a different ticket
   *  from a broad spread, so the rate alone is not enough to act on. */
  opponentChoiceKinds: Array<{ kind: string; count: number }>
  /** Self-owed choice kinds, most frequent first. These separate the two candidate fixes: a chain
   *  the mover can finish on the spot needs the chain resolved, an `ambush` that opens a fresh
   *  attack needs a real second action expanded. */
  selfChoiceKinds: Array<{ kind: string; count: number }>
}

/**
 * How often a lethal line is available at all (#432).
 *
 * The ceiling on every rule built over a lethal solver: "claim the initiative when it converts to
 * lethal", "claim when it denies theirs", and the tap-out risk gate can each only fire as often as
 * lethal exists. Measuring it with `canFinishNow` costs a comparison, where learning it after
 * building a solver and a sampled belief model on top would cost several tickets.
 *
 * `theirs` is the one that sizes the risk gate: it is the position the bot would be walking into.
 */
export interface LethalStat {
  decisions: number
  /** Decisions where the acting seat's ready units AGGREGATE to lethal. */
  ours: number
  /** Decisions where the opponent's ready units aggregate to lethal. */
  theirs: number
  /**
   * The strict readings: a **single action** finishes it. Players alternate, so an aggregate spread
   * over three units is three attacks with three opponent replies in between, not a kill. One ply
   * can only guarantee the single-action version, so this is the honest denominator.
   */
  oursOneAction: number
  theirsOneAction: number
  /** Split by round: a rate concentrated late is worth much less than one spread through the game. */
  byRound: Array<{ round: number; decisions: number; ours: number; theirs: number }>
}

/**
 * Whether a decision walked into a lethal it could have avoided.
 *
 * `unavoidable` is the distinction that matters: if every legal move leaves the opponent able to
 * finish, the position is already lost and a risk gate recovers nothing. Counting those as headroom
 * would inflate the case for the whole belief-model programme.
 */
export function classifyExposure(chosenExposed: boolean, anyCandidateSafe: boolean): 'safe' | 'avoidable' | 'unavoidable' {
  if (!chosenExposed) return 'safe'
  return anyCandidateSafe ? 'avoidable' : 'unavoidable'
}

/**
 * Headroom for a tap-out risk gate (#432): not how often the opponent *could* finish, but how often
 * the AI **chose** to let them when it had a legal alternative, and what that cost.
 *
 * Needs no oracle, which is the point of measuring it this way. It also splits the question the
 * belief model is really being asked: exposure visible on the public board is a SEARCH failure that
 * two-ply fixes with no hidden information, and only what is left can justify sampling a hand.
 */
export interface ExposureStat {
  decisions: number
  /** The chosen move left the opponent able to finish. */
  exposed: number
  /** Of those, a legal move existed that would not have. */
  avoidable: number
  /** Of those, every legal move led there anyway: already lost, nothing to recover. */
  unavoidable: number
  games: number
  /** Games decided rather than drawn, the denominator for what a gate could have saved. */
  losses: number
  /** Seat-games (two per game) where that seat made at least one avoidable exposure. */
  gamesWithAvoidable: number
  /** Of those, how many that seat lost. */
  lostAfterAvoidable: number
  /** Seat-games with no avoidable exposure: the control. */
  gamesWithoutAvoidable: number
  /** Of those, how many that seat lost. The gap against `lostAfterAvoidable` is the whole finding,
   *  because "39% of losses followed one" means nothing without knowing the base rate. */
  lostWithoutAvoidable: number
}

/**
 * Deploying the leader into a board that answers it (#397, re-homed to #425).
 *
 * #425 claims to **subsume** #397's direct-pinning half: "do not deploy into a board that kills it"
 * is exactly what a reply policy computes, so a hand-coded power-versus-HP term would duplicate the
 * search and then need keeping consistent with it. That claim rests on this rate falling, so without
 * the readout #397 would be closed on an argument rather than evidence.
 *
 * A leader is a large investment and re-deploying costs the epic action, so losing one immediately is
 * among the most expensive mistakes available.
 */
export interface LeaderStat {
  deploys: number
  /** Deployed leaders defeated before the end of the round after the one they arrived in. */
  diedSoon: number
}

/**
 * Shields, and whether the bot ever strips one (#493).
 *
 * A Shield prevents a whole instance of damage, so a ping that removes one leaves the same units at
 * the same HP and differs only by a token no evaluation term reads. The resulting board scores
 * **identically**, which makes the strip indistinguishable from doing nothing while the attack's cost
 * (exhausting the attacker, exposing it to a counter) is counted in full.
 *
 * These rates decide whether that is worth fixing. Rare shields retire the ticket cheaply; common
 * shields with a low strip rate confirm at scale what was first seen in live play.
 */
export interface ShieldStat {
  /** Decisions taken with at least one shielded enemy unit on the board. */
  decisionsFacingShield: number
  /** Of those, decisions where some legal move would have removed a shield. */
  removalAvailable: number
  /** Of those, decisions where the bot actually took one. */
  removals: number
  /** Shielded enemy units present, summed over decisions, so "how many" can be read alongside. */
  shieldsSeen: number
  /** Decisions where one of OUR units carried a shield, the other side of the same blindness. */
  decisionsHoldingShield: number

  /**
   * Shielded enemy **Sentinels**, summed over decisions. A Sentinel forces every attacker in its
   * arena onto itself, so a Shield on one is categorically different from a Shield on a body: it
   * closes a lane rather than absorbing a hit.
   */
  shieldedBlockers: number
  /**
   * Decisions where at least **one arena** is shut: every ready attacker we have there is
   * Sentinel-forced onto a shielded unit, so no damage of ours reaches that lane's base.
   *
   * **This is the reported defect.** Measuring it board-wide instead (below) puts it at 0.3% of
   * decisions, because a single unit in the other arena reports the board as open while the lane in
   * question is shut for the rest of the game.
   */
  laneLocked: number
  /** Decisions where **every** arena we can attack in is shut, so nothing of ours lands anywhere. */
  lockedOut: number
  /** Rounds sampled once each from the player seat, the denominator for the two below. */
  roundsSampled: number
  /** Of those, rounds in which the seat was fully locked out. */
  lockedRounds: number
  /**
   * Longest run of consecutive locked rounds **within a single game**. The figure that decides
   * whether this is structural: one round is noise, four is a lost game.
   */
  longestLockout: number
}

/**
 * How often a second opinion on a tie would be consulted, and how much it would re-search (#499).
 *
 * **Not the same question as `DecisionStat.tiedSearch`**, which counts decisions where *every*
 * candidate scored alike. A tie-break fires whenever more than one candidate ties **for the lead**,
 * which is a far weaker condition and therefore a much larger number. Quoting the whole-slate rate as
 * a firing rate would understate the cost of the feature, possibly by a lot.
 *
 * Read off `SearchTrace.tiedCandidates`, which the search records on every decision whether or not a
 * tie-break is configured, so the price can be measured before it is paid.
 */
export interface TieStat {
  /** Decisions with more than one candidate where a search actually ran: the denominator. Zero for a
   *  one-ply AI, which has no lead to tie for. */
  searched: number
  /** Of those, decisions where more than one candidate tied for the lead. */
  fired: number
  /**
   * Tied candidates summed over firing decisions. **This is the cost**, not `fired`: a firing decision
   * re-searches its whole tied set, so a rare tie between six moves can cost more than a common one
   * between two.
   */
  tiedTotal: number
  /** Root candidates summed over the same decisions, so the fan-out reads as a fraction of the work
   *  the main search already did. */
  rootsWhenFired: number
  /**
   * Root candidates over **all** searched decisions. The honest denominator for overhead: the main
   * search does `rootsSearched` root searches and a tie-break adds `tiedTotal` on top, so their ratio
   * is the extra work in root-searches. Dividing by `fired` instead flatters it, because the
   * decisions that fire are not the average decision.
   */
  rootsSearched: number
  /** Most candidates ever tied in one decision: the worst case behind the mean. */
  widest: number
  /**
   * `tiedTotal` with each decision's tied set capped at {@link TIE_FANOUT_CAP}, which sizes the cheap
   * version of the feature.
   *
   * Worth its own counter because the mean hides the tail badly: a handful of decisions tie hundreds
   * of candidates, and re-searching those costs more than every ordinary tie put together. The gap
   * between this and `tiedTotal` is what a cap buys.
   */
  tiedTotalCapped: number
  /** Firing decisions whose tied set exceeds the cap: how often a cap would bite at all. */
  firedWide: number
  /**
   * Split by decision kind, because a coin flip between two attacks can lose a unit and one between
   * two resource picks usually cannot. Classified by the move actually chosen.
   *
   * `widest` is carried per kind so the worst case can be attributed rather than just reported. A tie
   * of a few hundred candidates is either a real property of one decision kind or an arithmetic
   * error, and the two look identical in a single global maximum.
   */
  byKind: Array<{ kind: string; searched: number; fired: number; tiedTotal: number; widest: number }>
}

/**
 * The fan-out a capped tie-break would allow. Not a tuned value and not wired into the search: it
 * exists so `tiedTotalCapped` reports against a stated number rather than an implied one.
 */
export const TIE_FANOUT_CAP = 8

/**
 * How often the `blockedReach` term is live, against how often the situation it was written for
 * actually occurs (#499).
 *
 * The term prices the base damage an enemy Sentinel denies us each round, and was motivated by the
 * shielded-Sentinel lockout: a lane shut for the rest of the game, which is 2.1% of decisions. But the
 * quantity keys on `sentinelLocked`, true whenever **any** enemy Sentinel forces our attackers,
 * shielded or not. The gap between the two rates is the difference between a narrow gate and a
 * board-wide bias against Sentinels.
 *
 * Kept as a permanent counter because the mistake generalises: at weight 12 this measured 25.0%
 * against the shipped bot, and reading the weight against the model's scale (every other weight is 1
 * to 7) plus the quantity against its frequency would both have predicted it.
 */
export interface BlockedReachStat {
  /** Decisions observed, the denominator. */
  decisions: number
  /** Of those, decisions where the quantity is non-zero, so the term moves the score at all. */
  active: number
  /** Of those, decisions where a lane is genuinely shut: the case the term was written for. */
  activeAndLaneShut: number
  /** Summed magnitude, so a mean contribution can be read against the weight. */
  totalQuantity: number
  /** Largest magnitude seen. Against `blockedReachCap` this says how often the ceiling binds. */
  widestQuantity: number
}

/**
 * Where Advantage tokens are and where they go (#497).
 *
 * Unlike a Shield, Advantage is **not** invisible: it is a 1/0 token, so it feeds `power` through
 * `withUpgrades` and counts toward lethal. What the evaluation gets wrong is the **timing**. Advantage
 * lasts only until its unit next completes an attack or defence, and `consumeAdvantage` then clears
 * the whole stack, so three tokens are +3 power for exactly one attack and are scored as a permanent
 * +3 until then.
 *
 * The gate this exists to settle: Shield prevalence was 15.8% of decisions, which is what justified
 * pricing it. If Advantage is rare here, #497 closes without a weight.
 */
export interface AdvantageStat {
  decisions: number
  /** Decisions with a token in play on either side: the prevalence headline. */
  decisionsWithAny: number
  /** Tokens in play, summed over decisions, so "how many" reads alongside "how often". */
  tokensSeen: number
  /** Most on a single unit at once. The mis-timing scales with the stack, so this bounds the error. */
  maxStack: number
  /** Decisions where some candidate move attacks WITH a carrier or attacks one. */
  decisionsOnCarrier: number
  /** Tokens spent by their unit attacking. */
  spentAttacking: number
  /** Tokens spent by their unit defending: the case a permanent model gets most wrong, because the
   *  owner never chose to spend them. */
  spentDefending: number
  /** Spent by something other than the combat the action resolved: an ability, a cost, a cleanup. */
  spentOther: number
  /** Tokens that left play on a defeated unit, never spent. Pure phantom value while they sat there. */
  diedUnspent: number
  /** Of those, tokens the acting seat lost with its own carrier. */
  diedUnspentOurs: number
  /**
   * Of those, tokens removed by killing the other seat's carrier.
   *
   * With `spentDefending`, this is the whole of "did we trade to strip their Advantage". Pooling the
   * two sides would hide the difference between wasting our own tokens and denying theirs, which are
   * opposite outcomes.
   */
  diedUnspentTheirs: number
  /** Token-grant choices the bot answered. */
  grantChoices: number
  /**
   * Of those, how many had every candidate scoring identically, so the recipient was a coin flip.
   *
   * The second symptom, found on #501: `power` sums across a side, so +N lands the same wherever it
   * goes and the model cannot prefer arming a 1-cost unit over a leader.
   */
  grantChoicesAllEqual: number
}

/**
 * What each side could do next round, at a decision where claiming the initiative is on offer (#446).
 *
 * Claiming makes you act first in the round **after** this one, and the search stops at the round
 * boundary, so the whole value of the decision is out of sight. That is why "initiative: take it" is
 * the largest tie in the model, at 15.3% of 2,164 offers.
 *
 * Everything readies at regroup, so `reachSteady` is what a side can land next round. Deliberately
 * ignores the two cards each player draws: they are unknown to a player at the moment of choosing,
 * and reading them off the deck would be information the bot should not have.
 */
export interface InitiativeOutlook {
  /** Our steady reach covers what is left of their base, so acting first next round wins. */
  weFinishNext: boolean
  /** Theirs covers ours. */
  theyFinishNext: boolean
  /** We can already finish this round, so claiming is moot: we would simply win instead. */
  lethalNow: boolean
}

/** Base damage still needed to finish `seat`. */
function baseRemaining(state: GameState, seat: PlayerId): number {
  const base = state.players[seat].base
  return (state.cards[base.cardId]?.hp ?? 30) - base.damage
}

export function initiativeOutlook(state: GameState, me: PlayerId): InitiativeOutlook {
  const foe = opponentOf(me)
  return {
    weFinishNext: reachSteady(state, me) >= baseRemaining(state, foe),
    theyFinishNext: reachSteady(state, foe) >= baseRemaining(state, me),
    lethalNow: canFinishNow(state, me),
  }
}

/**
 * The ceiling on #446's rule: how often claiming could convert a win, or deny one.
 *
 * Sized before the mechanism is built, because the rule fires only where claiming is offered **and**
 * acting first next round changes the outcome. Lethal is available on 4.3% of decisions and 0.0%
 * before round 5, so that conjunction may be very small even though the initiative tie is large.
 */
export interface InitiativeHorizonStat {
  /** Decisions where claiming was a legal move. */
  offered: number
  weFinishNext: number
  theyFinishNext: number
  /** Both: whoever acts first wins, so claiming decides the game. The conversion case. */
  bothFinishNext: number
  /** They can finish and we cannot: denial is the only out. The inverse case. */
  theyOnly: number
  /** Positions we could already finish this round, where claiming is moot. */
  lethalNow: number
  /** The conversion case, excluding positions we could already win outright. */
  conversionLive: number
  /** The denial case, excluding the same. */
  denialLive: number
  /** We finish and they do not, so the initiative is a convenience rather than the game. */
  weOnlyLive: number
  /** Neither side finishes next round: the baseline population, and the control for the two below. */
  quietOffers: number
  /**
   * How often the bot actually claimed in each bucket.
   *
   * **The prevalence figures alone cannot say whether anything is wrong.** The bot claims on 12.1% of
   * offers already; if those claims are the denial cases, the rule is redundant. Reading a rate
   * against a baseline is what diagnosed #493 (strips a Shield 7.4% against random's 17.9%) and what
   * was missing when a 15.8% shield prevalence and a 20.7% Advantage prevalence each bought a term
   * that measured nothing.
   *
   * `quietClaimed / quietOffers` is that baseline, drawn from the same run and the same population, so
   * no second bot and no pooling is involved.
   */
  conversionClaimed: number
  denialClaimed: number
  weOnlyClaimed: number
  quietClaimed: number
}

/**
 * What actually happened after a denial-bucket decision (#516).
 *
 * The bucket rates say how often the bot claims when the opponent finishes next round. They cannot say
 * whether claiming **works**, and until that is known "claims in 10% of denial spots" is not a defect,
 * it is a number. `theyFinishNext` is a PREDICTION made by `reachSteady >= baseRemaining`, and nothing
 * has ever checked whether it comes true.
 *
 * A funnel rather than a rate, because the ways denial fails are different problems:
 *
 * | stage | meaning | what it would imply |
 * | --- | --- | --- |
 * | `lostFreeRun` | they won during the rest of the claim round | claiming CAUSED it: we handed them the round |
 * | `lostFirstAction` | we reached the next round and acted first, they won on their first action anyway | unstoppable; going first was never enough |
 * | `lostNextRound` | they won later in that round | we slowed them and it was not enough |
 * | `survived` | the next round ended with the game still live | denial bought at least a round |
 * | `wonGame` | we won | denial turned it around |
 *
 * `lostFreeRun` is the stage the tail exists to price and the one that is easiest to forget: claiming
 * makes us pass for the rest of the round (CR 1.15.5b), so the opponent gets a free run BEFORE the
 * turn order we bought ever applies.
 *
 * **Both arms, claimed and declined, from the same population.** A funnel for claims alone cannot say
 * whether claiming helped, only what followed it. The comparison is observational and therefore
 * confounded: the bot claims where it reads the position as salvageable, so the claimed arm is
 * selected for winnability. It is a baseline, not an effect, and a real effect needs the counterfactual
 * (fork the position, force each branch, replay).
 */
export interface DenialOutcomeStat {
  decided: number
  claimed: number
  declined: number
  /**
   * They could finish THIS round, with what is already ready, before any regroup.
   *
   * The bucket is built on `reachSteady`, which readies everything first, so it cannot tell "they kill
   * us next round if we do nothing" from "they kill us before the round is out". The second is not a
   * denial opportunity at all: turn order next round is irrelevant to a game that ends before the round
   * does. Judging the bot's claim rate without excluding these charges it for declining an option that
   * was never on offer.
   */
  claimedHopeless: number
  declinedHopeless: number
  /**
   * We still had something to do other than pass or claim.
   *
   * Claiming forfeits the rest of our round, so its cost depends entirely on what we were holding. With
   * no counterplay the claim is free and reads as a pure gain; the interesting claims are the ones that
   * gave something up.
   */
  claimedWithCounterplay: number
  declinedWithCounterplay: number
  claimedLostFreeRun: number
  declinedLostFreeRun: number
  claimedLostFirstAction: number
  declinedLostFirstAction: number
  claimedLostNextRound: number
  declinedLostNextRound: number
  claimedSurvived: number
  declinedSurvived: number
  claimedWonGame: number
  declinedWonGame: number
  /** Rounds between the decision and the end of the game, summed, so a mean can be reported. */
  claimedRoundsAfter: number
  declinedRoundsAfter: number
}

/**
 * One denial decision being followed to the end of its game.
 *
 * Per game and never reused across games. A watch list declared outside the game loop once reported a
 * leader-death rate of 72.3% against a true 17.7%, and this has exactly that shape.
 */
export interface DenialWatch {
  seat: PlayerId
  claimed: boolean
  round: number
  hopeless: boolean
  counterplay: boolean
  reachedNextRound: boolean
  foeActedNextRound: boolean
  lostFreeRun: boolean
  lostFirstAction: boolean
  lostNextRound: boolean
}

export function openDenialWatch(
  seat: PlayerId, claimed: boolean, round: number,
  facts: { hopeless: boolean; counterplay: boolean } = { hopeless: false, counterplay: false },
): DenialWatch {
  return {
    seat, claimed, round, hopeless: facts.hopeless, counterplay: facts.counterplay,
    reachedNextRound: false, foeActedNextRound: false,
    lostFreeRun: false, lostFirstAction: false, lostNextRound: false,
  }
}

/**
 * What claiming COST, measured over every claim rather than the denial bucket alone.
 *
 * Claiming forfeits the rest of our round, and the opponent spends it. The question this answers is
 * whether that free run is where the damage happens: a claim made when they could not finish next
 * round, followed by a round they used to make sure they could, is a claim that handed them the game.
 *
 * Deliberately over ALL claims. That case cannot appear in the denial bucket, because the bucket
 * requires the threat to exist at the moment of the decision, so a funnel scoped to denial is
 * structurally blind to the claim that creates its own threat.
 *
 * This is the quantity `tailActions` models. If the free run rarely changes anything, the tail is
 * pricing a cost that is not there, and its 84% share of the arm's 1.84x is wasted.
 */
/**
 * How often the bot does nothing (#521).
 *
 * The complaint is that it passes far more than a competent player, for whom a single pass is roughly a
 * one-game-in-five-to-ten event. Nothing measured the rate: the harness reported how often `pass` TIED
 * for the lead, which is a property of the evaluation, and never how often it was actually chosen,
 * which is the behaviour being complained about.
 *
 * **Forced passes are excluded and reported separately.** With no other legal move, passing is not a
 * decision, and a rate diluted by them would understate the defect exactly where the board is emptiest.
 *
 * `withAttackAvailable` is the sharpest of these: passing while a ready unit could attack is the pass a
 * player notices, and it needs no model of the position to call it out.
 */
export interface PassStat {
  games: number
  /** Decisions where passing was legal and something else was too. */
  offered: number
  /** Of those, passes actually taken. */
  taken: number
  /**
   * Of those taken, how many ended the action phase.
   *
   * **Not the defensible column**, which is what it was first taken for. Claiming makes you done for the
   * round rather than passing out of it, so the only pass that ends a round with nothing left to do is
   * the FORCED one, and that is excluded by construction. A chosen pass that ends the round is a pass
   * made while alternatives existed.
   */
  endedPhase: number
  /**
   * Of those taken, how many were **mid-round**: nobody had passed or claimed, so the round carried on
   * and the opponent got a free turn out of it.
   *
   * **This is the defect.** Every round ends with a pass by construction, so a raw pass count is
   * dominated by structure: forced passes run at ~5.3 a game over ~6.5 rounds. A competent player's
   * "one pass every five to ten games" is about discretionary passes, and this is that number.
   */
  midRound: number
  /** Of those taken, how many had an attack available. */
  withAttackAvailable: number
  /**
   * Of those taken, how many were **strictly worse than claiming**.
   *
   * When the opponent has already passed, passing ends the action phase (two consecutive passes) and so
   * does claiming (CR 1.15.5c). They reach the same board, except that claiming also takes the
   * initiative and acts first next round. So wherever claiming was legal in that window, passing gave a
   * free resource away for nothing.
   *
   * This is the sharpest number in the block: it needs no judgement about the position, no model of
   * what the opponent holds, and no view on whether passing is ever right. Two moves, identical
   * outcome, one strictly better.
   */
  dominatedByClaim: number
  /** Passing was the only legal move. Not a decision, and never counted in the rates above. */
  forced: number
  /**
   * Decisions the charge FLIPPED: passing had the best raw score and lost only because it was charged.
   *
   * The exact set the penalty is responsible for, recovered from the trace rather than inferred, since
   * `candidates` holds post-charge values and `passPenalty` says what to add back.
   *
   * **This is where the charge either pays for itself or does harm.** Spending resources is free in the
   * evaluation (`payCost` exhausts rather than removes, and both `resourceValue` and `handValue` count
   * the total), so playing a card costs only its hand value, roughly 1 to 3 points for a modest card,
   * against a charge of 8. The bot should therefore prefer a useless card to passing, which is a worse
   * habit than the one being fixed.
   */
  flipped: number
  /** What it played instead, over the flipped decisions. A tally of real actions against filler. */
  flippedInto: Array<{ kind: string; count: number }>
}

/**
 * Upgrades the bot attaches to its OWN units that make them worse (#509).
 *
 * Reported from live play: the bot played Pointless to Resist, "attached unit gets -3/-0 while attacking
 * a base", on its own unit. The engine is right, since upgrades attach to any unit unless a card says
 * otherwise, and the target choice is a genuine tie: `presence` sums `effectivePower` with **no
 * context**, so `ctx.attackingBase` is false, the -3 never appears, and friendly and enemy targets score
 * identically.
 *
 * Measured by comparing the host's attacking-base power across the attachment rather than by reading
 * card text, so it catches any upgrade that is a downgrade in the context that matters, whatever the
 * mechanism.
 *
 * The model is only **half** blind, which is why this is worth a number rather than an assumption:
 * `race.ts` computes power with `{ attacking: true, attackingBase: true }`, so the clock and the role
 * DO see the -3. The board term, which dominates, does not.
 */
export interface SelfDebuffStat {
  /** Upgrades attached to a friendly unit. */
  onOwnUnits: number
  /** Upgrades attached to an enemy unit. */
  onEnemyUnits: number
  /**
   * Attachments that lowered the host's power when attacking a base, by whose unit was chosen.
   *
   * **Both sides are needed or the number says nothing.** Counting only our own units cannot tell "the
   * bot always targets correctly" from "a debuff upgrade never came up", since a correct play onto an
   * enemy leaves no trace. The rate that matters is `own / (own + enemy)`: about half means the tie is
   * real and decided by coin flip, near zero means the bot is choosing correctly by some route, and
   * zero of zero means the situation never arose and this diagnostic cannot speak to it.
   */
  ownWorsened: number
  enemyWorsened: number
}

/**
 * How the claim decision actually resolves, decomposed (#516).
 *
 * Exists because the tie column it sits beside was measuring the wrong thing. "Tied" was implemented as
 * `init.v === max(every candidate INCLUDING claiming)`, which is satisfied by claiming winning
 * outright, so a decisive result counted as a blind spot. The headline "the initiative tie is the
 * largest blind spot in the model" rests on that number.
 *
 * The three outcomes partition the decision, so the corrected tie rate can be read against the wins it
 * used to be pooled with rather than taken on trust.
 *
 * `unresolved` is the separate and more useful question: a tie is handed to the second opinion, and
 * only what survives THAT is a coin flip. Nothing has ever recorded whether the tie-break, which is
 * shipped and paid for, separates anything.
 */
export interface InitiativeTieStat {
  decisions: number
  /** Claiming strictly beat every alternative. Not a tie at all. */
  uniquelyBest: number
  /** Claiming exactly matched the best alternative. */
  tiedWithBest: number
  /** Some alternative strictly beat claiming. */
  beaten: number
  /** Decisions the search left with more than one candidate at the lead. */
  tiesOffered: number
  /** Of those, still level after the second opinion: the genuine coin flips. */
  unresolved: number
  /** Candidates the seeded pick chose between, summed over `unresolved`. */
  survivors: number
  /**
   * What claiming was tied WITH, by move type, counted once per tying candidate.
   *
   * "Claiming ties" is not one situation. Tying with `pass` means the search sees nothing to do and
   * claiming is free, which is a decision worth taking blind; tying with an attack means it is weighing
   * turn order against damage, which is a real trade and a coin flip is a poor way to settle it. The
   * two want opposite policies, and a single rate cannot tell them apart.
   */
  tyingKinds: Array<{ kind: string; count: number }>
}

export interface ClaimCostStat {
  claims: number
  /** Reached the next round, so the free run actually happened and could be measured. */
  measured: number
  /** They could already finish next round when we claimed. */
  threatBefore: number
  /** They could not, and after the free run they could. The claim built the threat it now faces. */
  threatCreated: number
  /** Their steady reach grew across the free run, whether or not it crossed the line. */
  reachGrew: number
  /** Summed growth, so a mean can be reported beside the count. */
  reachGrowth: number
}

export interface ClaimWatch {
  seat: PlayerId
  round: number
  threatBefore: boolean
  foeReach: number
  settled: boolean
}

export function openClaimWatch(state: GameState, seat: PlayerId): ClaimWatch {
  return {
    seat,
    round: state.round,
    threatBefore: initiativeOutlook(state, seat).theyFinishNext,
    foeReach: reachSteady(state, opponentOf(seat)),
    settled: false,
  }
}

/** Settle once the free run is over, which is the moment the next round begins. */
export function advanceClaimWatch(watch: ClaimWatch, after: GameState, stat: ClaimCostStat): void {
  if (watch.settled) return
  // A game that ends during the free run never reaches the next round, so there is no "after" to
  // compare against and it is left unmeasured rather than counted as no change.
  if (after.winner !== null) { watch.settled = true; return }
  if (after.round <= watch.round) return
  watch.settled = true
  stat.measured++
  const threatAfter = initiativeOutlook(after, watch.seat).theyFinishNext
  if (watch.threatBefore) stat.threatBefore++
  else if (threatAfter) stat.threatCreated++
  const growth = reachSteady(after, opponentOf(watch.seat)) - watch.foeReach
  if (growth > 0) { stat.reachGrew++; stat.reachGrowth += growth }
}

/**
 * Advance every open watch by one resolved decision.
 *
 * `actingSeat` is who moved and `wasAnswer` marks a pending-choice answer, which is not an action: a
 * card handing someone a menu mid-resolution must not count as "their first action of the round", or
 * the stage would fire on the wrong event entirely.
 */
export function advanceDenialWatch(watch: DenialWatch, after: GameState, actingSeat: PlayerId, wasAnswer: boolean): void {
  const foe = opponentOf(watch.seat)
  const foeWon = after.winner === foe
  if (!watch.reachedNextRound) {
    // Still inside the round we claimed in: anything they win here, they won on the free run our own
    // claim handed them.
    if (foeWon) { watch.lostFreeRun = true; return }
    if (after.round > watch.round) watch.reachedNextRound = true
    return
  }
  if (after.round > watch.round + 1) return
  if (actingSeat === foe && !wasAnswer) {
    if (!watch.foeActedNextRound) {
      watch.foeActedNextRound = true
      if (foeWon) { watch.lostFirstAction = true; return }
    }
  }
  if (foeWon) watch.lostNextRound = true
}

/** Fold a finished game's watch into the totals. */
export function closeDenialWatch(watch: DenialWatch, final: GameState, stat: DenialOutcomeStat): void {
  const claimed = watch.claimed
  stat.decided++
  if (claimed) stat.claimed++
  else stat.declined++
  const bump = (a: keyof DenialOutcomeStat, b: keyof DenialOutcomeStat): void => { stat[claimed ? a : b]++ }
  if (watch.hopeless) bump('claimedHopeless', 'declinedHopeless')
  if (watch.counterplay) bump('claimedWithCounterplay', 'declinedWithCounterplay')
  if (watch.lostFreeRun) bump('claimedLostFreeRun', 'declinedLostFreeRun')
  if (watch.lostFirstAction) bump('claimedLostFirstAction', 'declinedLostFirstAction')
  if (watch.lostNextRound) bump('claimedLostNextRound', 'declinedLostNextRound')
  // Survived means the game was still live once the round we bought had run out.
  if (final.round > watch.round + 1 || (final.winner === null && final.round > watch.round)) {
    bump('claimedSurvived', 'declinedSurvived')
  }
  if (final.winner === watch.seat) bump('claimedWonGame', 'declinedWonGame')
  if (claimed) stat.claimedRoundsAfter += final.round - watch.round
  else stat.declinedRoundsAfter += final.round - watch.round
}

/**
 * Whether the bot can decline an optional ability (#396).
 *
 * A "may" trigger reaches the AI as a pending choice whose legal answers include `skipTrigger`, so
 * accepting and declining are observable from the candidate list without a table of ~70 choice kinds.
 * The ticket names the failure mode directly: "the bot always accepting every optional trigger, which
 * is what happens if declining is never scored favourably".
 *
 * `randomExpected` is the control. A uniform picker takes one of `n` candidates and exactly one of
 * them declines, so its expected accept count is the sum of `(n - 1) / n`. That is arithmetic rather
 * than a second run: exact, unbiased, and free.
 */
export interface TriggerStat {
  /** Decisions where a decline and at least one accept were both legal. */
  offered: number
  /** Of those, decisions where the bot chose anything other than the decline. */
  accepted: number
  /** Expected accepts for a uniform picker over the same decisions. */
  randomExpected: number
  /** Of those, decisions where every candidate scored alike, so the choice was a coin flip anyway. */
  tied: number
  /** Per choice kind, most offered first: one card dealing out a menu is a different finding from a
   *  broad bias, and the aggregate cannot tell them apart. */
  byKind: Array<{ kind: string; offered: number; accepted: number; randomExpected: number }>
}

/**
 * Offensive pinning (#397), sized for the first time.
 *
 * Holding a unit ready to threaten an undeployed leader is a **non-action**, and a board-score
 * maximiser always prefers the attack that moves the score now. No amount of depth finds it, because
 * the search is choosing between actions and this is the value of not taking one. That makes it one of
 * the few items that cannot be subsumed by search, and it has never been measured.
 *
 * `deployedIntoPin` is the one that decides whether self-play can measure it at all. A strategy
 * neither side plays cannot be rewarded by a bench: if the opponent deploys into a pin regardless,
 * holding the unit wins nothing here however right it is in a real game.
 */
export interface PinStat {
  /** Decisions taken while the enemy leader could still deploy. */
  decisions: number
  /** Of those, decisions where some ready ground unit of ours would defeat it on arrival. */
  pinAvailable: number
  /** Of those, decisions where the bot attacked with a pinning unit, spending the threat. */
  pinSpent: number
  /** Total pinning units across `pinAvailable`, for a mean. */
  pinnersTotal: number
  /** Leader deploys observed. */
  deploys: number
  /** Of those, deploys made while the other seat held a pin on the arriving leader. */
  deployedIntoPin: number
}

/**
 * Split a candidate list into the ways of declining and the ways of accepting.
 *
 * Taken from the candidates rather than from the choice kind, so a card offering several ways to say
 * yes counts as one offer and one accept rather than one per option. A list with no decline is a
 * mandatory choice and not this decision at all.
 */
export function optionalTriggerSplit(moves: Action[]): { declines: number; accepts: number } {
  let declines = 0
  for (const m of moves) if (m.type === 'skipTrigger') declines++
  return { declines, accepts: moves.length - declines }
}

/**
 * What a uniform picker would do with the same candidates: accept unless it happens to land on the
 * decline. Zero when there is nothing to decline, so a non-decision adds no expectation either way.
 */
export function randomAcceptChance(split: { declines: number; accepts: number }): number {
  const n = split.declines + split.accepts
  if (split.declines === 0 || split.accepts === 0 || n === 0) return 0
  return split.accepts / n
}

/**
 * Our ready units that would defeat the enemy leader if it deployed right now (#397).
 *
 * A leader arrives in the **ground** arena, ready and undamaged (CR 3.4.4), so the threat is any ready
 * ground unit whose power covers the leader's deployed HP. Exhausted units and the wrong arena
 * threaten nothing.
 *
 * Returns empty once there is no deploy left to threaten, mirroring `legalMoves`: already deployed, or
 * the epic action spent, or the cost not controlled. Deploy conditions are read through the card
 * definition for the same reason, so a custom one (Bo-Katan) is not silently treated as affordable.
 */
export function pinsLeader(state: GameState, me: PlayerId): string[] {
  const foe = opponentOf(me)
  const their = state.players[foe].leader
  if (their.deployed || their.epicActionUsed) return []
  const leaderCard = state.cards[their.cardId]
  if (!leaderCard) return []
  const condition = getCardDefinition(their.cardId)?.deployCondition
  const canDeploy = condition ? condition(state, foe) : state.players[foe].resources.length >= leaderCard.cost
  if (!canDeploy) return []

  const hp = leaderCard.hp ?? 0
  if (hp <= 0) return []
  return state.players[me].units
    .filter(u => !u.exhausted && u.arena === 'ground' && effectivePower(state, u, { attacking: true }) >= hp)
    .map(u => u.instanceId)
}

/** Advantage tokens per unit instance, across both seats. */
function advantageByUnit(s: GameState): Map<string, number> {
  const out = new Map<string, number>()
  for (const seat of ['player', 'opponent'] as PlayerId[]) {
    for (const u of s.players[seat].units) {
      const n = u.upgrades.filter(a => a.cardId === TOKEN_ADVANTAGE).length
      if (n > 0) out.set(u.instanceId, n)
    }
  }
  return out
}

/** How the Advantage tokens that left play during one action were spent. */
export interface AdvantageSpend {
  attacking: number
  defending: number
  other: number
  died: number
  /** Of `died`, those on the ACTING seat's own units: tokens we lost. */
  diedMine: number
  /** Of `died`, those on the other seat's units: tokens we removed by killing the carrier.
   *  With `defending`, this is the whole of "did we trade to strip their Advantage". */
  diedTheirs: number
}

/**
 * Attribute every Advantage token that disappeared across one resolved action.
 *
 * Read from the boards rather than instrumented into `consumeAdvantage`, so the diagnostic cannot
 * drift from the engine: whatever actually removed a token is counted, however it was removed. The
 * attacker and the defender are taken from the action, which is what separates the two spend routes.
 */
export function advantageSpend(before: GameState, after: GameState, action: Action): AdvantageSpend {
  const out: AdvantageSpend = { attacking: 0, defending: 0, other: 0, died: 0, diedMine: 0, diedTheirs: 0 }
  const was = advantageByUnit(before)
  if (was.size === 0) return out
  const now = advantageByUnit(after)
  const alive = new Set([...after.players.player.units, ...after.players.opponent.units].map(u => u.instanceId))
  const mine = new Set(before.players[before.activePlayer].units.map(u => u.instanceId))

  const attackerId = action.type === 'attack' ? action.attackerId : undefined
  const defenderId = action.type === 'attack' && action.target.kind === 'unit' ? action.target.instanceId : undefined

  for (const [id, before_] of was) {
    if (!alive.has(id)) {
      out.died += before_
      // Whose token it was, read from the seat that acted: killing THEIR carrier strips it, losing
      // OUR carrier wastes it. The two are opposite outcomes and must not pool.
      if (mine.has(id)) out.diedMine += before_
      else out.diedTheirs += before_
      continue
    }
    const gone = before_ - (now.get(id) ?? 0)
    if (gone <= 0) continue
    if (id === attackerId) out.attacking += gone
    else if (id === defenderId) out.defending += gone
    else out.other += gone
  }
  return out
}

export interface DecisionReport {
  commitId: string
  ai: string
  games: number
  stats: DecisionStat[]
  ties: TieStat
  initiativeHorizon: InitiativeHorizonStat
  denialOutcome: DenialOutcomeStat
  claimCost: ClaimCostStat
  initiativeTies: InitiativeTieStat
  passes: PassStat
  selfDebuff: SelfDebuffStat
  triggers: TriggerStat
  pin: PinStat
  advantage: AdvantageStat
  blockedReach: BlockedReachStat
  shields: ShieldStat
  leader: LeaderStat
  resourcing: ResourcingStat
  initiative: InitiativeStat
  role: RoleStat
  suspended: SuspendedStat
  lethal: LethalStat
  exposure: ExposureStat
}

interface Tally {
  offered: number
  tied: number
  tiedSearch: number
  candidates: number
}

const empty = (): Tally => ({ offered: 0, tied: 0, tiedSearch: 0, candidates: 0 })

/** The greedy driver's own scoring function, so a tie measured here is a tie it would coin-flip. */
const score = makeQuiescent(evaluate)

/**
 * Is this the candidate the AI chose?
 *
 * **By value, because the references never match.** The diagnostic builds its candidate list from its
 * own `legalMoves` call and the AI makes another inside itself, so the two arrays hold structurally
 * identical but distinct objects. Measured across 40 real positions with `greedy` and `beam-reply`:
 * reference match 0/40, value match 40/40.
 *
 * The older counters here survived that only because each carries a `?? recompute` fallback which was
 * silently doing all the work. A shield counter written without one reported the bot never stripping
 * a shield in 2,359 opportunities, which read as a dramatic finding and was arithmetic.
 */
export function sameAction(a: Action, b: Action): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/** How many shields a seat's units are carrying. */
function shieldsOn(s: GameState, seat: PlayerId): number {
  return s.players[seat].units.reduce(
    (n, u) => n + u.upgrades.filter(up => up.cardId === TOKEN_SHIELD).length,
    0,
  )
}

const isShielded = (u: UnitState): boolean => u.upgrades.some(up => up.cardId === TOKEN_SHIELD)

/** Enemy Sentinels carrying a Shield: the ones that can close a lane rather than absorb a hit. */
function shieldedBlockersAgainst(s: GameState, seat: PlayerId): number {
  return s.players[opponentOf(seat)].units
    .filter(u => isShielded(u) && unitHasKeyword(s, u, 'Sentinel')).length
}

/**
 * Which arenas is this seat shut out of by a shielded Sentinel?
 *
 * **Per arena, because a lane is an arena.** A shielded Sentinel in ground locks ground attackers and
 * leaves space untouched, so asking "is every attacker on the board locked" reports "not locked"
 * whenever a single unit stands in the other arena. Measured that way the rate came out at 0.3% of
 * decisions and never lasting a round, which contradicted what play-testers were reporting. The
 * complaint is that **one lane** closes, and that is what this counts.
 *
 * A lane needs at least one ready attacker of ours to be shut: an empty arena is not blocked.
 */
function lockedLanes(s: GameState, seat: PlayerId): Array<'ground' | 'space'> {
  const shut = (arena: 'ground' | 'space'): boolean => {
    const ready = s.players[seat].units.filter(u => !u.exhausted && u.arena === arena)
    if (ready.length === 0) return false
    return ready.every(u => {
      const { targets, sentinelLocked } = enemyAttackTargets(s, u, seat)
      return sentinelLocked && targets.length > 0 && targets.every(isShielded)
    })
  }
  return (['ground', 'space'] as const).filter(shut)
}

/** Every arena this seat can attack in is shut: no damage of ours lands anywhere. */
function lockedOutBy(s: GameState, seat: PlayerId): boolean {
  const arenas = (['ground', 'space'] as const)
    .filter(a => s.players[seat].units.some(u => !u.exhausted && u.arena === a))
  return arenas.length > 0 && lockedLanes(s, seat).length === arenas.length
}

/**
 * What kind of decision this was, for the tie split. Classified by the move actually chosen, since a
 * tied set can hold moves of several types and one label has to be picked.
 *
 * `pass` is separated rather than folded into "other" because passing is the move the reply-passivity
 * work is about: a coin flip that lands on it is the shape of the reported defect.
 */
function decisionKind(s: GameState, action: Action): string {
  // A pending choice hands the candidates to the player rather than the player choosing to have them,
  // so it classifies the decision whatever the answer's action type is.
  if (hasPendingChoices(s)) return 'answer'
  switch (action.type) {
    case 'attack': return 'attack'
    case 'playUnit': case 'playEvent': case 'playUpgrade': return 'play'
    case 'resourceCard': case 'skipResource': return 'resource'
    case 'takeInitiative': return 'initiative'
    case 'pass': return 'pass'
    default: return 'other'
  }
}

/** Choice kinds, most frequent first. Count then name, so the order is stable across runs rather
 *  than following insertion. */
const rank = (counts: Map<string, number>): Array<{ kind: string; count: number }> =>
  [...counts]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))

export function runDecisions(config: DecisionConfig): DecisionReport {
  const all = buildCoverageDecks(POOL, config.seed)
  const decks = config.deckLimit === undefined ? all.decks : all.decks.slice(0, config.deckLimit)
  const cardDb = buildCardDb(POOL)
  const ai = resolveAi(config.aiName ?? 'greedy')
  const ceiling = config.stepCeiling ?? 4000

  const shields: ShieldStat = {
    decisionsFacingShield: 0, removalAvailable: 0, removals: 0, shieldsSeen: 0, decisionsHoldingShield: 0,
    shieldedBlockers: 0, laneLocked: 0, lockedOut: 0, roundsSampled: 0, lockedRounds: 0, longestLockout: 0,
  }
  const resourcing = empty()
  const initiative = empty()
  const attacks = empty()
  const plays = empty()
  const answering = empty()
  let games = 0
  let banked = 0
  let skipped = 0
  let bankedPool = 0
  let skippedPool = 0
  let initOffered = 0
  let initTaken = 0
  let cheapOffered = 0
  let cheapTaken = 0
  let forfeited = 0
  let forfeitedCount = 0
  const roleCount = { aggressor: 0, defender: 0, neutral: 0 }
  let roleFlips = 0
  let walledSamples = 0
  let roleSamples = 0
  const suspended = {
    candidates: 0,
    opponentAnswers: 0,
    selfAnswers: 0,
    positions: 0,
    positionsWithOpponentAnswer: 0,
    positionsWithSelfAnswer: 0,
    chosenOpponentAnswer: 0,
    chosenSelfAnswer: 0,
  }
  const opponentKinds = new Map<string, number>()
  const selfKinds = new Map<string, number>()
  const ties = {
    searched: 0, fired: 0, tiedTotal: 0, rootsWhenFired: 0, rootsSearched: 0,
    widest: 0, tiedTotalCapped: 0, firedWide: 0,
  }
  const blocked: BlockedReachStat = {
    decisions: 0, active: 0, activeAndLaneShut: 0, totalQuantity: 0, widestQuantity: 0,
  }
  const flippedInto = new Map<string, number>()
  const passes: PassStat = {
    games: 0, offered: 0, taken: 0, endedPhase: 0, midRound: 0,
    withAttackAvailable: 0, dominatedByClaim: 0, forced: 0, flipped: 0, flippedInto: [],
  }
  const selfDebuff: SelfDebuffStat = { onOwnUnits: 0, onEnemyUnits: 0, ownWorsened: 0, enemyWorsened: 0 }

  const tyingKinds = new Map<string, number>()
  const initTies: InitiativeTieStat = {
    decisions: 0, uniquelyBest: 0, tiedWithBest: 0, beaten: 0,
    tiesOffered: 0, unresolved: 0, survivors: 0, tyingKinds: [],
  }

  const claimCost: ClaimCostStat = {
    claims: 0, measured: 0, threatBefore: 0, threatCreated: 0, reachGrew: 0, reachGrowth: 0,
  }

  const denialOutcome: DenialOutcomeStat = {
    decided: 0, claimed: 0, declined: 0,
    claimedHopeless: 0, declinedHopeless: 0,
    claimedWithCounterplay: 0, declinedWithCounterplay: 0,
    claimedLostFreeRun: 0, declinedLostFreeRun: 0,
    claimedLostFirstAction: 0, declinedLostFirstAction: 0,
    claimedLostNextRound: 0, declinedLostNextRound: 0,
    claimedSurvived: 0, declinedSurvived: 0,
    claimedWonGame: 0, declinedWonGame: 0,
    claimedRoundsAfter: 0, declinedRoundsAfter: 0,
  }

  const horizon: InitiativeHorizonStat = {
    offered: 0, weFinishNext: 0, theyFinishNext: 0, bothFinishNext: 0, theyOnly: 0,
    lethalNow: 0, conversionLive: 0, denialLive: 0, weOnlyLive: 0, quietOffers: 0,
    conversionClaimed: 0, denialClaimed: 0, weOnlyClaimed: 0, quietClaimed: 0,
  }
  const triggers = { offered: 0, accepted: 0, randomExpected: 0, tied: 0 }
  const triggerKinds = new Map<string, { offered: number; accepted: number; randomExpected: number }>()
  const pin: PinStat = {
    decisions: 0, pinAvailable: 0, pinSpent: 0, pinnersTotal: 0, deploys: 0, deployedIntoPin: 0,
  }
  const advantage: AdvantageStat = {
    decisions: 0, decisionsWithAny: 0, tokensSeen: 0, maxStack: 0, decisionsOnCarrier: 0,
    spentAttacking: 0, spentDefending: 0, spentOther: 0,
    diedUnspent: 0, diedUnspentOurs: 0, diedUnspentTheirs: 0,
    grantChoices: 0, grantChoicesAllEqual: 0,
  }
  const tieKinds = new Map<string, { searched: number; fired: number; tiedTotal: number; widest: number }>()
  const lethalByRound = new Map<number, { decisions: number; ours: number; theirs: number }>()
  let oursOneAction = 0
  let theirsOneAction = 0
  const leader: LeaderStat = { deploys: 0, diedSoon: 0 }
  const exposure = {
    decisions: 0, exposed: 0, avoidable: 0, unavoidable: 0, games: 0, losses: 0,
    gamesWithAvoidable: 0, lostAfterAvoidable: 0, gamesWithoutAvoidable: 0, lostWithoutAvoidable: 0,
  }

  decks.forEach((deck, d) => {
    for (let g = 0; g < config.gamesPerDeck; g++) {
      const seed = nextSeed(config.seed + d * 37 + g)
      const shuffleSeed = { v: seed }
      const shuffle = <T,>(arr: T[]): T[] => { shuffleSeed.v = nextSeed(shuffleSeed.v); return seededShuffle(arr, shuffleSeed.v) }
      let s: GameState = initGame(deck, deck, cardDb, { firstPlayer: g % 2 === 0 ? 'player' : 'opponent', shuffle, rngSeed: seed })
      games++
      passes.games++
      let lastRole: Exclude<Role, 'neutral'> | null = null
      let sampledRound = 0
      // Per seat, so an exposure can be charged to whoever made it when the game is decided.
      const avoidableBy: Record<PlayerId, boolean> = { player: false, opponent: false }
      /**
       * Leaders inside their "did it survive arriving" window. **Per game.** Declared alongside the
       * other accumulators once, and a watch left open when a game ended carried into the next one,
       * where its instance id no longer existed and was counted as a death. That read 72% against a
       * known baseline of 2.5%, which is the only reason it was caught.
       */
      const watching: Array<{ seat: PlayerId; instanceId: string; until: number }> = []

      // Per game, for the same reason: a lockout run must reset between games or the "longest run"
      // would be a run across the whole corpus rather than within one game.
      let lockSampledRound = -1
      let lockRun = 0

      // Per game, for the same reason as `watching` above: a watch list that outlives its game follows
      // a decision into a game it was never part of.
      const denialWatches: DenialWatch[] = []
      const claimWatches: ClaimWatch[] = []

      for (let i = 0; i < ceiling && s.winner === null; i++) {
        const moves = legalMoves(s)
        if (moves.length === 0) break
        const me = s.activePlayer
        // The role is fixed once per decision, exactly as the greedy driver does it, so a tie here
        // is a tie there.
        const asRole = role(s, me)
        const foe = opponentOf(me)

        // Taken BEFORE scoring, because the AI's own valuation of each candidate is a by-product of
        // asking it to move, and that valuation is what the search column reports. `setupAi` decides
        // setup without consulting any evaluation, so there is nothing to read there and the search
        // column falls back to the one-ply values.
        const forced = setupAi(s)
        clearSearchTrace()
        const action = forced ?? ai(s)
        if (!action) break
        const trace = forced ? null : lastSearchTrace()
        const searched = trace?.candidates ?? null
        const searchValue = (i: number): number => (searched && searched.length === moves.length ? searched[i] : NaN)

        // How often a second opinion would be consulted (#499). Guarded on the candidate count
        // matching, so a trace left by some inner search rather than this decision cannot be read as
        // if it described these moves.
        if (trace && moves.length >= 2 && trace.candidates.length === moves.length) {
          const kind = decisionKind(s, action)
          const bucket = tieKinds.get(kind) ?? { searched: 0, fired: 0, tiedTotal: 0, widest: 0 }
          ties.searched++
          ties.rootsSearched += moves.length
          bucket.searched++
          if (trace.tiedCandidates > 1) {
            ties.fired++
            // The tied SET is the charge: a tie-break re-searches all of them, not one.
            ties.tiedTotal += trace.tiedCandidates
            ties.tiedTotalCapped += Math.min(trace.tiedCandidates, TIE_FANOUT_CAP)
            if (trace.tiedCandidates > TIE_FANOUT_CAP) ties.firedWide++
            ties.rootsWhenFired += moves.length
            if (trace.tiedCandidates > ties.widest) ties.widest = trace.tiedCandidates
            bucket.fired++
            bucket.tiedTotal += trace.tiedCandidates
            if (trace.tiedCandidates > bucket.widest) bucket.widest = trace.tiedCandidates
          }
          tieKinds.set(kind, bucket)
        }

        const scored = moves.map(m => {
          const next = resolve(s, m)
          // Scored with quiescence, as the greedy driver does, so a tie counted here is a tie there.
          // The half-resolution counts alongside are taken from the RAW state, since they measure how
          // often quiescence has anything to do rather than what it concluded.
          // Exposure uses the STRICT reading: handing them a kill they can take with one action,
          // before we act again. The aggregate reading counts lines needing several of their actions
          // with several of ours in between, which is a threat rather than a kill, and it inflated
          // this measurement threefold.
          return { m, v: score(next, me, asRole), r: classifyResolution(next, me), exposed: canFinishThisAction(next, foe) }
        })
        const record = (tally: Tally, subset: Array<(typeof scored)[number] & { sv: number }>): void => {
          if (subset.length < 2) return
          tally.offered++
          tally.candidates += subset.length
          const tiedOnePly = new Set(subset.map(x => x.v)).size === 1
          if (tiedOnePly) tally.tied++
          // With no search to read, the searching column is the one-ply one rather than a silent
          // zero, which would read as "the search breaks every tie" for an AI that does not search.
          const svs = subset.map(x => x.sv)
          const usable = svs.every(v => !Number.isNaN(v))
          if (usable ? new Set(svs).size === 1 : tiedOnePly) tally.tiedSearch++
        }
        const withSearch = scored.map((x, i) => ({ ...x, sv: searchValue(i) }))
        // Shields (#493). Counted from the ACTING seat, so "facing" means shields in the way of the
        // player about to move. A strip is a move after which they hold fewer than before: the token
        // is spent by the engine's prevention hook, never by an explicit action, so it can only be
        // observed by comparing the resulting board rather than by inspecting the move.
        {
          const theirs = shieldsOn(s, foe)
          if (theirs > 0) {
            shields.decisionsFacingShield++
            shields.shieldsSeen += theirs
            const strips = scored.filter(x => shieldsOn(resolve(s, x.m), foe) < theirs)
            if (strips.length > 0) shields.removalAvailable++
            if (strips.some(x => sameAction(x.m, action))) shields.removals++
          }
          if (shieldsOn(s, me) > 0) shields.decisionsHoldingShield++

          // Advantage prevalence (#497). Counted on the same decisions as the shield counters so the
          // two rates are directly comparable: Shield's 15.8% is the bar this has to clear.
          {
            const carried = advantageByUnit(s)
            advantage.decisions++
            if (carried.size > 0) {
              advantage.decisionsWithAny++
              for (const n of carried.values()) {
                advantage.tokensSeen += n
                if (n > advantage.maxStack) advantage.maxStack = n
              }
              // "Turns on a carrier": some candidate attacks WITH one, or attacks one.
              const touches = moves.some(m => m.type === 'attack'
                && (carried.has(m.attackerId)
                  || (m.target.kind === 'unit' && carried.has(m.target.instanceId))))
              if (touches) advantage.decisionsOnCarrier++
            }
            // Who to arm, when the model has no preference (#501). Scored one-ply, matching the
            // `tied` column, so the two read on the same basis.
            const grant = (s.pendingChoices ?? []).find(c => c.kind === 'mayGiveTokens')
            if (grant && grant.controller === me && scored.length >= 2) {
              advantage.grantChoices++
              if (new Set(scored.map(x => x.v)).size === 1) advantage.grantChoicesAllEqual++
            }
          }

          // How live the term is, against how often the lockout it was written for occurs.
          //
          // Through `blockedFor`, so this is the quantity the evaluation prices. The cap applies to
          // EACH SIDE before the difference, and differencing the raw reach instead reported a
          // largest quantity of 26 against a cap of 10: a measurement of something the model cannot
          // see, and it would have inflated every contribution figure read off it.
          blocked.decisions++
          const denied = Math.abs(blockedFor(s, foe, DEFAULT_WEIGHTS) - blockedFor(s, me, DEFAULT_WEIGHTS))
          if (denied > 0) {
            blocked.active++
            blocked.totalQuantity += denied
            if (denied > blocked.widestQuantity) blocked.widestQuantity = denied
            if (lockedLanes(s, me).length > 0) blocked.activeAndLaneShut++
          }
          shields.shieldedBlockers += shieldedBlockersAgainst(s, me)
          if (lockedLanes(s, me).length > 0) shields.laneLocked++
          if (lockedOutBy(s, me)) shields.lockedOut++
        }

        // Lockout duration, sampled once a round from ONE seat so the figure is rounds rather than
        // actions. `lockRun` is declared per game below; a watch list declared outside the game loop
        // once reported a leader-death rate of 72.3% against a true 17.7%.
        if (s.phase === 'action' && s.round !== lockSampledRound) {
          lockSampledRound = s.round
          shields.roundsSampled++
          // Duration tracks the LANE reading, since a lane shut for four rounds is the lost game;
          // a board-wide lockout is a rarer and stricter event.
          if (lockedLanes(s, 'player').length > 0) {
            shields.lockedRounds++
            lockRun++
            if (lockRun > shields.longestLockout) shields.longestLockout = lockRun
          } else {
            lockRun = 0
          }
        }

        record(resourcing, withSearch.filter(x => x.m.type === 'resourceCard'))
        record(attacks, withSearch.filter(x => x.m.type === 'attack'))
        record(plays, withSearch.filter(x => x.m.type === 'playUnit' || x.m.type === 'playEvent' || x.m.type === 'playUpgrade'))
        // With a choice outstanding, `legalMoves` returns nothing BUT its answers, so the whole
        // candidate set is the decision. The one kind where the options were handed to the player by
        // a card rather than chosen, which is why it is measured separately from the plays above.
        if (hasPendingChoices(s)) record(answering, withSearch)

        // Can the bot say no? (#396) An optional trigger is a decision offering both a decline and at
        // least one accept. Counted per decision, not per option: a card with five ways to say yes is
        // still one chance to say no.
        {
          const split = optionalTriggerSplit(moves)
          if (split.declines > 0 && split.accepts > 0) {
            const chance = randomAcceptChance(split)
            const accepted = action.type !== 'skipTrigger'
            triggers.offered++
            triggers.randomExpected += chance
            if (accepted) triggers.accepted++
            if (new Set(scored.map(x => x.v)).size === 1) triggers.tied++
            const kind = (s.pendingChoices ?? []).find(c => c.controller === me)?.kind ?? 'unknown'
            const bucket = triggerKinds.get(kind) ?? { offered: 0, accepted: 0, randomExpected: 0 }
            bucket.offered++
            bucket.randomExpected += chance
            if (accepted) bucket.accepted++
            triggerKinds.set(kind, bucket)
          }
        }

        // Offensive pinning (#397). `pinSpent` is the behaviour the ticket predicts: the bot attacks
        // with the unit that was holding the threat, because attacking moves the score now and holding
        // is a non-action no search has a candidate for.
        {
          const pinners = pinsLeader(s, me)
          const theirLeader = s.players[foe].leader
          if (!theirLeader.deployed && !theirLeader.epicActionUsed) pin.decisions++
          if (pinners.length > 0) {
            pin.pinAvailable++
            pin.pinnersTotal += pinners.length
            if (action.type === 'attack' && pinners.includes(action.attackerId)) pin.pinSpent++
          }
          // Whether the OTHER seat is playing around our threat. If leaders deploy into a pin anyway,
          // self-play cannot show the strategy being punished, so it cannot reward holding one either.
          if (action.type === 'deployLeader') {
            pin.deploys++
            if (pinsLeader(s, foe).length > 0) pin.deployedIntoPin++
          }
        }

        // How much of what gets scored is a half-resolved board. A single forced move is not a
        // decision, so it cannot be mis-ranked against anything and is excluded, matching `record`.
        if (scored.length >= 2) {
          suspended.positions++
          suspended.candidates += scored.length
          let anyOpponent = false
          let anySelf = false
          for (const { r } of scored) {
            if (r.kind === 'opponent') {
              suspended.opponentAnswers++
              anyOpponent = true
              opponentKinds.set(r.choiceKind, (opponentKinds.get(r.choiceKind) ?? 0) + 1)
            } else if (r.kind === 'self') {
              suspended.selfAnswers++
              anySelf = true
              selfKinds.set(r.choiceKind, (selfKinds.get(r.choiceKind) ?? 0) + 1)
            }
          }
          if (anyOpponent) suspended.positionsWithOpponentAnswer++
          if (anySelf) suspended.positionsWithSelfAnswer++
        }

        // Initiative is a single move, so "tied" means tied with the best alternative: the position
        // where the seeded tie-break decides whether to forfeit the rest of the round.
        const init = withSearch.find(x => x.m.type === 'takeInitiative')
        if (init) {
          // What claiming could be worth next round (#446). Counted here rather than per decision,
          // because the rule can only ever fire where claiming is actually on offer.
          {
            const o = initiativeOutlook(s, me)
            horizon.offered++
            if (o.weFinishNext) horizon.weFinishNext++
            if (o.theyFinishNext) horizon.theyFinishNext++
            if (o.lethalNow) horizon.lethalNow++
            if (o.weFinishNext && o.theyFinishNext) horizon.bothFinishNext++
            else if (o.theyFinishNext) horizon.theyOnly++

            // The cross-tab: prevalence says the situation arises, this says whether the bot gets it
            // wrong. Four buckets partitioning the offers we could not simply win outright, each with
            // the claim rate beside it, so the two live cases can be read against the quiet baseline
            // from the same population rather than against a second run.
            const claimed = action.type === 'takeInitiative'
            if (!o.lethalNow) {
              if (o.weFinishNext && o.theyFinishNext) {
                horizon.conversionLive++
                if (claimed) horizon.conversionClaimed++
              } else if (o.theyFinishNext) {
                horizon.denialLive++
                if (claimed) horizon.denialClaimed++
                // Follow this one to the end of the game. The bucket rate says what the bot did; only
                // this says whether it mattered.
                //
                // `hopeless` uses `canFinishNow` rather than the bucket's `reachSteady`: the bucket
                // readies everything first, so it cannot tell "they kill us next round" from "they kill
                // us before this round is out", and only the first is a denial opportunity at all.
                denialWatches.push(openDenialWatch(me, claimed, s.round, {
                  hopeless: canFinishNow(s, foe),
                  counterplay: moves.some(m => m.type !== 'pass' && m.type !== 'takeInitiative'),
                }))
              } else if (o.weFinishNext) {
                horizon.weOnlyLive++
                if (claimed) horizon.weOnlyClaimed++
              } else {
                horizon.quietOffers++
                if (claimed) horizon.quietClaimed++
              }
            }
          }
          initiative.offered++
          initiative.candidates += 1
          // Against the best ALTERNATIVE, which is what the question has always said and what the
          // implementation did not do. `best` is the max over every candidate INCLUDING claiming, so
          // `init.v === best` also fires when claiming wins outright, and a decisive result was being
          // counted as a blind spot. Every other decision kind uses `record`, which requires the whole
          // candidate set to be level.
          const others = withSearch.filter(x => x.m.type !== 'takeInitiative')
          if (others.length > 0) {
            const bestOther = Math.max(...others.map(x => x.v))
            if (init.v === bestOther) initiative.tied++

            const svs = withSearch.map(x => x.sv)
            const usable = svs.every(v => !Number.isNaN(v))
            const bestOtherSearch = usable ? Math.max(...others.map(x => x.sv)) : NaN
            if (usable ? init.sv === bestOtherSearch : init.v === bestOther) initiative.tiedSearch++

            // The decomposition, so the corrected rate can be read against what it replaces.
            initTies.decisions++
            if (usable) {
              if (init.sv > bestOtherSearch) initTies.uniquelyBest++
              else if (init.sv === bestOtherSearch) {
                initTies.tiedWithBest++
                // What it tied WITH. Raw move type rather than the coarser decision kind, since
                // "tied with pass" and "tied with an attack" are the distinction that matters.
                for (const other of others) {
                  if (other.sv === bestOtherSearch) {
                    tyingKinds.set(other.m.type, (tyingKinds.get(other.m.type) ?? 0) + 1)
                  }
                }
              } else initTies.beaten++
            }
            // And what the seeded pick was actually left with. `tiedCandidates` is the tie the second
            // opinion is handed; `finalists` is what survived it, which is the real coin flip.
            if (trace && trace.tiedCandidates > 1) {
              initTies.tiesOffered++
              if (trace.finalists > 1) {
                initTies.unresolved++
                initTies.survivors += trace.finalists
              }
            }
          }
          initOffered++
          // The opponent has already passed, so claiming ends the phase (CR 1.15.5c) and they gain
          // nothing from your silence. Still costs your own remaining actions, hence "cheap".
          if (s.consecutivePasses >= 1) cheapOffered++
        }

        // Lethal availability, from the ACTING seat: "could I finish now" and "could they finish me
        // now". Counted per decision rather than per round, because that is the unit a risk gate
        // would act on.
        {
          const bucket = lethalByRound.get(s.round) ?? { decisions: 0, ours: 0, theirs: 0 }
          bucket.decisions++
          if (canFinishNow(s, me)) bucket.ours++
          if (canFinishNow(s, opponentOf(me))) bucket.theirs++
          if (canFinishThisAction(s, me)) oursOneAction++
          if (canFinishThisAction(s, opponentOf(me))) theirsOneAction++
          lethalByRound.set(s.round, bucket)
        }

        // Sample the role once a round from the player's seat, so the split is not weighted by how
        // many actions a side happened to take.
        if (s.phase === 'action' && s.round !== sampledRound) {
          sampledRound = s.round
          roleSamples++
          const r = role(s, 'player')
          roleCount[r]++
          if (reachSteady(s, 'player') === 0 || reachSteady(s, 'opponent') === 0) walledSamples++
          // Neutral is not a flip, it is the road between the two, so only committed roles count.
          if (r !== 'neutral') {
            if (lastRole !== null && r !== lastRole) roleFlips++
            lastRole = r
          }
        }

        // What the AI actually committed to. Matched by VALUE: the AI's own `legalMoves` call returns
        // different objects from ours, so a reference comparison never matches. `setupAi` builds an
        // action that is not in `moves` at all, hence the fallback.
        if (scored.length >= 2) {
          const chosen = scored.find(x => sameAction(x.m, action))?.r ?? classifyResolution(resolve(s, action), me)
          if (chosen.kind === 'opponent') suspended.chosenOpponentAnswer++
          if (chosen.kind === 'self') suspended.chosenSelfAnswer++

          // Did this move hand them lethal, and was there a legal move that would not have? A forced
          // move is excluded above, because "unavoidable" is already its whole answer.
          const picked = scored.find(x => sameAction(x.m, action))
          const chosenExposed = picked ? picked.exposed : canFinishThisAction(resolve(s, action), foe)
          const verdict = classifyExposure(chosenExposed, scored.some(x => !x.exposed))
          exposure.decisions++
          if (verdict !== 'safe') exposure.exposed++
          if (verdict === 'avoidable') { exposure.avoidable++; avoidableBy[me] = true }
          if (verdict === 'unavoidable') exposure.unavoidable++
        }
        // Pool size BEFORE the decision, so "skipped at 8" means it already held 8. Skipping with
        // an empty hand is forced, not chosen, so it is not counted.
        const pool = s.players[me].resources.length
        const couldBank = s.players[me].hand.length > 0
        if (action.type === 'resourceCard' && s.phase === 'regroup') { banked++; bankedPool += pool }
        if (action.type === 'skipResource' && couldBank) { skipped++; skippedPool += pool }
        if (action.type === 'takeInitiative') {
          // Every claim, not just the denial ones: a claim that hands them the round they need to
          // BUILD lethal cannot appear in a bucket that requires the threat to exist already.
          claimWatches.push(openClaimWatch(s, me))
          claimCost.claims++
          initTaken++
          if (s.consecutivePasses >= 1) cheapTaken++
          else { forfeitedCount++; forfeited += s.players[me].units.filter(u => !u.exhausted).length }
        }
        // Doing nothing (#521). Counted from the candidate list rather than from the tie columns: how
        // often `pass` TIES is a property of the evaluation, how often it is CHOSEN is the behaviour.
        // Carried to the post-resolve check below, so a FORCED pass that ends the phase is not counted
        // as a phase-ending choice. Without it `endedPhase` exceeded `taken`, which is how it was found.
        let passWasChosen = false
        if (moves.some(m => m.type === 'pass')) {
          const alternatives = moves.filter(m => m.type !== 'pass')
          if (alternatives.length === 0) passes.forced++
          else {
            passes.offered++
            // Did the charge decide this? Add the penalty back to the pass candidate and see whether it
            // would have led. Only meaningful when the trace describes THIS decision, hence the length
            // guard used everywhere else in this file.
            if (action.type !== 'pass' && trace && trace.passPenalty > 0
              && trace.candidates.length === moves.length) {
              const passIndex = moves.findIndex(m => m.type === 'pass')
              const raw = trace.candidates[passIndex] + trace.passPenalty
              const bestOther = Math.max(...trace.candidates.filter((_, i) => i !== passIndex))
              if (raw > bestOther) {
                passes.flipped++
                flippedInto.set(action.type, (flippedInto.get(action.type) ?? 0) + 1)
              }
            }
            if (action.type === 'pass') {
              passes.taken++
              passWasChosen = true
              if (alternatives.some(m => m.type === 'attack')) passes.withAttackAvailable++
              // Neither side has stopped, so this pass does not end the round: it hands over a turn and
              // play continues. Read off the board rather than from the resolve, so it stays a property
              // of the decision the bot faced.
              if (s.consecutivePasses === 0 && s.initiativeTakenBy === null) passes.midRound++
              // Their pass already stands, so ours ends the phase; claiming ends it too and takes the
              // initiative with it. Same board, one strictly better move.
              if (s.consecutivePasses >= 1 && alternatives.some(m => m.type === 'takeInitiative')) {
                passes.dominatedByClaim++
              }
            }
          }
        }

        const beforeAction = s
        // Read BEFORE the resolve: an answer is a decision the card handed the player, not an action
        // they chose to take, and the funnel's "their first action" stage must not fire on one.
        const wasAnswer = hasPendingChoices(beforeAction)
        s = resolve(s, action)
        if (passWasChosen && beforeAction.phase === 'action' && s.phase !== 'action') {
          passes.endedPhase++
        }

        // Attaching an upgrade to our own unit that makes it WORSE (#509). Compared across the
        // attachment in the attacking-base context, rather than read off the card, so any upgrade that
        // is a downgrade where it matters is caught however it is implemented.
        if (action.type === 'playUpgrade' && action.targetInstanceId !== undefined) {
          const ctx = { attacking: true, attackingBase: true }
          for (const seat of [me, foe]) {
            const before = beforeAction.players[seat].units.find(u => u.instanceId === action.targetInstanceId)
            const after = s.players[seat].units.find(u => u.instanceId === action.targetInstanceId)
            if (!before || !after) continue
            const worse = effectivePower(s, after, ctx) < effectivePower(beforeAction, before, ctx)
            if (seat === me) {
              selfDebuff.onOwnUnits++
              if (worse) selfDebuff.ownWorsened++
            } else {
              selfDebuff.onEnemyUnits++
              if (worse) selfDebuff.enemyWorsened++
            }
          }
        }
        for (const watch of denialWatches) advanceDenialWatch(watch, s, me, wasAnswer)
        for (const watch of claimWatches) advanceClaimWatch(watch, s, claimCost)

        // Where the tokens went (#497). Diffed across the resolve rather than instrumented into
        // `consumeAdvantage`, so however a token leaves play it is still counted.
        {
          const spend = advantageSpend(beforeAction, s, action)
          advantage.spentAttacking += spend.attacking
          advantage.spentDefending += spend.defending
          advantage.spentOther += spend.other
          advantage.diedUnspent += spend.died
          advantage.diedUnspentOurs += spend.diedMine
          advantage.diedUnspentTheirs += spend.diedTheirs
        }

        // A deployed leader is a large investment, and re-deploying costs the epic action, so losing
        // one straight away is among the most expensive mistakes available. Watch each one until the
        // end of the round AFTER it arrived, which is the window a reply policy should protect.
        if (action.type === 'deployLeader') {
          const arrived = s.players[me].units.find(u => u.isLeader)
          if (arrived) {
            leader.deploys++
            watching.push({ seat: me, instanceId: arrived.instanceId, until: s.round + 1 })
          }
        }
        for (let w = watching.length - 1; w >= 0; w--) {
          const watch = watching[w]
          const alive = s.players[watch.seat].units.some(u => u.instanceId === watch.instanceId)
          if (!alive) { leader.diedSoon++; watching.splice(w, 1) }
          else if (s.round > watch.until) watching.splice(w, 1) // survived the window
        }
      }

      for (const watch of denialWatches) closeDenialWatch(watch, s, denialOutcome)

      // Charge each seat's avoidable exposures against whether that seat actually lost. A gate can
      // only ever recover games where the exposure preceded the defeat.
      exposure.games++
      const loser = s.winner === 'player' ? 'opponent' : s.winner === 'opponent' ? 'player' : null
      if (loser !== null) exposure.losses++
      for (const seat of ['player', 'opponent'] as PlayerId[]) {
        if (avoidableBy[seat]) {
          exposure.gamesWithAvoidable++
          if (seat === loser) exposure.lostAfterAvoidable++
        } else {
          exposure.gamesWithoutAvoidable++
          if (seat === loser) exposure.lostWithoutAvoidable++
        }
      }
    }
  })

  const stat = (label: string, t: Tally): DecisionStat => ({
    label,
    offered: t.offered,
    tied: t.tied,
    tiedSearch: t.tiedSearch,
    avgCandidates: t.offered === 0 ? 0 : t.candidates / t.offered,
  })

  return {
    commitId: COMMIT_ID,
    ai: config.aiName ?? 'greedy',
    games,
    stats: [
      stat('regroup: which card', resourcing),
      stat('initiative: take it', initiative),
      stat('which attack', attacks),
      stat('which card to play', plays),
      stat('answering a choice', answering),
    ],
    ties: {
      ...ties,
      byKind: [...tieKinds]
        .map(([kind, b]) => ({ kind, ...b }))
        .sort((a, b) => b.fired - a.fired || a.kind.localeCompare(b.kind)),
    },
    initiativeHorizon: horizon,
    denialOutcome,
    claimCost,
    selfDebuff,
    passes: {
      ...passes,
      flippedInto: [...flippedInto.entries()]
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count),
    },
    initiativeTies: {
      ...initTies,
      tyingKinds: [...tyingKinds.entries()]
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count),
    },
    triggers: {
      ...triggers,
      byKind: [...triggerKinds]
        .map(([kind, b]) => ({ kind, ...b }))
        .sort((a, b) => b.offered - a.offered || a.kind.localeCompare(b.kind)),
    },
    pin,
    advantage,
    blockedReach: blocked,
    shields,
    leader,
    resourcing: {
      banked,
      skipped,
      avgPoolWhenBanked: banked === 0 ? 0 : bankedPool / banked,
      avgPoolWhenSkipped: skipped === 0 ? 0 : skippedPool / skipped,
    },
    initiative: {
      offered: initOffered,
      taken: initTaken,
      cheapOffered,
      cheapTaken,
      avgForfeitedWhenClaimed: forfeitedCount === 0 ? 0 : forfeited / forfeitedCount,
    },
    role: {
      ...roleCount,
      flipsPerGame: games === 0 ? 0 : roleFlips / games,
      walledSamples,
      samples: roleSamples,
    },
    suspended: {
      ...suspended,
      opponentChoiceKinds: rank(opponentKinds),
      selfChoiceKinds: rank(selfKinds),
    },
    lethal: {
      decisions: [...lethalByRound.values()].reduce((n, b) => n + b.decisions, 0),
      ours: [...lethalByRound.values()].reduce((n, b) => n + b.ours, 0),
      theirs: [...lethalByRound.values()].reduce((n, b) => n + b.theirs, 0),
      oursOneAction,
      theirsOneAction,
      byRound: [...lethalByRound].sort(([a], [b]) => a - b).map(([round, b]) => ({ round, ...b })),
    },
    exposure,
  }
}
