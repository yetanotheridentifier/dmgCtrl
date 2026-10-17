import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import { nextSeed } from '../engine/rng'
import { COMMIT_ID } from '../buildIdentity'
import { resolveAi } from '../ai/registry'
import type { Ai } from '../ai/types'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { wilsonInterval, firstPlayerSplit, type FirstPlayerSplit } from './stats'
import { benchDeckSet, type DeckSource } from './decks'
import type { DropReason, GameResult } from './selfPlay'
import { seating } from './seating'
import { runGames, bySeat, newTally, addToTally, mergeTallies, type ScheduledGame, type Tally } from './gameRun'
import { recordGames, type GameRecorder } from './records'

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
  /** The deck population (`DeckSource`), coverage unless named. A deck is named by its player-seat list. */
  decks?: DeckSource
  /** Handed each completed game, as `runBench`'s is (`records.ts`). */
  onGame?: GameRecorder
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
  commitId: string
  aiA: string
  aiB: string
  /** The deck population played. */
  population: DeckSource
  decks: number
  gamesPerDeck: number
  totalGames: number
  completed: number
  dropped: number
  overallWinRateA: number
  overallCi: number
  /** aiA's win rate on the play and on the draw, over every completed game. */
  split: FirstPlayerSplit
  /** Per-deck results, sorted weakest-first for aiA (the decks it struggles with come up top). */
  perDeck: DeckResult[]
  /** Win rate aggregated by leader, weakest-first. */
  perLeader: GroupResult[]
  /** Win rate aggregated by base aspect, weakest-first. */
  perBase: GroupResult[]
  failures: Failure[]
  droppedGames: GameResult[]
}

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
  config: { gamesPerDeck: number; seed: number; stepCeiling?: number; decks?: DeckSource; onGame?: GameRecorder },
): GeneralisationReport {
  const { decks: matchups, cardDb } = benchDeckSet(config.decks ?? 'coverage', config.seed)
  const decks = matchups.map(m => m.player)
  const byId = new Map(POOL.map(c => [`${c.Set}_${c.Number}`, c]))

  function* schedule(): Generator<ScheduledGame<ParsedDeck>> {
    let seed = config.seed
    for (const m of matchups) {
      for (let g = 0; g < config.gamesPerDeck; g++) {
        seed = nextSeed(seed)
        // Seat and first player both cycle, independently, so neither advantage lands on one AI.
        const seats = seating(g)
        yield { seed, seats, ...bySeat(m, seats), key: m.player }
      }
    }
  }

  const failures: Failure[] = []
  const droppedGames: GameResult[] = []
  const byDeck = new Map<ParsedDeck, Tally>(decks.map(d => [d, newTally()]))
  runGames(schedule(), { aiA, aiB, cardDb, stepCeiling: config.stepCeiling }, g => {
    // Every tally reads the game from aiA's seat. The raw result stays as played, because a dropped
    // game is replayed from it and must keep the seats it was actually played with.
    addToTally(byDeck.get(g.key)!, g)
    if (g.result.status === 'dropped') {
      failures.push({ deck: g.key.name, seed: g.result.seed, reason: g.result.dropReason! })
      droppedGames.push(g.result)
    }
  }, ...(config.onGame ? [recordGames<ParsedDeck>({ runSeed: config.seed, decks: config.decks ?? 'coverage', aiA: labelA, aiB: labelB }, config.onGame)] : []))

  const leaderOf = (deck: ParsedDeck): string => byId.get(deck.leader)?.Name ?? deck.leader
  const baseOf = (deck: ParsedDeck): string => (byId.get(deck.base)?.Aspects ?? [])[0] ?? '?'
  const perDeck: DeckResult[] = decks.map(deck => {
    const t = byDeck.get(deck)!
    return {
      deck: deck.name,
      leader: deck.leader,
      leaderName: leaderOf(deck),
      baseAspect: baseOf(deck),
      games: t.games,
      completed: t.completed,
      dropped: t.dropped,
      winRateA: t.completed === 0 ? 0 : t.wins / t.completed,
      winCi: wilsonInterval(t.wins, t.completed).halfWidth,
      drawRate: t.completed === 0 ? 0 : t.draws / t.completed,
      avgMargin: t.completed === 0 ? 0 : t.marginSum / t.completed,
    }
  })
  perDeck.sort((a, b) => a.winRateA - b.winRateA)

  /** Per-deck tallies merged under a leader or a base aspect, in deck order. */
  const toGroups = (keyOf: (deck: ParsedDeck) => string): GroupResult[] => {
    const groups = new Map<string, ParsedDeck[]>()
    for (const deck of decks) groups.set(keyOf(deck), [...(groups.get(keyOf(deck)) ?? []), deck])
    return [...groups.entries()]
      .map(([key, members]) => {
        const e = mergeTallies(members.map(d => byDeck.get(d)!))
        return {
          key,
          decks: members.length,
          completed: e.completed,
          winRateA: e.completed === 0 ? 0 : e.wins / e.completed,
          winCi: wilsonInterval(e.wins, e.completed).halfWidth,
          avgMargin: e.completed === 0 ? 0 : e.marginSum / e.completed,
        }
      })
      .sort((a, b) => a.winRateA - b.winRateA)
  }

  const all = mergeTallies(byDeck.values())
  const overall = wilsonInterval(all.wins, all.completed)
  return {
    commitId: COMMIT_ID,
    aiA: labelA,
    aiB: labelB,
    population: config.decks ?? 'coverage',
    decks: decks.length,
    gamesPerDeck: config.gamesPerDeck,
    totalGames: decks.length * config.gamesPerDeck,
    completed: all.completed,
    dropped: droppedGames.length,
    overallWinRateA: all.completed === 0 ? 0 : all.wins / all.completed,
    overallCi: overall.halfWidth,
    split: firstPlayerSplit(all.winsOnPlay, all.gamesOnPlay, all.wins - all.winsOnPlay, all.completed - all.gamesOnPlay),
    perDeck,
    perLeader: toGroups(leaderOf),
    perBase: toGroups(baseOf),
    failures,
    droppedGames,
  }
}
