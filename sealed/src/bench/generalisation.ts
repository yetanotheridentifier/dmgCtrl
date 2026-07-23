import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import { buildCardDb } from '../engine/cardDb'
import { nextSeed } from '../engine/rng'
import { BUILD_TAG } from '../buildTag'
import { resolveAi } from '../ai/registry'
import type { Ai } from '../ai/types'
import { wilsonInterval } from './stats'
import { buildCoverageDecks } from './coverageDecks'
import { playGame } from './selfPlay'
import type { DropReason, GameResult } from './selfPlay'

/**
 * Generalisation diagnostic (#408 follow-up): play `aiA` against `aiB` on each coverage deck and
 * report `aiA`'s win rate PER DECK. Against `random`, a strong AI should win most decks; the decks
 * where it wins least point straight at the card mechanics its evaluation mishandles (the "better on
 * Ahsoka than other decks" overfitting, made concrete). Turns "should we hand-tune?" into data.
 *
 * Same deck both sides (a mirror deck, different AIs), first player alternated so first-player
 * advantage cancels. Seeded, so a run reproduces exactly.
 */

const POOL = ashSet as unknown as SwuCard[]

export interface GeneralisationConfig {
  gamesPerDeck: number
  seed: number
  aiA: string
  aiB: string
  stepCeiling?: number
  timeoutMs?: number
}

export interface DeckResult {
  deck: string
  leader: string
  games: number
  completed: number
  dropped: number
  winRateA: number
  winCi: number
  drawRate: number
  avgMargin: number
}

export interface Failure {
  deck: string
  seed: number
  reason: DropReason
}

export interface GeneralisationReport {
  buildTag: string
  aiA: string
  aiB: string
  decks: number
  gamesPerDeck: number
  totalGames: number
  completed: number
  dropped: number
  overallWinRateA: number
  overallCi: number
  /** Per-deck results, sorted weakest-first for aiA (the decks it struggles with come up top). */
  perDeck: DeckResult[]
  failures: Failure[]
  droppedGames: GameResult[]
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

export function runGeneralisation(config: GeneralisationConfig): GeneralisationReport {
  return runGeneralisationWith(resolveAi(config.aiA), resolveAi(config.aiB), config.aiA, config.aiB, config)
}

/**
 * The core: play two AI FUNCTIONS against each other across the coverage decks. Used directly by the
 * weight tuner, which builds candidate greedy AIs on the fly rather than registering them by name.
 */
export function runGeneralisationWith(
  aiA: Ai,
  aiB: Ai,
  labelA: string,
  labelB: string,
  config: { gamesPerDeck: number; seed: number; stepCeiling?: number; timeoutMs?: number },
): GeneralisationReport {
  const { decks } = buildCoverageDecks(POOL, config.seed)
  const cardDb = buildCardDb(POOL)

  let seed = config.seed
  const perDeck: DeckResult[] = []
  const failures: Failure[] = []
  const droppedGames: GameResult[] = []
  let totalWinsA = 0
  let totalCompleted = 0

  for (const deck of decks) {
    const results: GameResult[] = []
    for (let g = 0; g < config.gamesPerDeck; g++) {
      seed = nextSeed(seed)
      const result = playGame({
        deckPlayer: deck,
        deckOpponent: deck,
        cardDb,
        aiPlayer: aiA,
        aiOpponent: aiB,
        seed,
        firstPlayer: g % 2 === 0 ? 'player' : 'opponent',
        stepCeiling: config.stepCeiling,
        timeoutMs: config.timeoutMs,
      })
      results.push(result)
      if (result.status === 'dropped') {
        failures.push({ deck: deck.name, seed: result.seed, reason: result.dropReason! })
        droppedGames.push(result)
      }
    }

    const done = results.filter(r => r.status === 'completed')
    const winsA = done.filter(r => r.winner === 'player').length
    const draws = done.filter(r => r.winner === 'draw').length
    const ci = wilsonInterval(winsA, done.length)
    totalWinsA += winsA
    totalCompleted += done.length
    perDeck.push({
      deck: deck.name,
      leader: deck.leader,
      games: results.length,
      completed: done.length,
      dropped: results.length - done.length,
      winRateA: done.length === 0 ? 0 : winsA / done.length,
      winCi: ci.halfWidth,
      drawRate: done.length === 0 ? 0 : draws / done.length,
      avgMargin: mean(done.map(r => r.margin)),
    })
  }

  perDeck.sort((a, b) => a.winRateA - b.winRateA)
  const overall = wilsonInterval(totalWinsA, totalCompleted)

  return {
    buildTag: BUILD_TAG,
    aiA: labelA,
    aiB: labelB,
    decks: decks.length,
    gamesPerDeck: config.gamesPerDeck,
    totalGames: decks.length * config.gamesPerDeck,
    completed: totalCompleted,
    dropped: droppedGames.length,
    overallWinRateA: totalCompleted === 0 ? 0 : totalWinsA / totalCompleted,
    overallCi: overall.halfWidth,
    perDeck,
    failures,
    droppedGames,
  }
}
