import { COMMIT_ID, RELEASE } from '../buildIdentity'
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

/** A `GameRecord` as it leaves the device: no id, no card database, no final state. */
export type ExportedRecord = Omit<GameRecord, 'id' | 'initialState' | 'finalState'> & {
  initialState: StateWithoutCards
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
  const { id, finalState, initialState, ...kept } = record
  void id
  void finalState
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
