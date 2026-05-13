import { describe, it, expect, afterEach, vi } from 'vitest'
import { SELF } from 'cloudflare:test'

const ALLOWED_ORIGIN = 'https://dmgctrl.app'
const DEV_ORIGIN = 'https://dev.dmgctrl.app'

afterEach(() => vi.unstubAllGlobals())

// Response must be constructed inside the mock (within the request context),
// not pre-built outside it — the Workers runtime ties I/O objects to a request.
function stubFetch(makeResponse) {
  const mock = vi.fn().mockImplementation(makeResponse)
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('GET /swudb/deck/:id', () => {
  it('proxies to swudb.com and returns JSON with CORS headers', async () => {
    const mock = stubFetch(() =>
      new Response(JSON.stringify({ id: 'abc123', name: 'Test Deck' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const response = await SELF.fetch('https://worker.example/swudb/deck/abc123')
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ id: 'abc123', name: 'Test Deck' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(mock).toHaveBeenCalledWith(
      expect.stringContaining('swudb.com/api/deck/abc123'),
      expect.any(Object)
    )
  })
})

describe('GET passthrough', () => {
  it('proxies to api.swu-db.com with correct path and CORS headers', async () => {
    const mock = stubFetch(() =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const response = await SELF.fetch('https://worker.example/cards?q=test')
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ results: [] })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(mock).toHaveBeenCalledWith(
      expect.stringContaining('api.swu-db.com/cards?q=test')
    )
  })
})

describe('POST /analytics/batch', () => {
  it('returns 200 with received count for a valid payload', async () => {
    stubFetch(() => new Response(null, { status: 204 }))

    const response = await SELF.fetch('https://worker.example/analytics/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({
        events: [
          { event_id: 'uuid-1', name: 'game_started', data: { baseKey: 'SOR-026' }, queued_at: '2025-01-01T10:00:00.000Z' },
          { event_id: 'uuid-2', name: 'game_ended', data: { baseKey: 'SOR-026' }, queued_at: '2025-01-01T10:30:00.000Z' },
        ],
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.received).toBe(2)
  })

  it('writes each event to InfluxDB using queued_at as the timestamp and field', async () => {
    const capturedBodies = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      capturedBodies.push(init?.body ?? '')
      return new Response(null, { status: 204 })
    }))

    await SELF.fetch('https://worker.example/analytics/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({
        events: [
          { event_id: 'uuid-1', name: 'game_started', data: { players: 2 }, queued_at: '2025-01-01T10:00:00.000Z' },
        ],
      }),
    })

    const lines = capturedBodies[0]
    expect(lines).toContain('events,event=game_started')
    expect(lines).toContain('players=2i')
    expect(lines).toContain('queued_at="2025-01-01T10:00:00.000Z"')
    expect(lines).toContain('1735725600')
  })

  it('writes all events in a single InfluxDB request', async () => {
    const mock = stubFetch(() => new Response(null, { status: 204 }))

    await SELF.fetch('https://worker.example/analytics/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({
        events: [
          { event_id: 'uuid-1', name: 'game_started', data: {}, queued_at: '2025-01-01T10:00:00.000Z' },
          { event_id: 'uuid-2', name: 'game_ended', data: {}, queued_at: '2025-01-01T10:30:00.000Z' },
        ],
      }),
    })

    expect(mock).toHaveBeenCalledOnce()
    const [, init] = mock.mock.calls[0]
    const lines = (init?.body ?? '').split('\n')
    expect(lines).toHaveLength(2)
  })

  it('adds country and city from request.cf to every event', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      capturedBody = init?.body ?? ''
      return new Response(null, { status: 204 })
    }))

    await SELF.fetch('https://worker.example/analytics/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({
        events: [
          { event_id: 'uuid-1', name: 'game_started', data: {}, queued_at: '2025-01-01T10:00:00.000Z' },
        ],
      }),
      cf: { country: 'AU', city: 'Sydney' },
    })

    expect(capturedBody).toContain('country="AU"')
    expect(capturedBody).toContain('city="Sydney"')
  })

  it('returns 400 for malformed JSON', async () => {
    const response = await SELF.fetch('https://worker.example/analytics/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: 'not valid json',
    })

    expect(response.status).toBe(400)
  })

  it('returns 500 when InfluxDB returns an error', async () => {
    stubFetch(() => new Response('Internal Server Error', { status: 500 }))

    const response = await SELF.fetch('https://worker.example/analytics/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({
        events: [
          { event_id: 'uuid-1', name: 'game_started', data: {}, queued_at: '2025-01-01T10:00:00.000Z' },
        ],
      }),
    })

    expect(response.status).toBe(500)
  })

  it('responds to OPTIONS preflight with correct CORS headers', async () => {
    const response = await SELF.fetch('https://worker.example/analytics/batch', {
      method: 'OPTIONS',
      headers: { Origin: ALLOWED_ORIGIN },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN)
  })

  it('does not include CORS header for unknown origin', async () => {
    const response = await SELF.fetch('https://worker.example/analytics/batch', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com' },
    })

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('POST /analytics', () => {
  it('returns 204 and writes to InfluxDB for a valid payload', async () => {
    const mock = stubFetch(() => new Response(null, { status: 204 }))

    const response = await SELF.fetch('https://worker.example/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ event: 'game_started', data: { players: 2 } }),
    })

    expect(response.status).toBe(204)
    expect(mock).toHaveBeenCalledWith(
      expect.stringContaining('influxdb'),
      expect.any(Object)
    )
  })

  it('writes event name as tag and data fields in InfluxDB line protocol', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      capturedBody = init?.body ?? ''
      return new Response(null, { status: 204 })
    }))

    await SELF.fetch('https://worker.example/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ event: 'game_started', data: { players: 2 } }),
    })

    expect(capturedBody).toContain('events,event=game_started')
    expect(capturedBody).toContain('players=2i')
  })

  it('includes country and city from request.cf in the line protocol', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      capturedBody = init?.body ?? ''
      return new Response(null, { status: 204 })
    }))

    await SELF.fetch('https://worker.example/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ event: 'game_started', data: {} }),
      cf: { country: 'AU', city: 'Sydney' },
    })

    expect(capturedBody).toContain('country="AU"')
    expect(capturedBody).toContain('city="Sydney"')
  })

  it('includes latitude and longitude as floats when present in request.cf', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      capturedBody = init?.body ?? ''
      return new Response(null, { status: 204 })
    }))

    await SELF.fetch('https://worker.example/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ event: 'game_started', data: {} }),
      cf: { country: 'AU', city: 'Sydney', latitude: '-33.8688', longitude: '151.2093' },
    })

    expect(capturedBody).toContain('latitude=-33.8688')
    expect(capturedBody).toContain('longitude=151.2093')
  })

  it('omits latitude and longitude from line protocol when absent from request.cf', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      capturedBody = init?.body ?? ''
      return new Response(null, { status: 204 })
    }))

    await SELF.fetch('https://worker.example/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ event: 'game_started', data: {} }),
      cf: { country: 'AU', city: 'Sydney' },
    })

    expect(capturedBody).not.toContain('latitude=')
    expect(capturedBody).not.toContain('longitude=')
  })

  it('uses "unknown" for country and city when request.cf fields are absent', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      capturedBody = init?.body ?? ''
      return new Response(null, { status: 204 })
    }))

    await SELF.fetch('https://worker.example/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ event: 'game_started', data: {} }),
    })

    expect(capturedBody).toContain('country="unknown"')
    expect(capturedBody).toContain('city="unknown"')
  })

  it('returns 400 for malformed JSON', async () => {
    const response = await SELF.fetch('https://worker.example/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: 'not valid json',
    })

    expect(response.status).toBe(400)
  })

  it('returns 500 when InfluxDB returns an error', async () => {
    stubFetch(() => new Response('Internal Server Error', { status: 500 }))

    const response = await SELF.fetch('https://worker.example/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ event: 'game_started', data: { players: 2 } }),
    })

    expect(response.status).toBe(500)
  })

  it('responds to OPTIONS preflight with correct CORS headers', async () => {
    const response = await SELF.fetch('https://worker.example/analytics', {
      method: 'OPTIONS',
      headers: { Origin: ALLOWED_ORIGIN },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('allows OPTIONS preflight from dev origin', async () => {
    const response = await SELF.fetch('https://worker.example/analytics', {
      method: 'OPTIONS',
      headers: { Origin: DEV_ORIGIN },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(DEV_ORIGIN)
  })

  it('returns dev origin in CORS headers for POST from dev origin', async () => {
    stubFetch(() => new Response(null, { status: 204 }))

    const response = await SELF.fetch('https://worker.example/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: DEV_ORIGIN },
      body: JSON.stringify({ event: 'game_started', data: { players: 2 } }),
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(DEV_ORIGIN)
  })

  it('does not include CORS header for unknown origin', async () => {
    const response = await SELF.fetch('https://worker.example/analytics', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com' },
    })

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
