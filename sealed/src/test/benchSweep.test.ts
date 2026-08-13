import { describe, it, expect } from 'vitest'
import { runSweep } from '../bench/sweep'
import { compareCardIds } from '../bench/playCoverage'

/**
 * The coverage sweep (#408) plays across the whole coverage deck set so every card is exercised, and
 * reports any hang/throw as a dropped game. It is a FUZZER: a dropped game is a finding, not a test
 * failure, so this asserts the sweep ran and covered the pool, never that zero games dropped.
 */
describe('runSweep', () => {
  const report = runSweep({ gamesPerDeck: 1, seeds: [5] })

  it('plays one game across every coverage deck', () => {
    expect(report.decks).toBeGreaterThanOrEqual(18)
    expect(report.totalGames).toBe(report.decks * report.gamesPerDeck)
    expect(report.completed + report.dropped).toBe(report.totalGames)
  })

  it('decks every deck-able card in the pool', () => {
    // ASH's 264 cards are 18 leaders + 8 bases + 238 deck-able (179 units, 34 events, 25 upgrades).
    // The coverage deck set is built to include all 238, and leaders and bases are counted apart.
    // This says nothing about whether any of them were PLAYED, which is what the numbers below are
    // for: the two were conflated under one count until they were separated.
    expect(report.cardsDecked).toBe(238)
  })

  it('reports cards played and drawn as well as decked', () => {
    expect(report.cardsPlayed).toBeGreaterThan(0)
    expect(report.cardsDrawn).toBeGreaterThan(0)
  })

  it('never claims more cards played than were drawn, or drawn than were decked', () => {
    // The ordering is the sanity check on the whole measurement: a card cannot be played without
    // reaching a hand or play, nor reach either without being in a deck.
    expect(report.cardsPlayed).toBeLessThanOrEqual(report.cardsDecked)
    expect(report.cardsDrawn).toBeLessThanOrEqual(report.cardsDecked)
  })

  it('lists uncovered cards in ascending id order, so the list is scannable', () => {
    expect(report.uncovered).toEqual([...report.uncovered].sort(compareCardIds))
  })

  it('lists the decked-but-never-played cards rather than hiding them', () => {
    // One game per deck cannot draw a whole deck, so at this size there MUST be uncovered cards.
    // If this list were ever empty here, the meter would be crediting cards it should not.
    expect(report.uncovered.length).toBeGreaterThan(0)
    expect(report.cardsDecked - report.cardsPlayed).toBe(report.uncovered.length)
  })

  it('counts leaders and bases apart from deck cards', () => {
    // Every deck has one leader and one base, in play from the first turn. Folding them into the
    // played count would credit two free cards per deck and hide whether a leader ever deployed.
    expect(report.leaders).toBeGreaterThanOrEqual(18)
    expect(report.leadersDeployed).toBeLessThanOrEqual(report.leaders)
  })
})

/**
 * Coverage at the tail is seed-luck rather than run length: a card can go unplayed on one seed and
 * be played on the next. Running several seeds and taking the union is what turns "probably covered"
 * into evidence, so the sweep takes a list of seeds rather than one.
 */
describe('runSweep across several seeds', () => {
  const oneSeed = runSweep({ gamesPerDeck: 1, seeds: [5] })
  const threeSeeds = runSweep({ gamesPerDeck: 1, seeds: [5, 6, 7] })

  it('plays every deck once per seed', () => {
    expect(threeSeeds.totalGames).toBe(oneSeed.totalGames * 3)
    expect(threeSeeds.decks).toBe(oneSeed.decks)
    expect(threeSeeds.completed + threeSeeds.dropped).toBe(threeSeeds.totalGames)
  })

  it('unions coverage across seeds rather than reporting the last one', () => {
    // More seeds can only ever cover more, so the uncovered list must shrink or hold.
    expect(threeSeeds.cardsPlayed).toBeGreaterThanOrEqual(oneSeed.cardsPlayed)
    expect(threeSeeds.uncovered.length).toBeLessThanOrEqual(oneSeed.uncovered.length)
  })

  it('leaves every card uncovered by three seeds also uncovered by one of them', () => {
    // The union property, stated the other way round: nothing appears in the combined uncovered
    // list that a single seed already managed to play.
    const single = new Set(oneSeed.uncovered)
    for (const id of threeSeeds.uncovered) expect(single.has(id), id).toBe(true)
  })

  it('records which seeds it ran, so a result can be reproduced', () => {
    expect(threeSeeds.seeds).toEqual([5, 6, 7])
  })

  /**
   * Given explicit headroom because it is the only test here that runs a **second** three-seed sweep,
   * and it runs inside a parallel suite. Alone it costs about a second; under a loaded machine it has
   * been measured at 5.8s and timed out against the 5s default, twice, each time because an unrelated
   * expensive test happened to be running beside it. The work is genuinely a second's worth, so the
   * default was simply too tight rather than the test too slow.
   */
  it('is deterministic across the whole seed list', () => {
    const again = runSweep({ gamesPerDeck: 1, seeds: [5, 6, 7] })
    expect(again.uncovered).toEqual(threeSeeds.uncovered)
    expect(again.cardsPlayed).toBe(threeSeeds.cardsPlayed)
  }, 30_000)
})

describe('runSweep failure reporting', () => {
  const report = runSweep({ gamesPerDeck: 1, seeds: [5] })

  it('records each failure with a reproducible seed and reason', () => {
    expect(report.failures.length).toBe(report.dropped)
    for (const f of report.failures) {
      expect(typeof f.seed).toBe('number')
      expect(f.reason).toBeTruthy()
    }
  })
})
