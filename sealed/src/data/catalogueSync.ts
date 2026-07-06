import { db } from './db'
import { cardId, getCard } from './cards'
import { ensureThumb } from './thumbnails'

export interface CardRef {
  set: string
  number: string
}

export interface SyncResult {
  hydrated: number
  skipped: number
  failed: number
}

interface SyncOptions {
  onProgress?: (done: number, total: number) => void
}

/**
 * Progressive catalogue sync (T1.5): walk the given refs in order — callers pass
 * priority order (active deck cards first) — hydrating card JSON and thumbnails
 * for anything not yet cached. Individual failures don't stop the walk.
 */
export async function syncCatalogue(refs: CardRef[], opts: SyncOptions = {}): Promise<SyncResult> {
  const unique = new Map<string, CardRef>()
  for (const ref of refs) {
    const id = cardId(ref.set, ref.number)
    if (!unique.has(id)) unique.set(id, ref)
  }

  const result: SyncResult = { hydrated: 0, skipped: 0, failed: 0 }
  const total = unique.size
  let done = 0

  for (const [id, ref] of unique) {
    const cached = await db.cards.get(id)
    if (cached) {
      result.skipped++
    } else {
      try {
        await getCard(ref.set, ref.number)
        result.hydrated++
      } catch {
        result.failed++
        done++
        opts.onProgress?.(done, total)
        continue
      }
    }
    // Thumbnail is best-effort background work; ensureThumb never throws.
    await ensureThumb(ref.set, ref.number)
    done++
    opts.onProgress?.(done, total)
  }

  return result
}
