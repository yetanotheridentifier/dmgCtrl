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
  leaderName: string
  baseAspect: string
  games: number
  completed: number
  dropped: number
  winRateA: number
  winCi: number
  drawRate: number
  avgMargin: number
}

/** Win rate aggregated over every deck sharing a leader (or a base aspect). */
export interface GroupResult {
  key: string
  decks: number
  completed: number
  winRateA: number
  winCi: number
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
  /** Win rate aggregated by leader, weakest-first. */
  perLeader: GroupResult[]
  /** Win rate aggregated by base aspect, weakest-first. */
  perBase: GroupResult[]
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
  const byId = new Map(POOL.map(c => [`${c.Set}_${c.Number}`, c]))

  let seed = config.seed
  const perDeck: DeckResult[] = []
  const failures: Failure[] = []
  const droppedGames: GameResult[] = []
  let totalWinsA = 0
  let totalCompleted = 0

  interface Agg { decks: number; wins: number; completed: number; marginSum: number }
  const leaderAgg = new Map<string, Agg>()
  const baseAgg = new Map<string, Agg>()
  const bump = (map: Map<string, Agg>, key: string, wins: number, completed: number, marginSum: number): void => {
    const e = map.get(key) ?? { decks: 0, wins: 0, completed: 0, marginSum: 0 }
    e.decks++; e.wins += wins; e.completed += completed; e.marginSum += marginSum
    map.set(key, e)
  }

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

    const leaderName = byId.get(deck.leader)?.Name ?? deck.leader
    const baseAspect = (byId.get(deck.base)?.Aspects ?? [])[0] ?? '?'
    const marginSum = done.reduce((s, r) => s + r.margin, 0)
    bump(leaderAgg, leaderName, winsA, done.length, marginSum)
    bump(baseAgg, baseAspect, winsA, done.length, marginSum)

    perDeck.push({
      deck: deck.name,
      leader: deck.leader,
      leaderName,
      baseAspect,
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
  const toGroups = (map: Map<string, Agg>): GroupResult[] =>
    [...map.entries()]
      .map(([key, e]) => ({
        key,
        decks: e.decks,
        completed: e.completed,
        winRateA: e.completed === 0 ? 0 : e.wins / e.completed,
        winCi: wilsonInterval(e.wins, e.completed).halfWidth,
        avgMargin: e.completed === 0 ? 0 : e.marginSum / e.completed,
      }))
      .sort((a, b) => a.winRateA - b.winRateA)
  const perLeader = toGroups(leaderAgg)
  const perBase = toGroups(baseAgg)

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
    perLeader,
    perBase,
    failures,
    droppedGames,
  }
}
