// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

  /**
   * Where a record came from is written with it, because none of it can be worked out afterwards:
   * which build's rules and AI produced the moves, which AI the opponent was, and which seat the
   * person held. None is an indexed key, so the store's schema is unchanged.
   */
  it('keeps the provenance it was saved with', async () => {
    await saveGameRecord({
      playerDeckName: 'A',
      opponentDeckName: 'B',
      winner: 'opponent',
      startedAt: 1,
      endedAt: 10,
      initialState: state(),
      moves: [],
      finalState: state(),
      build: { release: '412', commitId: 'abc1234' },
      opponentAi: 'beam-reply',
      humanSeat: 'player',
    })

    const [record] = await listGameRecords()
    expect(record.build).toEqual({ release: '412', commitId: 'abc1234' })
    expect(record.opponentAi).toBe('beam-reply')
    expect(record.humanSeat).toBe('player')
    expect(db.verno).toBe(2)
  })

  /**
   * Console route for getting saved games off the device, reachable as `__sealedExportGames()`
   * beside `__sealedClearGames()`. It hands the browser one JSON file to save.
   */
  describe('exporting from the console', () => {
    const base = {
      playerDeckName: 'A',
      opponentDeckName: 'B',
      winner: 'player' as const,
      startedAt: 1,
      endedAt: 10,
      initialState: state(),
      moves: [{ by: 'player' as const, action: { type: 'pass' as const } }],
      finalState: state(),
    }

    /** Stand in for the browser's download: capture what the helper hands it. */
    function captureDownload() {
      const downloads: { name: string; blob: Blob }[] = []
      let pending: Blob | null = null
      // jsdom has no object URLs, so these are put there and taken away again.
      URL.createObjectURL = (blob: Blob | MediaSource) => { pending = blob as Blob; return 'blob:export' }
      URL.revokeObjectURL = () => {}
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push({ name: this.download, blob: pending! })
      })
      return downloads
    }

    const objectUrls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    afterEach(() => {
      vi.restoreAllMocks()
      URL.createObjectURL = objectUrls.create
      URL.revokeObjectURL = objectUrls.revoke
    })

    it('is exposed on window for console use', () => {
      expect(typeof window.__sealedExportGames).toBe('function')
    })

    it('downloads every saved game as one JSON file and reports how many', async () => {
      const downloads = captureDownload()
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      await saveGameRecord(base)
      await saveGameRecord(base)

      expect(await window.__sealedExportGames()).toBe(2)

      expect(downloads).toHaveLength(1)
      expect(downloads[0].name).toMatch(/^dmgctrl-sealed-games-.*\.json$/)
      expect(downloads[0].blob.type).toBe('application/json')
      const file = JSON.parse(await downloads[0].blob.text())
      expect(file.formatVersion).toBe(1)
      expect(file.records).toHaveLength(2)
      expect(file.records[0].moves).toEqual(base.moves)
      expect(file.records[0].initialState.cards).toBeUndefined()
      expect(file.records[0].finalState).toBeUndefined()
      expect(info).toHaveBeenCalledWith('[sealed] exported 2 game records')
    })

    it('downloads nothing when there are no games, and says so', async () => {
      const downloads = captureDownload()
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})

      expect(await window.__sealedExportGames()).toBe(0)

      expect(downloads).toHaveLength(0)
      expect(info).toHaveBeenCalledWith('[sealed] exported 0 game records')
    })
  })
})
