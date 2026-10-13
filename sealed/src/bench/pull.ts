import type { DatabaseSync } from 'node:sqlite'
import type { CollectedRecord } from '../data/collection'
import type { CardDb } from '../engine/types'
import { archiveGame, hasGame, readSnapshot, today, writeSnapshot, type ArchivedGame, type SnapshotFile } from './recordArchive'
import { GET_BATCH, STAGING_PREFIX, type StagingStore } from './staging'
import { gameKey, replayedStates } from './trainingRows'

/**
 * Pulling collected games out of staging (`staging.ts`) into the archive (`recordArchive.ts`).
 *
 * **A game is archived only when it checks out** (`verifyStaged`): its key is the key of its own
 * starting position and moves, and it replays on this build to the winner it names. The first
 * catches a value that was damaged or altered, since the Worker made the key from the game; the
 * second is the check the row tool makes, made here so nothing reaches the archive that could not
 * become rows. A game that fails is reported with its key and the reason and is otherwise left
 * alone: not archived, and never deleted.
 *
 * **A pull is read-only unless told to delete**, and a delete names only keys that were listed in
 * this run and whose games the archive holds. The order is what makes it safe to be cut off
 * anywhere:
 *
 * 1. each game is its own committed write to the archive, as it is verified;
 * 2. then the snapshot is written, and read back to see that it holds every game about to go;
 * 3. only then is the delete issued.
 *
 * A run that stops before 3, or whose delete fails, leaves games both staged and archived. The next
 * pull sees them as duplicates, fetches nothing and deletes them then.
 *
 * **A delete needs a snapshot folder.** After it the archive is the only copy of those games, and
 * one file on one disk is not a place to keep the only copy of something that cannot be collected
 * again. So the backup is not left to be remembered afterwards: the delete is refused without it.
 */

const GAME_KEY = /^[0-9a-f]{16}$/

/**
 * One staged value, checked. Returns the game's key and the payload as it is archived (the staged
 * JSON, serialised again so it is one line whatever spacing it arrived in). Throws with the reason
 * for a value that is not the game its key names, or does not replay to its own result.
 */
export function verifyStaged(key: string, text: string, cards: CardDb): { gameKey: string; payload: string } {
  const named = key.startsWith(STAGING_PREFIX) ? key.slice(STAGING_PREFIX.length) : key
  if (!GAME_KEY.test(named)) throw new Error('not a game key: a staged game is named by 16 hex digits')
  let record: Partial<CollectedRecord> | null
  try {
    record = JSON.parse(text) as Partial<CollectedRecord> | null
  } catch {
    throw new Error('the value is not JSON')
  }
  if (!record || typeof record !== 'object' || typeof record.initialState !== 'object' || record.initialState === null || !Array.isArray(record.moves) || typeof record.winner !== 'string') {
    throw new Error('the value is not a game record: it has no starting position, moves or winner')
  }
  const game = record as CollectedRecord
  const actual = gameKey(game)
  if (actual !== named) throw new Error(`the key does not match the game: the value is game ${actual}`)
  replayedStates(game, cards)
  return { gameKey: named, payload: JSON.stringify(game) }
}

export interface PullOptions {
  /** Remove from staging the listed games the archive holds. Needs `backupDir`, unless `dryRun`. */
  delete?: boolean
  /** With `delete`: remove nothing, and say what would be removed (`removable`). */
  dryRun?: boolean
  /** Write a snapshot of the archive to this folder once the pull is done. */
  backupDir?: string
  /** The day to mark newly pulled games with. Today unless given. */
  day?: string
  /** How many values to fetch at once. The store's own limit unless given. */
  batch?: number
  /** How a snapshot is read back before a delete. The real reader unless given. */
  readBack?: (path: string) => ArchivedGame[]
}

export interface PullResult {
  /** Keys found in staging. */
  listed: number
  /** Games archived by this run. */
  pulled: number
  /** Staged games the archive already held, which were not fetched again. */
  duplicates: number
  /** Staged values that were not archived, with why. They are still staged. */
  refused: { key: string; reason: string }[]
  /** The staged keys whose games the archive holds: exactly what a delete removes. */
  removable: string[]
  snapshot?: SnapshotFile
  /** The keys removed from staging by this run. */
  deleted: string[]
  /** Why nothing was deleted, when a delete was asked for and could not be done. */
  deleteFailed?: string
}

export function pullStaged(staging: StagingStore, db: DatabaseSync, cards: CardDb, options: PullOptions = {}): PullResult {
  const deleting = options.delete === true && options.dryRun !== true
  if (deleting && options.backupDir === undefined) {
    throw new Error('--delete needs --backup DIR: once a game is removed from staging the archive is its only copy')
  }
  const day = options.day ?? today()
  const batch = options.batch ?? GET_BATCH

  const listed = new Set<string>()
  let cursor: string | undefined
  do {
    const page = staging.list(cursor)
    for (const key of page.keys) listed.add(key)
    cursor = page.cursor
  } while (cursor !== undefined)

  const result: PullResult = { listed: listed.size, pulled: 0, duplicates: 0, refused: [], removable: [], deleted: [] }
  const held = (key: string): boolean => key.startsWith(STAGING_PREFIX) && hasGame(db, key.slice(STAGING_PREFIX.length))
  const wanted: string[] = []
  for (const key of listed) {
    if (held(key)) result.duplicates++
    else wanted.push(key)
  }

  for (let from = 0; from < wanted.length; from += batch) {
    const keys = wanted.slice(from, from + batch)
    const values = staging.get(keys)
    for (const key of keys) {
      const text = values.get(key)
      try {
        if (text === undefined) throw new Error('listed, but no value came back for it')
        const game = verifyStaged(key, text, cards)
        archiveGame(db, { gameKey: game.gameKey, pulledDay: day, payload: game.payload })
        result.pulled++
      } catch (err) {
        result.refused.push({ key, reason: (err as Error).message })
      }
    }
  }

  result.removable = [...listed].filter(held).sort()
  if (options.backupDir !== undefined) result.snapshot = writeSnapshot(db, options.backupDir, day)
  if (!deleting || result.removable.length === 0) return result

  try {
    const saved = new Set((options.readBack ?? readSnapshot)(result.snapshot!.path).map(game => STAGING_PREFIX + game.gameKey))
    const unsaved = result.removable.filter(key => !saved.has(key))
    if (unsaved.length > 0) throw new Error(`the snapshot ${result.snapshot!.path} does not hold ${unsaved.length} of the games to remove`)
    staging.delete(result.removable)
    result.deleted = result.removable
  } catch (err) {
    result.deleteFailed = (err as Error).message
  }
  return result
}
