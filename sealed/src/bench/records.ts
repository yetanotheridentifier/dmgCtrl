import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { COMMIT_ID, RELEASE } from '../buildIdentity'
import { EXPORT_FORMAT_VERSION, type ExportedRecord, type GameExport } from '../data/recordExport'
import { withoutCards } from '../data/replayData'
import type { PlayerId } from '../engine/types'
import type { DeckMatchup, DeckSource } from './decks'
import type { GameResult } from './selfPlay'
import { shardRunKey, type ShardConfig } from './shard'

/**
 * Completed bench games as records, in the shape the app exports its saved games in.
 *
 * A game is a function of its seed, its decks and its two bots, so the record is the replayable
 * minimum (the starting position without its card database, and the moves) plus what says which
 * game it was. Everything else is derived by replaying it: `--rows` turns a records file into
 * training rows as it stands (`trainingRows.ts`), and `cardUse.ts` asks a question of the records
 * directly. Records are kept and rows are derived because a game's rows are some thirty times the
 * size of its record.
 *
 * **A recorder is a function the run calls once per completed game** (`GameRecorder`), and this
 * module is one: `runBench` knows only that it was handed a callback. That is the whole seam, kept
 * that narrow so a runner that takes its recorders as a list can take this one unchanged. Only the
 * head-to-head game run offers it; the other modes play their games through their own loops.
 *
 * A dropped game is not recorded here. It has its own file, as a fixture to replay and file
 * (`reports.ts`), and it has no result for a row to carry.
 */

export const RECORDS_DIR = 'bench-results/records'

/** One completed game as the run played it, handed to a recorder before the run lets go of its moves. */
export interface PlayedGame {
  /** Which of the run's games this was, from zero. Dropped games keep their place, so it can skip. */
  index: number
  /** The seed the run was started with. The game's own seed is on `result`. */
  runSeed: number
  /** The deck set the run plays over, and the two lists this game was dealt from. */
  decks: DeckSource
  deck: DeckMatchup
  /** The name each seat played as. Seats swap from game to game, so this is the game's, not the run's. */
  ais: Record<PlayerId, string>
  /** The game, with its moves and starting position still on it. */
  result: GameResult
}

export type GameRecorder = (game: PlayedGame) => void

/**
 * The record of one completed game.
 *
 * **No clock is in it.** `startedAt` and `endedAt` are both zero: a bench game has no moment that
 * means anything, and leaving the time out is what makes the same seed, decks and bots give the
 * same bytes twice. Nothing about a person is in it either (no `humanSeat`, `opponentAi` or
 * `undoCount`), since nobody sat down: the bots are named per seat under `bench`.
 */
export function benchRecord(game: PlayedGame): ExportedRecord {
  const { result } = game
  if (result.status !== 'completed' || result.winner === null || !result.initialState) {
    throw new Error('benchRecord: only a completed game, with its moves still on it, can be recorded')
  }
  return {
    playerDeckName: game.deck.player.name,
    opponentDeckName: game.deck.opponent.name,
    winner: result.winner,
    startedAt: 0,
    endedAt: 0,
    moves: result.moves,
    build: { release: RELEASE, commitId: COMMIT_ID },
    bench: { ais: game.ais, seed: result.seed, runSeed: game.runSeed, game: game.index, decks: game.decks },
    initialState: withoutCards(result.initialState),
  }
}

/** What identifies one process's worth of games: a run, or one shard of a sharded one. */
export interface RecordedRun {
  games: number
  seed: number
  aiA: string
  aiB: string
  decks?: DeckSource
}

/**
 * Where a run's records go: one file for each build, pair of bots, game count, seed and deck set.
 *
 * **One file per seed is what lets shards record at once.** A sharded run is a process per seed,
 * each a whole run of its own, so each writes its own file and none can touch another's. The arm and
 * the control of an A/B differ in a bot, so they keep separate files too.
 *
 * The build leads the path because it is part of what the games are: another build's bots play the
 * same seed differently, and its records are different data, not a newer copy to write over. So a
 * file on disk under this build's name was written by this build. The rest is the run key a sharded
 * run already banks under (`shardRunKey`), for a single seed.
 */
export function recordsPath(run: RecordedRun, root: string = RECORDS_DIR): string {
  const key = shardRunKey({ shards: 1, games: run.games, baseSeed: run.seed, aiA: run.aiA, aiB: run.aiB, decks: run.decks })
  return join(root, COMMIT_ID, `${key}.json`)
}

/**
 * The shards of a run that have no records file, by seed.
 *
 * A shard that an earlier attempt banked is not played again, so a resumed run writes nothing for
 * it: its records exist only if that attempt was recording as well. This is how the run finds out,
 * so it can say so instead of reporting a corpus quietly short of the games it pooled.
 */
export function missingRecords(
  config: ShardConfig,
  root: string = RECORDS_DIR,
  exists: (path: string) => boolean = existsSync,
): { seed: number; path: string }[] {
  return Array.from({ length: config.shards }, (_, i) => config.baseSeed + i)
    .map(seed => ({ seed, path: recordsPath({ games: config.games, seed, aiA: config.aiA, aiB: config.aiB, decks: config.decks }, root) }))
    .filter(file => !exists(file.path))
}

export interface RecordsFile {
  path: string
  games: number
  bytes: number
}

/**
 * Write records to `path` one at a time, as one export file (`GameExport`).
 *
 * Each record is appended as its game finishes, so a run holds no more than the game in hand
 * however long it is, and the file that results is byte for byte what serialising the whole export
 * at once would give.
 *
 * **The file appears under its own name only when `close` is called.** Until then it is being
 * written beside itself as `.partial`. A run that dies part way is played again from its first game,
 * so its half-written file is worth nothing, and this way nothing reads one as a finished run.
 */
export function recordsWriter(path: string): { record: (record: ExportedRecord) => void; close: () => RecordsFile } {
  const partial = `${path}.partial`
  const empty: GameExport = { formatVersion: EXPORT_FORMAT_VERSION, build: { release: RELEASE, commitId: COMMIT_ID }, records: [] }
  const whole = JSON.stringify(empty)
  // Everything before the closing of `records` and of the file itself, which `close` writes.
  const tail = ']}'
  // Started at the first game or at the close, whichever comes first, so a run that is refused
  // before it plays (a bot name that does not resolve) leaves nothing behind.
  let started = false
  const start = (): void => {
    if (started) return
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(partial, whole.slice(0, -tail.length))
    started = true
  }
  let games = 0
  return {
    record(record) {
      start()
      appendFileSync(partial, `${games === 0 ? '' : ','}${JSON.stringify(record)}`)
      games++
    },
    close() {
      start()
      appendFileSync(partial, tail)
      renameSync(partial, path)
      return { path, games, bytes: statSync(path).size }
    },
  }
}
