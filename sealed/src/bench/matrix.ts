import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import { buildCardDb } from '../engine/cardDb'
import { nextSeed } from '../engine/rng'
import { BUILD_TAG } from '../buildTag'
import type { Ai } from '../ai/types'
import { playGame } from './selfPlay'
import type { MatchupDeck } from './matchupDecks'

/**
 * Deck-vs-deck matchup matrix (#392 follow-up): with one fixed AI model, play every deck against
 * every deck (mirrors included) and record the row deck's win rate and base-damage margin against the
 * column deck. First player is alternated so seat advantage cancels; that also means "i vs j" already
 * measures "j vs i", so only the upper triangle + diagonal is played and the rest is derived, halving
 * the work.
 *
 * The result is N*N ordered cells, stored in SQLite so it can be interrogated: average a row for deck
 * strength under a fixed model, or diff two models' rows to see which decks improve or degrade.
 */

const POOL = ashSet as unknown as SwuCard[]

export interface MatchupCell {
  aLabel: string
  bLabel: string
  leaderA: string
  baseA: string
  leaderB: string
  baseB: string
  games: number
  winsA: number
  winRateA: number
  avgMargin: number
}

export interface MatrixResult {
  buildTag: string
  model: string
  deckCount: number
  gamesPerCell: number
  seed: number
  dropped: number
  /** N*N ordered pairs (row deck vs column deck). */
  cells: MatchupCell[]
}

function cell(a: MatchupDeck, b: MatchupDeck, games: number, wins: number, margin: number): MatchupCell {
  return {
    aLabel: a.label, bLabel: b.label,
    leaderA: a.leaderName, baseA: a.baseAspect,
    leaderB: b.leaderName, baseB: b.baseAspect,
    games, winsA: wins, winRateA: games === 0 ? 0 : wins / games, avgMargin: margin,
  }
}

export function runMatchupMatrix(
  decks: MatchupDeck[],
  ai: Ai,
  model: string,
  config: { gamesPerCell: number; seed: number; stepCeiling?: number; timeoutMs?: number },
): MatrixResult {
  const cardDb = buildCardDb(POOL)
  const cells: MatchupCell[] = []
  let seed = config.seed
  let dropped = 0

  for (let i = 0; i < decks.length; i++) {
    for (let j = i; j < decks.length; j++) {
      let winsA = 0
      let winsB = 0
      let completed = 0
      let marginSum = 0
      for (let g = 0; g < config.gamesPerCell; g++) {
        seed = nextSeed(seed)
        const r = playGame({
          deckPlayer: decks[i].deck,
          deckOpponent: decks[j].deck,
          cardDb,
          aiPlayer: ai,
          aiOpponent: ai,
          seed,
          firstPlayer: g % 2 === 0 ? 'player' : 'opponent',
          stepCeiling: config.stepCeiling,
          timeoutMs: config.timeoutMs,
        })
        if (r.status !== 'completed') { dropped++; continue }
        completed++
        if (r.winner === 'player') winsA++
        else if (r.winner === 'opponent') winsB++
        marginSum += r.margin // from deck i's (the player seat's) perspective
      }
      const avgMargin = completed === 0 ? 0 : marginSum / completed
      cells.push(cell(decks[i], decks[j], completed, winsA, avgMargin))
      // The same games give the reverse matchup: deck j's wins are winsB, margin flips sign.
      if (i !== j) cells.push(cell(decks[j], decks[i], completed, winsB, -avgMargin))
    }
  }

  return {
    buildTag: BUILD_TAG,
    model,
    deckCount: decks.length,
    gamesPerCell: config.gamesPerCell,
    seed: config.seed,
    dropped,
    cells,
  }
}
