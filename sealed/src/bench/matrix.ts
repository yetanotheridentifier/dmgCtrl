import ashSet from '../test/fixtures/ashSet.json'
import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import type { SwuCard } from '../data/cards'
import { buildCardDb } from '../engine/cardDb'
import { nextSeed } from '../engine/rng'
import { COMMIT_ID } from '../buildIdentity'
import type { Ai } from '../ai/types'
import { playGame } from './selfPlay'
import { seating, resultForA, movedFirstForA } from './seating'
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
 *
 * Every cell also carries the half of its games the row deck moved first in, so "A beats B 54%" can be
 * read as its two sub-rates. A cell hiding 68% on the play and 40% on the draw is the case that makes
 * the single number misleading rather than merely coarse.
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
  /**
   * The on-play half: games deck A moved first in, and how many of those it won.
   *
   * **Only one half is stored.** The on-draw half is `games - gamesOnPlay` and `winsA - winsOnPlay`,
   * so the two sub-rates weight-average back to `winRateA` by construction rather than by agreement,
   * and no later change can leave them disagreeing with the number already trusted.
   */
  gamesOnPlay: number
  winsOnPlay: number
}

/** One cell's tally, from the row deck's point of view. */
interface Tally {
  games: number
  wins: number
  gamesOnPlay: number
  winsOnPlay: number
  margin: number
}

export interface MatrixResult {
  commitId: string
  model: string
  deckCount: number
  gamesPerCell: number
  seed: number
  dropped: number
  /** N*N ordered pairs (row deck vs column deck). */
  cells: MatchupCell[]
}

function cell(a: MatchupDeck, b: MatchupDeck, t: Tally): MatchupCell {
  return {
    aLabel: a.label, bLabel: b.label,
    leaderA: a.leaderName, baseA: a.baseAspect,
    leaderB: b.leaderName, baseB: b.baseAspect,
    games: t.games, winsA: t.wins, winRateA: t.games === 0 ? 0 : t.wins / t.games, avgMargin: t.margin,
    gamesOnPlay: t.gamesOnPlay, winsOnPlay: t.winsOnPlay,
  }
}

/**
 * Every unordered deck pair, or the subset belonging to one shard.
 *
 * **Dealt round-robin, never sliced.** The enumeration is `for i, for j >= i`, so a contiguous split
 * by `i` gives the first shard the 72 pairs of row 0 and the last shard a single pair: one shard would
 * run an order of magnitude longer than the rest and set the wall clock by itself.
 *
 * A child is told only its index and the count, so it deals itself its share. The alternative, the
 * parent handing over an explicit pair list, does not fit on a command line at 2,628 pairs, and it
 * would stop a shard being independently re-runnable, which is what resumption depends on.
 */
export function dealPairs(deckCount: number, shardIndex = 0, shardCount = 1): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let n = 0
  for (let i = 0; i < deckCount; i++) {
    for (let j = i; j < deckCount; j++) {
      if (n % shardCount === shardIndex) out.push([i, j])
      n++
    }
  }
  return out
}

/**
 * The seed a pair's games start from, derived from the pair rather than from iteration order.
 *
 * **This is what makes a sharded matrix comparable with a serial one.** The loop used to advance a
 * single shared seed as it went, so a pair's games depended on how many pairs had run before it: a
 * child playing every Nth pair would play different games, and no sharded result could ever be
 * checked against a serial one. Deriving from `(base, i, j)` removes the ordering dependency, so a
 * pair also becomes independently re-runnable for investigation.
 *
 * The multipliers are the usual odd 32-bit mixing constants, chosen only to spread neighbouring pairs
 * apart; `i` and `j` are mixed differently so `(3, 7)` and `(7, 3)` do not collide.
 */
export function pairSeed(base: number, i: number, j: number): number {
  const mixed = ((base ^ Math.imul(i + 1, 0x9E3779B1) ^ Math.imul(j + 1, 0x85EBCA77)) >>> 0) || 1
  return nextSeed(mixed)
}

export function runMatchupMatrix(
  decks: MatchupDeck[],
  ai: Ai,
  model: string,
  config: {
    gamesPerCell: number
    seed: number
    stepCeiling?: number
    timeoutMs?: number
    /** Which share of the pairs to play. Defaults to all of them. */
    shardIndex?: number
    shardCount?: number
  },
): MatrixResult {
  const cardDb = buildCardDb(POOL)
  const cells: MatchupCell[] = []
  let dropped = 0

  for (const [i, j] of dealPairs(decks.length, config.shardIndex ?? 0, config.shardCount ?? 1)) {
    {
      let winsA = 0
      let winsB = 0
      let completed = 0
      let marginSum = 0
      // The first-player split, tallied inside the loop because it cannot be recovered afterwards.
      // Deck j's on-play half is exactly the games deck i did NOT move first in, so both cells' halves
      // are counted here rather than derived by subtraction, where a sign slip would be silent.
      let iFirstGames = 0
      let iWinsWhileFirst = 0
      let jWinsWhileFirst = 0
      let seed = pairSeed(config.seed, i, j)
      for (let g = 0; g < config.gamesPerCell; g++) {
        seed = nextSeed(seed)
        // One AI plays both sides, so the seat advantage lands on a DECK. Swapping which deck sits
        // in the player seat is what makes the reverse-matchup derivation below sound: it assumes
        // the two directions are the same games, which an uncancelled seat bias would falsify.
        const seats = seating(g)
        const r = playGame({
          deckPlayer: seats.swapped ? decks[j].deck : decks[i].deck,
          deckOpponent: seats.swapped ? decks[i].deck : decks[j].deck,
          cardDb,
          aiPlayer: ai,
          aiOpponent: ai,
          seed,
          firstPlayer: seats.firstPlayer,
          stepCeiling: config.stepCeiling,
        })
        if (r.status !== 'completed') { dropped++; continue }
        completed++
        const forI = resultForA(r, seats) // "A" here is deck i
        const iFirst = movedFirstForA(seats)
        if (iFirst) iFirstGames++
        if (forI.won) { winsA++; if (iFirst) iWinsWhileFirst++ }
        else if (!forI.draw) { winsB++; if (!iFirst) jWinsWhileFirst++ }
        marginSum += forI.margin // from deck i's perspective, whichever seat it took
      }
      const avgMargin = completed === 0 ? 0 : marginSum / completed
      cells.push(cell(decks[i], decks[j], {
        games: completed, wins: winsA, margin: avgMargin,
        gamesOnPlay: iFirstGames, winsOnPlay: iWinsWhileFirst,
      }))
      // The same games give the reverse matchup: deck j's wins are winsB, margin flips sign, and its
      // on-play half is deck i's on-draw half.
      if (i !== j) {
        cells.push(cell(decks[j], decks[i], {
          games: completed, wins: winsB, margin: -avgMargin,
          gamesOnPlay: completed - iFirstGames, winsOnPlay: jWinsWhileFirst,
        }))
      }
    }
  }

  return {
    commitId: COMMIT_ID,
    model,
    deckCount: decks.length,
    gamesPerCell: config.gamesPerCell,
    seed: config.seed,
    dropped,
    cells,
  }
}
