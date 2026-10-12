import { db } from './db'
import { buildGameExport, downloadJson } from './recordExport'
import type { Action } from '../engine/actions'
import type { GameState, PlayerId } from '../engine/types'

/**
 * Completed-game record. `initialState` + `moves`
 * deterministically replay the whole game through the pure resolver, which is
 * exactly the substrate the Epic 7 training pipeline needs later.
 */
export interface GameRecord {
  id: string
  playerDeckName: string
  opponentDeckName: string
  winner: PlayerId | 'draw'
  /**
   * When the board was dealt and when the winner appeared, in milliseconds since the epoch. A
   * record with no `build` was written at a time when both were taken at the end, so its
   * `startedAt` is its `endedAt` and says nothing about how long the game took.
   */
  startedAt: number
  endedAt: number
  initialState: GameState
  moves: { by: PlayerId; action: Action }[]
  finalState: GameState
  /**
   * How many times the player took a move back while playing this game. Undone moves are
   * truncated out of `moves`, so a game played with undo replays perfectly and is otherwise
   * indistinguishable from one played straight through: a consumer that treats a retried line
   * as a played line has no way to tell. Not an indexed key, so it needs no schema version.
   *
   * Absent on records written before it was counted, which means provenance unknown rather
   * than zero. It cannot be backfilled.
   */
  undoCount?: number
  /**
   * The build that played the game: its rules and its AI produced these moves, and a later build
   * may resolve the same moves differently. Written when the record is saved, like the two fields
   * below. None of the three is an indexed key, so none needs a schema version, and each is absent
   * on records written before it was captured, which means unknown and cannot be backfilled.
   */
  build?: BuildIdentity
  /**
   * The registered name the opponent played as (`ai/registry.ts`). Absent as well when the
   * opponent was handed in as a function with no name, as tests do.
   */
  opponentAi?: string
  /**
   * The seat the person held. The other seat's moves are the AI's, which is what tells a consumer
   * whose decisions it is reading.
   */
  humanSeat?: PlayerId
}

/** Both identifiers of a build: the release a person quotes and the commit that pins the code. */
export interface BuildIdentity {
  release: string
  commitId: string
}

export async function saveGameRecord(record: Omit<GameRecord, 'id'>): Promise<GameRecord> {
  const saved: GameRecord = { ...record, id: crypto.randomUUID() }
  await db.games.put(saved)
  return saved
}

/** Newest first. */
export async function listGameRecords(): Promise<GameRecord[]> {
  return db.games.orderBy('endedAt').reverse().toArray()
}

/**
 * Wipe every saved game, returning how many went. Touches only `games` — the card cache and
 * saved decks survive, so nothing needs re-hydrating afterwards.
 *
 * Reachable from the devtools console as `window.__sealedClearGames()` (see
 * docs/operations.md). It exists because records written before the AI became a pure function
 * of state (#366) cannot be replayed: that opponent drew from `Math.random`, so re-resolving a
 * stored move list diverges from the stored final state, making those records useless as
 * training data and misleading as bug reports.
 */
export async function clearGameRecords(): Promise<number> {
  const count = await db.games.count()
  await db.games.clear()
  return count
}

/**
 * Download every saved game as one JSON file, returning how many it holds. With nothing saved
 * there is nothing to download, and it returns zero.
 *
 * Reachable from the devtools console as `window.__sealedExportGames()` (see docs/operations.md).
 * The file never leaves the device unless the person who downloaded it sends it somewhere.
 */
export async function exportGameRecords(): Promise<number> {
  const records = await listGameRecords()
  if (records.length > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    downloadJson(`dmgctrl-sealed-games-${stamp}.json`, buildGameExport(records))
  }
  return records.length
}

declare global {
  interface Window {
    __sealedClearGames: () => Promise<number>
    __sealedExportGames: () => Promise<number>
  }
}

if (typeof window !== 'undefined') {
  window.__sealedExportGames = async () => {
    const exported = await exportGameRecords()
    console.info(`[sealed] exported ${exported} game record${exported === 1 ? '' : 's'}`)
    return exported
  }
  window.__sealedClearGames = async () => {
    const cleared = await clearGameRecords()
    console.info(`[sealed] cleared ${cleared} game record${cleared === 1 ? '' : 's'}`)
    return cleared
  }
}
