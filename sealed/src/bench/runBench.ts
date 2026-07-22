import { BUILD_TAG } from '../buildTag'
import { nextSeed } from '../engine/rng'
import { resolveAi } from '../ai/registry'
import { wilsonInterval } from './stats'
import { benchInputs } from './decks'
import { playGame } from './selfPlay'
import type { DropReason, GameResult } from './selfPlay'

export interface BenchConfig {
  games: number
  seed: number
  /** AI name for the player seat (see the registry). */
  aiA: string
  /** AI name for the opponent seat. */
  aiB: string
  stepCeiling?: number
  timeoutMs?: number
}

export interface Failure {
  gameIndex: number
  seed: number
  reason: DropReason
}

export interface BenchReport {
  /** Engine build the run was measured under: every number is only meaningful against this. */
  buildTag: string
  aiA: string
  aiB: string
  seed: number
  gamesRequested: number
  completed: number
  dropped: number
  /** True if any game dropped: the aggregate is then provisional, not a clean result. */
  provisional: boolean
  /** Win rate of the player seat (aiA), over completed games only. */
  winRateA: number
  drawRate: number
  /** Half-width of the 95% confidence band on winRateA: the +/- you can quote. */
  winCi: number
  /** Mean base-damage margin from the player seat's view, over completed games. */
  avgMargin: number
  avgRounds: number
  movesPerSec: number
  failures: Failure[]
  games: GameResult[]
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

/**
 * Play N games between two named AIs and aggregate the metrics the tickets ask for. First-player
 * advantage is cancelled by alternating who holds the initiative each game. Everything is seeded
 * from one base seed, so a whole run reproduces exactly. Any dropped game makes the run provisional
 * and its seed is recorded so the failure can be reproduced and filed.
 */
export function runBench(config: BenchConfig): BenchReport {
  const { deck, cardDb } = benchInputs()
  const aiPlayer = resolveAi(config.aiA)
  const aiOpponent = resolveAi(config.aiB)

  const games: GameResult[] = []
  const failures: Failure[] = []
  let seed = config.seed

  for (let i = 0; i < config.games; i++) {
    seed = nextSeed(seed)
    const firstPlayer = i % 2 === 0 ? 'player' : 'opponent'
    const result = playGame({
      deckPlayer: deck,
      deckOpponent: deck,
      cardDb,
      aiPlayer,
      aiOpponent,
      seed,
      firstPlayer,
      stepCeiling: config.stepCeiling,
      timeoutMs: config.timeoutMs,
    })

    if (result.status === 'dropped') {
      failures.push({ gameIndex: i, seed: result.seed, reason: result.dropReason! })
    } else {
      // Bound memory over a long run: a completed game's move list is not needed once counted.
      result.moves = []
    }
    games.push(result)
  }

  const done = games.filter(g => g.status === 'completed')
  const completed = done.length
  const winsA = done.filter(g => g.winner === 'player').length
  const draws = done.filter(g => g.winner === 'draw').length
  const ci = wilsonInterval(winsA, completed)

  const totalMoves = games.reduce((n, g) => n + g.moveCount, 0)
  const totalMs = games.reduce((ms, g) => ms + g.durationMs, 0)

  return {
    buildTag: BUILD_TAG,
    aiA: config.aiA,
    aiB: config.aiB,
    seed: config.seed,
    gamesRequested: config.games,
    completed,
    dropped: games.length - completed,
    provisional: failures.length > 0,
    winRateA: completed === 0 ? 0 : winsA / completed,
    drawRate: completed === 0 ? 0 : draws / completed,
    winCi: ci.halfWidth,
    avgMargin: mean(done.map(g => g.margin)),
    avgRounds: mean(done.map(g => g.rounds)),
    movesPerSec: totalMs === 0 ? 0 : totalMoves / (totalMs / 1000),
    failures,
    games,
  }
}
