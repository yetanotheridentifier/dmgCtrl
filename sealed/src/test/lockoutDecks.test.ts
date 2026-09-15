import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { buildLockoutDecks, WALL_DECK } from '../bench/lockoutDecks'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { deckReport } from '../deckgen/rules'

/**
 * The wall deck set: a deck population in which the shielded-Sentinel lockout actually happens.
 *
 * ## Why a deck set rather than another evaluation term
 *
 * Every measurement of this defect has run into the same wall. The lockout is a **human strategy**,
 * built on purpose, and self-play over the coverage decks produces it on **0.5%** of decisions and
 * never for more than a round, while play-testers hit it constantly. `blockedReach` was written off
 * as "invisible over ~2,500 games" on exactly that population. A term that speaks in 0.5% of
 * positions cannot move a win rate however right it is, so that was a verdict on the deck set and
 * not on the term.
 *
 * This is the deck set that can see it. **One side of every pairing is an ordinary coverage deck**,
 * so the pool is still exercised and, more importantly, so there is a deck WITHOUT the wall trying to
 * find a way through one. A mirror in which both sides hold the wall cannot show that.
 *
 * ## What it does not do
 *
 * It is not a population anybody plays, so **an absolute win rate over it is meaningless by
 * construction**: the pairing has a favourite before either bot moves. Only the paired difference
 * against a matched control on the same seeds means anything here. The ordinary coverage set stays
 * the non-inferiority gate, and this set measures the benefit.
 */

const POOL = ashSet as unknown as SwuCard[]
const byId = new Map(POOL.map(c => [`${c.Set}_${c.Number}`, c]))

/** The wall's cards with multiplicity, read from card data rather than from the list's comments. */
const wallCards = (): SwuCard[] => WALL_DECK.cards.flatMap(e => Array<SwuCard>(e.count).fill(byId.get(e.id)!))

describe('the wall deck set', () => {

  const pairings = buildLockoutDecks(POOL, 1)

  it('pairs every coverage deck with a wall, so the pool is still covered on the facing side', () => {
    const coverage = buildCoverageDecks(POOL, 1).decks
    expect(pairings.length).toBe(coverage.length)
    // The facing side is the coverage set unchanged, not an approximation of it. Rebuilding it here
    // rather than trusting the pairing is the point: a facing deck that quietly drifted would make
    // every rate measured over this set incomparable with the coverage baseline it is read against.
    expect(pairings.map(p => p.facing)).toEqual(coverage)
  })

  /**
   * **One fixed wall, many decks facing it.** A generated wall moved whenever the card data or the
   * generator did: correcting one printed cost took a Sentinel out of three walls and cut the lockout
   * rate in half. A list someone built does not drift, so a rate read over it stays comparable.
   */
  it('faces every coverage deck with the same fixed wall', () => {
    for (const { wall } of pairings) expect(wall).toEqual(WALL_DECK)
  })

  /**
   * The whole purpose of the set. A self-shielding Sentinel arrives with the Shield already on it,
   * so the wall needs no combination and no intent: the bot plays a good body and the lane shuts.
   */
  it('holds self-shielding Sentinels it will actually draw', () => {
    const selfShielding = wallCards().filter(c => (c.Keywords ?? []).includes('Sentinel') && (c.Keywords ?? []).includes('Shielded'))
    expect(selfShielding.length).toBeGreaterThanOrEqual(3)
  })

  /**
   * **Re-shielding is what makes the lockout last**, and duration is the reported defect. A Shield
   * absorbs one instance of damage and is then gone, so without support the wall falls the moment the
   * bot strips it and the bench reads a one-round lockout. The filed game ran four rounds.
   */
  it('holds ways to put the Shield back', () => {
    const reshield = wallCards().filter(c => /give a Shield token/i.test(c.FrontText ?? ''))
    expect(reshield.length).toBeGreaterThanOrEqual(2)
  })

  /** Enough to play on the first turn, so a Sentinel is down before the other side can attack. */
  it('has 8 or 9 units costing 2 or less', () => {
    const cheap = deckReport(WALL_DECK, byId).counts.cheapUnits
    expect(cheap).toBeGreaterThanOrEqual(8)
    expect(cheap).toBeLessThanOrEqual(9)
  })

  /**
   * **A deck someone would play.** Held to the same legality, curve, type and rarity rules as every
   * generated deck, so a weight tuned against this set is tuned against a legal deck rather than
   * against a pile built to prove a point.
   */
  it('is a legal, penalty-free deck', () => {
    const report = deckReport(WALL_DECK, byId)
    expect(report.violations, report.violations.join('; ')).toEqual([])
    expect(report.ok).toBe(true)
  })

  /** Reproducible, or no result measured over it can be re-read later. The seed moves the facing side only. */
  it('is deterministic from its seed', () => {
    expect(buildLockoutDecks(POOL, 1)).toEqual(pairings)
    const other = buildLockoutDecks(POOL, 2)
    expect(other.map(p => p.facing)).not.toEqual(pairings.map(p => p.facing))
    for (const { wall } of other) expect(wall).toEqual(WALL_DECK)
  })
})
