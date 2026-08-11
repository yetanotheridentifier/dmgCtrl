import { describe, it, expect } from 'vitest'
import { runDecisions, classifyResolution, sameAction, advantageSpend, TIE_FANOUT_CAP } from '../bench/decisions'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import type { GameState, PendingChoice } from '../engine/types'
import type { Action } from '../engine/actions'
import '../engine/cardDefinitions'

/**
 * Decision-quality diagnostics (#393). Win rate moves a point or two and says nothing about why;
 * what actually diagnosed #393 was counting how often the evaluation had NO opinion, every
 * candidate scoring the same so the seeded tie-break chose at random. That was 100% of regroup
 * resource picks, and it is the number a fix has to move.
 */
/**
 * One searching run, shared by everything below that needs one. `deckLimit` and a shallow beam keep
 * it to seconds; the mechanism is what is under test, not the rates, and a real run uses all 44 decks
 * with the shipped configuration.
 *
 * Shared rather than repeated per describe because a searching pass is by far the most expensive
 * thing in this suite, and a second copy of it pushed unrelated marginal tests over their timeouts.
 */
const searched = runDecisions({ gamesPerDeck: 1, seed: 4242, aiName: 'beam:4x2', deckLimit: 3 })

describe('runDecisions', () => {
  // One game per deck keeps this quick; the numbers are stable enough to assert on.
  const report = runDecisions({ gamesPerDeck: 1, seed: 4242 })

  it('reports the decisions the AI series cares about', () => {
    expect(report.stats.map(s => s.label)).toEqual([
      'regroup: which card',
      'initiative: take it',
      'which attack',
      'which card to play',
      'answering a choice',
    ])
  })

  /**
   * Answering a pending choice is its own decision kind and was going unmeasured, which left the
   * optional-abilities work with no way to size itself. It is the one kind where the candidates are
   * not actions the player chose to have: the card handed them a menu.
   */
  it('measures how well the evaluation separates the answers to a choice', () => {
    const answering = report.stats.find(s => s.label === 'answering a choice')!
    expect(answering.offered, 'choices with more than one answer are common').toBeGreaterThan(0)
    expect(answering.avgCandidates).toBeGreaterThan(1)
  })

  /**
   * A tie must be measured against the AI being diagnosed (#494).
   *
   * The tie rate was always computed with a **one-ply** scorer held in a module constant, whichever
   * AI was named. Pointing the diagnostic at `beam-reply` therefore walked the shipped bot's
   * positions while reporting one ply's opinion of them, which answers neither "what does one ply
   * miss" nor "what does the shipped bot miss".
   *
   * Both are now reported. The pair is the point: the gap between them is how many of the ties one
   * ply cannot break the search does break, which is exactly the question #396 and #398 were told to
   * re-ask once the search landed.
   */
  /**
   * **A search both breaks ties and creates them**, which is not what I assumed writing this.
   *
   * The obvious expectation is that deeper search can only refine one ply's opinion, so `tiedSearch`
   * should never exceed `tied`. Measured, it does. A beam values a move by the best board its
   * follow-ups reach, so two moves that one ply scores differently can converge on the same best
   * position inside the horizon and come out **equal**. Looking further can collapse distinct options
   * into equivalence as well as separate equivalent ones.
   *
   * That makes the pair worth more, not less. `tiedSearch` is the rate at which the **shipped bot**
   * coin-flips, which is the blind spot that matters, and it is not bounded by one ply's.
   */
  it('reports both columns, which need not agree in either direction', () => {
    const answering = searched.stats.find(s => s.label === 'answering a choice')!
    expect(answering.offered).toBeGreaterThan(0)
    for (const s of searched.stats) {
      expect(s.tiedSearch, s.label).toBeGreaterThanOrEqual(0)
      expect(s.tiedSearch, s.label).toBeLessThanOrEqual(s.offered)
    }
  })

  /** A one-ply AI has no search of its own, so the two columns must agree exactly rather than one
   *  quietly reporting zero. */
  it('reports identical columns for a one-ply AI', () => {
    for (const s of report.stats) {
      expect(s.tiedSearch, s.label).toBe(s.tied)
    }
  })

  /**
   * **How often a term is live, against how often the situation it was written for occurs.**
   *
   * `blockedReach` was written for the shielded-Sentinel lockout, a lane shut for the rest of the
   * game, measured at 2.1% of decisions. But the quantity keys on `sentinelLocked`, which is true
   * whenever ANY enemy Sentinel forces our attackers, shielded or not. If those two rates are far
   * apart the term is not the narrow gate it was designed as, and at weight 12 it measured 25.0%
   * against the shipped bot.
   *
   * The general lesson is the reason this is a permanent counter rather than a probe: a new term must
   * be read against how often it is live and how large it gets, not only against the position that
   * motivated it.
   */
  it('reports how often blocked reach is live, against how often a lane is shut', () => {
    const b = report.blockedReach
    expect(b.decisions).toBeGreaterThan(0)
    expect(b.active).toBeLessThanOrEqual(b.decisions)
    // A shut lane is a strict special case of the term being live, so this ordering must hold or the
    // two are measuring different things and neither can be read against the other.
    expect(b.activeAndLaneShut).toBeLessThanOrEqual(b.active)
    expect(b.widestQuantity).toBeGreaterThanOrEqual(0)
    if (b.active === 0) expect(b.widestQuantity).toBe(0)
    else expect(b.widestQuantity).toBeGreaterThan(0)

    // **The quantity must be the one the evaluation prices.** The cap applies to each side before the
    // difference, so a capped quantity can never exceed the cap. Differencing the raw reach instead
    // reported 26 against a cap of 10, and every contribution figure read off that would be inflated.
    expect(b.widestQuantity, 'a capped quantity cannot exceed the cap').toBeLessThanOrEqual(DEFAULT_WEIGHTS.blockedReachCap)
  })

  /**
   * Advantage prevalence, the gate on #497 (#497).
   *
   * The ticket closes itself if Advantage is rare: Shield prevalence was **15.8%** of decisions and
   * that is what made pricing it worth attempting. These counters answer the same question for a
   * token the evaluation already sees but mis-times.
   */
  it('reports how present Advantage is, and where the tokens go', () => {
    const a = report.advantage
    expect(a.decisions).toBeGreaterThan(0)
    expect(a.decisionsWithAny).toBeLessThanOrEqual(a.decisions)
    expect(a.decisionsOnCarrier).toBeLessThanOrEqual(a.decisionsWithAny)
    // A decision that sees any token sees at least one.
    expect(a.tokensSeen).toBeGreaterThanOrEqual(a.decisionsWithAny)
    if (a.decisionsWithAny > 0) expect(a.maxStack).toBeGreaterThan(0)
    else expect(a.maxStack).toBe(0)
    for (const n of [a.spentAttacking, a.spentDefending, a.spentOther, a.diedUnspent]) {
      expect(n).toBeGreaterThanOrEqual(0)
    }
    // The two sides of a death must account for all of it, or the denial rate is unreadable.
    expect(a.diedUnspentOurs + a.diedUnspentTheirs).toBe(a.diedUnspent)
  })

  /**
   * The second symptom, from #501: `power` is summed across a side, so every recipient of a token
   * grant scores alike and the bot coin-flips over who to arm. This counts how often that happens.
   */
  it('reports how often a token grant has no preferred recipient', () => {
    const a = report.advantage
    expect(a.grantChoicesAllEqual).toBeLessThanOrEqual(a.grantChoices)
    expect(a.grantChoices).toBeLessThanOrEqual(a.decisions)
  })

  /**
   * Shields, and whether the bot ever strips one (#493).
   *
   * A Shield prevents a whole instance of damage, so after a ping the board has the same units at the
   * same HP and the only difference is a token no evaluation term reads. The board scores
   * **identically**, which makes stripping a Shield indistinguishable from doing nothing while the
   * cost of the attack is counted in full.
   *
   * These counters decide whether #493 is worth building. If shielded units barely appear in this
   * pool the ticket dies cheaply; if they are common and the strip rate is low, the live-play
   * observation is confirmed at scale.
   */
  it('counts shields it faced and shields it removed', () => {
    const sh = report.shields
    expect(sh.decisionsFacingShield).toBeGreaterThanOrEqual(0)
    expect(sh.removals).toBeGreaterThanOrEqual(0)
    // A removal can only happen at a decision that faced one.
    expect(sh.removals).toBeLessThanOrEqual(sh.decisionsFacingShield)
    expect(sh.decisionsFacingShield).toBeLessThanOrEqual(report.exposure.decisions)
  })

  /** Whether the strip was even available matters more than whether it happened: declining an
   *  impossible play is not a blind spot. */
  it('counts the decisions where a strip was actually on offer', () => {
    const sh = report.shields
    expect(sh.removalAvailable).toBeGreaterThanOrEqual(sh.removals)
    expect(sh.removalAvailable).toBeLessThanOrEqual(sh.decisionsFacingShield)
  })

  /**
   * **The chosen move is never the same object as the candidate it matches.**
   *
   * The diagnostic calls `legalMoves` to build its candidate list and the AI calls it again inside
   * itself, so the two arrays hold structurally identical but distinct objects. Measured over 40 real
   * positions with both `greedy` and `beam-reply`: reference match 0/40, value match 40/40.
   *
   * Every counter that asks "did the AI pick this candidate" must therefore compare by value. The
   * existing ones survived only because they carry a `?? recompute` fallback that was quietly doing
   * all the work; a new counter written without one read exactly zero across 2,359 opportunities and
   * looked like a spectacular finding.
   */
  it('matches a chosen move to its candidate by value, since references never match', () => {
    expect(sameAction({ type: 'pass' }, { type: 'pass' })).toBe(true)
    expect(sameAction(
      { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } },
      { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } },
    )).toBe(true)
    expect(sameAction({ type: 'pass' }, { type: 'takeInitiative' })).toBe(false)
    expect(sameAction(
      { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } },
      { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e2' } },
    )).toBe(false)
  })

  /**
   * The shielded-Sentinel lockout (#493 follow-up), which is the defect play-testers actually report.
   *
   * A Sentinel forces every attacker in its arena onto itself. Give it a Shield and the bot cannot
   * remove it, because stripping leaves a board scoring identically, so **the lane is closed for the
   * rest of the game** and no base damage gets through it. That is structural, unlike the general
   * "shields are undervalued" reading, which measured 15.8% of decisions and swept to a null.
   *
   * The number that decides how hard to push a fix is **consecutive rounds locked**: one round is
   * noise, four is a lost game.
   */
  it('separates shielded blockers from shielded units generally', () => {
    const sh = report.shields
    // Every blocker is a shielded enemy unit, so it cannot exceed the total seen.
    expect(sh.shieldedBlockers).toBeLessThanOrEqual(sh.shieldsSeen)
    expect(sh.shieldedBlockers).toBeGreaterThanOrEqual(0)
  })

  /**
   * **A lane is an arena, and measuring board-wide instead understates it drastically.** A shielded
   * Sentinel in ground shuts ground and leaves space alone, so "is every attacker locked" reports
   * open whenever one unit stands in the other arena. Measured that way the rate was 0.3% of
   * decisions and never lasted a round, which contradicted what play-testers were reporting.
   */
  it('counts a shut lane separately from a shut board', () => {
    const sh = report.shields
    // Both lanes shut is a strict special case of one lane shut, which is a special case of facing
    // a shield at all. If that ordering ever breaks, the arena split is wrong.
    expect(sh.lockedOut).toBeLessThanOrEqual(sh.laneLocked)
    expect(sh.laneLocked).toBeLessThanOrEqual(sh.decisionsFacingShield)
  })

  /**
   * Sampled once a round from one seat, not per decision, so the figure is rounds rather than
   * actions. Per-game state must be built inside the game loop: a watch list declared outside one
   * once reported a leader-death rate of 72.3% against a true 17.7%.
   */
  it('measures how long a lockout persists, in rounds', () => {
    const sh = report.shields
    expect(sh.roundsSampled).toBeGreaterThan(0)
    expect(sh.lockedRounds).toBeLessThanOrEqual(sh.roundsSampled)
    expect(sh.longestLockout).toBeLessThanOrEqual(sh.lockedRounds)
    // A run cannot exceed the rounds in a single game, so a figure near `roundsSampled` across many
    // games would mean the per-game reset leaked.
    expect(sh.longestLockout).toBeLessThan(sh.roundsSampled)
  })

  it('actually plays games and observes each decision', () => {
    expect(report.games).toBeGreaterThan(0)
    for (const s of report.stats) expect(s.offered, s.label).toBeGreaterThan(0)
  })

  /**
   * The regression this exists to prevent. Before #393 every one of these was a tie; if the hand
   * valuation is ever removed or neutralised, this fails loudly rather than showing up as a slow
   * drift in win rate.
   */
  it('shows the AI has an opinion about which card to bank', () => {
    const resourcing = report.stats.find(s => s.label === 'regroup: which card')!
    expect(resourcing.avgCandidates, 'several cards to choose between').toBeGreaterThan(2)
    expect(resourcing.tied / resourcing.offered).toBeLessThan(0.1)
  })

  // Plays the coverage deck set twice over, so well past vitest's 5s default.
  /**
   * The readout that let #393 iteration 2 be judged. Banking is a flat public +1 at every regroup,
   * so the shipped AI never skips: 0% is the correct current number, not a broken measurement. A
   * concave pool moved it to 12.5% (all at a pool of exactly the knee) and still lost, so the flat
   * weights stayed. This asserts the instrument reports the behaviour, whatever the weights say.
   */
  it('reports whether the AI banks or skips, and at what pool size', () => {
    const { banked, skipped, avgPoolWhenBanked } = report.resourcing
    expect(banked).toBeGreaterThan(0)
    expect(avgPoolWhenBanked).toBeGreaterThan(0)
    // Flat pool value (`resourceSurplus === resource`) means banking always wins by exactly +1, and
    // the private hand term is bounded below 1, so it can never flip that. Forced skips (an empty
    // hand leaves no other legal move) are excluded, or this would be a few percent of phantoms.
    expect(DEFAULT_WEIGHTS.resourceSurplus).toBe(DEFAULT_WEIGHTS.resource)
    expect(skipped, 'a flat pool never CHOOSES to decline a resource').toBe(0)
  })

  /**
   * #394's readout, and the guard against its two named failure modes. Never-claim and always-claim
   * are both wrong however good the win rate looks, so the raw counts are asserted rather than a
   * score. Claiming forfeits the rest of your round, so a low mean of forfeited ready units is the
   * sign the cost term is doing its job.
   */
  it('claims the initiative sometimes, but never always and never not at all', () => {
    const { offered, taken, cheapOffered, cheapTaken, avgForfeitedWhenClaimed } = report.initiative
    expect(offered).toBeGreaterThan(0)
    expect(taken, 'never-claim is a failure mode').toBeGreaterThan(0)
    expect(taken, 'always-claim is the other failure mode').toBeLessThan(offered)
    // The cheap window (opponent already passed) should be taken far more often than not.
    expect(cheapOffered).toBeGreaterThan(0)
    expect(cheapTaken / cheapOffered).toBeGreaterThan(0.5)
    // It should mostly claim when it had little left to do: pre-#394 this averaged 2.5.
    expect(avgForfeitedWhenClaimed).toBeLessThan(1)
  })

  /**
   * Sizes the search work before any of it is built. Greedy scores the state a candidate move
   * produces, but some moves do not finish resolving: they leave a choice owed, either by the
   * opponent (an attack suspending on "may prevent damage") or by the mover itself (a when-played
   * effect whose target has not been picked). Either way the score is read off a half-resolved
   * board.
   *
   * The two counts point at different fixes, so they are reported separately: an opponent-owed
   * answer wants pessimistic resolution, a self-owed one wants the mover's own sequence expanded.
   */
  it('counts candidate moves that leave a choice owed, split by who owes it', () => {
    const s = report.suspended
    expect(s.positions, 'decisions observed').toBeGreaterThan(0)
    expect(s.candidates).toBeGreaterThanOrEqual(s.positions)

    // Each split is a subset of the whole, at both candidate and position granularity.
    expect(s.opponentAnswers + s.selfAnswers).toBeLessThanOrEqual(s.candidates)
    expect(s.positionsWithOpponentAnswer).toBeLessThanOrEqual(s.positions)
    expect(s.positionsWithSelfAnswer).toBeLessThanOrEqual(s.positions)
    expect(s.chosenOpponentAnswer).toBeLessThanOrEqual(s.positionsWithOpponentAnswer)
    expect(s.chosenSelfAnswer).toBeLessThanOrEqual(s.positionsWithSelfAnswer)

    // A when-played effect that asks the mover something is common enough that zero would mean the
    // instrument is broken rather than that the game lacks them.
    expect(s.selfAnswers, 'self-owed answers are everywhere in this card pool').toBeGreaterThan(0)

    // Naming the kinds is what turns a rate into a decision: one card driving it all is a very
    // different ticket from a broad spread, and on our own side a chain we can finish on the spot
    // is a different fix from an `ambush` that opens a whole second action.
    for (const ks of [s.opponentChoiceKinds, s.selfChoiceKinds]) {
      expect(ks.every(k => k.count > 0)).toBe(true)
      expect([...ks].sort((a, b) => b.count - a.count)).toEqual(ks)
    }
    expect(s.selfChoiceKinds.reduce((n, k) => n + k.count, 0)).toBe(s.selfAnswers)
    expect(s.opponentChoiceKinds.reduce((n, k) => n + k.count, 0)).toBe(s.opponentAnswers)
  })

  // Two full passes of the diagnostic, and quiescent scoring made each one about 2.5x dearer, so the
  // budget is generous: this guards determinism, and a slow machine failing it teaches nothing.
  /**
   * Sizing for the lethal work (#432): how often a lethal line is available at all. Every rule built
   * on a lethal solver (#433) can only fire as often as this, so if it is vanishingly rare the
   * initiative-lethal rules and the tap-out risk gate are both low value, and that is much cheaper to
   * learn here than after building a solver and a belief model on top.
   */
  it('reports how often either seat could finish the enemy base', () => {
    const l = report.lethal
    expect(l.decisions).toBeGreaterThan(0)
    expect(l.ours).toBeLessThanOrEqual(l.decisions)
    expect(l.theirs).toBeLessThanOrEqual(l.decisions)
    // A game ends by someone finishing a base, so lethal must exist somewhere.
    expect(l.ours, 'lethal never available to the acting seat would mean the measure is broken').toBeGreaterThan(0)
  })

  /** A rate concentrated in round 7+ matters far less than one spread through the game. */
  it('breaks lethal availability down by round, summing to the totals', () => {
    const l = report.lethal
    expect(l.byRound.length).toBeGreaterThan(1)
    expect(l.byRound.reduce((n, r) => n + r.decisions, 0)).toBe(l.decisions)
    expect(l.byRound.reduce((n, r) => n + r.ours, 0)).toBe(l.ours)
    expect(l.byRound.reduce((n, r) => n + r.theirs, 0)).toBe(l.theirs)
    for (let i = 1; i < l.byRound.length; i++) {
      expect(l.byRound[i].round).toBeGreaterThan(l.byRound[i - 1].round)
    }
  })

  /**
   * The headroom a tap-out risk gate could actually recover (#432). Not "how often could they
   * finish", which includes positions already lost, but "how often did the bot walk into a lethal it
   * had a legal move to avoid", and how often that preceded losing the game.
   */
  it('reports avoidable lethal exposure and what it cost', () => {
    const e = report.exposure
    expect(e.decisions).toBeGreaterThan(0)
    expect(e.avoidable).toBeLessThanOrEqual(e.exposed)
    expect(e.exposed).toBeLessThanOrEqual(e.decisions)
    expect(e.lostAfterAvoidable).toBeLessThanOrEqual(e.gamesWithAvoidable)
    expect(e.gamesWithAvoidable).toBeLessThanOrEqual(e.games)
    expect(e.losses).toBeLessThanOrEqual(e.games)
  })

  /**
   * #425 claims to subsume #397's direct pinning: "do not deploy into a board that kills it" is what
   * a reply policy computes, so the hand-coded term should not be built. That claim rests on this
   * rate falling, and without the readout #397 would be closed on an argument rather than evidence.
   */
  it('reports how often a deployed leader dies straight away', () => {
    expect(report.leader.deploys, 'leaders do get deployed').toBeGreaterThan(0)
    expect(report.leader.diedSoon).toBeLessThanOrEqual(report.leader.deploys)
  })

  it('is deterministic for a given seed', () => {
    expect(runDecisions({ gamesPerDeck: 1, seed: 4242 })).toEqual(report)
  }, 120_000)

  /**
   * A one-ply AI runs no search, so there is no lead to tie for. Zero rather than a fabricated number:
   * the existing `tied` column is the whole answer for greedy, and reporting a second one here would
   * invite reading a tie-break's firing rate off a bot that cannot have one.
   */
  it('reports no search ties for a one-ply AI', () => {
    expect(report.ties.searched).toBe(0)
    expect(report.ties.fired).toBe(0)
  })
})

/**
 * How often a tie-break would fire, and how much it would re-search (#499).
 *
 * The existing `tied` / `tiedSearch` columns count decisions where **every** candidate scored alike.
 * That is not the firing condition. A second opinion is consulted whenever more than one candidate
 * ties **for the lead**, which happens far more often than a whole-slate tie and is the number the
 * cost case rests on: a second search over two candidates in 5% of decisions is loose change, over
 * six candidates in half of them it is a second bot.
 *
 * Read off `tiedCandidates`, which the search records for every decision whether or not a tie-break
 * is configured, so the rate can be measured before deciding to pay for it.
 */
describe('tie-break firing rate', () => {
  const t = searched.ties

  it('counts decisions where more than one candidate tied for the lead', () => {
    expect(t.searched, 'a searching AI leaves a trace on every decision').toBeGreaterThan(0)
    expect(t.fired).toBeGreaterThan(0)
    expect(t.fired).toBeLessThanOrEqual(t.searched)
  })

  /**
   * The fan-out, which is the cost half. A firing decision re-searches its tied candidates, so the
   * charge is `tiedTotal` extra root searches, not `fired` of them.
   */
  it('reports how many candidates get re-searched', () => {
    expect(t.tiedTotal, 'each firing decision ties at least two').toBeGreaterThanOrEqual(2 * t.fired)
    expect(t.rootsWhenFired, 'the tied set is a subset of the roots').toBeGreaterThanOrEqual(t.tiedTotal)
    expect(t.widest).toBeGreaterThanOrEqual(2)
  })

  /**
   * Overhead needs the roots from **every** searched decision, not just the firing ones. Charging
   * `tiedTotal` against `rootsWhenFired` answers "how much of a firing decision gets redone", which
   * is a different and much friendlier question than "what does the feature cost".
   */
  it('reports the roots the main search covered, as the overhead denominator', () => {
    expect(t.rootsSearched).toBeGreaterThanOrEqual(t.rootsWhenFired)
    expect(t.rootsSearched, 'a searched decision has at least two roots').toBeGreaterThanOrEqual(2 * t.searched)
  })

  /**
   * **The mean hides the tail, and here the tail is most of the cost.** A handful of decisions tie
   * hundreds of candidates, so a cap changes the price of the feature far more than the firing rate
   * suggests. Reported against a stated cap rather than an implied one.
   */
  it('sizes a capped tie-break separately from an uncapped one', () => {
    expect(t.tiedTotalCapped).toBeLessThanOrEqual(t.tiedTotal)
    expect(t.tiedTotalCapped).toBeLessThanOrEqual(TIE_FANOUT_CAP * t.fired)
    expect(t.firedWide).toBeLessThanOrEqual(t.fired)
    // The two counters must agree about whether the cap bit at all.
    if (t.widest <= TIE_FANOUT_CAP) {
      expect(t.tiedTotalCapped).toBe(t.tiedTotal)
      expect(t.firedWide).toBe(0)
    } else {
      expect(t.firedWide).toBeGreaterThan(0)
      expect(t.tiedTotalCapped).toBeLessThan(t.tiedTotal)
    }
  })

  /**
   * Split by decision kind, because the value of a second opinion is not uniform. A coin flip between
   * two attacks can lose a unit; one between two resource picks usually cannot.
   */
  it('splits the firing rate by decision kind', () => {
    expect(t.byKind.length).toBeGreaterThan(0)
    expect(t.byKind.reduce((n, k) => n + k.fired, 0)).toBe(t.fired)
    expect(t.byKind.reduce((n, k) => n + k.searched, 0)).toBe(t.searched)
    for (const k of t.byKind) {
      expect(k.fired, k.kind).toBeLessThanOrEqual(k.searched)
      expect(k.tiedTotal, k.kind).toBeGreaterThanOrEqual(2 * k.fired)
      expect(k.widest, k.kind).toBeLessThanOrEqual(t.widest)
      if (k.fired === 0) expect(k.widest, k.kind).toBe(0)
    }
    // The worst case must be attributable, or a startling maximum cannot be told from an arithmetic
    // error. Exactly one kind holds it, and it is the global figure.
    expect(Math.max(...t.byKind.map(k => k.widest))).toBe(t.widest)
    // Most frequent first, so the readout is stable across runs rather than following insertion.
    expect([...t.byKind].sort((a, b) => b.fired - a.fired || a.kind.localeCompare(b.kind))).toEqual(t.byKind)
  })
})

/**
 * Where an Advantage token went (#497).
 *
 * Advantage is +1/0 **until the unit next completes an attack or defence**, and `consumeAdvantage`
 * then clears the whole stack at once. The evaluation scores it as a durable stat, so it over-values
 * a carrier, and the error scales with the stack: three tokens are +3 power for exactly one attack.
 *
 * Attribution matters more than the total. Spending on **defence** is the case the permanent model
 * gets most wrong, and a token that leaves play with a defeated unit was never worth anything at all.
 */
describe('advantageSpend', () => {
  const cards = {
    ...CARDS,
    BODY: card({ id: 'BODY', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 4 }),
  }
  const withAdv = (id: string, n: number) =>
    unit(id, 'BODY', { arena: 'ground', upgrades: Array.from({ length: n }, () => ({ cardId: TOKEN_ADVANTAGE, owner: 'player' as const })) })

  const board = (mine: ReturnType<typeof unit>[], theirs: ReturnType<typeof unit>[]): GameState =>
    state({ cards, players: { player: player({ units: mine }), opponent: player({ units: theirs }) } })

  const attack = (attackerId: string, targetId: string): Action =>
    ({ type: 'attack', attackerId, target: { kind: 'unit', instanceId: targetId } })

  it('charges the attacker\'s whole stack to attacking', () => {
    const before = board([withAdv('a', 2)], [unit('d', 'BODY', { arena: 'ground' })])
    const after = board([unit('a', 'BODY', { arena: 'ground' })], [unit('d', 'BODY', { arena: 'ground' })])
    expect(advantageSpend(before, after, attack('a', 'd'))).toMatchObject({ attacking: 2, defending: 0, died: 0 })
  })

  /** The defender spends too, and this is the half a permanent model never sees coming. */
  it('charges the defender\'s stack to defending', () => {
    const before = board([unit('a', 'BODY', { arena: 'ground' })], [withAdv('d', 1)])
    const after = board([unit('a', 'BODY', { arena: 'ground' })], [unit('d', 'BODY', { arena: 'ground' })])
    expect(advantageSpend(before, after, attack('a', 'd'))).toMatchObject({ attacking: 0, defending: 1, died: 0 })
  })

  /**
   * A token that leaves play on a defeated unit was pure phantom value: never spent, never useful.
   *
   * **Split by side**, because the two are opposite outcomes: killing their carrier denies them the
   * tokens, losing ours wastes them. `player` acts by default in the fixture, so a defeated
   * `opponent` carrier is a denial.
   */
  it('counts tokens that died with their unit, and whose they were', () => {
    const before = board([unit('a', 'BODY', { arena: 'ground' })], [withAdv('d', 3)])
    const after = board([unit('a', 'BODY', { arena: 'ground' })], [])
    expect(advantageSpend(before, after, attack('a', 'd')))
      .toMatchObject({ died: 3, diedTheirs: 3, diedMine: 0, defending: 0 })
  })

  it('charges a carrier we lost to our own side of the ledger', () => {
    const before = board([withAdv('a', 2)], [unit('d', 'BODY', { arena: 'ground' })])
    const after = board([], [unit('d', 'BODY', { arena: 'ground' })])
    expect(advantageSpend(before, after, attack('a', 'd')))
      .toMatchObject({ died: 2, diedMine: 2, diedTheirs: 0 })
  })

  it('reports nothing when no token moves', () => {
    const before = board([withAdv('a', 2)], [unit('d', 'BODY', { arena: 'ground' })])
    expect(advantageSpend(before, before, attack('a', 'd')))
      .toMatchObject({ attacking: 0, defending: 0, other: 0, died: 0 })
  })

  /** Spent by something other than the combat this action resolved: an ability, a cost, a cleanup. */
  it('files a spend it cannot attribute to the combat as other', () => {
    const before = board([withAdv('x', 1)], [unit('d', 'BODY', { arena: 'ground' })])
    const after = board([unit('x', 'BODY', { arena: 'ground' })], [unit('d', 'BODY', { arena: 'ground' })])
    expect(advantageSpend(before, after, { type: 'pass' })).toMatchObject({ other: 1, attacking: 0 })
  })
})

/**
 * The classifier the counts above are built from, tested directly so the rates cannot quietly drift
 * on a mis-read of who owes what. `activePlayer` is not enough on its own: the engine hands the turn
 * to the opponent when it raises a choice they control, so a state with them to move may be an
 * unfinished action rather than a completed one.
 */
describe('classifyResolution', () => {
  const choice = (controller: 'player' | 'opponent'): PendingChoice =>
    ({ kind: 'selectUnitToDefeat', id: 'c', controller, targets: ['u1'] })

  it('calls a fully resolved state complete', () => {
    expect(classifyResolution(state({ activePlayer: 'opponent' }), 'player')).toEqual({ kind: 'complete' })
  })

  it('reports a choice the mover still owes', () => {
    const s = state({ pendingChoices: [choice('player')] })
    expect(classifyResolution(s, 'player')).toEqual({ kind: 'self', choiceKind: 'selectUnitToDefeat' })
  })

  it('reports a choice handed to the opponent mid-action', () => {
    // The engine flips activePlayer to them so they can answer, then hands control back.
    const s = state({ activePlayer: 'opponent', pendingChoices: [choice('opponent')] })
    expect(classifyResolution(s, 'player')).toEqual({ kind: 'opponent', choiceKind: 'selectUnitToDefeat' })
  })

  /** A finished game is scored terminally, so an unanswered choice on it is not a half-resolution. */
  it('calls a won game complete even with a choice left pending', () => {
    const s = state({ winner: 'player', pendingChoices: [choice('opponent')] })
    expect(classifyResolution(s, 'player')).toEqual({ kind: 'complete' })
  })

  /** Both owed: the opponent's is the one that blocks, so it wins the classification. */
  it('prefers the opponent when both owe an answer', () => {
    const s = state({ activePlayer: 'opponent', pendingChoices: [choice('player'), choice('opponent')] })
    expect(classifyResolution(s, 'player')).toMatchObject({ kind: 'opponent' })
  })
})
