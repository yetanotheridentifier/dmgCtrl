import type { Action } from '../engine/actions'
import type { PlayerId } from '../engine/types'
import type { BuildIdentity, GameRecord } from './gameRecords'
import { exportRecord } from './recordExport'
import type { StateWithoutCards } from './replayData'
import { loadSettings } from './settingsStore'

/**
 * The gate between a saved game and anything that would send it to train the bot.
 *
 * `recordForCollection` is the only way to turn a record into an outbound payload, and it answers
 * for consent itself, from the stored setting, so a caller cannot be mistaken about it.
 *
 * Nothing sends yet. There is no collection endpoint, this module makes no network call, and
 * nothing in the app calls `recordForCollection`: it exists so that the sender, when it is built,
 * has exactly one thing to call and no record shape of its own to invent.
 */

/**
 * What is sent for one game: every field is named here, and a field not named here is not sent.
 *
 * This is the notice the player agreed to, as a type: both decks as loaded and every decision
 * (`initialState`, `moves`, `undoCount`, and which seat and which bot made them), who won, how long
 * it took, and the app version. It is replay data, so the replay harness reads it as it stands.
 *
 * Left out on purpose:
 * - **Deck names.** Free text the player typed, and the one field that could hold a name. Each deck
 *   is named by its leader and base instead.
 * - **The record id.** Random, so it identifies a game and not a person, but anyone holding the
 *   device could use it to find that game again, and the notice says a sent game cannot be found.
 * - **When the game was played.** The notice names how long it took, which is all that is sent.
 *
 * `initialState` is the engine's own state and is passed whole (less its card database), so this
 * list does not guard a field added to `GameState`: that type holds card ids and counters and must
 * never hold anything the player typed.
 */
export interface CollectedRecord {
  playerLeader: string
  playerBase: string
  opponentLeader: string
  opponentBase: string
  winner: PlayerId | 'draw'
  durationMs: number
  initialState: StateWithoutCards
  moves: { by: PlayerId; action: Action }[]
  undoCount?: number
  build?: BuildIdentity
  opponentAi?: string
  humanSeat?: PlayerId
}

function sharingGames(): boolean {
  return loadSettings().shareGames === 'yes'
}

/**
 * The mark a record is saved with, spread into it as the game finishes: present only while the
 * player is opted in. Read from storage at that moment, not from a render, so an answer changed
 * part-way through a game counts as it stands when the winner appears.
 */
export function consentStamp(): Pick<GameRecord, 'consentedAtFinish'> {
  return sharingGames() ? { consentedAtFinish: true } : {}
}

/**
 * One record as it may be sent, or `null` when it may not be: the player is not opted in now, or
 * was not when this game finished. Both are checked, so opting in never reaches back to games
 * already saved, and opting out stops everything at once.
 *
 * The payload is built by naming fields, starting from the exported form so there is one strip of
 * the card database and the final state (`recordExport.ts`). A field added to `GameRecord` later
 * stays on the device until it is added to `CollectedRecord` and here, deliberately.
 */
export function recordForCollection(record: Omit<GameRecord, 'id'> & { id?: string }): CollectedRecord | null {
  if (!sharingGames() || record.consentedAtFinish !== true) return null

  const exported = exportRecord(record)
  const { player, opponent } = exported.initialState.players
  return {
    playerLeader: player.leader.cardId,
    playerBase: player.base.cardId,
    opponentLeader: opponent.leader.cardId,
    opponentBase: opponent.base.cardId,
    winner: exported.winner,
    durationMs: exported.endedAt - exported.startedAt,
    initialState: exported.initialState,
    moves: exported.moves,
    // Provenance the record never had stays absent: absent means unknown, not zero.
    ...(exported.undoCount !== undefined ? { undoCount: exported.undoCount } : {}),
    ...(exported.build ? { build: { release: exported.build.release, commitId: exported.build.commitId } } : {}),
    ...(exported.opponentAi !== undefined ? { opponentAi: exported.opponentAi } : {}),
    ...(exported.humanSeat !== undefined ? { humanSeat: exported.humanSeat } : {}),
  }
}
