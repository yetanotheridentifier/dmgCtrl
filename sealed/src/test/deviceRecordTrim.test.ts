// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../data/db'
import { KEPT_AFTER_DELIVERY, listGameRecords, matchupRecords, trimGameRecords } from '../data/gameRecords'
import type { GameRecord } from '../data/gameRecords'
import { defaultSettings, saveSettings } from '../data/settingsStore'
import type { ShareGames } from '../data/settingsStore'
import { playedRecord } from './helpers/playedRecord'

/**
 * What a finished game leaves on the device. Every game keeps a small summary for good, which is
 * what the record by matchup is read from. Its replay data (`initialState`, `moves`, `finalState`)
 * stays only while something needs it: an undelivered game owed to the collection, and the newest
 * few delivered games for export and debugging. A player who does not share keeps none.
 */

const PLAYED = playedRecord(7)

/** A saved game, the newer the larger `n`, with the winner and seat varied so the tally has something to read. */
const game = (n: number, extra: Partial<GameRecord> = {}): GameRecord => ({
  ...PLAYED,
  id: `game-${n}`,
  endedAt: 10_000 + n,
  winner: n % 3 === 0 ? 'draw' : n % 2 === 0 ? 'player' : 'opponent',
  humanSeat: n % 4 === 1 ? 'opponent' : 'player',
  ...extra,
})

const answer = (shareGames: ShareGames) => saveSettings({ ...defaultSettings(), shareGames })

/** The ids still holding replay data, newest first. */
const fullIds = async () => (await listGameRecords()).map(r => r.id)

/** The tally as plain data, so two can be compared. */
const tallyOf = async () =>
  [...(await matchupRecords())].map(([mine, against]) => [mine, [...against].map(([theirs, m]) => [theirs, m.record])])

describe('trimming saved games on the device', () => {
  beforeEach(async () => {
    localStorage.clear()
    await db.games.clear()
  })

  describe.each([
    ['has not been asked', 'unasked'],
    ['said no', 'no'],
  ] as const)('for a player who %s', (_, shareGames) => {
    it('drops the replay data of every game, including one finished while sharing', async () => {
      answer(shareGames)
      await db.games.bulkPut([game(1), game(2, { consentedAtFinish: true }), game(3, { delivered: true })])

      await trimGameRecords()

      expect(await fullIds()).toEqual([])
      expect(await db.games.count()).toBe(3)
    })
  })

  describe('for a player who shares', () => {
    beforeEach(() => answer('yes'))

    it('keeps every game not yet delivered whole, however many there are', async () => {
      await db.games.bulkPut([1, 2, 3, 4, 5, 6].map(n => game(n, { consentedAtFinish: true })))

      await trimGameRecords()

      expect(await fullIds()).toHaveLength(6)
    })

    it(`keeps the newest ${KEPT_AFTER_DELIVERY} delivered games whole and only a summary of the rest`, async () => {
      await db.games.bulkPut([1, 2, 3, 4].map(n => game(n, { consentedAtFinish: true, delivered: true })))

      await trimGameRecords()

      expect(KEPT_AFTER_DELIVERY).toBe(2)
      expect(await fullIds()).toEqual(['game-4', 'game-3'])
      expect(await db.games.count()).toBe(4)
    })

    it('treats a game that may never be sent like a delivered one', async () => {
      await db.games.bulkPut([
        game(1),
        game(2, { consentedAtFinish: true }),
        game(3),
        game(4, { consentedAtFinish: true, delivered: true }),
        game(5),
      ])

      await trimGameRecords()

      expect(await fullIds()).toEqual(['game-5', 'game-4', 'game-2'])
    })
  })

  it('keeps every field of a trimmed game but its replay data, with the sides and how it ended', async () => {
    answer('no')
    const conceded = game(2, { finalState: { ...PLAYED.finalState, concededBy: 'player' } })
    await db.games.put(conceded)

    await trimGameRecords()

    const { initialState, moves, finalState, ...kept } = conceded
    void initialState
    void moves
    void finalState
    const stored = await db.games.get('game-2')
    expect(stored).toMatchObject(kept)
    expect(stored).not.toHaveProperty('initialState')
    expect(stored).not.toHaveProperty('moves')
    expect(stored).not.toHaveProperty('finalState')
    expect(stored).toHaveProperty('concededBy', 'player')
    const cards = PLAYED.initialState.cards
    const { player, opponent } = PLAYED.initialState.players
    expect(stored).toHaveProperty('sides', {
      player: { leader: cards[player.leader.cardId], base: cards[player.base.cardId] },
      opponent: { leader: cards[opponent.leader.cardId], base: cards[opponent.base.cardId] },
    })
  })

  it('leaves the record by matchup exactly as it was', async () => {
    answer('no')
    await db.games.bulkPut([1, 2, 3, 4, 5, 6, 7, 8].map(n => game(n)))
    const before = await tallyOf()
    expect(before).not.toEqual([])

    await trimGameRecords()
    await trimGameRecords()

    expect(await fullIds()).toEqual([])
    expect(await tallyOf()).toEqual(before)
  })
})
