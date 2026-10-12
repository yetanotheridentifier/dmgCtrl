import { db } from './db'
import { bundledSetCards } from './bundledSets'
import { cardId, fromSearchRow, SWU_DB_API } from './cards'
import type { SwuCard } from './cards'
import { logger } from './log'

/**
 * Full-set import: one SWUDB search call returns every card in a set
 * (Normal variants included for all types — notably the bases whose detail
 * endpoint 502s). Caching the set makes every later lookup cache-first, and
 * is the substrate for deck inspection. Sideboards remain out of
 * scope for pool import (user decision on).
 *
 * A bundled set (`bundledSets.ts`) is on the device in full already, so the deck screen only imports
 * a set that has no snapshot.
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

/**
 * How many cards of a set are on the device. A bundled set counts in full from the first visit, which
 * is what tells the deck screen it has nothing to import.
 */
export async function cachedSetCount(setCode: string): Promise<number> {
  return (await cachedSetCards(setCode)).length
}

/**
 * Every card of a set that is on the device, as the generator wants them: the bundled set, with the
 * cached copy of a card in place of the bundled one (the order `getCard` reads them in), and then
 * whatever else of the set the cache holds, such as a printing a deck list named.
 *
 * `json` is the raw SWUDB payload, which is what `SwuCard` describes, so this is a cast rather than a
 * conversion. For a set with no snapshot, cards that failed to cache simply are not here, and a
 * generator asked to build from a short pool reports the shortfall rather than throwing. A cache that
 * cannot be read leaves the bundled set.
 */
export async function cachedSetCards(setCode: string): Promise<SwuCard[]> {
  const set = setCode.toUpperCase()
  const cached = new Map<string, SwuCard>()
  try {
    for (const row of await db.cards.where('id').startsWith(`${set}_`).toArray()) cached.set(row.id, row.json as SwuCard)
  } catch (err) {
    logger.warn('card cache read failed, set read from the bundle alone', { set, error: String(err) })
  }

  const cards = (await bundledSetCards(set)).map(card => {
    const id = cardId(card.Set, card.Number)
    const copy = cached.get(id)
    cached.delete(id)
    return copy ?? card
  })
  return [...cards, ...cached.values()]
}
