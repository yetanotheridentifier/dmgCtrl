import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'
import { buildLockoutDecks, type DeckPairing } from '../bench/lockoutDecks'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { buildCardDb } from '../engine/cardDb'
import { initGame } from '../engine/initGame'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { greedyAi } from '../ai/greedyAi'
import { setupAi } from '../ai/setupAi'
import { lockedLanes } from '../ai/race'
import { nextSeed, seededShuffle } from '../engine/rng'
import '../engine/cardDefinitions'

/**
 * **Does the wall deck set actually produce the position it was built for?**
 *
 * The one thing about this set that must be measured rather than assumed. A deck list containing the
 * cards is not a board containing the lockout: the wall has to be drawn, played, and left standing
 * while the other seat has ready attackers in that arena and nothing else to hit. Any of those can
 * fail, and a set that quietly produces nothing would read as a clean null result on every question
 * asked of it, which is the most expensive way this can go wrong.
 *
 * The comparison is the point. The coverage set is the population every previous measurement of this
 * defect ran over, and it produces a shut lane on about 0.5% of decisions, never lasting a round.
 * Both arms are walked here with the same AI, the same seeds and the same walk, so the only
 * difference is the decks.
 */

const POOL = ashSet as unknown as SwuCard[]
const cardDb = buildCardDb(POOL)

interface Lockout {
  /** Decisions where the facing seat had at least one arena shut. */
  lockedDecisions: number
  decisions: number
  /** Longest run of consecutive rounds with a lane shut, within a single game. */
  longestRun: number
  games: number
}

/**
 * Walk games with `greedy` and count how locked the FACING seat gets.
 *
 * Greedy rather than the shipped beam because this measures the deck set, not the bot: it is the
 * cheap driver that still develops a board, and a searching AI over these decks is minutes rather
 * than seconds. The rate a searching bot sees is Stage 3's job and belongs on the bench.
 *
 * The facing seat is always `player`, which is also the seat the bench's own duration instrument
 * samples, so this test and the bench are reading the same thing.
 */
function walk(pairs: DeckPairing[], seed0: number): Lockout {
  const out: Lockout = { lockedDecisions: 0, decisions: 0, longestRun: 0, games: 0 }
  let seed = seed0

  for (const { facing, wall } of pairs) {
    seed = nextSeed(seed)
    let s = seed
    let g: GameState = initGame(facing, wall, cardDb, {
      firstPlayer: 'player',
      shuffle: <T,>(arr: T[]): T[] => { s = nextSeed(s); return seededShuffle(arr, s) },
      rngSeed: seed,
    })
    out.games++
    let sampledRound = -1
    let run = 0
    let steps = 0

    while (g.winner === null && steps < 3000) {
      steps++
      // Sampled once per round, so a long round cannot inflate the duration the way a per-decision
      // count would. The same rule the bench's `lockedRounds` follows.
      if (g.phase === 'action' && g.round !== sampledRound) {
        sampledRound = g.round
        if (lockedLanes(g, 'player').length > 0) {
          run++
          if (run > out.longestRun) out.longestRun = run
        } else run = 0
      }
      if (legalMoves(g).length > 1) {
        out.decisions++
        if (g.activePlayer === 'player' && lockedLanes(g, 'player').length > 0) out.lockedDecisions++
      }
      const action = setupAi(g) ?? greedyAi(g)
      if (!action) break
      g = resolve(g, action)
    }
  }
  return out
}

const rate = (l: Lockout): number => l.lockedDecisions / l.decisions

describe('the wall deck set in play', () => {

  // A slice rather than the whole set: this asks whether the mechanism fires, and the rates the
  // bench will quote come from the bench, over every deck and a searching bot.
  const DECKS = 12
  const walls = buildLockoutDecks(POOL, 7).slice(0, DECKS)
  const coverage = buildCoverageDecks(POOL, 7).decks.slice(0, DECKS)

  const withWall = walk(walls, 4242)
  const withoutWall = walk(coverage.map(d => ({ facing: d, wall: d })), 4242)

  /**
   * **Measured over these 12 pairings: 7.0% of decisions against the coverage set's 0.3%.**
   *
   * Roughly twenty times the rate, which is the whole justification for the set existing. Asserted as
   * a multiple of the matched coverage walk rather than against the recorded 7.0%, so an unrelated
   * change to `greedy` or to the generator moves both arms together and this fails only when the
   * decks stop producing the position.
   */
  it('produces a shut lane far more often than the coverage decks do', () => {
    expect(withWall.decisions, 'the walk must reach real decisions').toBeGreaterThan(500)
    expect(withoutWall.decisions, 'and the control walk must too').toBeGreaterThan(500)

    // Five times the coverage rate is the bar. Below that, a rate read over this set would still be
    // dominated by positions the defect does not occur in, which is the exact failure that retired
    // `blockedReach` once already.
    expect(rate(withWall)).toBeGreaterThan(Math.max(rate(withoutWall) * 5, 0.02))
  }, 300_000)

  /**
   * **Duration is the reported defect**, which is why the re-shield cards are in the package.
   *
   * Measured: **3 consecutive rounds** on this slice, against **0** on the matched coverage walk. The
   * bench has never recorded a lockout lasting a full round on the coverage decks; the filed game ran
   * four. A set producing only single-round lockouts would be measuring a milder, different thing.
   */
  it('holds a lane shut for several consecutive rounds', () => {
    expect(withWall.longestRun).toBeGreaterThanOrEqual(2)
    expect(withWall.longestRun).toBeGreaterThan(withoutWall.longestRun)
  }, 300_000)
})
