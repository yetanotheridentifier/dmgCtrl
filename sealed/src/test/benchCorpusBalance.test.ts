import { describe, it, expect } from 'vitest'
import { runDecisions } from '../bench/decisions'
import { runTerms } from '../bench/terms'
import { runLethal } from '../bench/lethal'
import { collectCorpus } from '../bench/cost'
import { firstPlayerFor } from '../bench/seating'
import '../engine/cardDefinitions'

/**
 * Every instrumented corpus opens both ways (#564).
 *
 * Four modes sample positions the same way: a mirror deck, **one** AI driving both seats, and every
 * decision recorded whoever takes it. The seat is therefore not a variable, which is why `seating`
 * does not apply here and why the first player is the only thing left to balance.
 *
 * **It was not balanced.** Each loop alternated on the game index *within a deck*, so at one game per
 * deck the alternation never fired and every game opened with `player` moving first. That is the
 * default for `--terms` and `--lethal`; `--decisions` defaults to three, giving 2:1; and `--cost`
 * pinned the first player outright. Whether a decision is taken with the initiative or without it is
 * a real strategic property, so a corpus that only ever opens one way is not a sample of the game.
 *
 * Indexing by the corpus-wide game number fixes it at any games-per-deck, and these tests pin the
 * case that was broken hardest: **one game per deck**, where the old code scored two of two rather
 * than one of two.
 */

describe('an instrumented corpus opens both ways', () => {
  /** Two decks, one game each: under the old within-deck alternation both opened `player`-first. */
  it('--decisions balances the first player at one game per deck', () => {
    const report = runDecisions({ gamesPerDeck: 1, seed: 4242, deckLimit: 2 })
    expect(report.games).toBe(2)
    expect(report.gamesPlayerFirst).toBe(1)
  }, 120_000)

  it('--terms balances the first player at one game per deck', () => {
    const report = runTerms({ gamesPerDeck: 1, seed: 4242, decks: 2 })
    expect(report.games).toBe(2)
    expect(report.gamesPlayerFirst).toBe(1)
  }, 240_000)

  it('--lethal balances the first player at one game per deck', () => {
    const report = runLethal({ gamesPerDeck: 1, seed: 4242, decks: 2, oracleSamples: 0 })
    expect(report.games).toBe(2)
    expect(report.gamesPlayerFirst).toBe(1)
  }, 240_000)

  /**
   * `--cost` and `--budget` share this corpus. It is collected once and replayed identically across
   * configurations, so a lopsided opening never biased a *ratio* between two AIs. It did skew the
   * rates `--budget` reads off the same positions, which are rates over the corpus rather than
   * comparisons within it.
   */
  it('the cost corpus opens both ways', () => {
    // 200 states is the mode's own default, and it spans only three games: a game contributes every
    // decision in it, so the corpus is far coarser in games than it looks in states. A smaller limit
    // is filled by a single game and can balance nothing.
    const corpus = collectCorpus(200, 7)
    expect(corpus.games, 'spans enough games for an opening to alternate').toBeGreaterThan(1)
    expect(corpus.gamesPlayerFirst).toBe(Math.ceil(corpus.games / 2))
  })

  /** Still one fixed corpus per seed, which is the property the whole cost comparison rests on. */
  it('stays identical for a given seed', () => {
    expect(JSON.stringify(collectCorpus(20, 7).states)).toBe(JSON.stringify(collectCorpus(20, 7).states))
  })

  /**
   * `--sweep` is the fifth loop, and the one that hid: it plays through `playGame` like the harnesses
   * that use `seating`, but passes its own first player, so it carried the same within-deck
   * alternation. Its default of five games a deck ran 3:2, and one game a deck would run 5:0.
   *
   * Asserted through `firstPlayerFor` on the sweep's own corpus-wide game index rather than by
   * running a sweep, which plays the whole pool and is far too slow for the suite.
   */
  it('the sweep indexes its opening corpus-wide', () => {
    const openings = Array.from({ length: 10 }, (_, gameIndex) => firstPlayerFor(gameIndex))
    expect(openings.filter(p => p === 'player')).toHaveLength(5)
  })
})
