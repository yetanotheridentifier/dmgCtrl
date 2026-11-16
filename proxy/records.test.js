import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { applyD1Migrations, env, SELF } from 'cloudflare:test'
import worker from './worker.js'
import { gameKey, handleRecords } from './records.js'
import contract from './recordContract.json'

/**
 * POST /records stages one finished game from a player who opted in. The notice that player agreed
 * to says nothing identifies them and their IP address is not linked to games, so most of this file
 * is about what the Worker must NOT keep: the staged value is the validated payload and nothing
 * else, under a key made from the game alone, and nothing is logged.
 */

const ORIGIN = 'https://dmgctrl.app'
const DEV_ORIGIN = 'https://dev.dmgctrl.app'
const URL_RECORDS = 'https://worker.example/records'

/** A payload of the shape the app sends (`CollectedRecord` in sealed/src/data/collection.ts), cut down. */
const seat = (leader, base) => ({
  leader: { cardId: leader, deployed: false },
  base: { cardId: base, damage: 0 },
  deck: ['ASH_101', 'ASH_102', 'ASH_103'],
  hand: ['ASH_104'],
  resources: [],
})
const record = (over = {}) => ({
  playerLeader: 'ASH_001',
  playerBase: 'ASH_020',
  opponentLeader: 'ASH_005',
  opponentBase: 'ASH_024',
  winner: 'player',
  durationMs: 754000,
  initialState: {
    turn: 1,
    rngSeed: 123456789,
    activePlayer: 'player',
    winner: null,
    players: { player: seat('ASH_001', 'ASH_020'), opponent: seat('ASH_005', 'ASH_024') },
  },
  moves: [
    { by: 'player', action: { type: 'keepHand' } },
    { by: 'opponent', action: { type: 'attack', attackerId: 'u-3', target: { kind: 'base' } } },
  ],
  undoCount: 0,
  build: { release: '412', commitId: 'abc1234' },
  opponentAi: 'beam-reply',
  humanSeat: 'player',
  ...over,
})

/** Everything a request can carry that would say who sent it. None of it may be kept. */
const IDENTIFYING = {
  'CF-Connecting-IP': '203.0.113.77',
  'X-Forwarded-For': '198.51.100.23, 203.0.113.77',
  'X-Real-IP': '192.0.2.99',
  'True-Client-IP': '192.0.2.150',
  'User-Agent': 'IdentifyingBrowser/9.9 (TellTale OS)',
  Cookie: 'session=tell-tale-cookie',
  Referer: 'https://dmgctrl.app/sealed/?who=tell-tale-referer',
  'CF-Ray': 'telltaleray123-LHR',
  'CF-IPCountry': 'ZZ',
  'Accept-Language': 'xx-TELLTALE',
}
const CF = { country: 'ZZ', city: 'Telltale City', asn: 64496, asOrganization: 'Telltale Net', colo: 'TTL', tlsClientRandom: 'telltale-random', postalCode: 'TT1 1TT', timezone: 'Tell/Tale' }
const TELL_TALES = [...Object.values(IDENTIFYING).filter(v => v !== 'ZZ'), 'Telltale', 'telltale', '64496', 'TTL', 'TT1']

function post(body, { headers = {}, origin = ORIGIN, cf } = {}) {
  return new Request(URL_RECORDS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...(cf ? { cf } : {}),
  })
}

/**
 * A D1 database that records every statement it runs and every value bound to it, in `written`.
 * With `fail`, each write throws, as a store that is down does.
 */
function fakeDb({ fail = false } = {}) {
  const written = []
  return {
    written,
    prepare: sql => ({
      bind: (...args) => ({
        run: async () => {
          if (fail) throw new Error('d1 down')
          written.push({ sql, args })
          return { success: true, meta: { changes: 1 } }
        },
      }),
    }),
  }
}

/** A store and a limiter that record every argument they are handed. */
function fakeEnv(over = {}) {
  return {
    RECORD_COLLECTION: 'on',
    GAME_DB: fakeDb(),
    RECORDS_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    ...over,
  }
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace']
const watchConsole = () => CONSOLE_METHODS.map(method => vi.spyOn(console, method).mockImplementation(() => {}))

/** Gzipped bytes back to their text. */
async function gunzip(bytes) {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** Every row of the real (local) store, its payload unpacked. */
async function storedGames() {
  const { results } = await env.GAME_DB.prepare('SELECT * FROM collected_games ORDER BY game_key').all()
  return Promise.all(results.map(async row => ({ ...row, payload: JSON.parse(await gunzip(row.payload)) })))
}

const UTC_DAY = /^\d{4}-\d{2}-\d{2}$/

beforeAll(async () => {
  await applyD1Migrations(env.GAME_DB, env.TEST_MIGRATIONS)
})
beforeEach(async () => {
  await env.GAME_DB.prepare('DELETE FROM collected_games').run()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('POST /records: storing a game', () => {
  it('stores a valid record and answers 204 with nothing in the body', async () => {
    const response = await SELF.fetch(post(record()))

    expect(await response.text()).toBe('')
    expect(response.status).toBe(204)
    const games = await storedGames()
    expect(games).toHaveLength(1)
    expect(games[0].payload).toEqual(record())
  })

  it('stores a game unchecked: the replay check beside it is the bench\'s to write', async () => {
    await SELF.fetch(post(record()))

    const [game] = await storedGames()
    expect(game).toMatchObject({ checked_on: null, refusal: null, flagged: 0 })
  })

  it('keeps the payload gzipped, as the JSON text it was sent as', async () => {
    await SELF.fetch(post(record()))

    const { results } = await env.GAME_DB.prepare('SELECT payload FROM collected_games').all()
    const bytes = new Uint8Array(results[0].payload)
    // The gzip magic number.
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b])
    expect(await gunzip(bytes)).toBe(JSON.stringify(record()))
  })

  it('keys it by the game alone: its starting position and its moves', async () => {
    await SELF.fetch(post(record()))

    const [{ game_key }] = await storedGames()
    expect(game_key).toBe(await gameKey(record()))
    expect(game_key).toMatch(/^[0-9a-f]{16}$/)
  })

  it('writes the build beside the payload, and the day it arrived in UTC and nothing finer', async () => {
    await SELF.fetch(post(record()))

    const [game] = await storedGames()
    expect(game.release).toBe('412')
    expect(game.commit_id).toBe('abc1234')
    expect(game.received_day).toMatch(UTC_DAY)
    expect(game.received_day).toBe(new Date().toISOString().slice(0, 10))
    // The replay check's columns name a build, not a time (migrations/0002).
    expect(Object.keys(game).sort()).toEqual(['checked_on', 'commit_id', 'flagged', 'game_key', 'payload', 'received_day', 'refusal', 'release'])
  })

  /**
   * The same definition as `gameKey` in sealed/src/bench/trainingRows.ts, so a staged game and its
   * training rows carry one key. The vector is pinned on both sides (`collectionContract.test.ts`).
   */
  it('gives the pinned starting position and moves the pinned game key', async () => {
    expect(await gameKey({ initialState: { turn: 1 }, moves: [{ by: 'player', action: { type: 'pass' } }] })).toBe('4b65e2ad9cfd3a18')
  })

  /**
   * A second send of a game already held is a delivery all the same: the answer is the 204 the
   * device takes as its confirmation, and the row is left as it was first written.
   */
  it('stores a game sent twice once, and confirms both sends', async () => {
    await SELF.fetch(post(record()))
    const again = await SELF.fetch(post(record()))

    expect(again.status).toBe(204)
    expect(await storedGames()).toHaveLength(1)
  })

  it('stores two different games apart', async () => {
    await SELF.fetch(post(record()))
    await SELF.fetch(post(record({ moves: [{ by: 'player', action: { type: 'mulligan' } }] })))

    expect(await storedGames()).toHaveLength(2)
  })

  it('accepts a record without the optional fields', async () => {
    const { undoCount, build, opponentAi, humanSeat, ...bare } = record()
    void undoCount, build, opponentAi, humanSeat

    const response = await SELF.fetch(post(bare))

    expect(response.status).toBe(204)
    const [game] = await storedGames()
    expect(game.payload).toEqual(bare)
    expect(game.release).toBeNull()
    expect(game.commit_id).toBeNull()
  })

  it('keeps no rowid, which would keep the order games arrived in', async () => {
    await SELF.fetch(post(record()))

    await expect(env.GAME_DB.prepare('SELECT rowid FROM collected_games').all()).rejects.toThrow('no such column')
  })

  it('no longer writes the KV staging store', async () => {
    await SELF.fetch(post(record()))

    expect((await env.GAME_RECORDS.list()).keys).toEqual([])
  })

  it('does not tell the sender where the game was staged', async () => {
    const response = await SELF.fetch(post(record()))

    const key = await gameKey(record())
    expect([...response.headers].flat().join(' ')).not.toContain(key)
  })
})

describe('POST /records: nothing that identifies the sender is kept', () => {
  it('hands the store the key and the payload, and nothing from the request', async () => {
    const fake = fakeEnv()

    const response = await handleRecords(post(record(), { headers: IDENTIFYING, cf: CF }), fake)

    expect(response.status).toBe(204)
    expect(fake.GAME_DB.written).toHaveLength(1)
    const [{ args }] = fake.GAME_DB.written
    // The key, the day, the build's two fields and the payload: nothing else is bound.
    expect(args).toHaveLength(5)
    const [key, day, release, commitId, payload] = args
    expect(key).toBe(await gameKey(record()))
    expect(day).toMatch(UTC_DAY)
    expect([release, commitId]).toEqual(['412', 'abc1234'])
    const sent = JSON.parse(await gunzip(payload))
    expect(sent).toEqual(record())
    expect(Object.keys(sent).sort()).toEqual([...contract.required, ...contract.optional].sort())
    for (const tellTale of TELL_TALES) expect(JSON.stringify([key, day, release, commitId, sent])).not.toContain(tellTale)
  })

  it('stores nothing of the request in the real store either', async () => {
    await SELF.fetch(post(record(), { headers: IDENTIFYING, cf: CF }))

    const stored = JSON.stringify(await storedGames())
    for (const tellTale of TELL_TALES) expect(stored).not.toContain(tellTale)
  })

  it('logs nothing when it stages a record', async () => {
    const spies = watchConsole()

    await handleRecords(post(record(), { headers: IDENTIFYING, cf: CF }), fakeEnv())

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it.each([
    ['a refused payload', () => post(record({ extra: 'tell-tale-extra' }), { headers: IDENTIFYING, cf: CF }), fakeEnv],
    ['malformed JSON', () => post('{nope', { headers: IDENTIFYING, cf: CF }), fakeEnv],
    ['a store that fails', () => post(record(), { headers: IDENTIFYING, cf: CF }), () => fakeEnv({ GAME_DB: fakeDb({ fail: true }) })],
    ['a sender over the rate limit', () => post(record(), { headers: IDENTIFYING, cf: CF }), () => fakeEnv({ RECORDS_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) } })],
    ['collection switched off', () => post(record(), { headers: IDENTIFYING, cf: CF }), () => fakeEnv({ RECORD_COLLECTION: 'off' })],
  ])('logs nothing and echoes nothing on %s', async (_, makeRequest, makeEnv) => {
    const spies = watchConsole()

    const response = await handleRecords(makeRequest(), makeEnv())

    expect(response.status).toBeGreaterThanOrEqual(400)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    const said = (await response.text()) + JSON.stringify([...response.headers])
    for (const tellTale of [...TELL_TALES, 'tell-tale-extra']) expect(said).not.toContain(tellTale)
  })

  /**
   * The one use of the address: a counter the rate limiter keeps for its window and no longer. It
   * is passed as the limiter's key and goes nowhere else.
   */
  it('gives the sender’s address to the rate limiter only', async () => {
    const fake = fakeEnv()

    await handleRecords(post(record(), { headers: IDENTIFYING, cf: CF }), fake)

    expect(fake.RECORDS_RATE_LIMITER.limit).toHaveBeenCalledTimes(1)
    expect(fake.RECORDS_RATE_LIMITER.limit).toHaveBeenCalledWith({ key: '203.0.113.77' })
    expect(JSON.stringify(fake.GAME_DB.written)).not.toContain('203.0.113.77')
  })
})

describe('POST /records: validation', () => {
  const refused = async (body, init) => {
    const fake = fakeEnv()
    const response = await handleRecords(post(body, init), fake)
    expect(fake.GAME_DB.written).toEqual([])
    return response
  }

  it('refuses a key that is not on the list, so a client fault cannot put a new field in storage', async () => {
    expect((await refused(record({ playerDeckName: 'Mine' }))).status).toBe(400)
    expect((await refused(record({ id: 'c0ffee' }))).status).toBe(400)
    expect((await refused(record({ startedAt: 1 }))).status).toBe(400)
  })

  it.each(contract.required)('refuses a record without %s', async key => {
    const body = record()
    delete body[key]
    expect((await refused(body)).status).toBe(400)
  })

  it.each([
    ['a winner that is no seat', { winner: 'nobody' }],
    ['a duration that is not a number', { durationMs: '754000' }],
    ['a negative duration', { durationMs: -1 }],
    ['a leader that is not text', { playerLeader: 7 }],
    ['a starting position that is a list', { initialState: [] }],
    ['a starting position that still holds the card database', { initialState: { turn: 1, cards: {} } }],
    ['moves that are not a list', { moves: {} }],
    ['a move with no action', { moves: [{ by: 'player' }] }],
    ['a move by nobody', { moves: [{ by: 'spectator', action: { type: 'pass' } }] }],
    ['a move carrying an extra field', { moves: [{ by: 'player', action: { type: 'pass' }, at: 1 }] }],
    ['an action with no type', { moves: [{ by: 'player', action: {} }] }],
    ['a negative undo count', { undoCount: -1 }],
    ['a fractional undo count', { undoCount: 1.5 }],
    ['a build with an extra field', { build: { release: '412', commitId: 'abc1234', host: 'x' } }],
    ['a build with no commit', { build: { release: '412' } }],
    ['a human seat that is no seat', { humanSeat: 'both' }],
    ['an opponent name that is not text', { opponentAi: {} }],
  ])('refuses %s', async (_, over) => {
    expect((await refused(record(over))).status).toBe(400)
  })

  /** Ids and counters only: text a person could have typed has spaces and punctuation, and is refused wherever it sits. */
  it.each([
    ['in the starting position', { initialState: { turn: 1, note: 'Sam’s favourite deck' } }],
    ['in a move', { moves: [{ by: 'player', action: { type: 'pass', note: 'hello there' } }] }],
    ['as a key', { initialState: { turn: 1, 'my deck': 1 } }],
    ['as a leader', { playerLeader: 'Sam Smith' }],
    ['as an overlong id', { opponentAi: 'a'.repeat(contract.maxTextLength + 1) }],
  ])('refuses free text %s', async (_, over) => {
    expect((await refused(record(over))).status).toBe(400)
  })

  it('refuses a payload nested deeper than a game state goes', async () => {
    let deep = { turn: 1 }
    for (let i = 0; i < contract.maxDepth + 2; i++) deep = { inner: deep }
    expect((await refused(record({ initialState: deep }))).status).toBe(400)
  })

  it.each([['a list', '[]'], ['null', 'null'], ['a number', '7'], ['malformed JSON', '{"playerLeader":'], ['nothing', '']])(
    'refuses a body that is %s',
    async (_, body) => {
      expect((await refused(body)).status).toBe(400)
    },
  )

  it('refuses a body over the size cap', async () => {
    const big = record({ moves: Array.from({ length: 30000 }, () => ({ by: 'player', action: { type: 'pass', pad: 'x'.repeat(40) } })) })
    expect(JSON.stringify(big).length).toBeGreaterThan(contract.maxBytes)

    expect((await refused(big)).status).toBe(413)
  })

  it('refuses on the declared length before reading the body', async () => {
    const response = await refused(record(), { headers: { 'Content-Length': String(contract.maxBytes + 1) } })
    expect(response.status).toBe(413)
  })

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'])('refuses a %s body', async type => {
    expect((await refused(record(), { headers: { 'Content-Type': type } })).status).toBe(415)
  })

  it('accepts a JSON content type that names its charset', async () => {
    const fake = fakeEnv()
    const response = await handleRecords(post(record(), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }), fake)
    expect(response.status).toBe(204)
  })

  it.each(['GET', 'PUT', 'DELETE'])('refuses %s: a staged game cannot be read back or removed here', async method => {
    const fake = fakeEnv()
    const response = await handleRecords(new Request(URL_RECORDS, { method, headers: { Origin: ORIGIN } }), fake)

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS')
    expect(fake.GAME_DB.written).toEqual([])
  })

  it('does not hand a GET to the card passthrough', async () => {
    const upstream = vi.fn(() => new Response('{}'))
    vi.stubGlobal('fetch', upstream)

    const response = await SELF.fetch(URL_RECORDS)

    expect(response.status).toBe(405)
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('POST /records: origins', () => {
  it.each([ORIGIN, DEV_ORIGIN])('answers the preflight from %s', async origin => {
    const response = await SELF.fetch(URL_RECORDS, { method: 'OPTIONS', headers: { Origin: origin } })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
  })

  it('names the origin on the answer to a staged record', async () => {
    const response = await SELF.fetch(post(record()))
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })

  it('gives another origin no CORS header on the preflight', async () => {
    const response = await SELF.fetch(URL_RECORDS, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it.each([['another origin', 'https://evil.example'], ['no origin', null]])('refuses a record from %s', async (_, origin) => {
    const fake = fakeEnv()

    const response = await handleRecords(post(record(), { origin }), fake)

    expect(response.status).toBe(403)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(fake.GAME_DB.written).toEqual([])
  })
})

describe('POST /records: abuse limits and switching it off', () => {
  it('answers 429 and stages nothing when the limiter says no', async () => {
    const fake = fakeEnv({ RECORDS_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) } })

    const response = await handleRecords(post(record()), fake)

    expect(response.status).toBe(429)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(fake.GAME_DB.written).toEqual([])
  })

  /** The limiter as wrangler.toml binds it: 30 a minute for one sender, and another sender is not held up by it. */
  it('refuses one sender past the configured limit, and not the next sender', async () => {
    const from = address => SELF.fetch(post(record(), { headers: { 'CF-Connecting-IP': address } }))
    const statuses = []
    for (let i = 0; i < 31; i++) statuses.push((await from('198.51.100.200')).status)

    expect(statuses.slice(0, 30)).toEqual(Array(30).fill(204))
    expect(statuses[30]).toBe(429)
    expect((await from('198.51.100.201')).status).toBe(204)
  })

  /** The limiter guards the store. Without it the size cap and the validation still hold. */
  it.each([
    ['is not bound', () => ({ RECORDS_RATE_LIMITER: undefined })],
    ['fails', () => ({ RECORDS_RATE_LIMITER: { limit: vi.fn().mockRejectedValue(new Error('limiter down')) } })],
  ])('still stages a record when the limiter %s', async (_, over) => {
    const fake = fakeEnv(over())

    const response = await handleRecords(post(record()), fake)

    expect(response.status).toBe(204)
    expect(fake.GAME_DB.written).toHaveLength(1)
  })

  it.each([['off', 'off'], ['unset', undefined], ['anything but on', 'true']])('answers 503 and stages nothing when collection is %s', async (_, value) => {
    const fake = fakeEnv({ RECORD_COLLECTION: value })

    const response = await handleRecords(post(record()), fake)

    expect(response.status).toBe(503)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(fake.GAME_DB.written).toEqual([])
    expect(fake.RECORDS_RATE_LIMITER.limit).not.toHaveBeenCalled()
  })

  it('answers 503 when the store is not bound', async () => {
    const response = await handleRecords(post(record()), fakeEnv({ GAME_DB: undefined }))

    expect(response.status).toBe(503)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })

  /** Only a write that went through is answered 204: the device takes that answer as delivery. */
  it('answers 503 when the store refuses the write', async () => {
    const fake = fakeEnv({ GAME_DB: fakeDb({ fail: true }) })

    const response = await handleRecords(post(record()), fake)

    expect(response.status).toBe(503)
  })

  /** A Worker deployed with no store, no limiter and no switch still serves cards. */
  it('leaves the card routes working with nothing bound', async () => {
    const upstream = vi.fn(() => new Response(JSON.stringify({ Name: 'Test Card' }), { status: 200 }))
    vi.stubGlobal('fetch', upstream)

    const refused = await worker.fetch(post(record()), {})
    const card = await worker.fetch(new Request('https://worker.example/cards/ASH/020'), {})
    const art = await worker.fetch(new Request('https://worker.example/art/cards/ASH/020.png'), {})

    expect(refused.status).toBe(503)
    expect(card.status).toBe(200)
    expect(await card.json()).toEqual({ Name: 'Test Card' })
    expect(art.status).toBe(200)
    expect(upstream).toHaveBeenCalledWith(expect.stringContaining('api.swu-db.com/cards/ASH/020'))
  })
})
