import Dexie, { type EntityTable } from 'dexie'
import { pendingIds } from './collectionPending'
import type { SavedGame } from './gameRecords'

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
  games!: EntityTable<SavedGame, 'id'>

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
    // v3: the same tables. A game that may lose its replay data once delivered needs to say it was,
    // and records saved before then carry no mark. The sender let go of a game once it was settled,
    // so a game finished while sharing that is no longer owed an attempt is read as delivered. This
    // runs once, before anything else opens the store.
    this.version(3)
      .stores({ cards: 'id', games: 'id, endedAt' })
      .upgrade(tx => {
        const waiting = new Set(pendingIds())
        return tx
          .table<SavedGame, string>('games')
          .toCollection()
          .modify(game => {
            if (game.consentedAtFinish && !waiting.has(game.id)) game.delivered = true
          })
      })
  }
}

export const db = new SealedDB()
