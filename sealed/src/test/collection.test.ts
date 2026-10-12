// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { recordForCollection, consentStamp } from '../data/collection'
import { exportRecord } from '../data/recordExport'
import { withoutCards } from '../data/replayData'
import { defaultSettings, saveSettings } from '../data/settingsStore'
import type { ShareGames } from '../data/settingsStore'
import type { GameRecord } from '../data/gameRecords'
import { replay, type Report } from './helpers/replayReport'
import { playedRecord } from './helpers/playedRecord'

/**
 * A game leaves the device for collection through one function, and only when the player has agreed.
 * These pin the three things the notice promises: nothing without consent, nothing from before the
 * consent, and nothing in the payload that the notice does not name.
 */

/** What a request body holds: whatever survives `JSON.stringify`. */
const throughJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const answer = (shareGames: ShareGames) => saveSettings({ ...defaultSettings(), shareGames })

/** A record finished while the player was opted in. */
const agreedRecord = (seed: number): GameRecord => ({ ...playedRecord(seed), consentedAtFinish: true })

describe('recordForCollection', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns nothing while the player has not been asked', () => {
    expect(recordForCollection(agreedRecord(7))).toBeNull()
  })

  it('returns nothing once the player has said no', () => {
    answer('no')
    expect(recordForCollection(agreedRecord(7))).toBeNull()
  })

  /** Opting in covers only games finished afterwards, so a game already saved stays on the device. */
  it('refuses a record finished before the player opted in', () => {
    answer('yes')
    expect(recordForCollection(playedRecord(7))).toBeNull()
  })

  /**
   * The keys are pinned exactly. The payload is built from a list of named fields, not by leaving
   * some out, so this fails only when the list itself is changed on purpose.
   */
  it('carries exactly the listed fields once the player has opted in', () => {
    answer('yes')
    const payload = throughJson(recordForCollection(agreedRecord(7)))!

    expect(Object.keys(payload).sort()).toEqual([
      'build', 'durationMs', 'humanSeat', 'initialState', 'moves', 'opponentAi', 'opponentBase',
      'opponentLeader', 'playerBase', 'playerLeader', 'undoCount', 'winner',
    ])
    expect(payload.durationMs).toBe(8_000)
    expect(payload.build).toEqual({ release: '412', commitId: 'abc1234' })
    expect(payload.opponentAi).toBe('beam-reply')
    expect(payload.humanSeat).toBe('player')
    expect(payload.undoCount).toBe(2)
  })

  it('names each deck by its leader and base, never by the name the player typed', () => {
    answer('yes')
    const record: GameRecord = {
      ...agreedRecord(7),
      playerDeckName: 'Alex Rivers birthday deck',
      opponentDeckName: 'Sam at 14 Elm Street',
    }
    const payload = throughJson(recordForCollection(record))!

    expect(payload.playerLeader).toBe(record.initialState.players.player.leader.cardId)
    expect(payload.playerBase).toBe(record.initialState.players.player.base.cardId)
    expect(payload.opponentLeader).toBe(record.initialState.players.opponent.leader.cardId)
    expect(payload.opponentBase).toBe(record.initialState.players.opponent.base.cardId)
    const sent = JSON.stringify(payload)
    expect(sent).not.toContain('Alex Rivers')
    expect(sent).not.toContain('Elm Street')
  })

  /**
   * No record id: it would let a game be looked up later, and the notice says a sent game cannot be
   * found. No timestamps either, since the notice names how long the game took and nothing more.
   */
  it('carries no id, no timestamps, no card database and no final state', () => {
    answer('yes')
    const record = agreedRecord(7)
    const payload = throughJson(recordForCollection(record))!

    for (const key of ['id', 'startedAt', 'endedAt', 'finalState', 'playerDeckName', 'opponentDeckName', 'consentedAtFinish']) {
      expect(key in payload, key).toBe(false)
    }
    expect('cards' in payload.initialState).toBe(false)
    expect(JSON.stringify(payload)).not.toContain(record.id)
  })

  /** The reason for a list: a field the record gains later stays on the device until it is listed. */
  it('leaves out a field the record gains later', () => {
    answer('yes')
    const record = { ...agreedRecord(7), playerName: 'Alex Rivers' } as GameRecord

    expect(JSON.stringify(recordForCollection(record))).not.toContain('Alex Rivers')
  })

  /** The starting position is the one the local export writes, so there is one strip and one shape. */
  it('sends the starting position and the moves the local export writes, which still replay', () => {
    answer('yes')
    const record = agreedRecord(11)
    const payload = throughJson(recordForCollection(record))!
    const exported = throughJson(exportRecord(record))

    expect(payload.initialState).toEqual(exported.initialState)
    expect(payload.moves).toEqual(exported.moves)

    const report: Report = payload
    const end = replay(report)
    expect(end.winner).toBe(record.winner)
    expect(withoutCards(end)).toEqual(withoutCards(record.finalState))
  })

  /** Absent means unknown, and a payload must not turn unknown into a value. */
  it('leaves out provenance the record never had', () => {
    answer('yes')
    const { build, opponentAi, humanSeat, undoCount, ...older } = agreedRecord(7)
    void build; void opponentAi; void humanSeat; void undoCount

    expect(Object.keys(throughJson(recordForCollection(older))!).sort()).toEqual([
      'durationMs', 'initialState', 'moves', 'opponentBase', 'opponentLeader', 'playerBase',
      'playerLeader', 'winner',
    ])
  })

  it('stops returning a record when the player turns sharing off again', () => {
    answer('yes')
    const record = agreedRecord(7)
    expect(recordForCollection(record)).not.toBeNull()

    answer('no')
    expect(recordForCollection(record)).toBeNull()
  })
})

describe('consentStamp', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('marks a record only while the player is opted in', () => {
    expect(consentStamp()).toEqual({})
    answer('no')
    expect(consentStamp()).toEqual({})
    answer('yes')
    expect(consentStamp()).toEqual({ consentedAtFinish: true })
  })
})
