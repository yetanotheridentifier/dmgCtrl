import Dexie, { type EntityTable } from 'dexie'
import type { GameRecord } from './gameRecords'

/**
 * One cached card. `json` is the full SWUDB card-detail payload (typed loosely
 * until hydration pins the fields we actually read); `thumb` is a low-res
 * WebP thumbnail added later — full art is fetched on demand, never cached.
 * Thumbnails are stored as raw bytes + mime type rather than a Blob: ArrayBuffers
 * structured-clone reliably in every IndexedDB implementation (Blobs do not).
 */
export interface CardRecord {
  id: string
  json: unknown
  thumb?: { buf: ArrayBuffer; type: string }
  fetchedAt: number
}

class SealedDB extends Dexie {
  cards!: EntityTable<CardRecord, 'id'>
  games!: EntityTable<GameRecord, 'id'>

  constructor() {
    super('dmgctrl-sealed')
    this.version(1).stores({
      // Primary key only — cards are always looked up by id.
      cards: 'id',
    })
    // v2: completed-game records. endedAt is indexed for newest-first
    // listing. SQLite/Drizzle migration is deferred to Epic 7, whose training
    // pipeline is the actual SQLite consumer — records here are JSON-exportable.
    this.version(2).stores({
      cards: 'id',
      games: 'id, endedAt',
    })
  }
}

export const db = new SealedDB()
