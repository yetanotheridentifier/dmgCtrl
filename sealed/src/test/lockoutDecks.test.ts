import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { buildLockoutDecks, WALL_PACKAGE } from '../bench/lockoutDecks'
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
const copies = (deck: { cards: Array<{ id: string; count: number }> }, id: string): number =>
  deck.cards.find(e => e.id === id)?.count ?? 0

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
   * The whole purpose of the set. A self-shielding Sentinel arrives with the Shield already on it,
   * so the wall needs no combination and no intent: the bot plays a good body and the lane shuts.
   */
  it('gives every wall deck a self-shielding Sentinel it will actually draw', () => {
    for (const { wall } of pairings) {
      const walls = WALL_PACKAGE.sentinels.reduce((n, id) => n + copies(wall, id), 0)
      expect(walls, `${wall.name} must hold a self-shielding Sentinel`).toBeGreaterThanOrEqual(3)
    }
  })

  /**
   * **Re-shielding is what makes the lockout last**, and duration is the reported defect. A Shield
   * absorbs one instance of damage and is then gone, so without support the wall falls the moment the
   * bot strips it and the bench reads a one-round lockout. The filed game ran four rounds.
   */
  it('gives every wall deck a way to put the Shield back', () => {
    for (const { wall } of pairings) {
      const support = WALL_PACKAGE.reshield.reduce((n, id) => n + copies(wall, id), 0)
      expect(support, `${wall.name} must be able to re-shield`).toBeGreaterThanOrEqual(2)
    }
  })

  /**
   * **A deck someone would play.** The package goes in only where it is penalty-free and the
   * generator's own curve, type and rarity rules still apply, so a weight tuned against this set is
   * tuned against legal decks rather than against a pile built to prove a point.
   */
  it('builds legal, penalty-free decks', () => {
    for (const { wall } of pairings) {
      const report = deckReport(wall, byId)
      expect(report.violations, `${wall.name}: ${report.violations.join('; ')}`).toEqual([])
      expect(report.ok).toBe(true)
    }
  })

  /**
   * **How varied the wall side is, asserted rather than assumed.**
   *
   * The archetype needs Vigilance for the re-shields and Villainy or Command for the Sentinels, which
   * sounds narrow and is not: **22 distinct leader and base combinations** host it, out of the 18
   * leaders against 4 base aspects the pool offers. So the wall side is an archetype rather than a
   * single deck, and a result over this set is not a claim about one matchup.
   *
   * Asserted as a floor rather than as 22 exactly, because the number is a property of the card pool
   * and a set rotation should not fail this. The floor is what matters: a set that collapsed to one
   * or two walls would be measuring a matchup rather than a strategy.
   */
  it('draws its walls from many hosting combinations', () => {
    const distinct = new Set(pairings.map(p => p.wall.name))
    expect(distinct.size, 'a single matchup repeated would measure the matchup').toBeGreaterThanOrEqual(8)
  })

  /** Reproducible, or no result measured over it can be re-read later. */
  it('is deterministic from its seed', () => {
    expect(buildLockoutDecks(POOL, 1)).toEqual(pairings)
    expect(buildLockoutDecks(POOL, 2)).not.toEqual(pairings)
  })
})
