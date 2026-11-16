import { sharingGames } from './collection'
import { db } from './db'
import { addGame, sidesOf } from './matchups'
import type { GameSides, MatchupTally } from './matchups'
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
  /**
   * Present when the player was opted in to sharing games as this one finished, and the only thing
   * that says so afterwards: opting in covers games finished from then on, never the ones already
   * saved. Written with the record (`consentStamp` in `collection.ts`), not an indexed key, and
   * absent on every record finished without consent, which the collection gate reads as a refusal.
   */
  consentedAtFinish?: true
  /**
   * Present once the collection endpoint answered 204 for this game, which it does only after the
   * game is stored, so it is the one answer that says the device's copy is no longer the only one.
   * Records saved before deliveries were marked had it set by the upgrade to schema 3 (`db.ts`).
   */
  delivered?: true
}

/** Both identifiers of a build: the release a person quotes and the commit that pins the code. */
export interface BuildIdentity {
  release: string
  commitId: string
}

type ReplayData = 'initialState' | 'moves' | 'finalState'

/**
 * A saved game that has lost its replay data: every other field it was saved with, the leaders and
 * bases at each seat (which is all the record by matchup reads), and who conceded, if anyone did.
 */
export interface GameSummary extends Omit<GameRecord, ReplayData> {
  sides: GameSides
  concededBy?: PlayerId
}

/** A row of the `games` table: whole, or trimmed to its summary. */
export type SavedGame = GameRecord | GameSummary

export const hasReplayData = (game: SavedGame): game is GameRecord => 'initialState' in game

export async function saveGameRecord(record: Omit<GameRecord, 'id'>): Promise<GameRecord> {
  const saved: GameRecord = { ...record, id: crypto.randomUUID() }
  await db.games.put(saved)
  return saved
}

/** The player's record by matchup over every saved game (see `data/matchups.ts`), one game at a time. */
export async function matchupRecords(): Promise<MatchupTally> {
  const tally: MatchupTally = new Map()
  await db.games.each(game => addGame(tally, { ...game, sides: hasReplayData(game) ? sidesOf(game.initialState) : game.sides }))
  return tally
}

/** The games that still have their replay data, newest first. */
export async function listGameRecords(): Promise<GameRecord[]> {
  return (await db.games.orderBy('endedAt').reverse().toArray()).filter(hasReplayData)
}

/**
 * How many delivered games keep their replay data, newest first, for `__sealedExportGames()` and
 * debugging. The player's ceiling is 5.
 */
export const KEPT_AFTER_DELIVERY = 2

function summaryOf(game: GameRecord): GameSummary {
  const { initialState, moves, finalState, ...kept } = game
  void moves
  const { concededBy } = finalState
  return { ...kept, sides: sidesOf(initialState), ...(concededBy ? { concededBy } : {}) }
}

/**
 * Bring what the device keeps into line with the sharing answer, as it stands now. Every game keeps
 * its summary. A player who shares keeps the replay data of every game still owed to the collection
 * (finished while sharing and not yet delivered), and of the newest `KEPT_AFTER_DELIVERY` of the
 * others, delivered or never to be sent. A player who does not share, or has not answered, keeps
 * none: nothing on the device reads it, and switching sharing off lets go of a game still waiting.
 *
 * Run after every game is offered for collection (`collectionSend.ts`), and as the app opens and
 * whenever the answer changes (`App.tsx`). Running it twice changes nothing.
 */
export async function trimGameRecords(): Promise<void> {
  const sharing = sharingGames()
  await db.transaction('rw', db.games, async () => {
    const trimmed: GameSummary[] = []
    let kept = 0
    await db.games.orderBy('endedAt').reverse().each(game => {
      if (!hasReplayData(game)) return
      if (sharing && game.consentedAtFinish && !game.delivered) return
      if (sharing && kept < KEPT_AFTER_DELIVERY) {
        kept++
        return
      }
      trimmed.push(summaryOf(game))
    })
    if (trimmed.length > 0) await db.games.bulkPut(trimmed)
  })
}

/** Mark a game delivered, then trim: it may push an older delivered game down to its summary. */
export async function recordDelivered(id: string): Promise<void> {
  await db.games.update(id, { delivered: true })
  await trimGameRecords()
}

/**
 * Wipe every saved game, summaries too, returning how many went. Touches only `games` — the card
 * cache and saved decks survive, so nothing needs re-hydrating afterwards.
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
 * Download every saved game that still has its replay data as one JSON file, returning how many it
 * holds. A summary is left out, having nothing to replay. With nothing to export there is nothing
 * to download, and it returns zero.
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
