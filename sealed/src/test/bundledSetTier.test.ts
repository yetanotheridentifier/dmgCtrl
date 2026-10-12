// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { db } from '../data/db'
import { getCard, SWU_DB_API, type SwuCard } from '../data/cards'
import { cachedSetCards, cachedSetCount } from '../data/setImport'
import { canonicaliseCards } from '../data/printings'
import { syncCatalogue } from '../data/catalogueSync'
import { printedCardCount } from '../data/implementedCards'
import { SET_CODES } from '../bench/setPools'
import sorSet from './fixtures/sorSet.json'

/**
 * The bundled sets as a tier of the card lookups: cache, then the bundled set, then the card API.
 * Every test here starts from an empty cache, and all but the ones about the order of the tiers run
 * with the card API unreachable, which is a first visit on a day the API is down.
 */

const SOR = sorSet as unknown as SwuCard[]

const unreachable = () => vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

beforeEach(async () => {
  await db.cards.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getCard with the card API unreachable', () => {
  it('serves a card of a bundled set without asking the network', async () => {
    const fetchMock = unreachable()
    vi.stubGlobal('fetch', fetchMock)

    const card = await getCard('SOR', '010')

    expect(card).toMatchObject({ Set: 'SOR', Number: '010', Name: 'Darth Vader', Type: 'Leader' })
    expect(card.FrontArt).toBe('https://cdn.swu-db.com/images/cards/SOR/010.png')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves a zero-padded number under the number its set uses', async () => {
    vi.stubGlobal('fetch', unreachable())
    const card = await getCard('IBH', '052')
    expect(card).toMatchObject({ Set: 'IBH', Number: '52', Name: 'Watch This' })
  })

  it('still fails, naming the card, for one the bundled set does not hold', async () => {
    vi.stubGlobal('fetch', unreachable())
    await expect(getCard('SOR', '999')).rejects.toThrow(/SOR_999/)
  })

  it('serves a bundled card when the cache cannot be read', async () => {
    vi.spyOn(db.cards, 'get').mockRejectedValue(new Error('VersionError: requested version is lower'))
    vi.stubGlobal('fetch', unreachable())
    expect((await getCard('SOR', '010')).Name).toBe('Darth Vader')
  })
})

describe('the order of the tiers', () => {
  const served = (json: unknown) => vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(json) })

  it('prefers the cache to the bundled set, so a visitor with a cache sees the cards they had', async () => {
    await db.cards.put({ id: 'SOR_010', json: { Set: 'SOR', Number: '010', Name: 'Cached Vader', Type: 'Leader' }, fetchedAt: 1 })
    vi.stubGlobal('fetch', unreachable())
    expect((await getCard('SOR', '010')).Name).toBe('Cached Vader')
  })

  it('prefers the bundled set to the network', async () => {
    const fetchMock = served({ Set: 'SOR', Number: '010', Name: 'Served Vader', Type: 'Leader' })
    vi.stubGlobal('fetch', fetchMock)

    expect((await getCard('SOR', '010')).Name).toBe('Darth Vader')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * The cache holds what the network served. A bundled card is already on the device, and copying it
   * into the cache would pin that copy ahead of the snapshot a later release ships.
   */
  it('does not copy a bundled card into the cache', async () => {
    vi.stubGlobal('fetch', unreachable())
    await getCard('SOR', '010')
    expect(await db.cards.count()).toBe(0)
  })

  it('asks the network for a printing the bundled set does not hold, and caches it', async () => {
    const hyperspace = { Set: 'SOR', Number: '280', Name: 'Darth Vader', Type: 'Leader', VariantType: 'Hyperspace' }
    const fetchMock = served(hyperspace)
    vi.stubGlobal('fetch', fetchMock)

    expect(await getCard('SOR', '280')).toEqual(hyperspace)
    expect(fetchMock).toHaveBeenCalledWith(`${SWU_DB_API}/cards/SOR/280`)
    expect(await db.cards.get('SOR_280')).toBeDefined()
  })
})

describe('a whole set with the card API unreachable', () => {
  it('is here for every set the setup panel lists, so no generator waits on an import', async () => {
    vi.stubGlobal('fetch', unreachable())
    for (const code of SET_CODES) {
      expect(await cachedSetCount(code), code).toBe(printedCardCount(code))
      expect(await cachedSetCards(code), code).toHaveLength(printedCardCount(code)!)
    }
  })

  it('reads the same whatever case the set is named in', async () => {
    expect(await cachedSetCount('sor')).toBe(SOR.length)
  })

  it('is empty for a set that is neither cached nor bundled', async () => {
    expect(await cachedSetCards('ZZZ')).toEqual([])
    expect(await cachedSetCount('ZZZ')).toBe(0)
  })

  it('takes a cached card over the bundled one, and adds a cached printing the bundled set does not hold', async () => {
    await db.cards.put({ id: 'SOR_010', json: { Set: 'SOR', Number: '010', Name: 'Cached Vader', Type: 'Leader' }, fetchedAt: 1 })
    await db.cards.put({ id: 'SOR_280', json: { Set: 'SOR', Number: '280', Name: 'Darth Vader', Type: 'Leader', VariantType: 'Hyperspace' }, fetchedAt: 1 })
    await db.cards.put({ id: 'ASH_011', json: { Set: 'ASH', Number: '011', Name: 'Cad Bane', Type: 'Leader' }, fetchedAt: 1 })

    const cards = await cachedSetCards('SOR')

    expect(cards).toHaveLength(SOR.length + 1)
    expect(cards.filter(c => c.Number === '010').map(c => c.Name)).toEqual(['Cached Vader'])
    expect(cards.some(c => c.Number === '280')).toBe(true)
    expect(cards.every(c => c.Set === 'SOR')).toBe(true)
    expect(await cachedSetCount('SOR')).toBe(SOR.length + 1)
  })

  it('is the bundled set when the cache cannot be read', async () => {
    vi.spyOn(db.cards, 'where').mockImplementation(() => { throw new Error('VersionError') })
    expect(await cachedSetCards('SOR')).toHaveLength(SOR.length)
  })
})

/**
 * Canonicalising a printing needs the set's Normal listing, which is what a bundled set is. Without
 * it a first visit with the API down reports every card of every set but ASH as a printing that
 * could not be identified, though each is a Normal printing already.
 */
describe('printings with the card API unreachable', () => {
  it('resolve within a bundled set, reporting nothing', async () => {
    const fetchMock = unreachable()
    vi.stubGlobal('fetch', fetchMock)
    const normal = SOR.find(c => c.Number === '059')!
    const hyperspace = { ...normal, Number: '323', VariantType: 'Hyperspace' } as SwuCard

    const { map, unresolved } = await canonicaliseCards([normal, hyperspace])

    expect(map.get('SOR_059')).toBe('SOR_059')
    expect(map.get('SOR_323')).toBe('SOR_059')
    expect(unresolved).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still use the cache first, so a visitor with a cached set resolves as before', async () => {
    vi.stubGlobal('fetch', unreachable())
    const renumbered = { Set: 'SOR', Number: '900', Name: '2-1B Surgical Droid', Type: 'Unit', VariantType: 'Normal' } as SwuCard
    await db.cards.put({ id: 'SOR_900', json: renumbered, fetchedAt: 1 })
    const hyperspace = { ...renumbered, Number: '323', VariantType: 'Hyperspace' } as SwuCard

    expect((await canonicaliseCards([hyperspace])).map.get('SOR_323')).toBe('SOR_900')
  })
})

describe('syncing a deck list with the card API unreachable', () => {
  it('counts the bundled cards as here and fetches nothing for them', async () => {
    const fetchMock = unreachable()
    vi.stubGlobal('fetch', fetchMock)

    const result = await syncCatalogue([{ set: 'SOR', number: '010' }, { set: 'SOR', number: '059' }])

    expect(result).toEqual({ hydrated: 2, skipped: 0, failed: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
