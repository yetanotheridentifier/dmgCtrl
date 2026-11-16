/**
 * The list of games owed a collection attempt, as the device keeps it. The sender (`collectionSend.ts`)
 * adds and removes ids; the store's upgrade (`db.ts`) reads it once.
 *
 * It imports nothing, so `db.ts` can read it without importing the sender, which imports the card
 * module, which imports `db.ts`: Node's loader would evaluate that cycle with a binding still
 * uninitialised and stop the bench before it starts.
 */

/** localStorage: the ids of games that are owed an attempt, oldest first. Never leaves the device. */
export const PENDING_KEY = 'sealed_collection_pending'

/** How many undelivered games are remembered. Past it the oldest is let go, so the list is bounded. */
export const MAX_PENDING = 50

export function pendingIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function writePending(ids: string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(PENDING_KEY)
    else localStorage.setItem(PENDING_KEY, JSON.stringify(ids.slice(-MAX_PENDING)))
  } catch {
    // Storage that cannot be written loses the retry, not the game in progress.
  }
}
