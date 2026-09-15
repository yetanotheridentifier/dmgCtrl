import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { buildDeckForLeader, generateDeck } from '../deckgen/generateDeck'
import { deckReport, MAX_COPIES, MAX_COPIES_BY_RARITY } from '../deckgen/rules'

/**
 * The deck generator (#408): a reusable primitive that builds one legal, penalty-free, realistically
 * shaped deck for a given leader (choosing the base itself). The strong proof is that it produces a
 * fully rule-satisfying deck for EVERY real ASH leader, and does so deterministically.
 */
const POOL = ashSet as unknown as SwuCard[]
const LEADERS = POOL.filter(c => c.Type === 'Leader')

function byId(pool: SwuCard[]): Map<string, SwuCard> {
  return new Map(pool.map(c => [`${c.Set}_${c.Number}`, c]))
}

/**
 * **Unique limits the board, not the deck.** A player may hold several copies of a Unique card; only one
 * of them can be in play at a time. So a forced count on a Unique is honoured like any other card's, up
 * to the copy cap.
 */
describe('generateDeck with forced copies', () => {
  const card = (n: string): SwuCard => POOL.find(c => c.Number === n)!
  const build = (require: Map<string, number>) =>
    generateDeck({ leader: card('008'), base: card('020'), pool: POOL, seed: 1, require }).deck
  const copies = (deck: { cards: Array<{ id: string; count: number }> }, id: string): number =>
    deck.cards.find(e => e.id === id)?.count ?? 0

  it('forces several copies of a Unique card when asked', () => {
    expect(card('097').Unique, 'Moff Gideon, Remnant Commander is Unique').toBe(true)
    expect(copies(build(new Map([['ASH_097', 3]])), 'ASH_097')).toBe(3)
  })

  it('still clamps a forced count to the copy cap', () => {
    expect(copies(build(new Map([['ASH_239', 5]])), 'ASH_239')).toBe(MAX_COPIES)
  })
})

describe('buildDeckForLeader', () => {
  it('has 18 ASH leaders to build for', () => {
    expect(LEADERS).toHaveLength(18)
  })

  for (const leader of LEADERS) {
    it(`builds a rule-satisfying deck for ${leader.Name}`, () => {
      const { deck, report } = buildDeckForLeader(leader, POOL, 1)
      expect(report.violations, `${leader.Name}: ${report.violations.join('; ')}`).toEqual([])
      // deckReport recomputed independently agrees.
      expect(deckReport(deck, byId(POOL)).ok).toBe(true)
    })
  }

  /**
   * **A pool is what limits copies in sealed, not a deckbuilding rule.** The 3-copy cap is a
   * constructed-format rule and does not apply here: you play what you opened, five copies included.
   * What actually limits you is how unlikely a duplicate is, and that depends entirely on rarity.
   *
   * A six-pack pool yields roughly 0-3 Legendaries in total and essentially never two of the same, a
   * duplicate Rare only a few percent of the time, and 2 or at a push 3 of a given Common. Building
   * from the whole set under a flat 3-copy cap ignores all of that: the matrix run at seed 42 put
   * **three copies of Zeb Orrelios**, a Legendary, into four decks.
   *
   * These caps stand in for the pool until the generator models one properly. They are an
   * approximation of a distribution, not a rule of the game.
   */
  /**
   * **Duplicates are a probability, not a cap.** How often you open two of the same card is entirely
   * a function of rarity, so that is what the generator rolls for. Measured over many decks rather
   * than asserted per deck, because the claim is about a distribution.
   */
  describe('duplicate frequency follows rarity', () => {
    /** Across every leader and many seeds: how often a chosen card got a second copy, by rarity. */
    const observed = () => {
      const card = byId(POOL)
      const seen = new Map<string, { entries: number; duplicated: number }>()
      for (let seed = 1; seed <= 25; seed++) {
        for (const leader of LEADERS) {
          for (const entry of buildDeckForLeader(leader, POOL, seed).deck.cards) {
            const rarity = card.get(entry.id)?.Rarity ?? 'Common'
            const t = seen.get(rarity) ?? { entries: 0, duplicated: 0 }
            t.entries++
            if (entry.count > 1) t.duplicated++
            seen.set(rarity, t)
          }
        }
      }
      return seen
    }

    const stats = observed()
    const rateFor = (rarity: string) => {
      const t = stats.get(rarity)
      return t && t.entries > 0 ? t.duplicated / t.entries : 0
    }

    it.each([
      ['Common', 0.40, 0.15],
      ['Uncommon', 0.10, 0.10],
      ['Rare', 0.03, 0.06],
    ])('duplicates %s at about the target rate', (rarity, target, tolerance) => {
      const t = stats.get(rarity)
      expect(t?.entries ?? 0, `${rarity} never appeared`).toBeGreaterThan(20)
      expect(Math.abs(rateFor(rarity) - target), `${rarity} at ${(rateFor(rarity) * 100).toFixed(1)}%`)
        .toBeLessThan(tolerance)
    })

    /** A duplicated Legendary is the case that started this: it should be vanishingly rare. */
    it('effectively never duplicates a Legendary', () => {
      expect(rateFor('Legendary')).toBeLessThan(0.01)
    })
  })

  describe('copies are capped by rarity, standing in for a pool', () => {
    const copiesByRarity = (deck: ReturnType<typeof buildDeckForLeader>['deck'], pool: SwuCard[]) => {
      const card = byId(pool)
      const worst = new Map<string, number>()
      for (const entry of deck.cards) {
        const rarity = card.get(entry.id)?.Rarity ?? 'Common'
        worst.set(rarity, Math.max(worst.get(rarity) ?? 0, entry.count))
      }
      return worst
    }

    for (const leader of LEADERS) {
      it(`respects the per-rarity cap for ${leader.Name}`, () => {
        const { deck } = buildDeckForLeader(leader, POOL, 1)
        for (const [rarity, most] of copiesByRarity(deck, POOL)) {
          const cap = MAX_COPIES_BY_RARITY[rarity as keyof typeof MAX_COPIES_BY_RARITY] ?? MAX_COPIES
          expect(most, `${rarity} in ${leader.Name}'s deck`).toBeLessThanOrEqual(cap)
        }
      })
    }

    /** The case that prompted this: a tripled Legendary is the thing a pool makes impossible. */
    it('never triples a Legendary, whatever the seed', () => {
      for (let seed = 1; seed <= 5; seed++) {
        for (const leader of LEADERS) {
          const { deck } = buildDeckForLeader(leader, POOL, seed)
          const most = copiesByRarity(deck, POOL).get('Legendary') ?? 0
          expect(most, `${leader.Name} at seed ${seed}`).toBeLessThanOrEqual(1)
        }
      }
    })
  })

  /**
   * **A base must not double an aspect the leader already supplies.** This set has no card with a
   * doubled aspect, so the overlap buys nothing, and one colour does not yield enough playables. The
   * picker used to take the first base that produced a legal deck, in pool order, which is how Luke
   * Skywalker (Vigilance) ended up on Fortress of the Great Mothers (Vigilance).
   */
  describe('base choice', () => {
    const aspectOf = (id: string) => byId(POOL).get(id)?.Aspects ?? []

    for (const leader of LEADERS) {
      it(`does not double ${leader.Name}'s aspect`, () => {
        const { deck } = buildDeckForLeader(leader, POOL, 1)
        const overlap = aspectOf(deck.base).filter(a => (leader.Aspects ?? []).includes(a))
        expect(overlap, `base ${deck.base}`).toEqual([])
      })
    }

    /** And it should not be the same base for everyone: the aspect is a real choice. */
    it('varies the base across leaders', () => {
      const bases = new Set(LEADERS.map(l => buildDeckForLeader(l, POOL, 1).deck.base))
      expect(bases.size).toBeGreaterThan(1)
    })
  })

  /**
   * **The type mix should vary, not land on a constant.** The targets are what a real pool pushes you
   * toward, not a quota every deck hits exactly, and a generator that builds 4 events and 3 upgrades
   * every single time is describing its own constants rather than a deck.
   */
  it('varies the unit, upgrade and event counts across seeds', () => {
    const shapes = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const { deck } = buildDeckForLeader(LEADERS[0], POOL, seed)
      const card = byId(POOL)
      const count = (type: string) => deck.cards
        .filter(c => card.get(c.id)?.Type === type)
        .reduce((n, c) => n + c.count, 0)
      shapes.add(`${count('Unit')}/${count('Upgrade')}/${count('Event')}`)
    }
    expect(shapes.size, 'every seed produced the same type mix').toBeGreaterThan(1)
  })

  it('is deterministic for a given seed', () => {
    const a = buildDeckForLeader(LEADERS[0], POOL, 7).deck
    const b = buildDeckForLeader(LEADERS[0], POOL, 7).deck
    expect(b).toEqual(a)
  })
})
