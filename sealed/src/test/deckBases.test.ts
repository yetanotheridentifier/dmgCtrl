import { describe, it, expect } from 'vitest'
import type { SwuCard } from '../data/cards'
import { buildDeckForLeader, generateDeck } from '../deckgen/generateDeck'
import { generateRandomDeck } from '../deckgen/randomDeck'
import { deckReport } from '../deckgen/rules'
import { minimumDeckSize } from '../utils/parseProtectThePod'
import { buildMatchupDecks } from '../bench/matchupDecks'
import { buildCoverageDecks } from '../bench/coverageDecks'
import sorSet from './fixtures/sorSet.json'
import shdSet from './fixtures/shdSet.json'
import twiSet from './fixtures/twiSet.json'
import jtlSet from './fixtures/jtlSet.json'
import lofSet from './fixtures/lofSet.json'
import secSet from './fixtures/secSet.json'
import hmwSet from './fixtures/hmwSet.json'

/**
 * What a generated deck is built on and what it may hold, across the sets that make it matter: cards
 * with a doubled aspect, bases that change the deck size, rare bases, and Homeworlds' world bases.
 */
const SETS: Record<string, SwuCard[]> = {
  SOR: sorSet as unknown as SwuCard[],
  SHD: shdSet as unknown as SwuCard[],
  TWI: twiSet as unknown as SwuCard[],
  JTL: jtlSet as unknown as SwuCard[],
  LOF: lofSet as unknown as SwuCard[],
  SEC: secSet as unknown as SwuCard[],
  HMW: hmwSet as unknown as SwuCard[],
}
const JTL = SETS.JTL
const HMW = SETS.HMW
const idOf = (c: SwuCard) => `${c.Set}_${c.Number}`
const byId = (pool: SwuCard[]) => new Map(pool.map(c => [idOf(c), c]))
const leadersOf = (pool: SwuCard[]) => pool.filter(c => c.Type === 'Leader')
const basesOf = (pool: SwuCard[]) => pool.filter(c => c.Type === 'Base')
const size = (deck: { cards: { count: number }[] }) => deck.cards.reduce((n, c) => n + c.count, 0)
const tally = (aspects: string[]) => {
  const t = new Map<string, number>()
  for (const a of aspects) t.set(a, (t.get(a) ?? 0) + 1)
  return t
}

/**
 * Counted here independently of the rules module: each icon on the card needs one from the leader or
 * base, by its printed aspects or by those of its Smuggle or Piloting cost.
 */
function payable(card: SwuCard, leader: SwuCard, base: SwuCard): boolean {
  const supply = tally([...(leader.Aspects ?? []), ...(base.Aspects ?? [])])
  const alternatives = [...(card.FrontText ?? '').matchAll(/(?:Smuggle|Piloting)\s*\[([^\]]+)\]/g)]
    .map(m => m[1].replace(/[{}]/g, ' ').split(/\s+/).filter(w => /^[A-Z][a-z]+$/.test(w)))
  return [card.Aspects ?? [], ...alternatives].some(aspects =>
    [...tally(aspects)].every(([a, n]) => (supply.get(a) ?? 0) >= n))
}

describe('aspect icons', () => {
  for (const [code, pool] of Object.entries(SETS)) {
    it(`never puts a card in a ${code} deck that its leader and base cannot pay for`, () => {
      const cards = byId(pool)
      for (const leader of leadersOf(pool)) {
        const { deck } = buildDeckForLeader(leader, pool, 1)
        const base = cards.get(deck.base)!
        const unpaid = deck.cards.map(e => cards.get(e.id)!).filter(c => !payable(c, leader, base)).map(c => c.Name)
        expect(unpaid, `${leader.Name} on ${base.Name}`).toEqual([])
      }
    })
  }

  /** The Mandalorian prints two Cunning but pilots for one, so a deck with one Cunning can play him. */
  it('lets a card in on its Piloting aspects', () => {
    const mando = JTL.find(c => c.Name === 'The Mandalorian' && c.Type === 'Unit')!
    const base = basesOf(JTL).find(b => b.Aspects?.[0] === 'Cunning' && b.Rarity === 'Common')!
    const leader = leadersOf(JTL).find(l => !(l.Aspects ?? []).includes('Cunning'))!
    const { deck } = generateDeck({ leader, base, pool: JTL, seed: 1, require: new Map([[idOf(mando), 1]]) })
    expect(deck.cards.map(e => e.id)).toContain(idOf(mando))
  })

  /** Choosing a base of the leader's own colour is what makes a doubled card playable, and so worth choosing. */
  it('plays doubled cards when the leader and base double their aspect', () => {
    const cards = byId(JTL)
    const doubled = (c: SwuCard) => new Set(c.Aspects ?? []).size < (c.Aspects ?? []).length
    let found = 0
    for (const leader of leadersOf(JTL)) {
      const colour = (leader.Aspects ?? []).find(a => !['Heroism', 'Villainy'].includes(a))
      if (!colour) continue
      const { deck } = buildDeckForLeader(leader, JTL, 1, undefined, colour)
      found += deck.cards.filter(e => doubled(cards.get(e.id)!)).length
    }
    expect(found).toBeGreaterThan(0)
  })
})

describe('deck size follows the base', () => {
  const named = (name: string) => basesOf(JTL).find(b => b.Name === name)!

  it.each([
    ['Thermal Oscillator', 25],
    ['Data Vault', 40],
  ])('builds a %s deck of %i cards that passes the rules', (name, want) => {
    const base = named(name)
    expect(minimumDeckSize(idOf(base))).toBe(want)
    const leaders = leadersOf(JTL).filter(l => !(l.Aspects ?? []).some(a => (base.Aspects ?? []).includes(a)))
    for (const leader of leaders) {
      const { deck, report } = generateDeck({ leader, base, pool: JTL, seed: 1 })
      expect(size(deck), leader.Name).toBe(want)
      expect(report.violations, `${leader.Name}: ${report.violations.join('; ')}`).toEqual([])
      expect(deckReport(deck, byId(JTL)).ok, leader.Name).toBe(true)
    }
  })
})

describe('which base a deck is built on', () => {
  const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1)
  const jtlDecks = SEEDS.map(seed => generateRandomDeck(JTL, seed)!)
  const jtlBases = byId(basesOf(JTL))

  it('fills every deck to its own base\'s size', () => {
    for (const { deck } of jtlDecks) expect(size(deck), deck.base).toBe(minimumDeckSize(deck.base))
  })

  it('uses every common base', () => {
    const used = new Set(jtlDecks.map(g => g.deck.base))
    const commons = basesOf(JTL).filter(b => b.Rarity === 'Common').map(idOf)
    expect(commons.filter(b => !used.has(b))).toEqual([])
  })

  /** A rare base turns up about once in 25 decks: it is a rare a pool has to open. */
  it('builds on a rare base about once in 25 decks', () => {
    const rare = jtlDecks.filter(g => jtlBases.get(g.deck.base)?.Rarity !== 'Common').length / jtlDecks.length
    expect(rare).toBeGreaterThan(0.01)
    expect(rare).toBeLessThan(0.08)
  })

  /**
   * A pool offering only rare bases still builds, on the bases it has. No sealed-sized set prints only
   * rare bases (TS26 and IBH do, and are too small to fill a deck), so JTL stands in with its commons removed.
   */
  it('builds on rare bases when the pool has no common one', () => {
    const rareOnly = JTL.filter(c => c.Type !== 'Base' || c.Rarity !== 'Common')
    for (const seed of SEEDS.slice(0, 10)) {
      const built = generateRandomDeck(rareOnly, seed)
      expect(built, `seed ${seed}`).not.toBeNull()
      expect(jtlBases.get(built!.deck.base)?.Rarity, `seed ${seed}`).not.toBe('Common')
    }
  })

  /**
   * Homeworlds prints each colour four times, once per world, and some cards name a world. The deck
   * takes the base of its colour whose world its cards name most, and where none does, any of them.
   */
  describe('Homeworlds world bases', () => {
    // The full 400: a world its colour's cards rarely name (Endor, in Command) is taken rarely, as it should be.
    const hmwDecks = SEEDS.map(seed => generateRandomDeck(HMW, seed)!)
    const hmwBases = byId(basesOf(HMW))
    const cards = byId(HMW)
    const mentions = (deck: { cards: { id: string; count: number }[] }, world: string) => deck.cards
      .filter(e => `${cards.get(e.id)?.FrontText ?? ''} ${cards.get(e.id)?.BackText ?? ''}`.toUpperCase().includes(world))
      .reduce((n, e) => n + e.count, 0)

    it('takes the world its cards name most', () => {
      for (const { deck } of hmwDecks) {
        const base = hmwBases.get(deck.base)!
        const rivals = basesOf(HMW).filter(b => b.Aspects?.[0] === base.Aspects?.[0])
        const best = Math.max(...rivals.map(b => mentions(deck, b.Traits![0])))
        expect(mentions(deck, base.Traits![0]), `${deck.name} on ${base.Name}`).toBe(best)
      }
    })

    it('uses every world base', () => {
      const used = new Set(hmwDecks.map(g => g.deck.base))
      expect(basesOf(HMW).map(idOf).filter(b => !used.has(b))).toEqual([])
    })
  })
})

/**
 * The bench's suites choose bases by the same rule as a generated deck, not the first base of each
 * colour in pool order, which in JTL was Data Vault for every Command deck.
 */
describe('the bench suites choose bases the same way', () => {
  const SUITE_SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)
  const jtlSuites = SUITE_SEEDS.map(seed => buildMatchupDecks(JTL, 4, seed))
  const jtlBases = byId(basesOf(JTL))

  it('spreads the matchup suite across every common base', () => {
    const used = new Set(jtlSuites.flat().map(d => d.deck.base))
    const commons = basesOf(JTL).filter(b => b.Rarity === 'Common').map(idOf)
    expect(commons.filter(b => !used.has(b))).toEqual([])
  })

  it('rarely builds a matchup deck on a rare base', () => {
    const decks = jtlSuites.flat()
    const rare = decks.filter(d => jtlBases.get(d.deck.base)?.Rarity !== 'Common').length / decks.length
    expect(rare).toBeLessThan(0.1)
  })

  it('fills each matchup and coverage deck to its own base\'s size', () => {
    for (const d of jtlSuites.flat()) expect(size(d.deck), d.label).toBe(minimumDeckSize(d.deck.base))
    for (const deck of buildCoverageDecks(JTL, 1).decks) expect(size(deck), deck.name).toBe(minimumDeckSize(deck.base))
  })

  it('takes the Homeworlds world the cards name most, in both suites', () => {
    const cards = byId(HMW)
    const hmwBases = byId(basesOf(HMW))
    const mentions = (deck: { cards: { id: string; count: number }[] }, world: string) => deck.cards
      .filter(e => `${cards.get(e.id)?.FrontText ?? ''} ${cards.get(e.id)?.BackText ?? ''}`.toUpperCase().includes(world))
      .reduce((n, e) => n + e.count, 0)
    const decks = [...buildMatchupDecks(HMW, 4, 1).map(d => d.deck), ...buildCoverageDecks(HMW, 1).decks]
    for (const deck of decks) {
      const base = hmwBases.get(deck.base)!
      const rivals = basesOf(HMW).filter(b => b.Aspects?.[0] === base.Aspects?.[0] && b.Rarity === base.Rarity)
      const best = Math.max(...rivals.map(b => mentions(deck, b.Traits![0])))
      expect(mentions(deck, base.Traits![0]), `${deck.name} on ${base.Name}`).toBe(best)
    }
  })
})
