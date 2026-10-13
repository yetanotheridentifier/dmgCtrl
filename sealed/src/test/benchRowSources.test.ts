// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { archiveGame, openArchive, writeSnapshot } from '../bench/recordArchive'
import { benchRecord } from '../bench/records'
import { runBench } from '../bench/runBench'
import { inputsFromArchive, inputsFromFile, writeRows } from '../bench/rowSources'
import { rowsForExport, trainingCardDb, type TrainingRow } from '../bench/trainingRows'
import { buildGameExport, type GameExport } from '../data/recordExport'
import { playedRecord } from './helpers/playedRecord'
import { stagedGame } from './helpers/stagedGames'

/**
 * The row tool reads games from three places and writes the same rows for the same game whichever
 * it came from: a file the app exported or the bench recorded, the archive of collected games, and
 * a snapshot of that archive. A collected game's rows say how long it took, which is the one thing
 * the payload holds that an exported record does not put on a row.
 */

const CARDS = trainingCardDb()
const SEEDS = [7, 11, 23]
const GAMES = SEEDS.map(stagedGame)
const DAY = '2026-10-13'

const dir = mkdtempSync(join(tmpdir(), 'rows-'))
const archive = openArchive(join(dir, 'collected-games.db'))
for (const game of GAMES) archiveGame(archive, { gameKey: game.gameKey, pulledDay: DAY, payload: game.text })
const snapshot = writeSnapshot(archive, dir, DAY).path

const exportFile = join(dir, 'export.json')
writeFileSync(exportFile, JSON.stringify(buildGameExport(SEEDS.map(seed => playedRecord(seed)))))

const benchFile = join(dir, 'bench.json')
const benchGames: GameExport = { ...buildGameExport([]), records: [] }
runBench({ games: 2, seed: 1, aiA: 'random', aiB: 'random', onGame: game => benchGames.records.push(benchRecord(game)) })
writeFileSync(benchFile, JSON.stringify(benchGames))

const rowsOf = (out: string): TrainingRow[] => readFileSync(out, 'utf8').trimEnd().split('\n').map(l => JSON.parse(l) as TrainingRow)
const written = (name: string, inputs: Parameters<typeof writeRows>[0], options = {}) => {
  const out = join(dir, `${name}.jsonl`)
  return { out, result: writeRows(inputs, CARDS, options, out) }
}

describe('rows from the archive of collected games', () => {
  const fromArchive = written('archive', inputsFromArchive(archive))

  it('are one game after another, a row a move, grouped by the key each game was staged under', () => {
    const rows = rowsOf(fromArchive.out)
    expect(fromArchive.result).toMatchObject({ games: 3, rows: rows.length, refused: [] })
    expect([...new Set(rows.map(r => r.gameKey))]).toEqual(GAMES.map(g => g.gameKey).sort())
    expect(fromArchive.result.bytes).toBe(readFileSync(fromArchive.out).length)
  })

  it('are the same bytes as the rows of a snapshot of it, read as a file', () => {
    const fromSnapshot = written('snapshot', inputsFromFile(snapshot))
    expect(readFileSync(fromSnapshot.out).equals(readFileSync(fromArchive.out))).toBe(true)
    expect(fromSnapshot.result).toEqual(fromArchive.result)
  })

  it('carry what the payload holds: the build, the bot, the seat, the take-backs and how long it took', () => {
    for (const row of rowsOf(fromArchive.out)) {
      expect(row.build).toEqual({ release: '412', commitId: 'abc1234' })
      expect(row.opponentAi).toBe('beam-reply')
      expect(row.humanSeat).toBe('player')
      expect(row.undoCount).toBe(2)
      expect(row.durationMs).toBe(8_000)
      expect(row.decidedBy).toBe(row.mover === 'player' ? 'human' : 'ai')
    }
  })

  it('are the rows of the same games exported from the app, plus how long each took', () => {
    const exported = rowsOf(written('exported', inputsFromFile(exportFile)).out)
    const byKey = (a: TrainingRow, b: TrainingRow): number => a.gameKey.localeCompare(b.gameKey) || a.moveIndex - b.moveIndex
    const collected = rowsOf(fromArchive.out).map(({ durationMs, ...rest }) => {
      void durationMs
      return rest
    })
    expect(collected.sort(byKey)).toEqual(exported.sort(byKey))
  })

  it('carry nothing the archive adds: no day, and no deck name or time the payload never had', () => {
    for (const row of rowsOf(fromArchive.out)) {
      expect(Object.keys(row).sort()).toEqual([
        'action', 'build', 'decidedBy', 'durationMs', 'formatVersion', 'gameKey', 'humanSeat', 'information',
        'mover', 'moveCount', 'moveIndex', 'opponentAi', 'outcome', 'state', 'undoCount',
      ].sort())
    }
  })

  it('take the same options as any other rows', () => {
    const rows = rowsOf(written('mover', inputsFromArchive(archive), { view: 'mover', legalMoves: true }).out)
    expect(new Set(rows.map(r => r.information))).toEqual(new Set(['mover']))
    expect(rows.every(r => Array.isArray(r.legalMoves))).toBe(true)
  })

  it('name a game that no longer replays by its key, and write the rest', () => {
    const db = openArchive(':memory:')
    const [good, bad] = GAMES
    archiveGame(db, { gameKey: good.gameKey, pulledDay: DAY, payload: good.text })
    const flipped = JSON.parse(bad.text) as { winner: string }
    flipped.winner = flipped.winner === 'player' ? 'opponent' : 'player'
    archiveGame(db, { gameKey: bad.gameKey, pulledDay: DAY, payload: JSON.stringify(flipped) })

    const { result } = written('refused', inputsFromArchive(db))

    expect(result.games).toBe(1)
    expect(result.refused).toEqual([expect.stringMatching(new RegExp(`^archive game ${bad.gameKey}: .*the record says`)) as string])
  })
})

describe('rows from files, as before', () => {
  it('are exactly the rows of the export, in the file’s order, a line each', () => {
    const { out, result } = written('export', inputsFromFile(exportFile))
    const expected = rowsForExport(JSON.parse(readFileSync(exportFile, 'utf8')), CARDS)

    expect(readFileSync(out, 'utf8')).toBe(expected.games.flatMap(g => g.rows).map(r => `${JSON.stringify(r)}\n`).join(''))
    expect(result).toMatchObject({ games: 3, refused: [] })
  })

  it('are exactly the rows of a bench records file', () => {
    const { out } = written('bench', inputsFromFile(benchFile))
    const expected = rowsForExport(JSON.parse(readFileSync(benchFile, 'utf8')), CARDS)
    expect(readFileSync(out, 'utf8')).toBe(expected.games.flatMap(g => g.rows).map(r => `${JSON.stringify(r)}\n`).join(''))
  })

  it('name a refused record by its file and its place in it', () => {
    const file = join(dir, 'one-bad.json')
    const games = JSON.parse(readFileSync(exportFile, 'utf8')) as GameExport
    games.records[1].winner = games.records[1].winner === 'player' ? 'opponent' : 'player'
    writeFileSync(file, JSON.stringify(games))

    const { result } = written('one-bad', inputsFromFile(file))

    expect(result.games).toBe(2)
    expect(result.refused).toEqual([expect.stringMatching(new RegExp(`^${file.replace(/[.\\]/g, '\\$&')} record 1: `)) as string])
  })

  it('refuse a file that is neither an export nor a snapshot', () => {
    const notExport = join(dir, 'not.json')
    writeFileSync(notExport, '{"games":[]}')
    expect(() => inputsFromFile(notExport)).toThrow('not a game export')

    const notSnapshot = join(dir, 'not.jsonl.gz')
    writeFileSync(notSnapshot, gzipSync('hello\n'))
    expect(() => inputsFromFile(notSnapshot)).toThrow('not a snapshot of collected games')
  })

  it('write the output afresh, and several sources one after another', () => {
    const out = join(dir, 'several.jsonl')
    writeFileSync(out, 'stale\n')
    const result = writeRows([...inputsFromFile(benchFile), ...inputsFromArchive(archive)], CARDS, {}, out)
    const rows = rowsOf(out)
    expect(result.games).toBe(5)
    expect(rows).toHaveLength(result.rows)
  })
})

describe('telling the three kinds of game apart from their rows', () => {
  const collected = rowsOf(written('kinds-collected', inputsFromArchive(archive)).out)
  const exported = rowsOf(written('kinds-exported', inputsFromFile(exportFile)).out)
  const bench = rowsOf(written('kinds-bench', inputsFromFile(benchFile)).out)

  it('a bench game says which run it came from, and the others never do', () => {
    expect(bench.every(r => r.bench !== undefined && r.ai !== undefined)).toBe(true)
    expect([...collected, ...exported].some(r => 'bench' in r || 'ai' in r || 'deck' in r)).toBe(false)
  })

  it('a collected game says how long it took, and the others never do', () => {
    expect(collected.every(r => typeof r.durationMs === 'number')).toBe(true)
    expect([...bench, ...exported].some(r => 'durationMs' in r)).toBe(false)
  })
})
