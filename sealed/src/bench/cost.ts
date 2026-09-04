import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'
import { buildCardDb } from '../engine/cardDb'
import { initGame } from '../engine/initGame'
import { resolve } from '../engine/resolve'
import { seededShuffle, nextSeed } from '../engine/rng'
import { setupAi } from '../ai/setupAi'
import { greedyAi } from '../ai/greedyAi'
import { resolveAi, aiNames } from '../ai/registry'
import { COMMIT_ID } from '../buildIdentity'
import { buildCoverageDecks } from './coverageDecks'
import { firstPlayerFor } from './seating'

/**
 * What a search configuration costs per decision (#425).
 *
 * ## Why this is a bench mode and not another throwaway script
 *
 * The same corpus-timing script has been written **three times**, and cost has been misreported
 * **twice**, both times by reading a bench wall clock: **12x when it was 34x**, and **42 ms when it
 * was 200 ms**. A game's wall clock includes the opponent's cheap decisions and the engine's own
 * work, so it systematically understates how expensive a search is. #425 is a cost trade and #447
 * sweeps configurations where cost is half the decision, so the measurement deserves to be an
 * instrument rather than something rebuilt from memory each time.
 *
 * ## What is and is not comparable
 *
 * **Ratios are the finding. Absolute milliseconds are not portable.** They depend on the machine and
 * on which positions the corpus holds: an early-game board has few units and few legal moves, so a
 * corpus weighted toward openings makes every search look cheap. What survives all of that is the
 * comparison, because **every AI is timed over the identical corpus**, collected once before any
 * timing starts.
 *
 * The corpus is driven by `greedy` rather than by each AI in turn, for the same reason: if each AI
 * played its own games it would be timed on positions of its own making, and a search that steers
 * toward simpler boards would look fast for the wrong reason.
 */

const POOL = ashSet as unknown as SwuCard[]

export interface CostConfig {
  /** How many decision states to time over. Cost per decision is stable well before this needs to be
   *  large; the beam is ~34x greedy, so tens of states already separate configurations. */
  states: number
  seed: number
  /** AI names to time. Defaults to every registered AI. */
  ais?: string[]
}

export interface CostRow {
  ai: string
  msPerDecision: number
  /** Against `baseline`, so a configuration's cost reads the same on any machine. */
  relative: number
}

export interface CostReport {
  commitId: string
  states: number
  /** Games the states were drawn from, and how many of those the `player` seat opened. A game
   *  contributes every decision in it, so a corpus spans far fewer games than it holds states. */
  games: number
  gamesPlayerFirst: number
  /**
   * Which AI the ratios are against.
   *
   * `greedy` when it is in the run, because it is the reference every win rate is already quoted
   * against, so "31x greedy" composes with what the docs already say. Ratios against the cheapest
   * measured are technically fine and practically useless: the first version reported the beam as
   * **2203x random**, which answers no question anyone has.
   */
  baseline: string
  rows: CostRow[]
}

/** `greedy` if present, else the cheapest thing measured, so the ratios stay readable either way. */
function baselineFor(timed: Array<{ ai: string; msPerDecision: number }>): { ai: string; ms: number } {
  const greedy = timed.find(t => t.ai === 'greedy')
  if (greedy) return { ai: greedy.ai, ms: greedy.msPerDecision }
  const cheapest = timed.reduce((a, b) => (a.msPerDecision <= b.msPerDecision ? a : b))
  return { ai: cheapest.ai, ms: cheapest.msPerDecision }
}

/** The fixed corpus, with the composition figures needed to say what it is a sample of. */
export interface Corpus {
  states: GameState[]
  /** Games started to fill it. Fewer than the deck count when `limit` is reached first. */
  games: number
  /** Of those, how many the `player` seat opened. Half, give or take the odd game. */
  gamesPlayerFirst: number
}

/**
 * Real positions an AI would actually be asked to think about.
 *
 * Setup decisions are excluded because `setupAi` makes them and never consults the evaluation, so
 * timing an AI on them would dilute the figure with positions it does not think about at all.
 *
 * **The first player alternates by deck.** It used to be pinned to `player`, which left every
 * position in the corpus descending from the same opening. That never biased a `--cost` ratio, since
 * one corpus is replayed identically by every configuration, but `--budget` reads *rates* off these
 * same positions, and a rate over a corpus that only opens one way is a rate over half the game.
 */
export function collectCorpus(limit: number, seed: number): Corpus {
  const { decks } = buildCoverageDecks(POOL, seed)
  const cardDb = buildCardDb(POOL)
  const states: GameState[] = []
  let next = seed
  let games = 0
  let gamesPlayerFirst = 0

  for (const [i, deck] of decks.entries()) {
    if (states.length >= limit) break
    next = nextSeed(next)
    let shuffleSeed = next
    const firstPlayer = firstPlayerFor(i)
    games++
    if (firstPlayer === 'player') gamesPlayerFirst++
    let state = initGame(deck, deck, cardDb, {
      firstPlayer,
      shuffle: <T,>(arr: T[]): T[] => { shuffleSeed = nextSeed(shuffleSeed); return seededShuffle(arr, shuffleSeed) },
      rngSeed: next,
    })

    let steps = 0
    while (state.winner === null && steps < 2000 && states.length < limit) {
      const forced = setupAi(state)
      if (!forced) states.push(state)
      const action = forced ?? greedyAi(state)
      if (!action) break
      state = resolve(state, action)
      steps++
    }
  }
  return { states, games, gamesPlayerFirst }
}

export function runCost(config: CostConfig): CostReport {
  const { states: corpus, games, gamesPlayerFirst } = collectCorpus(config.states, config.seed)
  const names = config.ais ?? aiNames()

  const timed = names.map(name => {
    const ai = resolveAi(name)
    // Warm the JIT first, or the first AI measured pays for compiling the engine and looks slower
    // than it is. This is a real effect, not a precaution: the first pass runs several times slower.
    for (const state of corpus.slice(0, Math.min(10, corpus.length))) ai(state)

    const start = performance.now()
    for (const state of corpus) ai(state)
    return { ai: name, msPerDecision: (performance.now() - start) / corpus.length }
  })

  const baseline = baselineFor(timed)
  return {
    commitId: COMMIT_ID,
    states: corpus.length,
    games,
    gamesPlayerFirst,
    baseline: baseline.ai,
    rows: timed.map(t => ({ ...t, relative: t.msPerDecision / baseline.ms })),
  }
}
