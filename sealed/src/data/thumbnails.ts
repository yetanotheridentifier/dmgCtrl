import { db } from './db'
import { cardId, SWU_DB_API } from './cards'
import type { SwuCard } from './cards'

/**
 * Rewrite a card-art URL to be fetchable from the browser (#311):
 * cdn.swu-db.com serves no CORS headers, so its images route through the
 * worker's /art passthrough. Hosts that do serve CORS (e.g.
 * cdn.starwarsunlimited.com, used by swuapi-sourced cards) pass unchanged.
 */
export function artUrl(frontArt: string | undefined): string | undefined {
  if (!frontArt) return undefined
  const CDN_PREFIX = 'https://cdn.swu-db.com/'
  if (frontArt.startsWith(CDN_PREFIX)) {
    return `${SWU_DB_API}/art/${frontArt.slice(CDN_PREFIX.length)}`
  }
  return frontArt
}

/**
 * Background thumbnail hydration (T1.4): once a card's JSON is cached, fetch its
 * art and store the bytes on the record. Never throws — callers fire-and-forget.
 * Returns true when a thumbnail is present on the record afterwards.
 *
 * The URL comes from the cached card's FrontArt. If the CDN grows a documented
 * low-res/WebP variant this is the one place to add it.
 */
export async function ensureThumb(set: string, number: string): Promise<boolean> {
  const id = cardId(set, number)

  const record = await db.cards.get(id)
  if (!record) return false
  if (record.thumb) return true

  const url = artUrl((record.json as SwuCard | undefined)?.FrontArt)
  if (!url) return false

  try {
    const response = await fetch(url)
    if (!response.ok) return false
    const buf = await response.arrayBuffer()
    const type = response.headers.get('content-type') ?? 'image/png'
    await db.cards.put({ ...record, thumb: { buf, type } })
    return true
  } catch {
    return false
  }
}
