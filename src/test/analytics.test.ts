import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { onAppStart, onGameStart, onGameEnd, onAppInstall, onAppResume } from '../services/analytics'
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
