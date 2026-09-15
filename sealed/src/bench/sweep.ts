import '../engine/cardDefinitions' // side effect: registers every implemented card ability
import { cardId } from '../data/cards'
import type { SwuCard } from '../data/cards'
import { asCardId, canonicalDeck } from '../data/printings'
import { reprintCanonicalId } from '../data/reprints'
import { buildCardDb } from '../engine/cardDb'
import type { CardDb } from '../engine/types'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { nextSeed } from '../engine/rng'
import { COMMIT_ID } from '../buildIdentity'
import { resolveAi } from '../ai/registry'
import { buildCoverageDecks } from './coverageDecks'
import { compareCardIds } from './playCoverage'
import { poolFor } from './setPools'
import { playGame } from './selfPlay'
import type { DropReason, GameResult } from './selfPlay'
import { firstPlayerFor } from './seating'

/**
 * A deck as the sweep plays it. Fixtures hold Normal printings only, so the one id left to collapse
 * is a card reprinted in another set: the engine implements it under a single id (`data/reprints.ts`),
 * and the other printing would otherwise play as a blank card. The app does the same when it hydrates
 * a deck (`canonicaliseCards`).
 */
export function engineDeck(deck: ParsedDeck): ParsedDeck {
  return canonicalDeck(deck, reprintCanonicalId)
}

/**
 * The pool's card database under the ids the games play. A reprint's row is filed under the id the
 * engine implements, unless the pool also holds that card's own row, which wins: otherwise the data
 * would depend on which of the two sets happened to come last in the pool.
 */
export function sweepCardDb(pool: SwuCard[]): CardDb {
  const ids = new Set(pool.map(c => cardId(c.Set, c.Number)))
  return buildCardDb(pool.flatMap(card => {
    const canonical = reprintCanonicalId(cardId(card.Set, card.Number))
    if (!canonical) return [card]
    return ids.has(canonical) ? [] : [asCardId(card, canonical)]
  }))
}

/**
 * The whole-pool fuzzing sweep (#408): play games across the coverage deck set so every card in the
 * pool gets exercised, and surface any hang or throw as a dropped game with a replayable fixture
 * (reusing the #390 machinery). Random play is the default: it is fast and pokes card interactions
 * broadly, which is what finds engine bugs (both hangs found so far came out this way).
 */

export interface SweepConfig {
  gamesPerDeck: number
  /**
   * One or more run seeds. Every deck plays `gamesPerDeck` games under each, and coverage is the
   * UNION across them. Tail coverage is seed-luck rather than run length (a card unplayed on one
   * seed is played on the next), so several short seeds are better evidence than one long run.
   */
  seeds: number[]
  aiName?: string
  stepCeiling?: number
  /**
   * The cards to sweep, ASH when absent. A pool may span several sets (see `poolFor`); each set builds
   * its own decks, so no deck mixes sets.
   */
  pool?: SwuCard[]
}

export interface SweepFailure {
  deck: string
  gameIndex: number
  seed: number
  reason: DropReason
}

export interface SweepReport {
  commitId: string
  /** The set codes the pool spanned, in pool order. */
  sets: string[]
  decks: number
  gamesPerDeck: number
  /** The seeds this run used, so it can be reproduced exactly. */
  seeds: number[]
  totalGames: number
  completed: number
  dropped: number
  /**
   * Deck-able card ids put into a deck. This is availability, NOT evidence: a card can be in every
   * deck of the sweep and never be drawn. Leaders and bases are counted separately below.
   */
  cardsDecked: number
  /** Decked cards that reached a hand at least once. */
  cardsDrawn: number
  /** Decked cards actually played. This is the number a coverage claim rests on. */
  cardsPlayed: number
  /** Decked but never played, named rather than summarised so a stubborn card can be chased. */
  uncovered: string[]
  /** Distinct leaders across the deck set, and how many of them actually deployed. */
  leaders: number
  leadersDeployed: number
  /** Distinct bases across the deck set. A base is in play from the first turn, so it is never
   *  "played"; it is reported for completeness rather than as coverage. */
  bases: number
  failures: SweepFailure[]
  /** The dropped games, kept whole so they can be written out as replayable fixtures. */
  droppedGames: GameResult[]
}

export function runSweep(config: SweepConfig): SweepReport {
  const pool = config.pool ?? poolFor(['ASH'])
  // The deck set is generated once, from the first seed. Regenerating it per seed would change
  // which cards are decked at all, so `cardsDecked` would move between seeds and the union would
  // no longer be measuring the same pool. Only the GAME seeds vary.
  const { decks } = buildCoverageDecks(pool, config.seeds[0])
  const cardDb = sweepCardDb(pool)
  const ai = resolveAi(config.aiName ?? 'random')

  let completed = 0
  let dropped = 0
  let gameIndex = 0
  const failures: SweepFailure[] = []
  const droppedGames: GameResult[] = []
  // Availability, by card type. Leaders and bases are separated here rather than at the end,
  // because a leader is in play from the first turn and would otherwise read as free coverage.
  const decked = new Set<string>()
  const leaders = new Set<string>()
  const bases = new Set<string>()
  // Evidence: what the games actually reached.
  const drawn = new Set<string>()
  const played = new Set<string>()
  const deployed = new Set<string>()

  // Each seed is an independent chain, so a run is reproducible from its seed list alone and adding
  // a seed extends the evidence rather than reshuffling what the earlier ones did.
  for (const baseSeed of config.seeds) {
    let seed = baseSeed
    for (const deck of decks) {
      leaders.add(deck.leader)
      bases.add(deck.base)
      for (const entry of deck.cards) decked.add(entry.id)
      // Games run in the engine's ids and coverage is reported in the printed ones. A deck draws on
      // one set, so each engine id in it stands for exactly one printing.
      const game = engineDeck(deck)
      const printedIds = new Map<string, string>([
        [game.leader, deck.leader],
        [game.base, deck.base],
        ...game.cards.map((entry, i): [string, string] => [entry.id, deck.cards[i].id]),
      ])
      const printed = (id: string) => printedIds.get(id) ?? id

      for (let g = 0; g < config.gamesPerDeck; g++) {
        seed = nextSeed(seed)
        const result = playGame({
          deckPlayer: game,
          deckOpponent: game,
          cardDb,
          aiPlayer: ai,
          aiOpponent: ai,
          seed,
          // Corpus-wide, not within the deck: a within-deck alternation leaves the odd default of
          // five games per deck running 3:2 on the same opening, and one game per deck running 5:0.
          firstPlayer: firstPlayerFor(gameIndex),
          stepCeiling: config.stepCeiling,
          trackCoverage: true,
        })
        for (const id of result.cardsDrawn) drawn.add(printed(id))
        for (const id of result.cardsPlayed) played.add(printed(id))
        for (const id of result.leadersDeployed) deployed.add(printed(id))
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
  }

  // Intersect with what was decked: play also surfaces tokens (Shield, Experience, Mandalorian),
  // which are created rather than decked and are not part of pool coverage.
  const deckedPlayed = [...decked].filter(id => played.has(id))
  const deckedDrawn = [...decked].filter(id => drawn.has(id))

  return {
    commitId: COMMIT_ID,
    sets: [...new Set(pool.map(c => c.Set))],
    decks: decks.length,
    gamesPerDeck: config.gamesPerDeck,
    seeds: [...config.seeds],
    totalGames: gameIndex,
    completed,
    dropped,
    cardsDecked: decked.size,
    cardsDrawn: deckedDrawn.length,
    cardsPlayed: deckedPlayed.length,
    uncovered: [...decked].filter(id => !played.has(id)).sort(compareCardIds),
    leaders: leaders.size,
    leadersDeployed: [...leaders].filter(id => deployed.has(id)).length,
    bases: bases.size,
    failures,
    droppedGames,
  }
}
