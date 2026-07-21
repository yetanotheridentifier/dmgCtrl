import { db } from './db'
import { cardId, SWU_DB_API } from './cards'
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
  const normals = (payload.data ?? []).filter(c => c.VariantType == null || c.VariantType === 'Normal')

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
