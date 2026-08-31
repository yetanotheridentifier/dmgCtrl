/**
 * Populates the base_aspects InfluxDB measurement with baseKey → aspect mappings.
 * Re-run whenever a new set is released. Runs nightly to stay inside InfluxDB's
 * 30-day retention window.
 *
 * Usage: node scripts/populate-base-aspects.mjs
 * Requires: INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG in environment or local .env.influxdb file
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.influxdb from project root if present
try {
  const env = readFileSync(resolve(__dirname, '..', '.env.influxdb'), 'utf-8')
  for (const line of env.split('\n')) {
    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue
    const key = line.slice(0, eqIdx).trim()
    const val = line.slice(eqIdx + 1).trim()
    if (key && !process.env[key]) process.env[key] = val
  }
} catch { /* no .env, rely on environment */ }

const SWUAPI_URL = 'https://api.swuapi.com'
const SWU_DB_URL = 'https://api.swu-db.com'

// ---------------------------------------------------------------------------
// Pure functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Merges swuapi and swu-db card lists into { baseKey, aspect } pairs.
 * swuapi covers current sets; swu-db covers rotated sets (SOR, SHD, TWI).
 */
export function buildBaseAspects(swuApiCards, swuDbCards) {
  const bases = []
  const swuApiSetCodes = new Set()
  const seen = new Set()

  for (const card of swuApiCards) {
    if (card.variant_type !== 'Standard') continue
    const key = `${card.set_code}|${card.card_number}`
    if (seen.has(key)) continue
    seen.add(key)
    swuApiSetCodes.add(card.set_code)
    const baseKey = `${card.set_code}-${String(card.card_number).padStart(3, '0')}`
    const aspect = card.aspects?.[0] ?? 'None'
    bases.push({ baseKey, aspect })
  }

  for (const card of swuDbCards) {
    if (swuApiSetCodes.has(card.Set)) continue
    const baseKey = `${card.Set}-${card.Number}`
    const aspect = Array.isArray(card.Aspects) ? (card.Aspects[0] ?? 'None') : 'None'
    bases.push({ baseKey, aspect })
  }

  return bases
}

/**
 * Converts a base→aspect pair to an InfluxDB line protocol record.
 * Every record in a run shares one timestamp, so a query can select a whole run.
 */
export function toLineProtocol(baseKey, aspect, timestampSeconds) {
  const escapedKey = baseKey.replace(/[, =]/g, '\\$&')
  return `base_aspects,baseKey=${escapedKey} aspect="${aspect}" ${timestampSeconds}`
}

// ---------------------------------------------------------------------------
// I/O (not executed when imported by tests)
// ---------------------------------------------------------------------------

async function fetchSwuApiCards() {
  const allCards = []
  let cursor = null
  do {
    const url = cursor
      ? `${SWUAPI_URL}/cards?type=Base&variant=all&limit=100&after=${cursor}`
      : `${SWUAPI_URL}/cards?type=Base&variant=all&limit=100`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`swuapi fetch failed: ${res.status}`)
    const json = await res.json()
    allCards.push(...json.cards)
    cursor = json.pagination?.next_cursor ?? null
  } while (cursor)
  return allCards
}

/**
 * Lists every set code swuapi knows about, used to scope the swu-db queries.
 */
export async function fetchSetCodes(fetchImpl = fetch) {
  const res = await fetchImpl(`${SWUAPI_URL}/sets`)
  if (!res.ok) throw new Error(`swuapi sets fetch failed: ${res.status}`)
  const json = await res.json()
  return (json.sets ?? []).map(s => s.code)
}

/**
 * Fetches base cards from swu-db one set at a time.
 *
 * A single unscoped `type:base` query is a single point of failure: swu-db
 * returns 502 for the whole query if any one set's base records cannot be
 * served. Scoping per set confines that to the offending set, which is
 * reported in `skipped` so the caller can warn rather than lose every set.
 */
export async function fetchSwuDbBases(setCodes, fetchImpl = fetch) {
  const cards = []
  const skipped = []

  for (const setCode of setCodes) {
    const url = `${SWU_DB_URL}/cards/search?q=type:base+set:${setCode.toLowerCase()}`
    let res
    try {
      res = await fetchImpl(url)
    } catch {
      skipped.push(setCode)
      continue
    }
    if (!res.ok) {
      skipped.push(setCode)
      continue
    }
    const json = await res.json()
    for (const card of json.data ?? []) {
      if (card.VariantType === 'Normal') cards.push(card)
    }
  }

  return { cards, skipped }
}

async function writeToInfluxDB(lines) {
  const { INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG } = process.env
  if (!INFLUXDB_URL || !INFLUXDB_TOKEN || !INFLUXDB_ORG) {
    throw new Error('Missing INFLUXDB_URL, INFLUXDB_TOKEN, or INFLUXDB_ORG')
  }
  const writeUrl = `${INFLUXDB_URL}/api/v2/write?org=${encodeURIComponent(INFLUXDB_ORG)}&bucket=dmgctrl&precision=s`
  const res = await fetch(writeUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${INFLUXDB_TOKEN}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: lines.join('\n'),
  })
  if (!res.ok) throw new Error(`InfluxDB write failed: ${res.status} ${await res.text()}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Fetching base data...')
  const [swuApiCards, setCodes] = await Promise.all([fetchSwuApiCards(), fetchSetCodes()])

  // swu-db is only consulted for sets swuapi has no bases for, so skip the rest.
  const coveredBySwuApi = new Set(
    swuApiCards.filter(c => c.variant_type === 'Standard').map(c => c.set_code)
  )
  const setsToFetch = setCodes.filter(code => !coveredBySwuApi.has(code))

  console.log(`Fetching ${setsToFetch.length} set(s) from swu-db...`)
  const { cards: swuDbCards, skipped } = await fetchSwuDbBases(setsToFetch)
  if (skipped.length > 0) {
    console.warn(
      `Warning: swu-db could not serve ${skipped.length} set(s): ${skipped.join(', ')}. ` +
        'Their bases are omitted from this run; previously written records are unchanged.'
    )
  }

  const bases = buildBaseAspects(swuApiCards, swuDbCards)
  const runTimestamp = Math.floor(Date.now() / 1000)
  const lines = bases.map(({ baseKey, aspect }) => toLineProtocol(baseKey, aspect, runTimestamp))

  console.log(`Writing ${bases.length} base→aspect records to InfluxDB...`)
  await writeToInfluxDB(lines)

  const byAspect = Object.groupBy(bases, b => b.aspect)
  for (const [aspect, entries] of Object.entries(byAspect).sort()) {
    console.log(`  ${aspect} (${entries.length}): ${entries.map(e => e.baseKey).join(', ')}`)
  }
  console.log('Done.')
}
