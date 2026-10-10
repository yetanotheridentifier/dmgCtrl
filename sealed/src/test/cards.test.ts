// @vitest-environment jsdom
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

// As served by worker.dmgctrl.app/cards/IBH/52: the number comes back unpadded.
const WATCH_THIS = {
  Set: 'IBH',
  Number: '52',
  Name: 'Watch This',
  Type: 'Event',
  Aspects: ['Cunning'],
  Traits: ['GAMBIT'],
  Cost: '6',
  FrontText: "Return a non-leader unit that costs 6 or less to its owner's hand. Exhaust each other enemy unit in the same arena.",
  DoubleSided: false,
  Unique: false,
  VariantType: 'Normal',
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

  // The reported load: a deck list names IBH_052, and SWUDB files that set's cards unpadded, so
  // /cards/IBH/052 is a 404 while /cards/IBH/52 is the card (the same holds for TS26).
  it('retries a 404 without the leading zeros, for a set whose numbers are served unpadded', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url === `${SWU_DB_API}/cards/IBH/52`
          ? { ok: true, status: 200, json: () => Promise.resolve(WATCH_THIS) }
          : { ok: false, status: 404, json: () => Promise.resolve({ error: 'No card found for that set and card number.' }) },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const card = await getCard('IBH', '052')

    expect(card.Name).toBe('Watch This')
    expect(card.Number).toBe('52')
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([`${SWU_DB_API}/cards/IBH/052`, `${SWU_DB_API}/cards/IBH/52`])

    // Cached under the id the deck asked for, so the next load is local.
    fetchMock.mockClear()
    expect((await getCard('IBH', '052')).Name).toBe('Watch This')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not retry an error that is not a 404, or a number with no leading zero', async () => {
    const down = vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({ cards: [] }) })
    vi.stubGlobal('fetch', down)
    await expect(getCard('IBH', '052')).rejects.toThrow(/IBH_052/)
    expect(down.mock.calls.map(c => c[0])).not.toContain(`${SWU_DB_API}/cards/IBH/52`)

    const missing = vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({ cards: [] }) })
    vi.stubGlobal('fetch', missing)
    await expect(getCard('IBH', '999')).rejects.toThrow(/IBH_999/)
    expect(missing.mock.calls.filter(c => String(c[0]).startsWith(SWU_DB_API))).toHaveLength(1)
  })

  it('throws an error naming the card when both sources fail, caching nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    await expect(getCard('SOR', '999')).rejects.toThrow(/SOR_999/)
    expect(await db.cards.get('SOR_999')).toBeUndefined()
  })
})

describe('getCard — IndexedDB resilience (crossed schema versions, private mode)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('still hydrates from the network when the cache read fails', async () => {
    vi.spyOn(db.cards, 'get').mockRejectedValue(new Error('VersionError: requested version is lower'))
    vi.stubGlobal('fetch', mockFetchOk(VADER))

    const card = await getCard('SOR', '010')
    expect(card.Name).toBe('Darth Vader')
  })

  it('still returns the card when the cache write fails', async () => {
    vi.spyOn(db.cards, 'get').mockResolvedValue(undefined)
    vi.spyOn(db.cards, 'put').mockRejectedValue(new Error('QuotaExceededError'))
    vi.stubGlobal('fetch', mockFetchOk(VADER))

    const card = await getCard('SOR', '010')
    expect(card.Name).toBe('Darth Vader')
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

  // In a browser, a CORS-blocked response REJECTS the fetch promise ("TypeError:
  // Failed to fetch") — it never yields an ok:false response. Cloudflare's 1101
  // error page (worker exception) carries no CORS headers, so this is exactly
  // what upstream 502s looked like to the browser.
  it('falls back when the primary fetch rejects outright (CORS/network)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith(SWU_DB_API)) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SWUAPI_BASE_PAGE) })
    }))

    const card = await getCard('ASH', '020')
    expect(card.Name).toBe('Shadowed Undercity')
  })

  it('names the card when the primary rejects and the fallback misses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith(SWU_DB_API)) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cards: [], pagination: { next_cursor: null } }) })
    }))

    await expect(getCard('ASH', '999')).rejects.toThrow(/ASH_999/)
  })

  it('treats a rejecting fallback fetch as a miss rather than crashing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith(SWU_DB_API)) return Promise.resolve({ ok: false, status: 502 })
      return Promise.reject(new TypeError('Failed to fetch'))
    }))

    await expect(getCard('ASH', '020')).rejects.toThrow(/ASH_020/)
  })
})
