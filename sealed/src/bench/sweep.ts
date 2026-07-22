import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import { buildCardDb } from '../engine/cardDb'
import { nextSeed } from '../engine/rng'
import { BUILD_TAG } from '../buildTag'
import { resolveAi } from '../ai/registry'
import { buildCoverageDecks } from './coverageDecks'
import { playGame } from './selfPlay'
import type { DropReason, GameResult } from './selfPlay'

/**
 * The whole-pool fuzzing sweep (#408): play games across the coverage deck set so every card in the
 * set gets exercised, and surface any hang or throw as a dropped game with a replayable fixture
 * (reusing the #390 machinery). Random play is the default: it is fast and pokes card interactions
 * broadly, which is what finds engine bugs (both hangs found so far came out this way).
 */

const POOL = ashSet as unknown as SwuCard[]

export interface SweepConfig {
  gamesPerDeck: number
  seed: number
  aiName?: string
  stepCeiling?: number
  timeoutMs?: number
}

export interface SweepFailure {
  deck: string
  gameIndex: number
  seed: number
  reason: DropReason
}

export interface SweepReport {
  buildTag: string
  decks: number
  gamesPerDeck: number
  totalGames: number
  completed: number
  dropped: number
  /** Distinct card ids exercised across the deck set (leaders and bases included). */
  cardsExercised: number
  failures: SweepFailure[]
  /** The dropped games, kept whole so they can be written out as replayable fixtures. */
  droppedGames: GameResult[]
}

export function runSweep(config: SweepConfig): SweepReport {
  const { decks } = buildCoverageDecks(POOL, config.seed)
  const cardDb = buildCardDb(POOL)
  const ai = resolveAi(config.aiName ?? 'random')

  let seed = config.seed
  let completed = 0
  let dropped = 0
  let gameIndex = 0
  const failures: SweepFailure[] = []
  const droppedGames: GameResult[] = []
  const exercised = new Set<string>()

  for (const deck of decks) {
    exercised.add(deck.leader)
    exercised.add(deck.base)
    for (const entry of deck.cards) exercised.add(entry.id)

    for (let g = 0; g < config.gamesPerDeck; g++) {
      seed = nextSeed(seed)
      const result = playGame({
        deckPlayer: deck,
        deckOpponent: deck,
        cardDb,
        aiPlayer: ai,
        aiOpponent: ai,
        seed,
        firstPlayer: g % 2 === 0 ? 'player' : 'opponent',
        stepCeiling: config.stepCeiling,
        timeoutMs: config.timeoutMs,
      })
      if (result.status === 'dropped') {
        dropped++
        failures.push({ deck: deck.name, gameIndex, seed: result.seed, reason: result.dropReason! })
        droppedGames.push(result)
      } else {
        completed++
      }
      gameIndex++
    }
  }

  return {
    buildTag: BUILD_TAG,
    decks: decks.length,
    gamesPerDeck: config.gamesPerDeck,
    totalGames: gameIndex,
    completed,
    dropped,
    cardsExercised: exercised.size,
    failures,
    droppedGames,
  }
}
