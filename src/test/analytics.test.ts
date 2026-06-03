import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  enqueue, flush,
  onAppStart, onGameStart, onGameEnd, onMatchCompleted, onAppInstall, onAppResume,
  onDamageDealt, onDamageHealed, onRoundIncremented, onUndoUsed,
  onEpicActionUsed, onForceGained, onForceUsed,
  onFavouriteAdded, onFavouriteRemoved, onFavouritesCleared,
  onSettingChanged, onDeckImportSuccess, onDeckImportFailure,
  onImageLoadFailed, onBasesLoadFailed, onBasesLoadStale, onWakeLockFailed,
  onTournamentStarted, onTournamentRoundCompleted, onTournamentDropped, onTournamentEnded,
  onXwingGameStarted, onXwingGameEnded, onXwingRoundAdvanced,
} from '../services/analytics'
import { version as APP_VERSION } from '../../package.json'

const TEST_URL = 'https://test.example/analytics'
const BATCH_URL = `${TEST_URL}/batch`
const QUEUE_KEY = 'analytics_queue'

beforeEach(() => {
  vi.stubEnv('VITE_ANALYTICS_URL', TEST_URL)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ received: 1 }), { status: 200 })
  ))
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

function getLastBody() {
  const calls = vi.mocked(fetch).mock.calls
  const [, init] = calls[calls.length - 1]
  const body = JSON.parse((init as RequestInit).body as string)
  return body.events[0]
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

describe('enqueue', () => {
  it('writes an event to the localStorage queue', () => {
    enqueue('test_event', { foo: 'bar' })
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY)!)
    expect(queue).toHaveLength(1)
    expect(queue[0].name).toBe('test_event')
  })

  it('includes event_id, name, data, and queued_at on each entry', () => {
    enqueue('test_event', { foo: 'bar' })
    const event = JSON.parse(localStorage.getItem(QUEUE_KEY)!)[0]
    expect(typeof event.event_id).toBe('string')
    expect(event.event_id.length).toBeGreaterThan(0)
    expect(event.name).toBe('test_event')
    expect(event.data).toEqual({ foo: 'bar' })
    expect(typeof event.queued_at).toBe('string')
    expect(new Date(event.queued_at).getTime()).not.toBeNaN()
  })

  it('appends to an existing queue', () => {
    enqueue('event_a', {})
    enqueue('event_b', {})
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY)!)
    expect(queue).toHaveLength(2)
    expect(queue[0].name).toBe('event_a')
    expect(queue[1].name).toBe('event_b')
  })

  it('caps the queue at 200 events, dropping the oldest', () => {
    for (let i = 0; i < 201; i++) enqueue('event', { i })
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY)!)
    expect(queue).toHaveLength(200)
    expect(queue[0].data.i).toBe(1)
    expect(queue[199].data.i).toBe(200)
  })

  it('fails silently when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => enqueue('test_event', {})).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// flush
// ---------------------------------------------------------------------------

describe('flush', () => {
  it('sends all queued events in a single batch request', async () => {
    enqueue('event_a', {})
    enqueue('event_b', {})
    await flush()
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
    const [, init] = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.events).toHaveLength(2)
  })

  it('POSTs to the /batch endpoint', async () => {
    enqueue('test_event', {})
    await flush()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(BATCH_URL, expect.objectContaining({ method: 'POST' }))
  })

  it('clears the queue on a 200 response', async () => {
    enqueue('test_event', {})
    await flush()
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull()
  })

  it('preserves the queue on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Error', { status: 500 })))
    enqueue('test_event', {})
    await flush()
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)).toHaveLength(1)
  })

  it('preserves the queue on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    enqueue('test_event', {})
    await flush()
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)).toHaveLength(1)
  })

  it('is a no-op when the queue is empty', async () => {
    await flush()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('resolves without throwing on any error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    enqueue('test_event', {})
    await expect(flush()).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// window online event
// ---------------------------------------------------------------------------

describe('window online event', () => {
  it('triggers a flush when the online event fires', async () => {
    enqueue('test_event', {})
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(BATCH_URL, expect.any(Object))
  })
})

// ---------------------------------------------------------------------------
// onAppStart
// ---------------------------------------------------------------------------

describe('onAppStart', () => {
  it('POSTs to the batch URL', async () => {
    await onAppStart()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(BATCH_URL, expect.objectContaining({ method: 'POST' }))
  })

  it('sends event name app_started', async () => {
    await onAppStart()
    expect(getLastBody().name).toBe('app_started')
  })

  it('includes app version in payload', async () => {
    await onAppStart()
    expect(getLastBody().data.version).toBe(APP_VERSION)
  })

  it('includes env field in payload', async () => {
    await onAppStart()
    expect(getLastBody().data.env).toBe('test')
  })

  it('includes previously queued events in the flush', async () => {
    enqueue('offline_event', {})
    await onAppStart()
    const [, init] = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.events).toHaveLength(2)
    expect(body.events[0].name).toBe('offline_event')
    expect(body.events[1].name).toBe('app_started')
  })

  it('does not include user-identifiable fields', async () => {
    await onAppStart()
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

// ---------------------------------------------------------------------------
// onGameStart
// ---------------------------------------------------------------------------

describe('onGameStart', () => {
  it('POSTs to the batch URL', async () => {
    await onGameStart('SOR-026', 'SOR', false, 'casual')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(BATCH_URL, expect.objectContaining({ method: 'POST' }))
  })

  it('sends event name game_started', async () => {
    await onGameStart('SOR-026', 'SOR', false, 'casual')
    expect(getLastBody().name).toBe('game_started')
  })

  it('includes baseKey in payload', async () => {
    await onGameStart('SOR-026', 'SOR', false, 'casual')
    expect(getLastBody().data.baseKey).toBe('SOR-026')
  })

  it('includes baseSet in payload', async () => {
    await onGameStart('SOR-026', 'SOR', false, 'casual')
    expect(getLastBody().data.baseSet).toBe('SOR')
  })

  it('includes hyperspace flag in payload', async () => {
    await onGameStart('SOR-026', 'SOR', true, 'casual')
    expect(getLastBody().data.hyperspace).toBe(true)
  })

  it('includes playMode in payload', async () => {
    await onGameStart('SOR-026', 'SOR', false, 'bo3')
    expect(getLastBody().data.playMode).toBe('bo3')
  })

  it("includes game: 'swu' in payload", async () => {
    await onGameStart('SOR-026', 'SOR', false, 'casual')
    expect(getLastBody().data.game).toBe('swu')
  })

  it('does not include user-identifiable fields', async () => {
    await onGameStart('SOR-026', 'SOR', false, 'casual')
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

// ---------------------------------------------------------------------------
// onGameEnd
// ---------------------------------------------------------------------------

describe('onGameEnd', () => {
  it('POSTs to the batch URL', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120, 'casual')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(BATCH_URL, expect.objectContaining({ method: 'POST' }))
  })

  it('sends event name game_ended', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120, 'casual')
    expect(getLastBody().name).toBe('game_ended')
  })

  it('includes baseKey in payload', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120, 'casual')
    expect(getLastBody().data.baseKey).toBe('SOR-026')
  })

  it('includes baseSet in payload', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120, 'casual')
    expect(getLastBody().data.baseSet).toBe('SOR')
  })

  it('includes hyperspace flag in payload', async () => {
    await onGameEnd('SOR-026', 'SOR', true, 120, 'casual')
    expect(getLastBody().data.hyperspace).toBe(true)
  })

  it('includes durationSeconds in payload', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120, 'casual')
    expect(getLastBody().data.durationSeconds).toBe(120)
  })

  it('includes playMode in payload', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120, 'bo1')
    expect(getLastBody().data.playMode).toBe('bo1')
  })

  it("includes game: 'swu' in payload", async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120, 'casual')
    expect(getLastBody().data.game).toBe('swu')
  })

  it('does not include user-identifiable fields', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120, 'casual')
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

// ---------------------------------------------------------------------------
// onMatchCompleted
// ---------------------------------------------------------------------------

describe('onMatchCompleted', () => {
  it('sends event name match_completed', async () => {
    await onMatchCompleted('bo1', 'won', 2, 0)
    expect(getLastBody().name).toBe('match_completed')
  })

  it('includes playMode in payload', async () => {
    await onMatchCompleted('bo3', 'lost', 0, 2)
    expect(getLastBody().data.playMode).toBe('bo3')
  })

  it('includes matchResult in payload', async () => {
    await onMatchCompleted('bo1', 'drawn', 1, 1)
    expect(getLastBody().data.matchResult).toBe('drawn')
  })

  it('includes playerScore in payload', async () => {
    await onMatchCompleted('bo3', 'won', 2, 1)
    expect(getLastBody().data.playerScore).toBe(2)
  })

  it('includes opponentScore in payload', async () => {
    await onMatchCompleted('bo3', 'lost', 0, 2)
    expect(getLastBody().data.opponentScore).toBe(2)
  })

  it('does not include user-identifiable fields', async () => {
    await onMatchCompleted('bo1', 'won', 2, 0)
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

// ---------------------------------------------------------------------------
// onAppInstall
// ---------------------------------------------------------------------------

describe('onAppInstall', () => {
  it('sends event name app_installed', async () => {
    await onAppInstall('ios')
    expect(getLastBody().name).toBe('app_installed')
  })

  it('includes platform in payload', async () => {
    await onAppInstall('android')
    expect(getLastBody().data.platform).toBe('android')
  })

  it('does not include user-identifiable fields', async () => {
    await onAppInstall('ios')
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

// ---------------------------------------------------------------------------
// onAppResume
// ---------------------------------------------------------------------------

describe('onAppResume', () => {
  it('sends event name app_resumed', async () => {
    await onAppResume()
    expect(getLastBody().name).toBe('app_resumed')
  })

  it('includes sessionDurationSoFarSeconds as a non-negative number', async () => {
    await onAppResume()
    const { sessionDurationSoFarSeconds } = getLastBody().data
    expect(typeof sessionDurationSoFarSeconds).toBe('number')
    expect(sessionDurationSoFarSeconds).toBeGreaterThanOrEqual(0)
  })

  it('does not include user-identifiable fields', async () => {
    await onAppResume()
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

// ---------------------------------------------------------------------------
// sessionId
// ---------------------------------------------------------------------------

describe('sessionId', () => {
  it('includes sessionId in every event', async () => {
    await onAppStart()
    expect(getLastBody().data.sessionId).toBeDefined()
    expect(typeof getLastBody().data.sessionId).toBe('string')
    expect(getLastBody().data.sessionId.length).toBeGreaterThan(0)
  })

  it('uses the same sessionId across all events in a session', async () => {
    await onAppStart()
    const id = getLastBody().data.sessionId
    expect(id).toBeDefined()
    await onGameStart('SOR-026', 'SOR', false, 'casual')
    expect(getLastBody().data.sessionId).toBe(id)
    await onGameEnd('SOR-026', 'SOR', false, 30, 'casual')
    expect(getLastBody().data.sessionId).toBe(id)
  })
})

// ---------------------------------------------------------------------------
// error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('resolves without throwing when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    await expect(onAppStart()).resolves.toBeUndefined()
  })

  it('resolves without throwing when server returns an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Error', { status: 500 })))
    await expect(onAppStart()).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Remaining event functions
// ---------------------------------------------------------------------------

describe('onDamageDealt', () => {
  it('sends event name damage_dealt', async () => {
    await onDamageDealt('SOR-026', 'SOR', 5)
    expect(getLastBody().name).toBe('damage_dealt')
  })

  it('includes baseKey, baseSet and amount in payload', async () => {
    await onDamageDealt('SOR-026', 'SOR', 5)
    const { baseKey, baseSet, amount } = getLastBody().data
    expect(baseKey).toBe('SOR-026')
    expect(baseSet).toBe('SOR')
    expect(amount).toBe(5)
  })

  it('does not include user-identifiable fields', async () => {
    await onDamageDealt('SOR-026', 'SOR', 5)
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

describe('onDamageHealed', () => {
  it('sends event name damage_healed', async () => {
    await onDamageHealed('SOR-026', 'SOR', 3)
    expect(getLastBody().name).toBe('damage_healed')
  })

  it('includes baseKey, baseSet and amount in payload', async () => {
    await onDamageHealed('SOR-026', 'SOR', 3)
    const { baseKey, baseSet, amount } = getLastBody().data
    expect(baseKey).toBe('SOR-026')
    expect(baseSet).toBe('SOR')
    expect(amount).toBe(3)
  })
})

describe('onRoundIncremented', () => {
  it('sends event name round_incremented', async () => {
    await onRoundIncremented('SOR-026', 'SOR', 2)
    expect(getLastBody().name).toBe('round_incremented')
  })

  it('includes baseKey, baseSet and round in payload', async () => {
    await onRoundIncremented('SOR-026', 'SOR', 2)
    const { baseKey, baseSet, round } = getLastBody().data
    expect(baseKey).toBe('SOR-026')
    expect(baseSet).toBe('SOR')
    expect(round).toBe(2)
  })
})

describe('onUndoUsed', () => {
  it('sends event name undo_used', async () => {
    await onUndoUsed('SOR-026', 'SOR', 'hit')
    expect(getLastBody().name).toBe('undo_used')
  })

  it('includes baseKey, baseSet and undoneAction in payload', async () => {
    await onUndoUsed('SOR-026', 'SOR', 'hit')
    const { baseKey, baseSet, undoneAction } = getLastBody().data
    expect(baseKey).toBe('SOR-026')
    expect(baseSet).toBe('SOR')
    expect(undoneAction).toBe('hit')
  })
})

describe('onEpicActionUsed', () => {
  it('sends event name epic_action_used', async () => {
    await onEpicActionUsed('SOR-022', 'SOR')
    expect(getLastBody().name).toBe('epic_action_used')
  })

  it('includes baseKey and baseSet in payload', async () => {
    await onEpicActionUsed('SOR-022', 'SOR')
    const { baseKey, baseSet } = getLastBody().data
    expect(baseKey).toBe('SOR-022')
    expect(baseSet).toBe('SOR')
  })
})

describe('onForceGained', () => {
  it('sends event name force_gained', async () => {
    await onForceGained('LOF-026', 'LOF')
    expect(getLastBody().name).toBe('force_gained')
  })

  it('includes baseKey and baseSet in payload', async () => {
    await onForceGained('LOF-026', 'LOF')
    const { baseKey, baseSet } = getLastBody().data
    expect(baseKey).toBe('LOF-026')
    expect(baseSet).toBe('LOF')
  })
})

describe('onForceUsed', () => {
  it('sends event name force_used', async () => {
    await onForceUsed('LOF-026', 'LOF')
    expect(getLastBody().name).toBe('force_used')
  })

  it('includes baseKey and baseSet in payload', async () => {
    await onForceUsed('LOF-026', 'LOF')
    const { baseKey, baseSet } = getLastBody().data
    expect(baseKey).toBe('LOF-026')
    expect(baseSet).toBe('LOF')
  })
})

describe('onFavouriteAdded', () => {
  it('sends event name favourite_added', async () => {
    await onFavouriteAdded('SOR-026', 'SOR')
    expect(getLastBody().name).toBe('favourite_added')
  })

  it('includes baseKey and baseSet in payload', async () => {
    await onFavouriteAdded('SOR-026', 'SOR')
    const { baseKey, baseSet } = getLastBody().data
    expect(baseKey).toBe('SOR-026')
    expect(baseSet).toBe('SOR')
  })
})

describe('onFavouriteRemoved', () => {
  it('sends event name favourite_removed', async () => {
    await onFavouriteRemoved('SOR-026', 'SOR')
    expect(getLastBody().name).toBe('favourite_removed')
  })

  it('includes baseKey and baseSet in payload', async () => {
    await onFavouriteRemoved('SOR-026', 'SOR')
    const { baseKey, baseSet } = getLastBody().data
    expect(baseKey).toBe('SOR-026')
    expect(baseSet).toBe('SOR')
  })
})

describe('onFavouritesCleared', () => {
  it('sends event name favourites_cleared', async () => {
    await onFavouritesCleared()
    expect(getLastBody().name).toBe('favourites_cleared')
  })
})

describe('onSettingChanged', () => {
  it('sends event name setting_changed', async () => {
    await onSettingChanged('useHyperspace', false)
    expect(getLastBody().name).toBe('setting_changed')
  })

  it('includes setting name and value in payload', async () => {
    await onSettingChanged('useHyperspace', false)
    const { setting, value } = getLastBody().data
    expect(setting).toBe('useHyperspace')
    expect(value).toBe(false)
  })
})

describe('onDeckImportSuccess', () => {
  it('sends event name deck_import_success', async () => {
    await onDeckImportSuccess('JTL-030', 'JTL')
    expect(getLastBody().name).toBe('deck_import_success')
  })

  it('includes baseKey and baseSet in payload', async () => {
    await onDeckImportSuccess('JTL-030', 'JTL')
    const { baseKey, baseSet } = getLastBody().data
    expect(baseKey).toBe('JTL-030')
    expect(baseSet).toBe('JTL')
  })
})

describe('onDeckImportFailure', () => {
  it('sends event name deck_import_failure', async () => {
    await onDeckImportFailure('deck_not_accessible')
    expect(getLastBody().name).toBe('deck_import_failure')
  })

  it('includes reason in payload', async () => {
    await onDeckImportFailure('deck_not_accessible')
    expect(getLastBody().data.reason).toBe('deck_not_accessible')
  })
})

describe('onImageLoadFailed', () => {
  it('sends event name image_load_failed', async () => {
    await onImageLoadFailed('SOR-026', 'SOR', 'https://cdn.swu-db.com/images/cards/SOR/026.png')
    expect(getLastBody().name).toBe('image_load_failed')
  })

  it('includes baseKey, baseSet, and url in payload', async () => {
    await onImageLoadFailed('SOR-026', 'SOR', 'https://cdn.swu-db.com/images/cards/SOR/026.png')
    const { baseKey, baseSet, url } = getLastBody().data
    expect(baseKey).toBe('SOR-026')
    expect(baseSet).toBe('SOR')
    expect(url).toBe('https://cdn.swu-db.com/images/cards/SOR/026.png')
  })
})

describe('onBasesLoadFailed', () => {
  it('sends event name bases_load_failed', async () => {
    await onBasesLoadFailed()
    expect(getLastBody().name).toBe('bases_load_failed')
  })
})

describe('onBasesLoadStale', () => {
  it('sends event name bases_load_stale', async () => {
    await onBasesLoadStale()
    expect(getLastBody().name).toBe('bases_load_stale')
  })
})

describe('onWakeLockFailed', () => {
  it('sends event name wake_lock_failed', async () => {
    await onWakeLockFailed('NotAllowedError')
    expect(getLastBody().name).toBe('wake_lock_failed')
  })

  it('includes reason in payload', async () => {
    await onWakeLockFailed('NotAllowedError')
    expect(getLastBody().data.reason).toBe('NotAllowedError')
  })
})

// ---------------------------------------------------------------------------
// onTournamentStarted
// ---------------------------------------------------------------------------

describe('onTournamentStarted', () => {
  it('sends event name tournament_started', async () => {
    await onTournamentStarted('premier', 'bo3', 5)
    expect(getLastBody().name).toBe('tournament_started')
  })

  it('includes format in payload', async () => {
    await onTournamentStarted('premier', 'bo3', 5)
    expect(getLastBody().data.format).toBe('premier')
  })

  it('includes playMode in payload', async () => {
    await onTournamentStarted('premier', 'bo1', 5)
    expect(getLastBody().data.playMode).toBe('bo1')
  })

  it('includes totalRounds in payload', async () => {
    await onTournamentStarted('premier', 'bo3', 7)
    expect(getLastBody().data.totalRounds).toBe(7)
  })

  it('does not include user-identifiable fields', async () => {
    await onTournamentStarted('premier', 'bo3', 5)
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

// ---------------------------------------------------------------------------
// onTournamentRoundCompleted
// ---------------------------------------------------------------------------

describe('onTournamentRoundCompleted', () => {
  it('sends event name tournament_round_completed', async () => {
    await onTournamentRoundCompleted(1, 'won', 2, 0, 'premier', 'bo3')
    expect(getLastBody().name).toBe('tournament_round_completed')
  })

  it('includes roundNumber in payload', async () => {
    await onTournamentRoundCompleted(2, 'lost', 0, 2, 'premier', 'bo3')
    expect(getLastBody().data.roundNumber).toBe(2)
  })

  it('includes result in payload', async () => {
    await onTournamentRoundCompleted(1, 'drawn', 1, 1, 'premier', 'bo3')
    expect(getLastBody().data.result).toBe('drawn')
  })

  it('includes playerScore in payload', async () => {
    await onTournamentRoundCompleted(1, 'won', 2, 0, 'premier', 'bo3')
    expect(getLastBody().data.playerScore).toBe(2)
  })

  it('includes opponentScore in payload', async () => {
    await onTournamentRoundCompleted(1, 'won', 2, 0, 'premier', 'bo3')
    expect(getLastBody().data.opponentScore).toBe(0)
  })

  it('includes format in payload', async () => {
    await onTournamentRoundCompleted(1, 'won', 2, 0, 'premier', 'bo3')
    expect(getLastBody().data.format).toBe('premier')
  })

  it('includes playMode in payload', async () => {
    await onTournamentRoundCompleted(1, 'won', 2, 0, 'premier', 'bo3')
    expect(getLastBody().data.playMode).toBe('bo3')
  })

  it('does not include user-identifiable fields', async () => {
    await onTournamentRoundCompleted(1, 'won', 2, 0, 'premier', 'bo3')
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

// ---------------------------------------------------------------------------
// onTournamentDropped
// ---------------------------------------------------------------------------

describe('onTournamentDropped', () => {
  it('sends event name tournament_dropped', async () => {
    await onTournamentDropped(2, 'premier', 'bo3')
    expect(getLastBody().name).toBe('tournament_dropped')
  })

  it('includes roundsCompleted in payload', async () => {
    await onTournamentDropped(2, 'premier', 'bo3')
    expect(getLastBody().data.roundsCompleted).toBe(2)
  })

  it('includes format in payload', async () => {
    await onTournamentDropped(2, 'premier', 'bo3')
    expect(getLastBody().data.format).toBe('premier')
  })

  it('includes playMode in payload', async () => {
    await onTournamentDropped(2, 'premier', 'bo1')
    expect(getLastBody().data.playMode).toBe('bo1')
  })

  it('does not include user-identifiable fields', async () => {
    await onTournamentDropped(2, 'premier', 'bo3')
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

// ---------------------------------------------------------------------------
// onTournamentEnded
// ---------------------------------------------------------------------------

describe('onTournamentEnded', () => {
  it('sends event name tournament_ended', async () => {
    await onTournamentEnded(5, 3, 1, 1, 10, 'premier', 'bo3')
    expect(getLastBody().name).toBe('tournament_ended')
  })

  it('includes totalRounds in payload', async () => {
    await onTournamentEnded(5, 3, 1, 1, 10, 'premier', 'bo3')
    expect(getLastBody().data.totalRounds).toBe(5)
  })

  it('includes won, lost, drawn in payload', async () => {
    await onTournamentEnded(5, 3, 1, 1, 10, 'premier', 'bo3')
    const { won, lost, drawn } = getLastBody().data
    expect(won).toBe(3)
    expect(lost).toBe(1)
    expect(drawn).toBe(1)
  })

  it('includes points in payload', async () => {
    await onTournamentEnded(5, 3, 1, 1, 10, 'premier', 'bo3')
    expect(getLastBody().data.points).toBe(10)
  })

  it('includes format in payload', async () => {
    await onTournamentEnded(5, 3, 1, 1, 10, 'premier', 'bo3')
    expect(getLastBody().data.format).toBe('premier')
  })

  it('includes playMode in payload', async () => {
    await onTournamentEnded(5, 3, 1, 1, 10, 'premier', 'bo3')
    expect(getLastBody().data.playMode).toBe('bo3')
  })

  it('does not include user-identifiable fields', async () => {
    await onTournamentEnded(5, 3, 1, 1, 10, 'premier', 'bo3')
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

// ---------------------------------------------------------------------------
// onXwingGameStarted
// ---------------------------------------------------------------------------

describe('onXwingGameStarted', () => {
  it('sends event name game_started', async () => {
    await onXwingGameStarted(0, 0)
    expect(getLastBody().name).toBe('game_started')
  })

  it("includes game: 'xwing' in payload", async () => {
    await onXwingGameStarted(0, 0)
    expect(getLastBody().data.game).toBe('xwing')
  })

  it('includes player_deficit in payload', async () => {
    await onXwingGameStarted(3, 0)
    expect(getLastBody().data.player_deficit).toBe(3)
  })

  it('includes opponent_deficit in payload', async () => {
    await onXwingGameStarted(0, 5)
    expect(getLastBody().data.opponent_deficit).toBe(5)
  })

  it('does not include user-identifiable fields', async () => {
    await onXwingGameStarted(0, 0)
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

// ---------------------------------------------------------------------------
// onXwingGameEnded
// ---------------------------------------------------------------------------

describe('onXwingGameEnded', () => {
  const payload = { final_round: 3, player_score: 25, opponent_score: 50, player_deficit: 0, opponent_deficit: 0, result: 'loss' as const, elapsed_seconds: 120, timer_expired: false }

  it('sends event name game_ended', async () => {
    await onXwingGameEnded(payload)
    expect(getLastBody().name).toBe('game_ended')
  })

  it("includes game: 'xwing' in payload", async () => {
    await onXwingGameEnded(payload)
    expect(getLastBody().data.game).toBe('xwing')
  })

  it('includes final_round in payload', async () => {
    await onXwingGameEnded(payload)
    expect(getLastBody().data.final_round).toBe(3)
  })

  it('includes player_score in payload', async () => {
    await onXwingGameEnded(payload)
    expect(getLastBody().data.player_score).toBe(25)
  })

  it('includes opponent_score in payload', async () => {
    await onXwingGameEnded(payload)
    expect(getLastBody().data.opponent_score).toBe(50)
  })

  it('includes player_deficit in payload', async () => {
    await onXwingGameEnded(payload)
    expect(getLastBody().data.player_deficit).toBe(0)
  })

  it('includes opponent_deficit in payload', async () => {
    await onXwingGameEnded(payload)
    expect(getLastBody().data.opponent_deficit).toBe(0)
  })

  it('includes result in payload', async () => {
    await onXwingGameEnded(payload)
    expect(getLastBody().data.result).toBe('loss')
  })

  it('includes elapsed_seconds in payload', async () => {
    await onXwingGameEnded(payload)
    expect(getLastBody().data.elapsed_seconds).toBe(120)
  })

  it('includes timer_expired in payload', async () => {
    await onXwingGameEnded(payload)
    expect(getLastBody().data.timer_expired).toBe(false)
  })

  it('does not include user-identifiable fields', async () => {
    await onXwingGameEnded(payload)
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

// onXwingRoundAdvanced
// ---------------------------------------------------------------------------

describe('onXwingRoundAdvanced', () => {

  it('sends event name xwing_round_advanced', async () => {
    await onXwingRoundAdvanced(1, 2)
    expect(getLastBody().name).toBe('xwing_round_advanced')
  })

  it('includes from_round in payload', async () => {
    await onXwingRoundAdvanced(3, 4)
    expect(getLastBody().data.from_round).toBe(3)
  })

  it('includes to_round in payload', async () => {
    await onXwingRoundAdvanced(3, 4)
    expect(getLastBody().data.to_round).toBe(4)
  })

  it('does not include user-identifiable fields', async () => {
    await onXwingRoundAdvanced(1, 2)
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })

})
