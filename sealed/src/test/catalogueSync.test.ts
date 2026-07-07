import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { db } from '../data/db'
import { syncCatalogue } from '../data/catalogueSync'
import { SWU_DB_API } from '../data/cards'

function makeCard(set: string, number: string) {
  return {
    Set: set,
    Number: number,
    Name: `Card ${set} ${number}`,
    Type: 'Unit',
    FrontArt: `https://cdn.swu-db.com/images/cards/${set}/${number}.png`,
  }
}

/** fetch mock that serves card JSON for API URLs and bytes for CDN URLs. */
function mockNetwork(failFor: string[] = []) {
  return vi.fn().mockImplementation((url: string) => {
    const failed = failFor.some(f => url.includes(f))
    if (failed) return Promise.resolve({ ok: false, status: 500 })
    // Art requests also route through the worker now (#311) — match them first.
    if (url.includes('/art/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer),
        headers: { get: () => 'image/webp' },
      })
    }
    if (url.startsWith(SWU_DB_API)) {
      const [, set, number] = url.slice(SWU_DB_API.length).match(/\/cards\/(\w+)\/(\w+)/)!
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeCard(set, number)),
      })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer),
      headers: { get: () => 'image/webp' },
    })
  })
}

describe('syncCatalogue', () => {
  beforeEach(async () => {
    await db.cards.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hydrates every uncached card and its thumbnail', async () => {
    vi.stubGlobal('fetch', mockNetwork())

    const result = await syncCatalogue([
      { set: 'SOR', number: '010' },
      { set: 'SOR', number: '011' },
    ])

    expect(result).toEqual({ hydrated: 2, skipped: 0, failed: 0 })
    const a = await db.cards.get('SOR_010')
    const b = await db.cards.get('SOR_011')
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(a!.thumb).toBeDefined()
    expect(b!.thumb).toBeDefined()
  })

  it('skips cards whose JSON is already cached', async () => {
    await db.cards.put({
      id: 'SOR_010',
      json: makeCard('SOR', '010'),
      thumb: { buf: new Uint8Array([1]).buffer, type: 'image/webp' },
      fetchedAt: 1,
    })
    const fetchMock = mockNetwork()
    vi.stubGlobal('fetch', fetchMock)

    const result = await syncCatalogue([
      { set: 'SOR', number: '010' },
      { set: 'SOR', number: '011' },
    ])

    expect(result).toEqual({ hydrated: 1, skipped: 1, failed: 0 })
    const apiCalls = fetchMock.mock.calls.filter(c => String(c[0]).startsWith(SWU_DB_API) && !String(c[0]).includes('/art/'))
    expect(apiCalls).toHaveLength(1)
    expect(String(apiCalls[0][0])).toContain('/cards/SOR/011')
  })

  it('continues past failures and counts them', async () => {
    vi.stubGlobal('fetch', mockNetwork(['/cards/SOR/010']))

    const result = await syncCatalogue([
      { set: 'SOR', number: '010' },
      { set: 'SOR', number: '011' },
    ])

    expect(result).toEqual({ hydrated: 1, skipped: 0, failed: 1 })
    expect(await db.cards.get('SOR_010')).toBeUndefined()
    expect(await db.cards.get('SOR_011')).toBeDefined()
  })

  it('fetches in the order given (caller passes priority order)', async () => {
    const fetchMock = mockNetwork()
    vi.stubGlobal('fetch', fetchMock)

    await syncCatalogue([
      { set: 'JTL', number: '050' },
      { set: 'SOR', number: '001' },
    ])

    const apiCalls = fetchMock.mock.calls
      .map(c => String(c[0]))
      .filter(u => u.startsWith(SWU_DB_API) && !u.includes('/art/'))
    expect(apiCalls[0]).toContain('/cards/JTL/050')
    expect(apiCalls[1]).toContain('/cards/SOR/001')
  })

  it('deduplicates repeated refs (multi-copy deck lists)', async () => {
    const fetchMock = mockNetwork()
    vi.stubGlobal('fetch', fetchMock)

    const result = await syncCatalogue([
      { set: 'SOR', number: '010' },
      { set: 'SOR', number: '010' },
      { set: 'SOR', number: '010' },
    ])

    expect(result.hydrated).toBe(1)
    const apiCalls = fetchMock.mock.calls.filter(c => String(c[0]).startsWith(SWU_DB_API) && !String(c[0]).includes('/art/'))
    expect(apiCalls).toHaveLength(1)
  })

  it('reports progress per processed card', async () => {
    vi.stubGlobal('fetch', mockNetwork())
    const seen: [number, number][] = []

    await syncCatalogue(
      [
        { set: 'SOR', number: '010' },
        { set: 'SOR', number: '011' },
      ],
      { onProgress: (done, total) => seen.push([done, total]) },
    )

    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ])
  })
})
