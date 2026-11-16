// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import Dexie from 'dexie'
import { db } from '../data/db'
import { PENDING_KEY } from '../data/collectionPending'
import { playedRecord } from './helpers/playedRecord'

/**
 * A device that saved games before deliveries were marked. The sender then forgot a game once it
 * was settled, so a game finished while sharing that is no longer owed an attempt is the only sign
 * of a delivery those records have, and the upgrade reads it as one. A game still owed an attempt,
 * and one that was never shared, are left unmarked.
 */
describe('upgrading the games saved before deliveries were marked', () => {
  it('marks a shared game that is no longer waiting as delivered, and nothing else', async () => {
    const PLAYED = playedRecord(7)
    const old = new Dexie('dmgctrl-sealed')
    old.version(1).stores({ cards: 'id' })
    old.version(2).stores({ cards: 'id', games: 'id, endedAt' })
    await old.table('games').bulkPut([
      { ...PLAYED, id: 'settled', consentedAtFinish: true },
      { ...PLAYED, id: 'waiting', consentedAtFinish: true },
      { ...PLAYED, id: 'private' },
    ])
    old.close()
    localStorage.setItem(PENDING_KEY, JSON.stringify(['waiting']))

    const games = await db.games.toArray()

    expect(db.verno).toBe(3)
    expect(Object.fromEntries(games.map(g => [g.id, g.delivered]))).toEqual({ settled: true, waiting: undefined, private: undefined })
    expect(games.every(g => 'moves' in g)).toBe(true)
  })
})
