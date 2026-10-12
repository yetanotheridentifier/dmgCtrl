// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { COLLECTION_URL, MAX_PENDING, PENDING_KEY, retryPendingCollection, sendForCollection } from '../data/collectionSend'
import { recordForCollection } from '../data/collection'
import { SWU_DB_API } from '../data/cards'
import { db } from '../data/db'
import { defaultSettings, saveSettings } from '../data/settingsStore'
import type { ShareGames } from '../data/settingsStore'
import type { GameRecord } from '../data/gameRecords'
import { isDev } from '../env'
import { playedRecord } from './helpers/playedRecord'

vi.mock('../env', () => ({ isDev: vi.fn(() => false) }))
const mockIsDev = vi.mocked(isDev)

/**
 * The sender is the only code that puts a game on the network. These pin that it sends exactly what
 * the gate returns and nothing when the gate returns nothing, that a failure is silent and bounded,
 * and that a game it could not deliver is offered again later, once, without a storm.
 */

const answer = (shareGames: ShareGames) => saveSettings({ ...defaultSettings(), shareGames })

/** A record finished while the player was opted in. One game is played and reused: the id tells them apart. */
const PLAYED = playedRecord(7)
const agreedRecord = (id = 'game-a'): GameRecord => ({ ...PLAYED, id, consentedAtFinish: true })

const pending = (): string[] => JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as string[]

const replies = (status: number) => vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status })

function stubFetch(mock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('sending a finished game for collection', () => {
  beforeEach(async () => {
    localStorage.clear()
    await db.games.clear()
    mockIsDev.mockReturnValue(false)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts to the card Worker, on the path it collects games at', () => {
    expect(COLLECTION_URL).toBe(`${SWU_DB_API}/records`)
  })

  describe('without the player’s agreement', () => {
    it.each([
      ['has not been asked', undefined],
      ['said no', 'no'],
    ] as const)('makes no network call when the player %s', async (_, shareGames) => {
      if (shareGames) answer(shareGames)
      const fetchMock = stubFetch(replies(204))

      await sendForCollection(agreedRecord())

      expect(fetchMock).not.toHaveBeenCalled()
      expect(pending()).toEqual([])
    })

    it('never sends a game finished before the player opted in', async () => {
      answer('yes')
      const fetchMock = stubFetch(replies(204))

      await sendForCollection({ ...PLAYED, id: 'game-old' })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(pending()).toEqual([])
    })
  })

  describe('once the player has opted in', () => {
    beforeEach(() => answer('yes'))

    it('posts exactly what the gate returns, and nothing else', async () => {
      const fetchMock = stubFetch(replies(204))
      const record = agreedRecord()

      await sendForCollection(record)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(COLLECTION_URL)
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(init.body).toBe(JSON.stringify(recordForCollection(record)))
      // The record id and the deck names stay on the device.
      expect(init.body).not.toContain(record.id)
      expect(init.body).not.toContain('Mine')
      expect(init.body).not.toContain('Theirs')
    })

    it('sends no cookies and no referrer with it', async () => {
      const fetchMock = stubFetch(replies(204))

      await sendForCollection(agreedRecord())

      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect(init.credentials).toBe('omit')
      expect(init.referrerPolicy).toBe('no-referrer')
    })

    it('remembers nothing once the game is delivered', async () => {
      stubFetch(replies(204))

      await sendForCollection(agreedRecord())

      expect(pending()).toEqual([])
    })

    it('sends nothing from a dev build', async () => {
      mockIsDev.mockReturnValue(true)
      const fetchMock = stubFetch(replies(204))

      await sendForCollection(agreedRecord())

      expect(fetchMock).not.toHaveBeenCalled()
      expect(pending()).toEqual([])
    })

    describe('when the game cannot be delivered', () => {
      it('fails silently when the network is down, and keeps the game for later', async () => {
        stubFetch(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
        const noise = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'info'), vi.spyOn(console, 'log')]

        await expect(sendForCollection(agreedRecord())).resolves.toBeUndefined()

        for (const spy of noise) expect(spy).not.toHaveBeenCalled()
        expect(pending()).toEqual(['game-a'])
      })

      it('does not try at all while the browser says it is offline', async () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
        const fetchMock = stubFetch(replies(204))

        await sendForCollection(agreedRecord())

        expect(fetchMock).not.toHaveBeenCalled()
        expect(pending()).toEqual(['game-a'])
      })

      it.each([429, 500, 503])('keeps the game for later on a %i', async status => {
        const fetchMock = stubFetch(replies(status))

        await sendForCollection(agreedRecord())

        // One attempt: a failure is never retried on the spot.
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(pending()).toEqual(['game-a'])
      })

      /** A refusal of the payload itself will be a refusal next time too, so it is not offered again. */
      it.each([400, 403, 413, 415])('drops the game on a %i', async status => {
        stubFetch(replies(status))

        await sendForCollection(agreedRecord())

        expect(pending()).toEqual([])
      })

      it('remembers only so many undelivered games, dropping the oldest', async () => {
        stubFetch(replies(503))

        for (let i = 0; i < MAX_PENDING + 3; i++) await sendForCollection(agreedRecord(`game-${i}`))

        expect(pending()).toHaveLength(MAX_PENDING)
        expect(pending()[0]).toBe('game-3')
        expect(pending().at(-1)).toBe(`game-${MAX_PENDING + 2}`)
      })
    })
  })

  describe('offering undelivered games again when the app starts', () => {
    const undelivered = async (...ids: string[]) => {
      for (const id of ids) await db.games.put(agreedRecord(id))
      localStorage.setItem(PENDING_KEY, JSON.stringify(ids))
    }

    it('makes no network call when nothing is waiting', async () => {
      answer('yes')
      const fetchMock = stubFetch(replies(204))

      await retryPendingCollection()

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('sends each waiting game once, oldest first, and forgets the delivered ones', async () => {
      answer('yes')
      await undelivered('game-a', 'game-b')
      const fetchMock = stubFetch(replies(204))

      await retryPendingCollection()

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(pending()).toEqual([])
    })

    it('stops at the first failure, leaving the rest for the next start', async () => {
      answer('yes')
      await undelivered('game-a', 'game-b', 'game-c')
      const fetchMock = stubFetch(replies(503))

      await retryPendingCollection()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(pending()).toEqual(['game-a', 'game-b', 'game-c'])
    })

    it('forgets a waiting game that is no longer on the device', async () => {
      answer('yes')
      await undelivered('game-a')
      localStorage.setItem(PENDING_KEY, JSON.stringify(['game-gone', 'game-a']))
      const fetchMock = stubFetch(replies(204))

      await retryPendingCollection()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(pending()).toEqual([])
    })

    /** Opting out stops everything at once, including games that were waiting to go. */
    it('sends nothing after the player opts out, and forgets what was waiting', async () => {
      answer('yes')
      stubFetch(replies(503))
      const record = agreedRecord()
      await db.games.put(record)
      await sendForCollection(record)
      expect(pending()).toEqual(['game-a'])

      answer('no')
      const fetchMock = stubFetch(replies(204))
      await retryPendingCollection()
      await sendForCollection(record)

      expect(fetchMock).not.toHaveBeenCalled()
      expect(pending()).toEqual([])
    })

    it('sends nothing from a dev build', async () => {
      answer('yes')
      await undelivered('game-a')
      mockIsDev.mockReturnValue(true)
      const fetchMock = stubFetch(replies(204))

      await retryPendingCollection()

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('survives a damaged list', async () => {
      answer('yes')
      localStorage.setItem(PENDING_KEY, '{not json')
      const fetchMock = stubFetch(replies(204))

      await expect(retryPendingCollection()).resolves.toBeUndefined()

      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
