// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ANALYTICS_QUEUE_KEY, onAppStarted, onGameEnded, onGameStarted } from '../data/analytics'
import type { SealedGameStart } from '../data/analytics'
import { RELEASE } from '../buildIdentity'

const TEST_URL = 'https://test.example/analytics'

const START: SealedGameStart = {
  player_set: 'SOR', opponent_set: 'SOR', player_deck: 'generated', opponent_deck: 'saved', rematch: false,
  player_leader: 'SOR_010', opponent_leader: 'SOR_005',
  player_leader_name: 'Darth Vader (SOR)', opponent_leader_name: 'Luke Skywalker (SOR)', player_base: 'SOR_020', opponent_base: 'SOR_021',
  player_aspect: 'Vigilance', opponent_aspect: 'none',
}

const sent = () => {
  const calls = vi.mocked(fetch).mock.calls
  const [url, init] = calls[calls.length - 1]
  return { url, events: JSON.parse((init as RequestInit).body as string).events as { name: string; data: Record<string, unknown> }[] }
}

describe('Sealed analytics', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  describe('pointed at an endpoint', () => {
    beforeEach(() => vi.stubEnv('VITE_ANALYTICS_URL', TEST_URL))

    it('posts to the batch endpoint, tagged as Sealed and with the build, env and session', async () => {
      await onAppStarted()
      const { url, events } = sent()
      expect(url).toBe(`${TEST_URL}/batch`)
      expect(events).toHaveLength(1)
      expect(events[0].name).toBe('app_started')
      expect(events[0].data).toMatchObject({ game: 'sealed', version: RELEASE, env: 'test' })
      expect(events[0].data.sessionId).toMatch(/^[a-z0-9]+$/)
    })

    it('sends a game start with its decks', async () => {
      await onGameStarted(START)
      const { events } = sent()
      expect(events[0].name).toBe('game_started')
      expect(events[0].data).toMatchObject({ game: 'sealed', ...START })
    })

    // The end carries the decks too: nothing links a game's two events, so a result by leader or set
    // can only be read from the end event alone.
    it('sends a game end with its decks and how it ended', async () => {
      await onGameEnded({ ...START, result: 'win', round: 4, durationSeconds: 600, undo_count: 2, conceded_by: 'none' })
      const { events } = sent()
      expect(events[0].name).toBe('game_ended')
      expect(events[0].data).toMatchObject({ game: 'sealed', ...START, result: 'win', round: 4, durationSeconds: 600, undo_count: 2, conceded_by: 'none' })
    })

    // Sealed is served from /sealed/ on the PWA's origin, so the two apps share localStorage.
    it("keeps its own queue and leaves the PWA's alone", async () => {
      const pwaQueue = JSON.stringify([{ event_id: 'x', name: 'app_started', data: {}, queued_at: '2026-01-01T00:00:00Z' }])
      localStorage.setItem('analytics_queue', pwaQueue)
      vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))

      await onAppStarted()

      expect(ANALYTICS_QUEUE_KEY).not.toBe('analytics_queue')
      expect(JSON.parse(localStorage.getItem(ANALYTICS_QUEUE_KEY) ?? '[]')).toHaveLength(1)
      expect(localStorage.getItem('analytics_queue')).toBe(pwaQueue)
      expect(sent().events.map(e => e.name)).toEqual(['app_started'])
    })

    it('keeps an undelivered event and sends it with the next', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
      await onAppStarted()
      await onGameStarted(START)
      expect(sent().events.map(e => e.name)).toEqual(['app_started', 'game_started'])
      expect(localStorage.getItem(ANALYTICS_QUEUE_KEY)).toBeNull()
    })
  })

  // The Worker writes whatever reaches it, and a test run is not a browser, so nothing stops a stray
  // event landing in the production data. Under test the sender goes nowhere unless pointed somewhere.
  it('under test, with no endpoint set, sends and keeps nothing', async () => {
    await onAppStarted()
    await onGameStarted(START)
    expect(fetch).not.toHaveBeenCalled()
    expect(localStorage.getItem(ANALYTICS_QUEUE_KEY)).toBeNull()
  })
})
