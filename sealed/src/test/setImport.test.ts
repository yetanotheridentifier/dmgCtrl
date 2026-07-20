import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { db } from '../data/db'
import { importSet, cachedSetCount } from '../data/setImport'
import { getCard, SWU_DB_API } from '../data/cards'

const SEARCH_PAYLOAD = {
  total_cards: 3,
  data: [
    { Set: 'ASH', Number: '011', Name: 'Cad Bane', Type: 'Leader', VariantType: 'Normal', Cost: '6' },
    { Set: 'ASH', Number: '020', Name: 'Nevarro City, Restored', Type: 'Base', VariantType: 'Normal', HP: '30' },
    { Set: 'ASH', Number: '311', Name: 'Cad Bane', Type: 'Leader', VariantType: 'Hyperspace', Cost: '6' },
  ],
}

function mockSearchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(SEARCH_PAYLOAD),
  })
}

describe('importSet', () => {
  beforeEach(async () => {
    await db.cards.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the set via search and caches every Normal-variant card', async () => {
    const fetchMock = mockSearchOk()
    vi.stubGlobal('fetch', fetchMock)

    const result = await importSet('ash')

    expect(fetchMock).toHaveBeenCalledWith(`${SWU_DB_API}/cards/search?q=set:ASH`)
    expect(result).toEqual({ cached: 2, total: 2 })
    expect(await db.cards.get('ASH_011')).toBeDefined()
    expect(await db.cards.get('ASH_020')).toBeDefined()
    expect(await db.cards.get('ASH_311')).toBeUndefined() // variant filtered out
  })

  it('reports progress per cached card', async () => {
    vi.stubGlobal('fetch', mockSearchOk())
    const seen: [number, number][] = []

    await importSet('ASH', { onProgress: (done, total) => seen.push([done, total]) })

    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ])
  })

  it('a cached base is then served cache-first — no more detail-endpoint 502s', async () => {
    vi.stubGlobal('fetch', mockSearchOk())
    await importSet('ASH')

    // Any further network call would blow up — the cache must answer.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network must not be hit')))
    const base = await getCard('ASH', '020')
    expect(base.Name).toBe('Nevarro City, Restored')
  })

  it('throws naming the set on an error status, caching nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }))

    await expect(importSet('ASH')).rejects.toThrow(/ASH.*502/)
    expect(await db.cards.count()).toBe(0)
  })

  it('throws naming the set when the fetch rejects (CORS/offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(importSet('ASH')).rejects.toThrow(/ASH/)
  })
})

describe('cachedSetCount', () => {
  beforeEach(async () => {
    await db.cards.clear()
  })

  it('counts only the named set', async () => {
    await db.cards.put({ id: 'ASH_001', json: {}, fetchedAt: 1 })
    await db.cards.put({ id: 'ASH_002', json: {}, fetchedAt: 1 })
    await db.cards.put({ id: 'SOR_001', json: {}, fetchedAt: 1 })

    expect(await cachedSetCount('ash')).toBe(2)
    expect(await cachedSetCount('SOR')).toBe(1)
    expect(await cachedSetCount('JTL')).toBe(0)
  })
})
