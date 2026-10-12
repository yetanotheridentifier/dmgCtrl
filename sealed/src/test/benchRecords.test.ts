import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { benchRecord, recordsPath, recordsWriter, type PlayedGame } from '../bench/records'
import { runBench, type BenchReport } from '../bench/runBench'
import { rowsForExport, trainingCardDb } from '../bench/trainingRows'
import { COMMIT_ID, RELEASE } from '../buildIdentity'
import { EXPORT_FORMAT_VERSION, type ExportedRecord, type GameExport } from '../data/recordExport'
import { replayStates, withCardDb } from '../engine/replay'

/**
 * A bench game run can keep every completed game as a record in the shape the app exports: the
 * starting position without its card database, the moves, and who and what played. The run hands
 * each completed game to a recorder; nothing is kept unless one is given.
 */

const CARDS = trainingCardDb()
/** One whole seating cycle: each bot sits each seat and moves first from it once. */
const RUN = { games: 4, seed: 5, aiA: 'greedy', aiB: 'random' } as const

/** A run with every completed game handed over, as a recorder receives it. */
function recorded(config: { games: number; seed: number; aiA: string; aiB: string } = RUN): { report: BenchReport; played: PlayedGame[] } {
  const played: PlayedGame[] = []
  const report = runBench({ ...config, onGame: game => played.push(game) })
  return { report, played }
}

/** Everything about a report that does not depend on the clock. */
function stable(r: BenchReport) {
  return {
    ...r,
    movesPerSec: 0,
    games: r.games.map(g => ({ ...g, durationMs: 0 })),
  }
}

describe('the games a run hands to its recorder', () => {
  const { report, played } = recorded()
  const records = played.map(benchRecord)

  it('are every completed game, in the order they were played', () => {
    expect(report.completed).toBe(RUN.games)
    expect(played.map(g => g.index)).toEqual(report.games.map((_, i) => i))
    expect(played.map(g => g.result.seed)).toEqual(report.games.map(g => g.seed))
  })

  it('replay through the shipped replay to the winner the bench reported', () => {
    records.forEach((record, i) => {
      const states = replayStates(withCardDb(record, CARDS), record.moves)
      expect(states[states.length - 1].winner, `game ${i}`).toBe(report.games[i].winner)
      expect(record.winner, `game ${i}`).toBe(report.games[i].winner)
      expect(record.moves, `game ${i}`).toHaveLength(report.games[i].moveCount)
    })
  })

  /** Seats swap every other game, so the name on a seat is read from the game and not from the run. */
  it('name the AI on each seat, which is not the same seat every game', () => {
    expect(records.map(r => r.bench!.ais)).toEqual(played.map(g => g.ais))
    expect(records[0].bench!.ais).toEqual({ player: 'greedy', opponent: 'random' })
    expect(new Set(records.map(r => r.bench!.ais.player))).toEqual(new Set(['greedy', 'random']))
    for (const r of records) expect(new Set(Object.values(r.bench!.ais))).toEqual(new Set(['greedy', 'random']))
  })

  it('name the deck on each seat, the seed, the run and the build', () => {
    records.forEach((record, i) => {
      expect(record.playerDeckName).toBe('Bench Mirror')
      expect(record.opponentDeckName).toBe('Bench Mirror')
      expect(record.bench!.seed).toBe(report.games[i].seed)
      expect(record.initialState.rngSeed).toBe(report.games[i].seed)
      expect(record.bench!.runSeed).toBe(RUN.seed)
      expect(record.bench!.game).toBe(i)
      expect(record.bench!.decks).toBe('mirror')
      expect(record.build).toEqual({ release: RELEASE, commitId: COMMIT_ID })
    })
  })

  /** An AI is recorded as the run was given it, so an arm with a suffix is told from the plain bot. */
  it('keep an AI name exactly as the run was given it, suffix included', () => {
    const { played: suffixed } = recorded({ games: 2, seed: 5, aiA: 'beam+base=9', aiB: 'random' })
    expect(benchRecord(suffixed[0]).bench!.ais).toEqual({ player: 'beam+base=9', opponent: 'random' })
    expect(benchRecord(suffixed[1]).bench!.ais).toEqual({ player: 'random', opponent: 'beam+base=9' })
  })

  /**
   * Pinned exactly. The fields a person's game carries and a bot's does not are left out and not
   * filled in: nobody sat at either seat, and nothing was taken back.
   */
  it('have exactly these keys, with no clock and no person in them', () => {
    for (const record of records) {
      expect(Object.keys(record)).toEqual([
        'playerDeckName', 'opponentDeckName', 'winner', 'startedAt', 'endedAt', 'moves', 'build', 'bench', 'initialState',
      ])
      expect(Object.keys(record.bench!)).toEqual(['ais', 'seed', 'runSeed', 'game', 'decks'])
      expect(record.startedAt).toBe(0)
      expect(record.endedAt).toBe(0)
      expect('cards' in record.initialState).toBe(false)
    }
  })

  it('are byte for byte the same for the same seed, decks and AIs', () => {
    const again = recorded().played.map(benchRecord)
    expect(JSON.stringify(again)).toBe(JSON.stringify(records))
  })

  it('play different decks on the coverage set, each named on its record', () => {
    const out: PlayedGame[] = []
    runBench({ games: 8, seed: 5, aiA: 'random', aiB: 'random', decks: 'coverage', onGame: g => out.push(g) })
    const coverageRecords = out.map(benchRecord)
    // A deck is played for a whole seating cycle of four games, so eight games reach two.
    expect(new Set(coverageRecords.map(r => r.initialState.players.player.leader.cardId)).size).toBe(2)
    expect(coverageRecords.every(r => r.bench!.decks === 'coverage')).toBe(true)
    expect(coverageRecords.every(r => r.playerDeckName === r.opponentDeckName)).toBe(true)
  })
}, 60_000)

describe('a run with no recorder', () => {
  const { report } = recorded()

  it('reports exactly what the same run reports with one', () => {
    const plain = runBench(RUN)
    expect(stable(plain)).toEqual(stable(report))
  })

  /** A long run keeps no game whole: only a recorder is handed the moves before they are dropped. */
  it('still drops a completed game\'s moves and starting position once it is counted', () => {
    expect(report.games.every(g => g.moves.length === 0 && g.initialState === null)).toBe(true)
  })
}, 60_000)

describe('the records file', () => {
  let dir: string
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'bench-records-')) })
  afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

  /** One run's worth of records, written the way the bench writes them. */
  function write(config: { games: number; seed: number; aiA: string; aiB: string }): { path: string; records: ExportedRecord[] } {
    const path = recordsPath(config, dir)
    const writer = recordsWriter(path)
    const records: ExportedRecord[] = []
    runBench({ ...config, onGame: game => { const r = benchRecord(game); records.push(r); writer.record(r) } })
    const file = writer.close()
    expect(file).toEqual({ path, games: records.length, bytes: readFileSync(path).length })
    return { path, records }
  }

  it('is what the app exports: a format version, the build and the records', () => {
    const { path, records } = write({ ...RUN, games: 4 })
    const text = readFileSync(path, 'utf8')
    const file = JSON.parse(text) as GameExport

    expect(Object.keys(file)).toEqual(['formatVersion', 'build', 'records'])
    expect(file.formatVersion).toBe(EXPORT_FORMAT_VERSION)
    expect(file.build).toEqual({ release: RELEASE, commitId: COMMIT_ID })
    expect(file.records).toEqual(JSON.parse(JSON.stringify(records)))
    // Written piece by piece, and still exactly what serialising the whole export would give.
    expect(text).toBe(JSON.stringify({ formatVersion: EXPORT_FORMAT_VERSION, build: file.build, records }))
  })

  it('is only there once the run has finished, and leaves nothing half-written beside it', () => {
    const path = recordsPath({ ...RUN, games: 2, seed: 77 }, dir)
    const writer = recordsWriter(path)
    const played: PlayedGame[] = []
    runBench({ ...RUN, games: 2, seed: 77, onGame: g => played.push(g) })
    writer.record(benchRecord(played[0]))

    expect(existsSync(path)).toBe(false)
    writer.close()

    expect(existsSync(path)).toBe(true)
    expect(readdirSync(dirname(path)).filter(f => f.endsWith('.partial'))).toEqual([])
  })

  it('holds no games, and is still an export, when nothing completed', () => {
    const path = recordsPath({ ...RUN, games: 1, seed: 78 }, dir)
    recordsWriter(path).close()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      formatVersion: EXPORT_FORMAT_VERSION, build: { release: RELEASE, commitId: COMMIT_ID }, records: [],
    })
  })

  /** A sharded run is one process per seed, each writing at once: a file per seed is what keeps them apart. */
  it('is a different file for each seed, so two shards keep their own games', () => {
    const one = write({ ...RUN, games: 4, seed: 1 })
    const two = write({ ...RUN, games: 4, seed: 2 })

    expect(one.path).not.toBe(two.path)
    const read = (path: string): ExportedRecord[] => (JSON.parse(readFileSync(path, 'utf8')) as GameExport).records
    expect(read(one.path).map(r => r.bench!.runSeed)).toEqual([1, 1, 1, 1])
    expect(read(two.path).map(r => r.bench!.runSeed)).toEqual([2, 2, 2, 2])
    expect(read(one.path).map(r => r.bench!.seed)).not.toEqual(read(two.path).map(r => r.bench!.seed))
  })

  it('is named for the build, the two AIs, the games, the seed and the deck set', () => {
    const base = { games: 40, seed: 3, aiA: 'beam-reply:tie=reply', aiB: 'greedy' }
    const path = recordsPath(base, 'records')

    expect(path).toBe(join('records', COMMIT_ID, 'beam-reply_tie_reply__vs__greedy__g40__s3.json'))
    expect(recordsPath({ ...base, decks: 'coverage' }, 'records')).toBe(join('records', COMMIT_ID, 'beam-reply_tie_reply__vs__greedy__g40__s3__dcoverage.json'))
    // The control of an A/B plays the baseline against itself on the same seeds, and keeps its own file.
    expect(recordsPath({ ...base, aiA: 'greedy' }, 'records')).not.toBe(path)
  })

  it('is read by the row tool as it stands, each row naming the AI that sat where the move was made', () => {
    const { path, records } = write({ ...RUN, games: 4, seed: 9 })

    const result = rowsForExport(JSON.parse(readFileSync(path, 'utf8')), CARDS)

    expect(result.rejected).toEqual([])
    expect(result.games.map(g => g.rows.length)).toEqual(records.map(r => r.moves.length))
    result.games.forEach((game, i) => {
      const { ais } = records[i].bench!
      for (const row of game.rows) {
        expect(row.decidedBy).toBe('ai')
        expect(row.ai).toBe(ais[row.mover])
      }
      expect(new Set(game.rows.map(r => r.ai))).toEqual(new Set(['greedy', 'random']))
    })
    // The seats swap between games, so the same seat is a different bot in the next one.
    expect(result.games[0].rows.find(r => r.mover === 'player')!.ai).toBe('greedy')
    expect(result.games[1].rows.find(r => r.mover === 'player')!.ai).toBe('random')
  })
}, 60_000)
