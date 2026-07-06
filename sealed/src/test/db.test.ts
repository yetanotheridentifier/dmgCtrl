import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../data/db'
import type { CardRecord } from '../data/db'

describe('sealed card database (Dexie)', () => {
  beforeEach(async () => {
    await db.cards.clear()
  })

  it('exposes a cards table', () => {
    expect(db.tables.map(t => t.name)).toContain('cards')
  })

  it('round-trips a card record by id', async () => {
    const record: CardRecord = {
      id: 'SOR_010',
      json: { Name: 'Darth Vader' },
      fetchedAt: 1751700000000,
    }
    await db.cards.put(record)
    const loaded = await db.cards.get('SOR_010')
    expect(loaded).toBeDefined()
    expect(loaded!.id).toBe('SOR_010')
    expect(loaded!.json).toEqual({ Name: 'Darth Vader' })
    expect(loaded!.fetchedAt).toBe(1751700000000)
  })

  it('returns undefined for a card that has not been cached', async () => {
    const loaded = await db.cards.get('SOR_999')
    expect(loaded).toBeUndefined()
  })

  it('stores thumbnail bytes alongside the card JSON', async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer
    await db.cards.put({ id: 'SOR_020', json: {}, thumb: { buf, type: 'image/webp' }, fetchedAt: 1 })
    const loaded = await db.cards.get('SOR_020')
    expect(loaded!.thumb).toBeDefined()
    expect(loaded!.thumb!.type).toBe('image/webp')
    expect(new Uint8Array(loaded!.thumb!.buf)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('overwrites an existing record on put with the same id', async () => {
    await db.cards.put({ id: 'SOR_030', json: { Name: 'v1' }, fetchedAt: 1 })
    await db.cards.put({ id: 'SOR_030', json: { Name: 'v2' }, fetchedAt: 2 })
    const loaded = await db.cards.get('SOR_030')
    expect(loaded!.json).toEqual({ Name: 'v2' })
    expect(await db.cards.count()).toBe(1)
  })
})
