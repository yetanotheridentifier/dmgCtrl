import { describe, it, expect } from 'vitest'
import type { GameState, PlayerId } from '../engine/types'
import type { Ai } from '../ai/types'
import { resolveAi } from '../ai/registry'
import { buildCardDb } from '../engine/cardDb'
import { nextSeed } from '../engine/rng'
import { buildMatchupDecks } from '../bench/matchupDecks'
import { poolFor } from '../bench/setPools'
import { seating, seatForA, firstPlayerFor } from '../bench/seating'
import { runGames, bySeat, corpusSchedule, newTally, addToTally, tallyBy, mergeTallies, reverseTally, type FinishedGame, type ScheduledGame } from '../bench/gameRun'
import { runGeneralisation } from '../bench/generalisation'
import { benchDeckSet } from '../bench/decks'
import { runTerms } from '../bench/terms'
import { runLethal } from '../bench/lethal'
import '../engine/cardDefinitions'

/**
 * The one game runner every game-run harness plays through.
 *
 * Head-to-head, matchups, generalisation, the matrix and the sweep each used to drive their own copy of
 * the same loop: seed a game, seat the two sides, play it, read the result from side A. A change to a
 * shared concern then reached some copies and not others (the first-player split reached three of them).
 * What a run plays is now a schedule handed to one loop, and what it records is chosen by the run.
 */

const POOL = poolFor(['ASH'])
const cardDb = buildCardDb(POOL)
const decks = buildMatchupDecks(POOL, 1)
const deckA = decks[0].deck
const deckB = decks.find(d => d.deck.leader !== deckA.leader)!.deck

/** An AI that remembers which seat it was asked to move for, and otherwise plays randomly. */
function watching(seen: Set<PlayerId>): Ai {
  const random = resolveAi('random')
  return (state: GameState) => {
    seen.add(state.activePlayer)
    return random(state)
  }
}

function schedule(games: number, seed = 21): ScheduledGame<number>[] {
  const out: ScheduledGame<number>[] = []
  let s = seed
  for (let g = 0; g < games; g++) {
    s = nextSeed(s)
    out.push({ seed: s, seats: seating(g), deckA, deckB, key: g % 2 })
  }
  return out
}

describe('the game runner', () => {
  /** Side A's deck and side A's AI must land on the same seat, whichever seat that is. */
  it('seats each side with its own deck and its own AI', () => {
    const played: FinishedGame<number>[] = []
    const seenByA: Array<Set<PlayerId>> = []
    for (const game of schedule(4)) {
      const seen = new Set<PlayerId>()
      seenByA.push(seen)
      runGames([game], { aiA: watching(seen), aiB: resolveAi('random'), cardDb }, g => {
        expect(g.result.initialState!.players[seatForA(g.seats)].leader.cardId).toBe(deckA.leader)
        played.push(g)
      })
    }
    expect(played.map(g => g.seats.swapped)).toEqual([false, true, false, true])
    played.forEach((g, i) => expect([...seenByA[i]]).toEqual([seatForA(g.seats)]))
  })

  /** The result is read from side A, so a swapped game's margin is the seat margin negated. */
  it('reads every completed game from side A', () => {
    const played: FinishedGame<number>[] = []
    runGames(schedule(4), { aiA: resolveAi('greedy'), aiB: resolveAi('random'), cardDb }, g => played.push(g))
    for (const g of played) {
      expect(g.result.status).toBe('completed')
      expect(g.forA!.margin).toBe(g.seats.swapped ? -g.result.margin : g.result.margin)
      expect(g.forA!.won).toBe(g.result.winner === seatForA(g.seats))
    }
    expect(played.map(g => g.index)).toEqual([0, 1, 2, 3])
  })

  /** Recorders see the moves; the run lets go of them afterwards. A dropped game keeps them, as a fixture. */
  it('releases a completed game after its recorders, and keeps a dropped one whole', () => {
    const movesSeen: number[] = []
    const kept: FinishedGame<number>[] = []
    runGames(schedule(1), { aiA: resolveAi('random'), aiB: resolveAi('random'), cardDb },
      g => movesSeen.push(g.result.moves.length), g => kept.push(g))
    expect(movesSeen[0]).toBeGreaterThan(0)
    expect(kept[0].result.moves).toEqual([])
    expect(kept[0].result.initialState).toBeNull()

    const dropped: FinishedGame<number>[] = []
    runGames(schedule(1), { aiA: resolveAi('random'), aiB: resolveAi('random'), cardDb, stepCeiling: 1 }, g => dropped.push(g))
    expect(dropped[0].result.status).toBe('dropped')
    expect(dropped[0].forA).toBeNull()
    expect(dropped[0].result.moves.length).toBe(1)
    expect(dropped[0].result.initialState).not.toBeNull()
  })

  it('reports progress after every game, dropped ones included', () => {
    const progress: number[] = []
    runGames(schedule(3), { aiA: resolveAi('random'), aiB: resolveAi('random'), cardDb, stepCeiling: 1, onProgress: n => progress.push(n) })
    expect(progress).toEqual([1, 2, 3])
  })

  /** A deck matchup is dealt by SEAT: under an asymmetric source the wall stays on its seat. */
  it('deals a seat-keyed matchup to the right side', () => {
    const m = { player: deckA, opponent: deckB }
    expect(bySeat(m, { swapped: false, firstPlayer: 'player' })).toEqual({ deckA, deckB })
    expect(bySeat(m, { swapped: true, firstPlayer: 'player' })).toEqual({ deckA: deckB, deckB: deckA })
  })
})

describe('the tally', () => {
  const played: FinishedGame<number>[] = []
  runGames(schedule(8, 5), { aiA: resolveAi('greedy'), aiB: resolveAi('random'), cardDb }, g => played.push(g))

  it('counts outcomes and the first-player halves from side A', () => {
    const t = newTally()
    for (const g of played) addToTally(t, g)
    expect(t.completed).toBe(8)
    expect(t.wins).toBe(played.filter(g => g.forA!.won).length)
    expect(t.gamesOnPlay).toBe(4)
    expect(t.marginSum).toBe(played.reduce((s, g) => s + g.forA!.margin, 0))
  })

  it('groups by key, and the groups merge back to the whole', () => {
    const grouped = tallyBy<number>(g => String(g.key))
    for (const g of played) grouped.record(g)
    expect([...grouped.groups.keys()]).toEqual(['0', '1'])
    const whole = newTally()
    for (const g of played) addToTally(whole, g)
    expect(mergeTallies([...grouped.groups.values()])).toEqual(whole)
  })

  /** The matrix derives the reverse cell from the same games. B's halves are A's halves inverted. */
  it('reads the same games from side B', () => {
    const t = newTally()
    for (const g of played) addToTally(t, g)
    const r = reverseTally(t)
    expect(r.completed).toBe(t.completed)
    expect(r.wins).toBe(t.completed - t.wins - t.draws)
    expect(r.gamesOnPlay).toBe(t.completed - t.gamesOnPlay)
    expect(r.marginSum).toBe(-t.marginSum)
    expect(r.wins + t.wins + t.draws).toBe(t.completed)
    expect(r.winsOnPlay).toBe(played.filter(g => !g.forA!.won && !g.forA!.draw && g.seats.firstPlayer !== seatForA(g.seats)).length)
  })
})

describe('a watched game run', () => {
  /**
   * The instrumented corpora record from inside a game rather than from its result, so the runner
   * opens a watch per game and shows it every step, setup included, then the final position.
   */
  it('shows each game\'s watch every step and the final position', () => {
    const steps: Array<Array<{ before: GameState; after: GameState }>> = []
    const finals: GameState[] = []
    const results: Array<{ moveCount: number; winner: PlayerId | 'draw' | null }> = []
    runGames(schedule(2), {
      aiA: resolveAi('random'), aiB: resolveAi('random'), cardDb,
      watch: () => {
        const mine: Array<{ before: GameState; after: GameState }> = []
        steps.push(mine)
        return { step: (before, _action, after) => mine.push({ before, after }), end: final => finals.push(final) }
      },
    }, g => results.push({ moveCount: g.result.moveCount, winner: g.result.winner }))

    expect(steps).toHaveLength(2)
    steps.forEach((game, i) => {
      expect(game).toHaveLength(results[i].moveCount)
      expect(game[0].before.phase).toBe('setup')
      for (let k = 1; k < game.length; k++) expect(game[k].before).toBe(game[k - 1].after)
      expect(finals[i]).toBe(game[game.length - 1].after)
      expect(finals[i].winner).toBe(results[i].winner)
    })
  })
})

describe('the corpus schedule', () => {
  /**
   * The decision, term and lethal corpora: one AI on both seats, so the seats never swap and the first
   * player is the only thing to balance, indexed across the whole corpus (`firstPlayerFor`).
   */
  it('plays every deck in turn, never swapping seats, opening both ways corpus-wide', () => {
    const matchups = [{ player: deckA, opponent: deckA }, { player: deckB, opponent: deckA }]
    const games = [...corpusSchedule(matchups, 3, 100)]
    expect(games.map(g => g.key)).toEqual([0, 0, 0, 1, 1, 1])
    expect(games.every(g => !g.seats.swapped)).toBe(true)
    expect(games.map(g => g.seats.firstPlayer)).toEqual(games.map((_, i) => firstPlayerFor(i)))
    expect(games[4].deckA).toBe(deckB)
    expect(games[4].deckB).toBe(deckA)
    expect(games[4].seed).toBe(nextSeed(100 + 37 + 1))
  })
})

describe('deck populations', () => {
  /** The matchup deck set is a population like any other, not something only `--matchups` reaches. */
  it('offers the matchup decks as a deck source', () => {
    const { decks: set } = benchDeckSet('matchup', 1)
    expect(set.map(m => m.player)).toEqual(buildMatchupDecks(undefined, 1).map(d => d.deck))
    expect(set.every(m => m.opponent === m.player)).toBe(true)
  })

  it('lets the term and lethal corpora play any population', () => {
    const terms = runTerms({ gamesPerDeck: 1, seed: 4242, decks: 'mirror', weights: ['saturation'] })
    expect(terms.decks).toBe('mirror')
    expect(terms.games).toBe(1)
    const lethal = runLethal({ gamesPerDeck: 1, seed: 4242, decks: 'mirror', oracleSamples: 0 })
    expect(lethal.decks).toBe('mirror')
    expect(lethal.games).toBe(1)
  }, 240_000)

  it('lets the generalisation harness play any population', () => {
    const report = runGeneralisation({ gamesPerDeck: 2, seed: 5, aiA: 'random', aiB: 'random', decks: 'mirror' })
    expect(report.decks).toBe(1)
    expect(report.totalGames).toBe(2)
  }, 30_000)
})

describe('the generalisation harness', () => {
  /** It plays the same seated games as the head-to-head, so it reports the same first-player split. */
  it('splits its win rate by who moved first', () => {
    const report = runGeneralisation({ gamesPerDeck: 2, seed: 5, aiA: 'random', aiB: 'random' })
    expect(report.split.onPlay.games + report.split.onDraw.games).toBe(report.completed)
    expect(report.split.onPlay.wins + report.split.onDraw.wins).toBe(Math.round(report.overallWinRateA * report.completed))
  }, 30_000)
})
