import { db } from './db'
import { logger } from './log'

// api.swu-db.com serves no CORS headers, so browser fetches are blocked.
// The dmgCtrl Cloudflare worker's fallback route proxies any path to
// api.swu-db.com and adds Access-Control-Allow-Origin (see proxy/worker.js).
export const SWU_DB_API = 'https://worker.dmgctrl.app'

// Secondary source: SWUDB's card-detail endpoint 502s on some cards (observed:
// the entire ASH base range). swuapi.com serves bases with CORS enabled — the
// same source the main dmgCtrl app uses for base data.
export const SWUAPI_URL = 'https://api.swuapi.com'

/**
 * Card detail as served by the swu-db.com API (PascalCase fields).
 * Only the fields the app reads are declared; the full payload is cached as-is.
 * Numeric-looking fields (Cost/Power/HP) arrive as strings from the API.
 */
export interface SwuCard {
  Set: string
  Number: string
  Name: string
  Subtitle?: string
  Type: string
  Arenas?: string[]
  Cost?: string
  Power?: string
  HP?: string
  Aspects?: string[]
  Traits?: string[]
  FrontText?: string
  BackText?: string
  EpicAction?: string
  DoubleSided?: boolean
  Unique?: boolean
  Keywords?: string[]
  FrontArt?: string
  BackArt?: string
  Rarity?: string
}

/** swuapi.com card shape (snake_case) — only the fields we map. */
interface SwuApiCard {
  collector_number: string
  name: string
  subtitle: string | null
  type: string
  aspects: string[] | null
  traits: string[] | null
  arena: string | null
  cost: number | null
  power: number | null
  hp: number | null
  front_text: string | null
  double_sided: boolean | null
  rarity: string | null
  unique_flag: boolean | null
  variant_type: string | null
  front_image_url: string | null
}

export function cardId(set: string, number: string): string {
  return `${set.toUpperCase()}_${number}`
}

function mapSwuApiCard(card: SwuApiCard): SwuCard {
  const [set, number] = card.collector_number.split('_')
  return {
    Set: set,
    Number: number,
    Name: card.name,
    ...(card.subtitle != null && { Subtitle: card.subtitle }),
    Type: card.type,
    ...(card.arena != null && { Arenas: [card.arena] }),
    ...(card.cost != null && { Cost: String(card.cost) }),
    ...(card.power != null && { Power: String(card.power) }),
    ...(card.hp != null && { HP: String(card.hp) }),
    Aspects: card.aspects ?? [],
    Traits: card.traits ?? [],
    ...(card.front_text != null && { FrontText: card.front_text }),
    DoubleSided: card.double_sided ?? false,
    Unique: card.unique_flag ?? false,
    ...(card.front_image_url != null && { FrontArt: card.front_image_url }),
    ...(card.rarity != null && { Rarity: card.rarity }),
  }
}

/**
 * Fallback lookup: page through swuapi's Base list for the card. The observed
 * SWUDB failure domain is bases, so only bases are searched; anything else
 * that fails will surface by id via the thrown error and the log.
 */
async function fetchBaseFromSwuApi(set: string, number: string): Promise<SwuCard | null> {
  const id = cardId(set, number)
  let cursor: string | null = null
  do {
    const url: string = cursor
      ? `${SWUAPI_URL}/cards?type=Base&variant=all&limit=100&after=${cursor}`
      : `${SWUAPI_URL}/cards?type=Base&variant=all&limit=100`
    let response: Response
    try {
      response = await fetch(url)
    } catch (err) {
      logger.warn('swuapi fallback fetch rejected', { id, error: String(err) })
      return null
    }
    if (!response.ok) {
      logger.warn('swuapi fallback fetch failed', { id, status: response.status })
      return null
    }
    const json = (await response.json()) as { cards: SwuApiCard[]; pagination?: { next_cursor: string | null } }
    const hit = json.cards.find(
      c => c.collector_number?.toUpperCase() === id && (c.variant_type == null || c.variant_type === 'Standard' || c.variant_type === 'Normal'),
    )
    if (hit) return mapSwuApiCard(hit)
    cursor = json.pagination?.next_cursor ?? null
  } while (cursor)
  return null
}

/**
 * Local-first card lookup: cached record → SWUDB (via worker) → swuapi base
 * fallback. Failed fetches cache nothing and throw an error naming the card.
 */
export async function getCard(set: string, number: string): Promise<SwuCard> {
  const id = cardId(set, number)

  // The cache is an optimisation, never a gatekeeper: a broken IndexedDB
  // (crossed schema versions during dev, private browsing, quota) must not
  // block hydration while the network path still works.
  try {
    const cached = await db.cards.get(id)
    if (cached) return cached.json as SwuCard
  } catch (err) {
    logger.warn('card cache read failed — continuing to network', { id, error: String(err) })
  }

  // A browser rejects the whole fetch for CORS-blocked responses ("Failed to
  // fetch") — e.g. Cloudflare's 1101 worker-exception page, which carries no
  // CORS headers. Treat a rejection exactly like an error status: try the
  // fallback source before giving up.
  let primaryStatus: string
  try {
    const response = await fetch(`${SWU_DB_API}/cards/${set.toUpperCase()}/${number}`)
    if (response.ok) {
      const json = (await response.json()) as SwuCard
      await cacheCard(id, json)
      return json
    }
    primaryStatus = String(response.status)
  } catch (err) {
    primaryStatus = `unreachable: ${err instanceof Error ? err.message : String(err)}`
  }

  logger.warn('SWUDB card fetch failed, trying swuapi fallback', { id, primaryStatus })
  const fallback = await fetchBaseFromSwuApi(set, number)
  if (fallback) {
    logger.info('card hydrated via swuapi fallback', { id })
    await cacheCard(id, fallback)
    return fallback
  }

  logger.error('card hydration failed on all sources', { id, primaryStatus })
  throw new Error(`Card ${id} could not be loaded (SWUDB ${primaryStatus}, no swuapi match)`)
}

async function cacheCard(id: string, json: SwuCard): Promise<void> {
  try {
    await db.cards.put({ id, json, fetchedAt: Date.now() })
  } catch (err) {
    logger.warn('card cache write failed — card served uncached', { id, error: String(err) })
  }
}
