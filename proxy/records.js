import contract from './recordContract.json'

/**
 * POST /records: stages one finished game, sent by a player who opted in to sharing games.
 *
 * The notice that player agreed to says nothing identifies them, that their IP address is not
 * linked to games, and that a sent game cannot be found and deleted later. This module is what
 * makes those true on the server, so the rules are strict:
 *
 * - **The staged value is the validated payload and nothing else.** No address, header, `cf` field
 *   or arrival time is written with it, and the write passes no metadata and no expiry (an expiry
 *   is a write time in disguise).
 * - **Nothing is logged.** This module never calls `console`, not even on an error: a log line is
 *   a second store, with a timestamp on it.
 * - **The key is made from the game alone** (`gameKey`), so the same game sent twice is staged
 *   once, and no id is minted that the sender could be told or later ask for.
 * - **There is no way to read or remove a staged game through the Worker.** Only POST and its
 *   preflight are served.
 * - **The address is used once**, as the key of the rate limiter's counter, which Cloudflare keeps
 *   for the limiter's window and which cannot be read back. It goes nowhere else.
 *
 * What a payload may hold is data (`recordContract.json`), which a test in the Sealed package
 * reads to hold the app's real payload to it. The field list is a copy of `CollectedRecord` in
 * sealed/src/data/collection.ts: a field added there must be added here, or it is refused.
 */

const ALLOWED_ORIGINS = new Set([
  'https://dmgctrl.app',
  'https://dev.dmgctrl.app',
])

const ALLOWED_KEYS = new Set([...contract.required, ...contract.optional])
const TEXT = new RegExp(contract.text)
const SEATS = new Set(['player', 'opponent'])
const WINNERS = new Set(['player', 'opponent', 'draw'])
const KEY_PREFIX = 'records/'

function corsHeaders(origin) {
  if (!ALLOWED_ORIGINS.has(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

/** An answer that says what went wrong in a fixed word, and never repeats anything it was sent. */
function refuse(status, error, headers) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = value => typeof value === 'string' && value.length <= contract.maxTextLength && TEXT.test(value)
const hasOnly = (object, keys) => Object.keys(object).every(key => keys.includes(key))

/**
 * Ids and counters only, all the way down. Every string, keys included, is short and drawn from
 * the characters ids are written in, so text a person typed (a deck name, a note) is refused
 * wherever a future client might put it. Depth is bounded so the walk is.
 */
function isPlainData(value, depth = 0) {
  if (depth > contract.maxDepth) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return isText(value)
  if (Array.isArray(value)) return value.every(item => isPlainData(item, depth + 1))
  if (typeof value !== 'object') return false
  return Object.entries(value).every(([key, item]) => isText(key) && isPlainData(item, depth + 1))
}

const isMove = move =>
  isObject(move) && hasOnly(move, ['by', 'action']) && SEATS.has(move.by) && isObject(move.action) && typeof move.action.type === 'string'

/** The record rebuilt from its named fields, or `null` when the body is not one. */
function validRecord(body) {
  if (!isObject(body)) return null
  const keys = Object.keys(body)
  if (!keys.every(key => ALLOWED_KEYS.has(key))) return null
  if (!contract.required.every(key => keys.includes(key))) return null
  if (!isPlainData(body)) return null

  const ids = [body.playerLeader, body.playerBase, body.opponentLeader, body.opponentBase]
  if (!ids.every(id => typeof id === 'string' && id.length > 0)) return null
  if (!WINNERS.has(body.winner)) return null
  if (typeof body.durationMs !== 'number' || body.durationMs < 0) return null
  // The card database is stripped before a game is sent: it is most of a state's bytes.
  if (!isObject(body.initialState) || 'cards' in body.initialState) return null
  if (!Array.isArray(body.moves) || !body.moves.every(isMove)) return null
  if ('undoCount' in body && !(Number.isInteger(body.undoCount) && body.undoCount >= 0)) return null
  if ('build' in body) {
    const { build } = body
    if (!isObject(build) || !hasOnly(build, ['release', 'commitId'])) return null
    if (typeof build.release !== 'string' || typeof build.commitId !== 'string') return null
  }
  if ('opponentAi' in body && typeof body.opponentAi !== 'string') return null
  if ('humanSeat' in body && !SEATS.has(body.humanSeat)) return null

  const record = {}
  for (const key of [...contract.required, ...contract.optional]) {
    if (key in body) record[key] = body[key]
  }
  return record
}

/**
 * A key for the game itself: a hash of its starting position and its moves. The same definition as
 * `gameKey` in sealed/src/bench/trainingRows.ts (a copy: the two packages share no code), so a
 * staged game and the training rows made from it carry one key, and both sides pin one vector.
 */
export async function gameKey(record) {
  const bytes = new TextEncoder().encode(JSON.stringify([record.initialState, record.moves]))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

/** The body as text, or `null` once it runs past the cap or is not UTF-8. Reads no further than the cap. */
async function readCapped(request) {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > contract.maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** Whether this sender is within the limit. With no limiter bound, or one that fails, everyone is. */
async function withinRateLimit(request, env) {
  if (!env.RECORDS_RATE_LIMITER) return true
  try {
    // The only use of the address. It is the counter's key and is written nowhere.
    const { success } = await env.RECORDS_RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' })
    return success
  } catch {
    return true
  }
}

export async function handleRecords(request, env) {
  const origin = request.headers.get('Origin') ?? ''
  const cors = corsHeaders(origin)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }
  if (request.method !== 'POST') {
    return refuse(405, 'method_not_allowed', { Allow: 'POST, OPTIONS', ...cors })
  }
  if (!ALLOWED_ORIGINS.has(origin)) {
    return refuse(403, 'origin_not_allowed', cors)
  }
  // The switch (`RECORD_COLLECTION` in wrangler.toml) and the store. Without either, nothing is
  // collected and the rest of the Worker carries on.
  if (env.RECORD_COLLECTION !== 'on' || !env.GAME_RECORDS) {
    return refuse(503, 'collection_off', cors)
  }
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') {
    return refuse(415, 'json_only', cors)
  }
  if (Number(request.headers.get('Content-Length') ?? 0) > contract.maxBytes) {
    return refuse(413, 'too_large', cors)
  }
  if (!(await withinRateLimit(request, env))) {
    return refuse(429, 'slow_down', cors)
  }

  const text = await readCapped(request)
  if (text === null) {
    return refuse(413, 'too_large', cors)
  }
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return refuse(400, 'not_a_record', cors)
  }
  const record = validRecord(body)
  if (!record) {
    return refuse(400, 'not_a_record', cors)
  }

  try {
    // A key and a value. No third argument: metadata and an expiry would both be kept beside the game.
    await env.GAME_RECORDS.put(KEY_PREFIX + (await gameKey(record)), JSON.stringify(record))
  } catch {
    return refuse(503, 'not_staged', cors)
  }
  return new Response(null, { status: 204, headers: cors })
}
