import { db } from './db'
import { cardId, fromSearchRow, SWU_DB_API } from './cards'
import type { SwuCard } from './cards'
import { logger } from './log'

/**
 * Full-set import: one SWUDB search call returns every card in a set
 * (Normal variants included for all types — notably the bases whose detail
 * endpoint 502s). Caching the set makes every later lookup cache-first, and
 * is the substrate for deck inspection. Sideboards remain out of
 * scope for pool import (user decision on).
 */

export interface SetImportResult {
  cached: number
  total: number
}

interface SetImportOptions {
  onProgress?: (done: number, total: number) => void
}

interface SearchPayload {
  data?: SwuCard[]
}

export async function importSet(setCode: string, opts: SetImportOptions = {}): Promise<SetImportResult> {
  const set = setCode.toUpperCase()

  let response: Response
  try {
    response = await fetch(`${SWU_DB_API}/cards/search?q=set:${set}`)
  } catch (err) {
    logger.error('set import fetch rejected', { set, error: String(err) })
    throw new Error(`Set ${set} could not be fetched (${err instanceof Error ? err.message : String(err)})`, { cause: err })
  }
  if (!response.ok) {
    logger.error('set import fetch failed', { set, status: response.status })
    throw new Error(`Set ${set} could not be fetched (SWUDB ${response.status})`)
  }

  const payload = (await response.json()) as SearchPayload
  const normals = (payload.data ?? []).map(fromSearchRow).filter(c => c.VariantType == null || c.VariantType === 'Normal')

  let cached = 0
  for (const card of normals) {
    await db.cards.put({ id: cardId(card.Set, card.Number), json: card, fetchedAt: Date.now() })
    cached++
    opts.onProgress?.(cached, normals.length)
  }

  logger.info('set import complete', { set, cached, total: normals.length })
  return { cached, total: normals.length }
}

/** How many cards of a set are in the local cache. */
export async function cachedSetCount(setCode: string): Promise<number> {
  const prefix = `${setCode.toUpperCase()}_`
  return db.cards.where('id').startsWith(prefix).count()
}

/**
 * Every cached card of a set, as the generator wants them.
 *
 * `json` is the raw SWUDB payload, which is what `SwuCard` describes, so this is a cast rather than a
 * conversion. Cards that failed to cache simply are not here, and a generator asked to build from a
 * short pool reports the shortfall rather than throwing.
 */
export async function cachedSetCards(setCode: string): Promise<SwuCard[]> {
  const prefix = `${setCode.toUpperCase()}_`
  const rows = await db.cards.where('id').startsWith(prefix).toArray()
  return rows.map(r => r.json as SwuCard)
}

/**
 * The set to build a generated deck from: whichever has the most cards cached.
 *
 * Chosen rather than asked for, because a generated deck is a convenience and a second set-code input
 * beside the import one would be two fields meaning nearly the same thing. A sealed deck comes from a
 * single set, so mixing them would be wrong; picking the largest keeps that true without a choice to
 * make. `null` when nothing is cached, which the caller shows as "import a set first".
 */
export async function largestCachedSet(): Promise<{ set: string; cards: SwuCard[] } | null> {
  const rows = await db.cards.toArray()
  const bySet = new Map<string, SwuCard[]>()
  for (const r of rows) {
    const set = r.id.split('_')[0]
    if (!set) continue
    const list = bySet.get(set) ?? []
    list.push(r.json as SwuCard)
    bySet.set(set, list)
  }
  let best: { set: string; cards: SwuCard[] } | null = null
  for (const [set, cards] of bySet) {
    if (!best || cards.length > best.cards.length) best = { set, cards }
  }
  return best
}
