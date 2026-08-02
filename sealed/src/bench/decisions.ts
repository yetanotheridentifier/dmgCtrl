import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import type { GameState, PlayerId } from '../engine/types'
import { opponentOf, hasPendingChoices } from '../engine/types'
import { buildCardDb } from '../engine/cardDb'
import { initGame } from '../engine/initGame'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { seededShuffle, nextSeed } from '../engine/rng'
import { BUILD_TAG } from '../buildTag'
import { evaluate } from '../ai/evaluate'
import { makeQuiescent } from '../ai/search'
import { resolveAi } from '../ai/registry'
import { setupAi } from '../ai/setupAi'
import { role, reachSteady, type Role } from '../ai/race'
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
}

/** One kind of decision, and how often the evaluation had nothing to say about it. */
export interface DecisionStat {
  label: string
  /** Positions where this decision was offered with more than one candidate. */
  offered: number
  /** Of those, how many had every candidate scoring identically (a coin flip). */
  tied: number
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

export interface DecisionReport {
  buildTag: string
  ai: string
  games: number
  stats: DecisionStat[]
  resourcing: ResourcingStat
  initiative: InitiativeStat
  role: RoleStat
  suspended: SuspendedStat
}

interface Tally {
  offered: number
  tied: number
  candidates: number
}

const empty = (): Tally => ({ offered: 0, tied: 0, candidates: 0 })

/** The greedy driver's own scoring function, so a tie measured here is a tie it would coin-flip. */
const score = makeQuiescent(evaluate)

/** Choice kinds, most frequent first. Count then name, so the order is stable across runs rather
 *  than following insertion. */
const rank = (counts: Map<string, number>): Array<{ kind: string; count: number }> =>
  [...counts]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))

export function runDecisions(config: DecisionConfig): DecisionReport {
  const { decks } = buildCoverageDecks(POOL, config.seed)
  const cardDb = buildCardDb(POOL)
  const ai = resolveAi(config.aiName ?? 'greedy')
  const ceiling = config.stepCeiling ?? 4000

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

  decks.forEach((deck, d) => {
    for (let g = 0; g < config.gamesPerDeck; g++) {
      const seed = nextSeed(config.seed + d * 37 + g)
      const shuffleSeed = { v: seed }
      const shuffle = <T,>(arr: T[]): T[] => { shuffleSeed.v = nextSeed(shuffleSeed.v); return seededShuffle(arr, shuffleSeed.v) }
      let s: GameState = initGame(deck, deck, cardDb, { firstPlayer: g % 2 === 0 ? 'player' : 'opponent', shuffle, rngSeed: seed })
      games++
      let lastRole: Exclude<Role, 'neutral'> | null = null
      let sampledRound = 0

      for (let i = 0; i < ceiling && s.winner === null; i++) {
        const moves = legalMoves(s)
        if (moves.length === 0) break
        const me = s.activePlayer
        // The role is fixed once per decision, exactly as the greedy driver does it, so a tie here
        // is a tie there.
        const asRole = role(s, me)
        const scored = moves.map(m => {
          const next = resolve(s, m)
          // Scored with quiescence, as the greedy driver does, so a tie counted here is a tie there.
          // The half-resolution counts alongside are taken from the RAW state, since they measure how
          // often quiescence has anything to do rather than what it concluded.
          return { m, v: score(next, me, asRole), r: classifyResolution(next, me) }
        })
        const best = Math.max(...scored.map(x => x.v))

        const record = (tally: Tally, subset: typeof scored): void => {
          if (subset.length < 2) return
          tally.offered++
          tally.candidates += subset.length
          if (new Set(subset.map(x => x.v)).size === 1) tally.tied++
        }
        record(resourcing, scored.filter(x => x.m.type === 'resourceCard'))
        record(attacks, scored.filter(x => x.m.type === 'attack'))
        record(plays, scored.filter(x => x.m.type === 'playUnit' || x.m.type === 'playEvent' || x.m.type === 'playUpgrade'))
        // With a choice outstanding, `legalMoves` returns nothing BUT its answers, so the whole
        // candidate set is the decision. The one kind where the options were handed to the player by
        // a card rather than chosen, which is why it is measured separately from the plays above.
        if (hasPendingChoices(s)) record(answering, scored)

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
        const init = scored.find(x => x.m.type === 'takeInitiative')
        if (init) {
          initiative.offered++
          initiative.candidates += 1
          if (init.v === best) initiative.tied++
          initOffered++
          // The opponent has already passed, so claiming ends the phase (CR 1.15.5c) and they gain
          // nothing from your silence. Still costs your own remaining actions, hence "cheap".
          if (s.consecutivePasses >= 1) cheapOffered++
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

        const action = setupAi(s) ?? ai(s)
        if (!action) break
        // What the AI actually committed to. Greedy returns one of the `moves` objects, so the
        // classification is already computed; `setupAi` builds its own, so fall back to resolving.
        if (scored.length >= 2) {
          const chosen = scored.find(x => x.m === action)?.r ?? classifyResolution(resolve(s, action), me)
          if (chosen.kind === 'opponent') suspended.chosenOpponentAnswer++
          if (chosen.kind === 'self') suspended.chosenSelfAnswer++
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
      }
    }
  })

  const stat = (label: string, t: Tally): DecisionStat => ({
    label,
    offered: t.offered,
    tied: t.tied,
    avgCandidates: t.offered === 0 ? 0 : t.candidates / t.offered,
  })

  return {
    buildTag: BUILD_TAG,
    ai: config.aiName ?? 'greedy',
    games,
    stats: [
      stat('regroup: which card', resourcing),
      stat('initiative: take it', initiative),
      stat('which attack', attacks),
      stat('which card to play', plays),
      stat('answering a choice', answering),
    ],
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
  }
}
