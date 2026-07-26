import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'
import { buildCardDb } from '../engine/cardDb'
import { initGame } from '../engine/initGame'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { seededShuffle, nextSeed } from '../engine/rng'
import { BUILD_TAG } from '../buildTag'
import { evaluate } from '../ai/evaluate'
import { resolveAi } from '../ai/registry'
import { setupAi } from '../ai/setupAi'
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

export interface DecisionReport {
  buildTag: string
  ai: string
  games: number
  stats: DecisionStat[]
  resourcing: ResourcingStat
}

interface Tally {
  offered: number
  tied: number
  candidates: number
}

const empty = (): Tally => ({ offered: 0, tied: 0, candidates: 0 })

export function runDecisions(config: DecisionConfig): DecisionReport {
  const { decks } = buildCoverageDecks(POOL, config.seed)
  const cardDb = buildCardDb(POOL)
  const ai = resolveAi(config.aiName ?? 'greedy')
  const ceiling = config.stepCeiling ?? 4000

  const resourcing = empty()
  const initiative = empty()
  const attacks = empty()
  const plays = empty()
  let games = 0
  let banked = 0
  let skipped = 0
  let bankedPool = 0
  let skippedPool = 0

  decks.forEach((deck, d) => {
    for (let g = 0; g < config.gamesPerDeck; g++) {
      const seed = nextSeed(config.seed + d * 37 + g)
      const shuffleSeed = { v: seed }
      const shuffle = <T,>(arr: T[]): T[] => { shuffleSeed.v = nextSeed(shuffleSeed.v); return seededShuffle(arr, shuffleSeed.v) }
      let s: GameState = initGame(deck, deck, cardDb, { firstPlayer: g % 2 === 0 ? 'player' : 'opponent', shuffle, rngSeed: seed })
      games++

      for (let i = 0; i < ceiling && s.winner === null; i++) {
        const moves = legalMoves(s)
        if (moves.length === 0) break
        const me = s.activePlayer
        // The same scoring the greedy driver does, so a tie here is a tie there.
        const scored = moves.map(m => ({ m, v: evaluate(resolve(s, m), me) }))
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

        // Initiative is a single move, so "tied" means tied with the best alternative: the position
        // where the seeded tie-break decides whether to forfeit the rest of the round.
        const init = scored.find(x => x.m.type === 'takeInitiative')
        if (init) {
          initiative.offered++
          initiative.candidates += 1
          if (init.v === best) initiative.tied++
        }

        const action = setupAi(s) ?? ai(s)
        if (!action) break
        // Pool size BEFORE the decision, so "skipped at 8" means it already held 8. Skipping with
        // an empty hand is forced, not chosen, so it is not counted.
        const pool = s.players[me].resources.length
        const couldBank = s.players[me].hand.length > 0
        if (action.type === 'resourceCard' && s.phase === 'regroup') { banked++; bankedPool += pool }
        if (action.type === 'skipResource' && couldBank) { skipped++; skippedPool += pool }
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
    ],
    resourcing: {
      banked,
      skipped,
      avgPoolWhenBanked: banked === 0 ? 0 : bankedPool / banked,
      avgPoolWhenSkipped: skipped === 0 ? 0 : skippedPool / skipped,
    },
  }
}
