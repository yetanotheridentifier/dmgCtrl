import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { db } from '../data/db'
import { ensureThumb } from '../data/thumbnails'

const CARD = {
  Set: 'SOR',
  Number: '010',
  Name: 'Darth Vader',
  Type: 'Unit',
  FrontArt: 'https://cdn.swu-db.com/images/cards/SOR/010.png',
}

function mockImageFetch(bytes: number[], type = 'image/webp') {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer),
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? type : null) },
  })
}

describe('ensureThumb', () => {
  beforeEach(async () => {
    await db.cards.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the card art and stores thumbnail bytes on the record', async () => {
    await db.cards.put({ id: 'SOR_010', json: CARD, fetchedAt: 1 })
    const fetchMock = mockImageFetch([9, 8, 7])
    vi.stubGlobal('fetch', fetchMock)

    const ok = await ensureThumb('SOR', '010')

    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const record = await db.cards.get('SOR_010')
    expect(record!.thumb).toBeDefined()
    expect(record!.thumb!.type).toBe('image/webp')
    expect(new Uint8Array(record!.thumb!.buf)).toEqual(new Uint8Array([9, 8, 7]))
  })

  it('requests the FrontArt URL from the cached card JSON', async () => {
    await db.cards.put({ id: 'SOR_010', json: CARD, fetchedAt: 1 })
    const fetchMock = mockImageFetch([1])
    vi.stubGlobal('fetch', fetchMock)

    await ensureThumb('SOR', '010')

    expect(fetchMock.mock.calls[0][0]).toBe(CARD.FrontArt)
  })

  it('no-ops without fetching when a thumbnail is already stored', async () => {
    await db.cards.put({
      id: 'SOR_010',
      json: CARD,
      thumb: { buf: new Uint8Array([1]).buffer, type: 'image/webp' },
      fetchedAt: 1,
    })
    const fetchMock = mockImageFetch([2])
    vi.stubGlobal('fetch', fetchMock)

    const ok = await ensureThumb('SOR', '010')

    expect(ok).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns false without fetching when the card JSON is not cached yet', async () => {
    const fetchMock = mockImageFetch([1])
    vi.stubGlobal('fetch', fetchMock)

    const ok = await ensureThumb('SOR', '404')

    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows network failures and leaves the record unchanged', async () => {
    await db.cards.put({ id: 'SOR_010', json: CARD, fetchedAt: 1 })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const ok = await ensureThumb('SOR', '010')

    expect(ok).toBe(false)
    const record = await db.cards.get('SOR_010')
    expect(record!.thumb).toBeUndefined()
  })

  it('returns false when the card has no FrontArt URL', async () => {
    await db.cards.put({ id: 'SOR_011', json: { Name: 'No Art' }, fetchedAt: 1 })
    const fetchMock = mockImageFetch([1])
    vi.stubGlobal('fetch', fetchMock)

    const ok = await ensureThumb('SOR', '011')

    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
