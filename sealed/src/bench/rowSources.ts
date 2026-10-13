import type { DatabaseSync } from 'node:sqlite'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CardDb } from '../engine/types'
import { archivedGames, readSnapshot } from './recordArchive'
import { recordsOfExport, rowsForRecord, type RowOptions, type RowSource } from './trainingRows'

/**
 * Where `--rows` gets its games, and the writing of their rows.
 *
 * Three sources, one transformation (`trainingRows.ts`):
 *
 * - **an export file**: what the app downloads, or what a `--record` run writes;
 * - **the archive of collected games** (`recordArchive.ts`);
 * - **a snapshot of that archive**, which is why a backup is usable without the database.
 *
 * A collected game is its payload as it was staged, which is replay data with its provenance beside
 * it, so it is handed over as it stands. The same game gives the same rows from the archive and
 * from a snapshot, byte for byte.
 */

/** One game to turn into rows, with what to call it if it is refused. */
export interface RowInput {
  label: string
  record: RowSource
}

/** The games of one file: a snapshot if it is gzipped, an export otherwise. Throws for a file that is neither. */
export function inputsFromFile(path: string): RowInput[] {
  if (path.endsWith('.gz')) {
    return readSnapshot(path).map(game => ({ label: `${path} game ${game.gameKey}`, record: JSON.parse(game.payload) as RowSource }))
  }
  return recordsOfExport(JSON.parse(readFileSync(path, 'utf8'))).map((record, index) => ({ label: `${path} record ${index}`, record }))
}

/** The archive's games, in key order, read as they are asked for. */
export function* inputsFromArchive(db: DatabaseSync): Generator<RowInput> {
  for (const game of archivedGames(db)) yield { label: `archive game ${game.gameKey}`, record: JSON.parse(game.payload) as RowSource }
}

export interface RowsWritten {
  games: number
  rows: number
  bytes: number
  /** With legal moves asked for: moves that were made but are not among the engine's list for the position. */
  offList: number
  /** The games that did not replay, each as its label and the reason. They wrote no rows. */
  refused: string[]
}

/**
 * Write every input's rows to `out`, a JSON object to a line, in the order given. `out` is written
 * afresh. Each game's rows are appended as they are made, so a corpus of any size is transformed a
 * game at a time. A game this build cannot replay to its stored result is set aside with its reason
 * and the rest carry on.
 */
export function writeRows(inputs: Iterable<RowInput>, cards: CardDb, options: RowOptions, out: string): RowsWritten {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, '')
  const written: RowsWritten = { games: 0, rows: 0, bytes: 0, offList: 0, refused: [] }
  for (const input of inputs) {
    let rows
    try {
      rows = rowsForRecord(input.record, cards, options)
    } catch (err) {
      written.refused.push(`${input.label}: ${(err as Error).message}`)
      continue
    }
    const lines = rows.map(r => `${JSON.stringify(r)}\n`).join('')
    appendFileSync(out, lines)
    written.games++
    written.rows += rows.length
    written.bytes += Buffer.byteLength(lines)
    written.offList += rows.filter(r => r.chosenIndex === -1).length
  }
  return written
}
