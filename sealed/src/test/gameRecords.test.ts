import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../data/db'
import { saveGameRecord, listGameRecords, clearGameRecords } from '../data/gameRecords'
import { state } from './helpers/engineFixtures'

describe('game records', () => {
  beforeEach(async () => {
    await db.games.clear()
  })

  it('saves a completed game and lists it back', async () => {
    const initial = state()
    const final = { ...state(), winner: 'player' as const }

    const saved = await saveGameRecord({
      playerDeckName: 'Vader Aggro',
      opponentDeckName: 'Vader Aggro',
      winner: 'player',
      startedAt: 1000,
      endedAt: 2000,
      initialState: initial,
      moves: [
        { by: 'player', action: { type: 'pass' } },
        { by: 'opponent', action: { type: 'pass' } },
      ],
      finalState: final,
    })

    const records = await listGameRecords()
    expect(records).toHaveLength(1)
    expect(records[0].id).toBe(saved.id)
    expect(records[0].winner).toBe('player')
    expect(records[0].moves).toHaveLength(2)
    expect(records[0].initialState.round).toBe(2)
    expect(records[0].finalState.winner).toBe('player')
  })

  it('assigns distinct ids and lists newest first', async () => {
    const base = {
      playerDeckName: 'A',
      opponentDeckName: 'B',
      winner: 'player' as const,
      initialState: state(),
      moves: [],
      finalState: state(),
    }
    const first = await saveGameRecord({ ...base, startedAt: 1, endedAt: 10 })
    const second = await saveGameRecord({ ...base, startedAt: 2, endedAt: 20 })

    expect(first.id).not.toBe(second.id)
    const records = await listGameRecords()
    expect(records.map(r => r.id)).toEqual([second.id, first.id])
  })

  it('keeps the cards table intact across the schema upgrade', async () => {
    await db.cards.put({ id: 'TST_X', json: { Name: 'X' }, fetchedAt: 1 })
    expect(await db.cards.get('TST_X')).toBeDefined()
  })

  /**
   * Console escape hatch for wiping training data — reachable as `__sealedClearGames()`
   * alongside `__sealedLogs()`. Records written before the AI became state-seeded (#366)
   * do not replay faithfully, so there has to be a supported way to start clean.
   */
  describe('clearGameRecords', () => {
    const base = {
      playerDeckName: 'A',
      opponentDeckName: 'B',
      winner: 'player' as const,
      startedAt: 1,
      endedAt: 10,
      initialState: state(),
      moves: [],
      finalState: state(),
    }

    it('removes every record and reports how many it deleted', async () => {
      await saveGameRecord(base)
      await saveGameRecord(base)

      expect(await clearGameRecords()).toBe(2)
      expect(await listGameRecords()).toHaveLength(0)
    })

    it('is safe to run when there is nothing to clear', async () => {
      expect(await clearGameRecords()).toBe(0)
    })

    it('leaves the card cache alone — decks must not need re-hydrating', async () => {
      await db.cards.put({ id: 'TST_KEEP', json: { Name: 'Keep' }, fetchedAt: 1 })
      await saveGameRecord(base)

      await clearGameRecords()

      expect(await db.cards.get('TST_KEEP')).toBeDefined()
    })

    it('is exposed on window for console use', () => {
      expect(typeof window.__sealedClearGames).toBe('function')
    })
  })
})
