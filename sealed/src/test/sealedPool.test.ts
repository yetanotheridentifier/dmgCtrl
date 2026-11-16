import { describe, it, expect } from 'vitest'
import sorSet from './fixtures/sorSet.json'
import jtlSet from './fixtures/jtlSet.json'
import ashSet from './fixtures/ashSet.json'
import lofSet from './fixtures/lofSet.json'
import type { SwuCard } from '../data/cards'
import { minimumDeckSize } from '../utils/parseProtectThePod'
import { isToken } from '../data/cards'
import { openPack, openPool, packProfile, type Pack } from '../deckgen/packs'
import { buildDeckFromPool, NO_ASPECT } from '../deckgen/generateDeck'
import { seededRandom } from '../engine/rng'

/**
 * A sealed pool is six packs opened from one set, and a generated sealed deck is built from what came
 * out. The slot shape is the published one: one leader, one base, nine commons, three uncommons, one
 * rare or legendary, one foil of any rarity.
 */
const SOR = sorSet as unknown as SwuCard[]
const JTL = jtlSet as unknown as SwuCard[]
const ASH = ashSet as unknown as SwuCard[]
const LOF = lofSet as unknown as SwuCard[]
const id = (c: SwuCard): string => `${c.Set}_${c.Number}`
const isDeckCard = (c: SwuCard): boolean => c.Type === 'Unit' || c.Type === 'Event' || c.Type === 'Upgrade'

/** A real set fills every slot, which the first test below asserts. */
type Full = Required<Pack>
function packs(cards: SwuCard[], n: number, seed = 1): Full[] {
  const rand = seededRandom(seed)
  return Array.from({ length: n }, () => openPack(cards, rand) as Full)
}
const share = (xs: Full[], hit: (p: Full) => boolean): number => xs.filter(hit).length / xs.length

describe('openPack', () => {
  const sor = packs(SOR, 200)

  it('fills every slot with the rarity and type the slot prints', () => {
    for (const p of sor) {
      expect(p.leader.Type).toBe('Leader')
      expect(['Common', 'Rare']).toContain(p.leader.Rarity)
      expect(p.base.Type).toBe('Base')
      expect(p.base.Rarity).toBe('Common')
      expect(p.commons).toHaveLength(9)
      expect(p.commons.every(c => c.Rarity === 'Common' && c.Type !== 'Leader' && c.Type !== 'Base')).toBe(true)
      expect(p.uncommons).toHaveLength(3)
      expect(p.uncommons.every(c => c.Rarity === 'Uncommon')).toBe(true)
      expect(['Rare', 'Legendary']).toContain(p.rare.Rarity)
      expect(p.rare.Type).not.toBe('Leader')
    }
  })

  it('never repeats a common or an uncommon within one pack', () => {
    for (const p of sor) {
      expect(new Set(p.commons.map(id)).size).toBe(9)
      expect(new Set(p.uncommons.map(id)).size).toBe(3)
    }
  })

  /** A partial cache can print nothing for a slot: the slot comes back empty rather than undefined in the pool. */
  it('leaves a slot empty when the card list prints nothing for it', () => {
    const leaderOnly = SOR.filter(c => c.Type === 'Leader')
    const p = openPack(leaderOnly, seededRandom(1))
    expect(p.leader?.Type).toBe('Leader')
    expect([p.base, p.rare, p.foil]).toEqual([undefined, undefined, undefined])
    expect(openPool(leaderOnly, 1).every(c => c.Type === 'Leader')).toBe(true)
  })

  it('never opens a token', () => {
    for (const p of sor) for (const c of [p.leader, p.base, ...p.commons, ...p.uncommons, p.rare, p.foil]) expect(isToken(c)).toBe(false)
  })

  it('opens a rare base only from the rare or foil slot', () => {
    const rareBases = share(sor, p => p.rare.Type === 'Base')
    expect(rareBases).toBeGreaterThan(0)
  })

  describe('rates, over many packs', () => {
    const many = (cards: SwuCard[]) => packs(cards, 8000, 7)
    const sorMany = many(SOR)
    const jtlMany = many(JTL)
    const ashMany = many(ASH)

    it('opens a Legendary in about 1 in 8 packs before Jump to Lightspeed', () => {
      expect(share(sorMany, p => p.rare.Rarity === 'Legendary')).toBeCloseTo(1 / 8, 1)
    })

    it('opens a Legendary in about 1 in 5 packs from Jump to Lightspeed on', () => {
      expect(share(jtlMany, p => p.rare.Rarity === 'Legendary')).toBeCloseTo(1 / 5, 1)
      expect(share(ashMany, p => p.rare.Rarity === 'Legendary')).toBeCloseTo(1 / 5, 1)
    })

    it('opens a rare leader in about 1 in 8 packs', () => {
      expect(share(ashMany, p => p.leader.Rarity === 'Rare')).toBeCloseTo(packProfile('ASH').rareLeader, 1)
    })

    it('opens a foil mostly as a common, in the pack\'s own proportions', () => {
      const commonFoils = share(ashMany, p => p.foil.Rarity === 'Common')
      expect(commonFoils).toBeGreaterThan(0.6)
      expect(commonFoils).toBeLessThan(0.75)
    })

    it('opens a Special card only as a foil, and only from Jump to Lightspeed on', () => {
      const special = (p: Full) => [p.leader, p.base, ...p.commons, ...p.uncommons, p.rare].some(c => c.Rarity === 'Special')
      expect(sorMany.some(special)).toBe(false)
      expect(ashMany.some(special)).toBe(false)
      expect(sorMany.some(p => p.foil.Rarity === 'Special')).toBe(false)
      expect(ashMany.some(p => p.foil.Rarity === 'Special')).toBe(true)
    })
  })
})

describe('packProfile', () => {
  it('reads the Legendary rate off the set', () => {
    expect(packProfile('SOR').legendary).toBe(1 / 8)
    expect(packProfile('TWI').legendary).toBe(1 / 8)
    expect(packProfile('JTL').legendary).toBe(1 / 5)
    expect(packProfile('HMW').legendary).toBe(1 / 5)
  })
})

describe('openPool', () => {
  it('opens six packs, 16 cards each', () => {
    expect(openPool(ASH, 1)).toHaveLength(96)
  })

  it('is reproducible from its seed and varies between seeds', () => {
    expect(openPool(ASH, 3).map(id)).toEqual(openPool(ASH, 3).map(id))
    expect(openPool(ASH, 3).map(id)).not.toEqual(openPool(ASH, 4).map(id))
  })

  it('swaps a requested leader into one leader slot, keeping six leaders', () => {
    const wanted = ASH.find(c => c.Type === 'Leader' && c.Rarity === 'Rare')!
    for (const seed of [1, 2, 3, 4, 5]) {
      const pool = openPool(ASH, seed, { leader: wanted })
      expect(pool.some(c => id(c) === id(wanted))).toBe(true)
      expect(pool.filter(c => c.Type === 'Leader')).toHaveLength(6)
    }
  })
})

describe('buildDeckFromPool', () => {
  const LEADERS = ASH.filter(c => c.Type === 'Leader' && c.Rarity !== 'Special')
  const SEEDS = [1, 2, 3, 4, 5]
  const count = (xs: SwuCard[]) => {
    const m = new Map<string, number>()
    for (const c of xs) m.set(id(c), (m.get(id(c)) ?? 0) + 1)
    return m
  }

  it('plays no more copies of a card than the pool opened', () => {
    for (const leader of LEADERS) {
      for (const seed of SEEDS) {
        const pool = openPool(ASH, seed, { leader })
        const opened = count(pool)
        const { deck } = buildDeckFromPool(leader, pool, ASH, seed)
        expect(deck.leader).toBe(id(leader))
        for (const e of deck.cards) {
          expect(e.count, `${leader.Name} seed ${seed}: ${e.id}`).toBeLessThanOrEqual(opened.get(e.id) ?? 0)
        }
      }
    }
  })

  /**
   * Common bases are on the table at a sealed event, so any of the set's Common bases is usable
   * whether or not the pool opened it. A rare base has to be opened.
   */
  describe('bases', () => {
    const decks = (cards: SwuCard[]) => cards.filter(c => c.Type === 'Leader' && c.Rarity !== 'Special').flatMap(leader =>
      Array.from({ length: 20 }, (_, i) => i + 1).map(seed => {
        const pool = openPool(cards, seed, { leader })
        return { pool, deck: buildDeckFromPool(leader, pool, cards, seed).deck }
      }))
    const jtl = decks(JTL)
    const rarity = (deckBase: string) => JTL.find(c => id(c) === deckBase)!.Rarity

    it('builds on a Common base the pool did not open', () => {
      expect(jtl.some(({ pool, deck }) => rarity(deck.base) === 'Common' && !pool.some(c => id(c) === deck.base))).toBe(true)
    })

    it('builds on a rare base only when the pool opened it', () => {
      const rare = jtl.filter(({ deck }) => rarity(deck.base) !== 'Common')
      expect(rare.length, 'no deck used an opened rare base').toBeGreaterThan(0)
      for (const { pool, deck } of rare) expect(pool.some(c => id(c) === deck.base), deck.base).toBe(true)
    })

    it('builds on a base of a named aspect, taking it from the set when the pool cannot offer one', () => {
      const leader = JTL.find(c => c.Type === 'Leader' && c.Rarity === 'Common')!
      const lake = JTL.find(c => c.Name === 'Lake Country')!
      for (const seed of SEEDS) {
        const pool = openPool(JTL, seed, { leader }).filter(c => id(c) !== id(lake))
        expect(buildDeckFromPool(leader, pool, JTL, seed, NO_ASPECT).deck.base).toBe(id(lake))
        const command = buildDeckFromPool(leader, pool, JTL, seed, 'Command').deck.base
        expect(JTL.find(c => id(c) === command)!.Aspects).toEqual(['Command'])
      }
    })
  })

  /**
   * A pool deck is held to legality, its size, and nothing else: the curve, type caps, rarity mix and
   * alignment split are what the generator aims for, and an off-aspect card is a splash, counted.
   */
  it('reports legality only, counting the splash', () => {
    const anakin = LOF.find(c => c.Type === 'Leader' && c.Name === 'Anakin Skywalker')!
    const reports = SEEDS.flatMap(seed => [ASH, LOF].map(cards => {
      const leader = cards === LOF ? anakin : LEADERS[seed]
      return buildDeckFromPool(leader, openPool(cards, seed, { leader }), cards, seed).report
    }))
    for (const r of reports) {
      expect(r.violations).toEqual([])
      expect(r.ok).toBe(true)
    }
    expect(reports.some(r => r.offAspect > 0), 'some deck splashed').toBe(true)
  })

  const fills = (cards: SwuCard[], leaders: SwuCard[]) => {
    for (const leader of leaders) {
      for (const seed of SEEDS) {
        const { deck } = buildDeckFromPool(leader, openPool(cards, seed, { leader }), cards, seed)
        const size = deck.cards.reduce((n, e) => n + e.count, 0)
        expect(size, `${leader.Name} seed ${seed} on ${deck.base}`).toBe(minimumDeckSize(deck.base))
      }
    }
  }

  it('fills a whole deck from a six-pack pool for every leader', () => fills(ASH, LEADERS))

  /**
   * A leader with one aspect is paid by its base for one more, so a pool can hold fewer playable cards
   * than a deck needs. A player splashes: off-aspect cards, paying the penalty, rather than a short deck.
   */
  it('splashes off-aspect cards rather than build a short deck for a one-aspect leader', () => {
    const anakin = LOF.find(c => c.Type === 'Leader' && c.Name === 'Anakin Skywalker')!
    expect(anakin.Aspects, 'a one-aspect leader').toEqual(['Heroism'])
    fills(LOF, [anakin])
  })

  it('draws only on deck cards the pool opened', () => {
    const pool = openPool(ASH, 9, { leader: LEADERS[0] })
    const opened = new Set(pool.filter(isDeckCard).map(id))
    const { deck } = buildDeckFromPool(LEADERS[0], pool, ASH, 9)
    for (const e of deck.cards) expect(opened.has(e.id)).toBe(true)
  })
})
