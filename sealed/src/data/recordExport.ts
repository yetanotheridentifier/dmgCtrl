import { COMMIT_ID, RELEASE } from '../buildIdentity'
import type { PlayerId } from '../engine/types'
import type { BuildIdentity, GameRecord } from './gameRecords'
import { withoutCards, type StateWithoutCards } from './replayData'

/**
 * Saved games as a JSON file, in the replayable-minimum form.
 *
 * Each record keeps the starting position without its card database, the moves, and what is known
 * about how the game was played. The final state is left out because replaying the moves produces
 * it. A record is replay data with extra fields beside it, so the replay harness
 * (`test/helpers/replayReport.ts`) reads one as it stands.
 */

/** Raised when a reader of an older file would misread a newer one. */
export const EXPORT_FORMAT_VERSION = 1

/**
 * A `GameRecord` as it leaves the device: no id, no card database, no final state. No consent mark
 * either: that is the collection gate's (`collection.ts`), and a file the player downloads by hand
 * is theirs whatever they answered.
 */
export type ExportedRecord = Omit<GameRecord, 'id' | 'initialState' | 'finalState' | 'consentedAtFinish'> & {
  initialState: StateWithoutCards
  /** Only on a game the bench played between two bots (`bench/records.ts`). */
  bench?: BenchProvenance
}

/**
 * What a record of a bench game says that a person's game cannot: a bot sat at both seats, and the
 * game is one of a seeded run. With it the record carries no `opponentAi` and no `humanSeat`, which
 * describe a game one person played, and its two deck names are the bench's own.
 *
 * The type is here because the record it sits on is; nothing in the app writes or reads it. It is
 * not on the list of what is sent for a player's game (`collection.ts`), and does not belong there.
 */
export interface BenchProvenance {
  /** The name each seat played as, exactly as the run was given it, suffixes included (`ai/registry.ts`). */
  ais: Record<PlayerId, string>
  /** The seed this game was dealt and played from. */
  seed: number
  /** The run the game came from: its seed, which of its games this was from zero, and its deck set. */
  runSeed: number
  game: number
  decks: string
}

export interface GameExport {
  formatVersion: number
  /** The build that wrote the file. The build that played each game is on its record. */
  build: BuildIdentity
  records: ExportedRecord[]
}

/**
 * One record in its exported form. Provenance the record never had stays absent: absent means
 * unknown, and an export must not turn unknown into a value.
 */
export function exportRecord(record: Omit<GameRecord, 'id'> & { id?: string }): ExportedRecord {
  const { id, finalState, consentedAtFinish, initialState, ...kept } = record
  void id
  void finalState
  void consentedAtFinish
  return { ...kept, initialState: withoutCards(initialState) }
}

export function buildGameExport(records: GameRecord[]): GameExport {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    build: { release: RELEASE, commitId: COMMIT_ID },
    records: records.map(exportRecord),
  }
}

/**
 * Hand the browser a file to save. An object URL on a transient link, since that is the one way
 * to name a download from script.
 */
export function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
