import { describe, it, expect } from 'vitest'
import { engineDeck, runSweep, sweepCardDb } from '../bench/sweep'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { compareCardIds } from '../bench/playCoverage'
import { poolFor } from '../bench/setPools'
import { REPRINTS, reprintCanonicalId } from '../data/reprints'
import { getCardDefinition } from '../engine/abilities'
import { CARD_DATA_CORRECTIONS } from '../engine/cardDataCorrections'

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

/**
 * The pool is a parameter. Several sets are swept by building each set's coverage decks from that set
 * alone (see `buildCoverageDecks`), so adding a set adds decks and cards without disturbing the others.
 */
describe('runSweep over a chosen pool', () => {
  const ash = poolFor(['ASH'])
  const defaulted = runSweep({ gamesPerDeck: 1, seeds: [5] })

  it('sweeps ASH when no pool is given, and says so', () => {
    expect(defaulted.sets).toEqual(['ASH'])
  })

  it('plays exactly the default sweep when ASH is named', () => {
    const named = runSweep({ gamesPerDeck: 1, seeds: [5], pool: ash })
    expect(named.decks).toBe(defaulted.decks)
    expect(named.cardsPlayed).toBe(defaulted.cardsPlayed)
    expect(named.uncovered).toEqual(defaulted.uncovered)
    expect(named.failures).toEqual(defaulted.failures)
  })

  /** Given headroom for the same reason as the determinism test above: it is two sweeps' worth of games. */
  it('adds a second set as its own decks and cards', () => {
    // A copy of ASH under another code, so the second set's deck count is known exactly.
    const twin = ash.map(c => ({ ...c, Set: 'TWN' }))
    const both = runSweep({ gamesPerDeck: 1, seeds: [5], pool: [...ash, ...twin] })
    expect(both.sets).toEqual(['ASH', 'TWN'])
    expect(both.decks).toBe(defaulted.decks * 2)
    expect(both.cardsDecked).toBe(defaulted.cardsDecked * 2)
    expect(both.completed + both.dropped).toBe(both.totalGames)
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

/**
 * A card reprinted in another set has a second id, and the engine keys behaviour by id. The app
 * collapses the printing onto the implemented id when it hydrates a deck; the sweep reads the set
 * fixtures directly, so it has to do the same, or a printing plays as a blank card while the report
 * credits it as played.
 */
describe('runSweep over cards reprinted in another set', () => {
  const printings = REPRINTS.flatMap(r => r.printings.map(id => ({ id, canonical: r.canonical, name: r.name })))
  const pool = poolFor([...new Set(printings.map(p => p.id.split('_')[0]))])
  const { decks } = buildCoverageDecks(pool, 5)
  const cardDb = sweepCardDb(pool)

  it('decks every printing in the reprint table, so the checks below are not vacuous', () => {
    const decked = new Set(decks.flatMap(d => d.cards.map(e => e.id)))
    for (const { id } of printings) expect(decked.has(id), id).toBe(true)
  })

  it('plays each printing under the id the engine implements, and nothing else changes', () => {
    for (const deck of decks) {
      const game = engineDeck(deck)
      expect(game.leader).toBe(deck.leader)
      expect(game.base).toBe(deck.base)
      expect(game.cards).toEqual(deck.cards.map(e => ({ ...e, id: reprintCanonicalId(e.id) ?? e.id })))
    }
  })

  it("gives each printing the implemented card's data, corrections and behaviour", () => {
    for (const { id, canonical, name } of printings) {
      const deck = decks.find(d => d.cards.some(e => e.id === id))!
      const played = engineDeck(deck).cards.find((_, i) => deck.cards[i].id === id)!.id
      expect(cardDb[played]?.name, id).toBe(name)
      expect(cardDb[played], id).toMatchObject(CARD_DATA_CORRECTIONS[canonical] ?? {})
      expect(getCardDefinition(played), id).toBe(getCardDefinition(canonical))
    }
    // Most reprints are of cards with registered behaviour, so the comparison above has teeth.
    expect(printings.filter(p => getCardDefinition(p.canonical)).length).toBeGreaterThan(printings.length / 2)
  })

  /** Given headroom: three seeds of a whole set's decks, inside a parallel suite. */
  it('still reports a printing under its printed id, and credits it when played', () => {
    const twi = runSweep({ gamesPerDeck: 1, seeds: [5, 6, 7], pool: poolFor(['TWI']) })
    expect(twi.uncovered.every(id => id.startsWith('TWI_'))).toBe(true)
    // A played printing reported under the engine's id would miss the decked id and read as uncovered.
    const twiPrintings = printings.map(p => p.id).filter(id => id.startsWith('TWI_'))
    expect(twiPrintings.filter(id => !twi.uncovered.includes(id)).length).toBeGreaterThan(0)
  }, 30_000)
})
