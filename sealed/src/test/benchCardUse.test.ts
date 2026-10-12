import { describe, it, expect } from 'vitest'
import { cardUse, deckOf, type CardUse } from '../bench/cardUse'
import { benchRecord } from '../bench/records'
import { runBench } from '../bench/runBench'
import { rowsForRecord, trainingCardDb } from '../bench/trainingRows'
import type { ExportedRecord } from '../data/recordExport'
import type { PlayerId } from '../engine/types'

/**
 * The question recorded games exist to answer without a counter written for it: for each card,
 * under each deck, how many times was it played, and in how many games was it legally playable
 * when its holder chose to pass instead. Asked of records alone, by replaying them.
 */

const CARDS = trainingCardDb()

/** Eight coverage games: two decks, each sat four times by each bot. `random` passes holding plays. */
function recordedGames(): ExportedRecord[] {
  const records: ExportedRecord[] = []
  runBench({ games: 8, seed: 5, aiA: 'greedy', aiB: 'random', decks: 'coverage', onGame: g => records.push(benchRecord(g)) })
  // What a records file holds: whatever survives `JSON.stringify`.
  return JSON.parse(JSON.stringify(records)) as ExportedRecord[]
}

const PLAYS = ['playUnit', 'playUpgrade', 'playBaseUpgrade', 'playEvent']
const key = (r: Pick<CardUse, 'ai' | 'deck' | 'cardId'>): string => `${r.ai}|${r.deck.list}|${r.cardId}`

/**
 * The same tally by another route: from each game's training rows with their legal moves on them,
 * which is what a consumer holding rows and no engine would count from.
 */
function tallyFromRows(records: ExportedRecord[]): Map<string, { played: number; declined: number; gamesDeclined: number }> {
  const tally = new Map<string, { played: number; declined: number; gamesDeclined: number }>()
  const at = (k: string) => {
    if (!tally.has(k)) tally.set(k, { played: 0, declined: 0, gamesDeclined: 0 })
    return tally.get(k)!
  }
  for (const record of records) {
    const heldBack = new Set<string>()
    for (const row of rowsForRecord(record, CARDS, { legalMoves: true })) {
      const hand = row.state.players[row.mover].hand
      const k = (cardId: string): string => key({ ai: row.ai!, deck: deckOf(record, row.mover), cardId })
      const action = row.action as { type: string; handIndex?: number }
      if (PLAYS.includes(action.type)) at(k(hand[action.handIndex!])).played++
      if (action.type !== 'pass' || row.legalMoves!.length < 2) continue
      const playable = new Set(
        (row.legalMoves as { type: string; handIndex?: number }[]).filter(m => PLAYS.includes(m.type)).map(m => m.handIndex!),
      )
      for (const index of playable) {
        at(k(hand[index])).declined++
        heldBack.add(k(hand[index]))
      }
    }
    for (const k of heldBack) at(k).gamesDeclined++
  }
  return tally
}

describe('how each card was used, per deck, from recorded games', () => {
  const records = recordedGames()
  const use = cardUse(records, CARDS)

  it('counts plays and declined plays exactly as the games\' own rows do', () => {
    const expected = tallyFromRows(records)

    expect(use.length).toBeGreaterThan(20)
    expect(new Map(use.map(r => [key(r), { played: r.played, declined: r.declined, gamesDeclined: r.gamesDeclined }]))).toEqual(expected)
  })

  it('has both halves of the question in it: cards played, and cards held back at a pass', () => {
    expect(use.some(r => r.played > 0)).toBe(true)
    expect(use.some(r => r.declined > 0)).toBe(true)
    // The table the question is after: playable, passed over, and never once played under that deck.
    expect(use.some(r => r.gamesDeclined > 0 && r.played === 0)).toBe(true)
  })

  it('counts a game once however many passes the card sat through in it', () => {
    for (const r of use) {
      expect(r.gamesDeclined, key(r)).toBeLessThanOrEqual(r.declined)
      expect(r.gamesDeclined, key(r)).toBeLessThanOrEqual(r.games)
    }
    expect(use.some(r => r.declined > r.gamesDeclined)).toBe(true)
  })

  /** Each bot sat each of the two decks four times, and a deck is its list, not its name. */
  it('is split by deck and by the bot that held the cards, with how many games each sat', () => {
    const decks = new Set(use.map(r => r.deck.list))
    expect(decks.size).toBe(2)
    expect(new Set(use.map(r => r.ai))).toEqual(new Set(['greedy', 'random']))
    expect(use.every(r => r.games === 4)).toBe(true)
    for (const r of use) {
      expect(r.deck.list).toMatch(/^[0-9a-f]{8}$/)
      expect(CARDS[r.deck.leader].type).toBe('leader')
      expect(CARDS[r.deck.base].type).toBe('base')
      expect(r.name).toBe(CARDS[r.cardId].name)
    }
  })

  it('names a seat\'s deck from the record alone: its name, leader, base and list', () => {
    const [record] = records
    const seats: PlayerId[] = ['player', 'opponent']
    for (const seat of seats) {
      const deck = deckOf(record, seat)
      expect(deck.name).toBe(seat === 'player' ? record.playerDeckName : record.opponentDeckName)
      expect(deck.leader).toBe(record.initialState.players[seat].leader.cardId)
      expect(deck.base).toBe(record.initialState.players[seat].base.cardId)
    }
    // A mirror: both seats were dealt the same list, in a different order.
    expect(deckOf(record, 'player')).toEqual(deckOf(record, 'opponent'))
    expect(record.initialState.players.player.deck).not.toEqual(record.initialState.players.opponent.deck)
    expect(deckOf(records[4], 'player').list).not.toBe(deckOf(record, 'player').list)
  })

  it('is grouped by deck and bot, the cards held back in the most games first', () => {
    const group = (r: CardUse): string => `${r.deck.list}|${r.ai}`
    expect(use.map(group)).toEqual([...use.map(group)].sort())
    use.slice(1).forEach((r, i) => {
      if (group(use[i]) === group(r)) expect(r.gamesDeclined, key(r)).toBeLessThanOrEqual(use[i].gamesDeclined)
    })
    expect(cardUse(records, CARDS)).toEqual(use)
  })

  it('refuses a record with no bench provenance, which names no bot to count for', () => {
    const { bench, ...appRecord } = records[0]
    void bench
    expect(() => cardUse([appRecord], CARDS)).toThrow(/record 0 .*not a bench record/)
  })
}, 60_000)
