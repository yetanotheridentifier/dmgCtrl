import { db } from './db'
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

declare global {
  interface Window {
    __sealedClearGames: () => Promise<number>
  }
}

if (typeof window !== 'undefined') {
  window.__sealedClearGames = async () => {
    const cleared = await clearGameRecords()
    console.info(`[sealed] cleared ${cleared} game record${cleared === 1 ? '' : 's'}`)
    return cleared
  }
}
