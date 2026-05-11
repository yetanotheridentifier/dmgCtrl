import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  onAppStart, onGameStart, onGameEnd, onAppInstall, onAppResume,
  onDamageDealt, onDamageHealed, onRoundIncremented, onUndoUsed,
  onEpicActionUsed, onForceGained, onForceUsed,
  onFavouriteAdded, onFavouriteRemoved, onFavouritesCleared,
  onSettingChanged, onDeckImportSuccess, onDeckImportFailure,
} from '../services/analytics'
import { version as APP_VERSION } from '../../package.json'

const TEST_URL = 'https://test.example/analytics'

beforeEach(() => {
  vi.stubEnv('VITE_ANALYTICS_URL', TEST_URL)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function getLastBody() {
  const calls = vi.mocked(fetch).mock.calls
  const [, init] = calls[calls.length - 1]
  return JSON.parse((init as RequestInit).body as string)
}

describe('onAppStart', () => {
  it('POSTs to the analytics URL', async () => {
    await onAppStart()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(TEST_URL, expect.objectContaining({ method: 'POST' }))
  })

  it('sends event name app_started', async () => {
    await onAppStart()
    expect(getLastBody().event).toBe('app_started')
  })

  it('includes app version in payload', async () => {
    await onAppStart()
    expect(getLastBody().data.version).toBe(APP_VERSION)
  })

  it('includes env field in payload', async () => {
    await onAppStart()
    expect(getLastBody().data.env).toBe('test')
  })

  it('does not include user-identifiable fields', async () => {
    await onAppStart()
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

describe('onGameStart', () => {
  it('POSTs to the analytics URL', async () => {
    await onGameStart('SOR-026', 'SOR', false)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(TEST_URL, expect.objectContaining({ method: 'POST' }))
  })

  it('sends event name game_started', async () => {
    await onGameStart('SOR-026', 'SOR', false)
    expect(getLastBody().event).toBe('game_started')
  })

  it('includes baseKey in payload', async () => {
    await onGameStart('SOR-026', 'SOR', false)
    expect(getLastBody().data.baseKey).toBe('SOR-026')
  })

  it('includes baseSet in payload', async () => {
    await onGameStart('SOR-026', 'SOR', false)
    expect(getLastBody().data.baseSet).toBe('SOR')
  })

  it('includes hyperspace flag in payload', async () => {
    await onGameStart('SOR-026', 'SOR', true)
    expect(getLastBody().data.hyperspace).toBe(true)
  })

  it('does not include user-identifiable fields', async () => {
    await onGameStart('SOR-026', 'SOR', false)
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

describe('onGameEnd', () => {
  it('POSTs to the analytics URL', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(TEST_URL, expect.objectContaining({ method: 'POST' }))
  })

  it('sends event name game_ended', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120)
    expect(getLastBody().event).toBe('game_ended')
  })

  it('includes baseKey in payload', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120)
    expect(getLastBody().data.baseKey).toBe('SOR-026')
  })

  it('includes baseSet in payload', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120)
    expect(getLastBody().data.baseSet).toBe('SOR')
  })

  it('includes hyperspace flag in payload', async () => {
    await onGameEnd('SOR-026', 'SOR', true, 120)
    expect(getLastBody().data.hyperspace).toBe(true)
  })

  it('includes durationSeconds in payload', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120)
    expect(getLastBody().data.durationSeconds).toBe(120)
  })

  it('does not include user-identifiable fields', async () => {
    await onGameEnd('SOR-026', 'SOR', false, 120)
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

describe('onAppInstall', () => {
  it('sends event name app_installed', async () => {
    await onAppInstall()
    expect(getLastBody().event).toBe('app_installed')
  })

  it('does not include user-identifiable fields', async () => {
    await onAppInstall()
    const keys = Object.keys(getLastBody().data ?? {})
    for (const piiKey of ['userId', 'email', 'name', 'ip', 'user']) {
      expect(keys).not.toContain(piiKey)
    }
  })
})

describe('onAppResume', () => {
  it('sends event name app_resumed', async () => {
    await onAppResume()
    expect(getLastBody().event).toBe('app_resumed')
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
    await onGameStart('SOR-026', 'SOR', false)
    expect(getLastBody().data.sessionId).toBe(id)
    await onGameEnd('SOR-026', 'SOR', false, 30)
    expect(getLastBody().data.sessionId).toBe(id)
  })
})

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

describe('onDamageDealt', () => {
  it('sends event name damage_dealt', async () => {
    await onDamageDealt('SOR-026', 'SOR', 5)
    expect(getLastBody().event).toBe('damage_dealt')
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
    expect(getLastBody().event).toBe('damage_healed')
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
    expect(getLastBody().event).toBe('round_incremented')
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
    expect(getLastBody().event).toBe('undo_used')
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
    expect(getLastBody().event).toBe('epic_action_used')
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
    expect(getLastBody().event).toBe('force_gained')
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
    expect(getLastBody().event).toBe('force_used')
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
    expect(getLastBody().event).toBe('favourite_added')
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
    expect(getLastBody().event).toBe('favourite_removed')
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
    expect(getLastBody().event).toBe('favourites_cleared')
  })
})

describe('onSettingChanged', () => {
  it('sends event name setting_changed', async () => {
    await onSettingChanged('useHyperspace', false)
    expect(getLastBody().event).toBe('setting_changed')
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
    expect(getLastBody().event).toBe('deck_import_success')
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
    expect(getLastBody().event).toBe('deck_import_failure')
  })

  it('includes reason in payload', async () => {
    await onDeckImportFailure('deck_not_accessible')
    expect(getLastBody().data.reason).toBe('deck_not_accessible')
  })
})
