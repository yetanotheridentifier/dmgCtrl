// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { db } from '../data/db'
import { getCard, SWU_DB_API } from '../data/cards'
import { cachedSetCount } from '../data/setImport'
import { bundledSetCards } from '../data/bundledSets'

/**
 * A set snapshot is a file of its own, requested when its set is first needed, so it can fail to
 * arrive when the page itself did. That has to read as a set that is not bundled, so the lookups go
 * on to the network as they always did, and it must not stick: the next ask tries the file again.
 */
let attempts = 0
vi.mock('./fixtures/ibhSet.json', () => {
  attempts++
  throw new Error('Failed to fetch dynamically imported module')
})

beforeEach(async () => {
  await db.cards.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a set snapshot that cannot be loaded', () => {
  it('reads as a set with nothing bundled, and is asked for again next time', async () => {
    expect(await bundledSetCards('IBH')).toEqual([])
    expect(await cachedSetCount('IBH')).toBe(0)
    expect(attempts).toBeGreaterThan(1)
  })

  it('leaves the card to the network', async () => {
    const served = { Set: 'IBH', Number: '52', Name: 'Watch This', Type: 'Event' }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(served) })
    vi.stubGlobal('fetch', fetchMock)

    expect(await getCard('IBH', '52')).toEqual(served)
    expect(fetchMock).toHaveBeenCalledWith(`${SWU_DB_API}/cards/IBH/52`)
  })

  it('does not affect a set whose snapshot loads', async () => {
    expect((await bundledSetCards('SOR')).length).toBeGreaterThan(200)
  })
})
