import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../data/db'
import { saveGameRecord, listGameRecords } from '../data/gameRecords'
import { state } from './helpers/engineFixtures'

describe('game records (T2.7 / T4.5)', () => {
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
})
