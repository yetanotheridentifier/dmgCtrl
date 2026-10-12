import { describe, it, expect } from 'vitest'
import { buildGameExport, exportRecord, EXPORT_FORMAT_VERSION } from '../data/recordExport'
import { withoutCards } from '../data/replayData'
import type { GameRecord } from '../data/gameRecords'
import { COMMIT_ID, RELEASE } from '../buildIdentity'
import { playGame } from '../bench/selfPlay'
import { benchInputs } from '../bench/decks'
import { randomAi } from '../ai/randomAi'
import { resolve } from '../engine/resolve'
import { replay, type Report } from './helpers/replayReport'
import { state, CARDS } from './helpers/engineFixtures'

/**
 * Saved games leave the device as JSON in the replayable-minimum form: the starting position
 * without its card database, the moves, and what is known about how the game was played. Each
 * exported record is a report the replay harness reads as it stands, so a game pulled out of the
 * app is a runnable fixture and a training example with no conversion step in between.
 */

/** What a file on disk holds: whatever survives `JSON.stringify`. */
const throughJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** A record as the app saves it, from a whole game between two bots on the ASH bench deck. */
function playedRecord(seed: number): GameRecord {
  const inputs = benchInputs()
  const game = playGame({
    deckPlayer: inputs.deck, deckOpponent: inputs.deck, cardDb: inputs.cardDb,
    aiPlayer: randomAi, aiOpponent: randomAi, firstPlayer: 'player', seed,
  })
  const initialState = game.initialState!
  const finalState = game.moves.reduce((s, m) => resolve(s, m.action), initialState)
  return {
    id: `game-${seed}`,
    playerDeckName: 'Mine',
    opponentDeckName: 'Theirs',
    winner: finalState.winner!,
    startedAt: 1_000,
    endedAt: 9_000,
    initialState,
    moves: game.moves,
    finalState,
    undoCount: 2,
    build: { release: '412', commitId: 'abc1234' },
    opponentAi: 'beam-reply',
    humanSeat: 'player',
  }
}

describe('withoutCards', () => {
  it('drops the card database and nothing else, leaving the state it was given alone', () => {
    const s = state()
    const stripped = withoutCards(s)

    expect('cards' in stripped).toBe(false)
    expect(Object.keys(stripped)).toEqual(Object.keys(s).filter(k => k !== 'cards'))
    expect(s.cards).toBe(CARDS)
  })
})

describe('an exported game record', () => {
  it('replays through the shipped harness to the stored final state and winner', () => {
    const record = playedRecord(11)
    expect(record.finalState.winner).not.toBeNull()

    const file = throughJson(buildGameExport([record]))
    // Assigned as it stands, with no mapping: an exported record is a `Report` by its type as well as its bytes.
    const report: Report = file.records[0]
    const end = replay(report)

    expect(end.winner).toBe(record.winner)
    expect(withoutCards(end)).toEqual(withoutCards(record.finalState))
  })

  /**
   * The card database is most of a state's bytes and identical across games, and the final state is
   * what replaying produces. Pinning the keys exactly is what stops either coming back in: a field
   * added to the record has to be added here on purpose.
   */
  it('carries exactly the replay data and the provenance, never the card database or the final state', () => {
    const exported = throughJson(exportRecord(playedRecord(7)))

    expect(Object.keys(exported).sort()).toEqual([
      'build', 'endedAt', 'humanSeat', 'initialState', 'moves', 'opponentAi', 'opponentDeckName',
      'playerDeckName', 'startedAt', 'undoCount', 'winner',
    ])
    expect('cards' in exported.initialState).toBe(false)
    expect(exported.build).toEqual({ release: '412', commitId: 'abc1234' })
    expect(exported.opponentAi).toBe('beam-reply')
    expect(exported.humanSeat).toBe('player')
    expect(exported.undoCount).toBe(2)
    expect(exported.startedAt).toBe(1_000)
    expect(exported.endedAt).toBe(9_000)
  })

  /** Absent means unknown, and an export must not turn unknown into a value. */
  it('leaves out provenance an older record never had', () => {
    const { build, opponentAi, humanSeat, undoCount, ...older } = playedRecord(7)
    void build; void opponentAi; void humanSeat; void undoCount

    const exported = throughJson(exportRecord(older))

    expect(Object.keys(exported).sort()).toEqual([
      'endedAt', 'initialState', 'moves', 'opponentDeckName', 'playerDeckName', 'startedAt', 'winner',
    ])
  })
})

describe('buildGameExport', () => {
  it('wraps the records with the format version and the build that wrote the file', () => {
    const file = buildGameExport([playedRecord(7), playedRecord(11)])

    expect(Object.keys(file)).toEqual(['formatVersion', 'build', 'records'])
    expect(file.formatVersion).toBe(EXPORT_FORMAT_VERSION)
    expect(file.build).toEqual({ release: RELEASE, commitId: COMMIT_ID })
    expect(file.records).toHaveLength(2)
  })

  it('is a valid file with no records in it', () => {
    expect(buildGameExport([]).records).toEqual([])
  })
})
