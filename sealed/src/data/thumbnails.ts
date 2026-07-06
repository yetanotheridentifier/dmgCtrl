import { db } from './db'
import { cardId } from './cards'
import type { SwuCard } from './cards'

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

  const artUrl = (record.json as SwuCard | undefined)?.FrontArt
  if (!artUrl) return false

  try {
    const response = await fetch(artUrl)
    if (!response.ok) return false
    const buf = await response.arrayBuffer()
    const type = response.headers.get('content-type') ?? 'image/png'
    await db.cards.put({ ...record, thumb: { buf, type } })
    return true
  } catch {
    return false
  }
}
