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
import { resolve } from '../engine/resolve'
import { seededShuffle, nextSeed } from '../engine/rng'
import { COMMIT_ID } from '../buildIdentity'
import { evaluate, blockedFor, DEFAULT_WEIGHTS } from '../ai/evaluate'
import { makeQuiescent, lastSearchTrace, clearSearchTrace } from '../ai/search'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
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

export interface DecisionReport {
  commitId: string
  ai: string
  games: number
  stats: DecisionStat[]
  ties: TieStat
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
        const best = Math.max(...scored.map(x => x.v))

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
          initiative.offered++
          initiative.candidates += 1
          if (init.v === best) initiative.tied++
          // Same question of the search: is claiming indistinguishable from the best alternative?
          const svs = withSearch.map(x => x.sv)
          if (svs.every(v => !Number.isNaN(v))) {
            if (init.sv === Math.max(...svs)) initiative.tiedSearch++
          } else if (init.v === best) {
            initiative.tiedSearch++
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
          initTaken++
          if (s.consecutivePasses >= 1) cheapTaken++
          else { forfeitedCount++; forfeited += s.players[me].units.filter(u => !u.exhausted).length }
        }
        s = resolve(s, action)

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
