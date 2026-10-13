import { SWU_DB_API } from './cards'
import { recordForCollection } from './collection'
import { db } from './db'
import type { GameRecord } from './gameRecords'
import { isDev } from '../env'

/**
 * The sender: the only code in the app that puts a game on the network.
 *
 * It sends what `recordForCollection` returns, as it stands, and nothing when that returns nothing,
 * so consent is answered in one place (`collection.ts`) and asked again on every attempt.
 *
 * Sending never gets in the way of play. It runs after the record is saved, nothing waits on it,
 * and every failure is silent: no message, no log line, no second attempt on the spot. A game that
 * could not be delivered is offered again the next time the app opens (`retryPendingCollection`).
 *
 * A dev build sends nothing: games played while developing are not what the bot should learn from,
 * and the endpoint does not accept the dev server's origin in any case.
 */

/** The card Worker, on the path it collects games at (`proxy/records.js`). */
export const COLLECTION_URL = `${SWU_DB_API}/records`

/** localStorage: the ids of games that are owed an attempt, oldest first. Never leaves the device. */
export const PENDING_KEY = 'sealed_collection_pending'

/** How many undelivered games are remembered. Past it the oldest is let go, so the list is bounded. */
export const MAX_PENDING = 50

/** How long one attempt may take before it counts as a failure. */
const TIMEOUT_MS = 20_000

function pendingIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writePending(ids: string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(PENDING_KEY)
    else localStorage.setItem(PENDING_KEY, JSON.stringify(ids.slice(-MAX_PENDING)))
  } catch {
    // Storage that cannot be written loses the retry, not the game in progress.
  }
}

/** A game already waiting keeps its place, so the oldest stays first. */
const remember = (id: string) => {
  const ids = pendingIds()
  if (!ids.includes(id)) writePending([...ids, id])
}
const forget = (id: string) => writePending(pendingIds().filter(other => other !== id))

/**
 * One attempt. `settled` means there is nothing more to do for this game: it was delivered, it may
 * not be sent, or the endpoint refused the payload itself and would refuse it again. `later` means
 * the attempt failed for a reason that may pass (offline, a timeout, a busy or switched-off server).
 */
async function attempt(record: GameRecord): Promise<'settled' | 'later'> {
  const payload = recordForCollection(record)
  if (payload === null) {
    forget(record.id)
    return 'settled'
  }
  remember(record.id)
  // Offline play is ordinary here, so it is not worth a request that can only fail.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'later'

  try {
    const response = await fetch(COLLECTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Nothing rides along that could say who is sending.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const passing = response.status >= 500 || response.status === 429 || response.status === 408
    if (passing) return 'later'
  } catch {
    return 'later'
  }
  forget(record.id)
  return 'settled'
}

/**
 * Offer one finished, saved game for collection. Resolves whatever happens and never throws, so a
 * caller can drop the promise.
 */
export async function sendForCollection(record: GameRecord): Promise<void> {
  if (isDev()) return
  try {
    await attempt(record)
  } catch {
    // Collection is never worth an error the player sees.
  }
}

let retrying = false

/**
 * Offer again the games that could not be delivered, oldest first, one at a time. It stops at the
 * first that fails, so an unreachable endpoint costs one request per app start, and a game that is
 * no longer on the device, or may no longer be sent, is dropped from the list.
 */
export async function retryPendingCollection(): Promise<void> {
  if (isDev() || retrying) return
  retrying = true
  try {
    for (const id of pendingIds()) {
      const record = await db.games.get(id)
      if (!record) {
        forget(id)
        continue
      }
      if ((await attempt(record)) === 'later') break
    }
  } catch {
    // As above: silent.
  } finally {
    retrying = false
  }
}
