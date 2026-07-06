import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { db } from '../data/db'
import { getCard, cardId, SWU_DB_API } from '../data/cards'

const VADER = {
  Set: 'SOR',
  Number: '010',
  Name: 'Darth Vader',
  Subtitle: 'Dark Lord of the Sith',
  Type: 'Unit',
  Arenas: ['Ground'],
  Cost: '7',
  Power: '5',
  HP: '7',
  Aspects: ['Aggression', 'Villainy'],
  Traits: ['FORCE', 'IMPERIAL', 'SITH'],
  FrontArt: 'https://cdn.swu-db.com/images/cards/SOR/010.png',
}

function mockFetchOk(json: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(json),
  })
}

describe('SWU_DB_API', () => {
  it('routes through the dmgCtrl worker (api.swu-db.com sends no CORS headers)', () => {
    expect(SWU_DB_API).toBe('https://worker.dmgctrl.app')
  })
})

describe('cardId', () => {
  it('builds SET_NUMBER ids, uppercasing the set', () => {
    expect(cardId('sor', '010')).toBe('SOR_010')
    expect(cardId('JTL', '050')).toBe('JTL_050')
  })
})

describe('getCard hydration', () => {
  beforeEach(async () => {
    await db.cards.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches card detail from SWUDB on first lookup', async () => {
    const fetchMock = mockFetchOk(VADER)
    vi.stubGlobal('fetch', fetchMock)

    const card = await getCard('SOR', '010')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${SWU_DB_API}/cards/SOR/010`)
    expect(card.Name).toBe('Darth Vader')
  })

  it('writes the fetched card to IndexedDB', async () => {
    vi.stubGlobal('fetch', mockFetchOk(VADER))

    await getCard('SOR', '010')

    const record = await db.cards.get('SOR_010')
    expect(record).toBeDefined()
    expect((record!.json as { Name: string }).Name).toBe('Darth Vader')
    expect(record!.fetchedAt).toBeGreaterThan(0)
  })

  it('reads local-first: no network call when the card is already cached', async () => {
    await db.cards.put({ id: 'SOR_010', json: VADER, fetchedAt: 1 })
    const fetchMock = mockFetchOk(VADER)
    vi.stubGlobal('fetch', fetchMock)

    const card = await getCard('SOR', '010')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(card.Name).toBe('Darth Vader')
  })

  it('normalises lowercase set codes to the same cache entry', async () => {
    await db.cards.put({ id: 'SOR_010', json: VADER, fetchedAt: 1 })
    const fetchMock = mockFetchOk(VADER)
    vi.stubGlobal('fetch', fetchMock)

    await getCard('sor', '010')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws an error naming the card when both sources fail, caching nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    await expect(getCard('SOR', '999')).rejects.toThrow(/SOR_999/)
    expect(await db.cards.get('SOR_999')).toBeUndefined()
  })
})

describe('getCard — swuapi fallback (SWUDB card-detail 502s on some bases)', () => {
  const SWUAPI_BASE_PAGE = {
    cards: [
      {
        collector_number: 'ASH_020',
        name: 'Shadowed Undercity',
        subtitle: null,
        type: 'Base',
        aspects: ['Cunning'],
        traits: [],
        arena: null,
        cost: null,
        power: null,
        hp: 30,
        front_text: null,
        double_sided: false,
        rarity: 'Common',
        unique_flag: false,
        variant_type: 'Standard',
        front_image_url: 'https://cdn.starwarsunlimited.com/card_ASH_020.png',
      },
    ],
    pagination: { next_cursor: null },
  }

  beforeEach(async () => {
    await db.cards.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockPrimaryDownFallbackUp() {
    return vi.fn().mockImplementation((url: string) => {
      if (url.startsWith(SWU_DB_API)) {
        return Promise.resolve({ ok: false, status: 502 })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(SWUAPI_BASE_PAGE),
      })
    })
  }

  it('falls back to the swuapi base list and maps the card to SWUDB shape', async () => {
    vi.stubGlobal('fetch', mockPrimaryDownFallbackUp())

    const card = await getCard('ASH', '020')

    expect(card).toMatchObject({
      Set: 'ASH',
      Number: '020',
      Name: 'Shadowed Undercity',
      Type: 'Base',
      HP: '30',
      Aspects: ['Cunning'],
      FrontArt: 'https://cdn.starwarsunlimited.com/card_ASH_020.png',
    })
  })

  it('caches the fallback result like a primary fetch', async () => {
    vi.stubGlobal('fetch', mockPrimaryDownFallbackUp())

    await getCard('ASH', '020')

    const record = await db.cards.get('ASH_020')
    expect(record).toBeDefined()
    expect((record!.json as { Name: string }).Name).toBe('Shadowed Undercity')
  })

  it('pages through the base list until it finds the card', async () => {
    const page1 = {
      cards: [{ ...SWUAPI_BASE_PAGE.cards[0], collector_number: 'ASH_019', name: 'Other Base' }],
      pagination: { next_cursor: 'abc' },
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith(SWU_DB_API)) return Promise.resolve({ ok: false, status: 502 })
      if (url.includes('after=abc')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SWUAPI_BASE_PAGE) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(page1) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const card = await getCard('ASH', '020')
    expect(card.Name).toBe('Shadowed Undercity')
  })

  it('throws with the card id and upstream status when the fallback misses too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith(SWU_DB_API)) return Promise.resolve({ ok: false, status: 502 })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cards: [], pagination: { next_cursor: null } }) })
    }))

    await expect(getCard('ASH', '999')).rejects.toThrow(/ASH_999.*502/)
  })
})
