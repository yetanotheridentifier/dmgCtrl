import { describe, it, expect } from 'vitest'
import {
  ROWS_FORMAT_VERSION, gameKey, outcomeFor, rowsForExport, rowsForRecord, trainingCardDb, type TrainingRow,
} from '../bench/trainingRows'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { poolFor } from '../bench/setPools'
import { engineDeck, sweepCardDb } from '../bench/sweep'
import { buildGameExport, exportRecord, EXPORT_FORMAT_VERSION, type ExportedRecord } from '../data/recordExport'
import { withoutCards } from '../data/replayData'
import { legalMoves } from '../engine/legalMoves'
import { resolve, UNSEEN_CARD } from '../engine/resolve'
import { seatView } from '../engine/seatView'
import type { GameState } from '../engine/types'
import { playedRecord } from './helpers/playedRecord'

/**
 * An exported game becomes training rows by replaying it: one row per recorded move, holding the
 * position the mover faced, what they did, and how the game ended for them. Nothing here is taken
 * on trust from the record except the starting position and the moves; the winner is replayed and
 * checked against the stored one, which is what catches a record this build no longer replays.
 */

/** What a file on disk holds: whatever survives `JSON.stringify`. */
const throughJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const CARDS = trainingCardDb()
const exported = (seed: number): ExportedRecord => throughJson(exportRecord(playedRecord(seed)))
const withCards = (row: TrainingRow): GameState => ({ ...row.state, cards: CARDS })

describe('the rows of one exported game', () => {
  const record = exported(11)
  const rows = throughJson(rowsForRecord(record, CARDS))

  it('are one per recorded move, in order, each holding the move that was made', () => {
    expect(record.moves.length).toBeGreaterThan(20)
    expect(rows).toHaveLength(record.moves.length)
    expect(rows.map(r => r.moveIndex)).toEqual(record.moves.map((_, i) => i))
    expect(rows.map(r => r.action)).toEqual(record.moves.map(m => m.action))
    expect(rows.every(r => r.moveCount === record.moves.length)).toBe(true)
  })

  it('name the seat that made each move, which is the seat the position was waiting on', () => {
    expect(rows.map(r => r.mover)).toEqual(record.moves.map(m => m.by))
    expect(rows.map(r => r.mover)).toEqual(rows.map(r => r.state.activePlayer))
    expect(new Set(rows.map(r => r.mover))).toEqual(new Set(['player', 'opponent']))
  })

  /**
   * The proof that a row's state is the position its move was chosen in: the first is the record's
   * starting position, and applying each row's move to its own state gives the next row's state.
   */
  it('hold the real position before each move', () => {
    expect(rows[0].state).toEqual(record.initialState)
    rows.slice(0, -1).forEach((row, i) => {
      expect(throughJson(withoutCards(resolve(withCards(row), row.action))), `after move ${i}`).toEqual(rows[i + 1].state)
    })
    const last = rows[rows.length - 1]
    expect(resolve(withCards(last), last.action).winner).toBe(record.winner)
  })

  it('never carry the card database', () => {
    expect(rows.every(r => !('cards' in r.state))).toBe(true)
  })

  it('give the result from the mover\'s side, so the two seats read opposite', () => {
    expect(['player', 'opponent']).toContain(record.winner)
    for (const row of rows) expect(row.outcome).toBe(row.mover === record.winner ? 'win' : 'loss')
    expect(new Set(rows.map(r => r.outcome))).toEqual(new Set(['win', 'loss']))
  })

  it('carry what is known about how the game was played, and who decided', () => {
    for (const row of rows) {
      expect(row.build).toEqual({ release: '412', commitId: 'abc1234' })
      expect(row.opponentAi).toBe('beam-reply')
      expect(row.humanSeat).toBe('player')
      expect(row.undoCount).toBe(2)
      expect(row.decidedBy).toBe(row.mover === 'player' ? 'human' : 'ai')
    }
  })

  /** A hand and a deck in draw order are in every state, the opponent's included, and the row says so. */
  it('say that the state holds both hands and both decks', () => {
    expect(rows.every(r => r.information === 'full')).toBe(true)
    expect(rows[0].state.players.opponent.hand.length).toBeGreaterThan(0)
    expect(rows[0].state.players.opponent.deck.length).toBeGreaterThan(0)
  })

  /**
   * Pinned exactly, in order: a field added to a row has to be added here on purpose, and the bulky
   * one stays last so a row can be read from the left.
   */
  it('have exactly these keys', () => {
    for (const row of rows) {
      expect(Object.keys(row)).toEqual([
        'formatVersion', 'gameKey', 'moveIndex', 'moveCount', 'mover', 'decidedBy', 'outcome', 'information',
        'build', 'opponentAi', 'humanSeat', 'undoCount', 'action', 'state',
      ])
      expect(row.formatVersion).toBe(ROWS_FORMAT_VERSION)
    }
  })

  /** Absent means unknown, as it does in the export, and a row must not turn unknown into a value. */
  it('leave out provenance the record never had, and then cannot say who decided', () => {
    const { build, opponentAi, humanSeat, undoCount, ...older } = record
    void build; void opponentAi; void humanSeat; void undoCount

    const olderRows = throughJson(rowsForRecord(older, CARDS))

    expect(Object.keys(olderRows[0])).toEqual([
      'formatVersion', 'gameKey', 'moveIndex', 'moveCount', 'mover', 'decidedBy', 'outcome', 'information',
      'action', 'state',
    ])
    expect(olderRows.every(r => r.decidedBy === 'unknown')).toBe(true)
  })
})

/**
 * A game the bench recorded has a bot on both seats and says which (`bench` on the record). Its rows
 * name the bot that sat where each move was made. A person's game has no such field, and its rows
 * are the ones above, unchanged.
 */
describe('the rows of a game two bots played', () => {
  const { opponentAi, humanSeat, undoCount, ...played } = exported(11)
  void opponentAi; void humanSeat; void undoCount
  const record: ExportedRecord = {
    ...played,
    playerDeckName: 'Deck One',
    opponentDeckName: 'Deck Two',
    bench: { ais: { player: 'beam-reply', opponent: 'greedy+base=9' }, seed: 11, runSeed: 3, game: 6, decks: 'coverage' },
  }
  const rows = throughJson(rowsForRecord(record, CARDS))

  it('say a bot decided every move, and which one', () => {
    for (const row of rows) {
      expect(row.decidedBy).toBe('ai')
      expect(row.ai).toBe(row.mover === 'player' ? 'beam-reply' : 'greedy+base=9')
    }
    expect(new Set(rows.map(r => r.ai))).toEqual(new Set(['beam-reply', 'greedy+base=9']))
  })

  it('name the deck the mover played and carry the run the game came from', () => {
    for (const row of rows) {
      expect(row.deck).toBe(row.mover === 'player' ? 'Deck One' : 'Deck Two')
      expect(row.bench).toEqual(record.bench)
    }
  })

  it('have exactly these keys, with none of a person\'s provenance', () => {
    for (const row of rows) {
      expect(Object.keys(row)).toEqual([
        'formatVersion', 'gameKey', 'moveIndex', 'moveCount', 'mover', 'decidedBy', 'outcome', 'information',
        'build', 'ai', 'deck', 'bench', 'action', 'state',
      ])
      expect(row.formatVersion).toBe(ROWS_FORMAT_VERSION)
    }
  })

  it('are the same rows in everything else as the same game without the field', () => {
    const plain = throughJson(rowsForRecord(played, CARDS))
    const rest = (row: TrainingRow) => ({ ...row, decidedBy: null, ai: null, deck: null, bench: null })
    expect(rows.map(rest)).toEqual(plain.map(rest))
    expect(plain.every(r => r.decidedBy === 'unknown' && !('ai' in r) && !('deck' in r) && !('bench' in r))).toBe(true)
  })

  /** The key is the game's own, so the same game is the same game whoever is said to have played it. */
  it('keep the game\'s key', () => {
    expect(rows[0].gameKey).toBe(gameKey(played))
  })
})

describe('the result as the mover saw it', () => {
  it('is a win for the winner, a loss for the other seat and a draw for both', () => {
    expect(outcomeFor('player', 'player')).toBe('win')
    expect(outcomeFor('player', 'opponent')).toBe('loss')
    expect(outcomeFor('opponent', 'opponent')).toBe('win')
    expect(outcomeFor('opponent', 'player')).toBe('loss')
    expect(outcomeFor('draw', 'player')).toBe('draw')
    expect(outcomeFor('draw', 'opponent')).toBe('draw')
  })
})

/**
 * The export carries no record id, so rows are grouped by a key made from the game itself. The same
 * game exported twice gets the same key, which is what lets a later stage drop the repeat.
 */
describe('the key that groups a game\'s rows', () => {
  it('is the same on every row of a game and differs between games', () => {
    const a = rowsForRecord(exported(11), CARDS)
    const b = rowsForRecord(exported(7), CARDS)

    expect(new Set(a.map(r => r.gameKey)).size).toBe(1)
    expect(a[0].gameKey).toMatch(/^[0-9a-f]{16}$/)
    expect(b[0].gameKey).not.toBe(a[0].gameKey)
  })

  it('depends on the starting position and the moves alone, so a repeated export keeps it', () => {
    const record = exported(11)

    const exportedAgain: ExportedRecord = { ...record, endedAt: 1, undoCount: 9, playerDeckName: 'Renamed' }

    expect(gameKey(exportedAgain)).toBe(gameKey(record))
    expect(gameKey({ ...record, moves: record.moves.slice(0, -1) })).not.toBe(gameKey(record))
  })
})

describe('the legal moves, when asked for', () => {
  const record = exported(11)

  it('are left out by default, since the state is enough to list them again', () => {
    const row = rowsForRecord(record, CARDS)[0]
    expect('legalMoves' in row).toBe(false)
    expect('chosenIndex' in row).toBe(false)
  })

  it('are the engine\'s own list for the position, with the move that was made pointed at', () => {
    const rows = throughJson(rowsForRecord(record, CARDS, { legalMoves: true }))

    for (const row of rows) {
      expect(row.legalMoves).toEqual(throughJson(legalMoves(withCards(row))))
      expect(row.legalMoves![row.chosenIndex!]).toEqual(row.action)
    }
    expect(Object.keys(rows[0]).slice(-4)).toEqual(['action', 'chosenIndex', 'legalMoves', 'state'])
  })

  /**
   * The engine never lists offering to concede (`legalMoves` says why), and a game that ends that
   * way records the offer as a move. The row is kept, since it was a decision, and points nowhere.
   */
  it('point nowhere for an offer to concede, which the engine never lists', () => {
    const conceded = exported(6)
    const offer = conceded.moves.findIndex(m => m.action.type === 'offerConcession')
    expect(offer).toBeGreaterThan(0)

    const rows = rowsForRecord(conceded, CARDS, { legalMoves: true })

    expect(rows).toHaveLength(conceded.moves.length)
    expect(rows.filter(r => r.chosenIndex === -1).map(r => r.moveIndex)).toEqual([offer])
    expect(rows[offer + 1].action).toEqual({ type: 'acceptConcession' })
    expect(rows[offer + 1].legalMoves![rows[offer + 1].chosenIndex!]).toEqual({ type: 'acceptConcession' })
  })
})

/**
 * A row can hold the position as its mover saw it instead of the whole of it. Everything about the
 * row but its state and what it says of that state is the same either way, and a run that does not
 * ask for the mover's view writes what it always wrote.
 */
describe('rows in the mover\'s view', () => {
  const record = exported(11)
  const fullRows = throughJson(rowsForRecord(record, CARDS))
  const rows = throughJson(rowsForRecord(record, CARDS, { view: 'mover' }))
  const other = (row: TrainingRow) => (row.mover === 'player' ? 'opponent' : 'player')

  it('say so, where the others say they hold everything', () => {
    expect(rows.every(r => r.information === 'mover')).toBe(true)
    expect(fullRows.every(r => r.information === 'full')).toBe(true)
  })

  it('hold the position as the engine shows it to the seat that moved', () => {
    expect(rows).toHaveLength(fullRows.length)
    rows.forEach((row, i) => {
      expect(row.state, `move ${i}`).toEqual(throughJson(withoutCards(seatView(withCards(fullRows[i]), row.mover))))
    })
  })

  it('hold none of the other seat\'s hand or deck, and all of the mover\'s own hand', () => {
    rows.forEach((row, i) => {
      const theirs = row.state.players[other(row)]
      const whole = fullRows[i].state.players
      expect(new Set([...theirs.hand, ...theirs.deck, UNSEEN_CARD])).toEqual(new Set([UNSEEN_CARD]))
      expect(theirs.hand).toHaveLength(whole[other(row)].hand.length)
      expect(theirs.deck).toHaveLength(whole[other(row)].deck.length)
      expect(row.state.players[row.mover].hand).toEqual(whole[row.mover].hand)
    })
    expect(rows.some(r => r.state.players[other(r)].hand.length > 0)).toBe(true)
  })

  it('are the same rows in everything else: the move, the mover, the result and the provenance', () => {
    const rest = (row: TrainingRow) => ({ ...row, state: null, information: null })
    expect(rows.map(rest)).toEqual(fullRows.map(rest))
    expect(Object.keys(rows[0])).toEqual(Object.keys(fullRows[0]))
    expect(rows[0].formatVersion).toBe(ROWS_FORMAT_VERSION)
  })

  /** The legal moves are the mover's own, listed from the real position: a view cannot be asked. */
  it('carry the same legal moves and the same pointer as the full rows', () => {
    const legal = throughJson(rowsForRecord(record, CARDS, { view: 'mover', legalMoves: true }))
    const fullLegal = throughJson(rowsForRecord(record, CARDS, { legalMoves: true }))
    expect(legal.map(r => r.legalMoves)).toEqual(fullLegal.map(r => r.legalMoves))
    expect(legal.map(r => r.chosenIndex)).toEqual(fullLegal.map(r => r.chosenIndex))
  })

  it('are not what a run writes unless it asks: the full view is the default, byte for byte', () => {
    const lines = (all: TrainingRow[]) => all.map(r => JSON.stringify(r)).join('\n')
    expect(lines(rowsForRecord(record, CARDS, { view: 'full' }))).toBe(lines(rowsForRecord(record, CARDS)))
    const file = throughJson(buildGameExport([playedRecord(11)]))
    expect(lines(rowsForExport(file, CARDS).games[0].rows)).toBe(lines(rowsForRecord(record, CARDS)))
    expect(rowsForExport(file, CARDS, { view: 'mover' }).games[0].rows[0].information).toBe('mover')
  })
})

/**
 * A record is only as good as this build's ability to replay it. One that ends somewhere other
 * than where it says it did would give every row the wrong result, so it yields no rows at all.
 */
describe('a record that does not replay to its stored result', () => {
  const record = exported(11)

  it('is refused when the replayed winner is not the stored one', () => {
    const flipped: ExportedRecord = { ...record, winner: record.winner === 'player' ? 'opponent' : 'player' }
    expect(() => rowsForRecord(flipped, CARDS)).toThrow(/replays to a win for (player|opponent), but the record says (player|opponent)/)
  })

  it('is refused when its moves stop before the game is over', () => {
    const cutShort: ExportedRecord = { ...record, moves: record.moves.slice(0, 10) }
    expect(() => rowsForRecord(cutShort, CARDS)).toThrow(/no winner after its 10 moves/)
  })

  it('is refused when it has moves left after the game is over', () => {
    const overrun: ExportedRecord = { ...record, moves: [...record.moves, { by: 'player', action: { type: 'pass' } }] }
    expect(() => rowsForRecord(overrun, CARDS)).toThrow(/the replay threw: .*the game is over/)
  })
})

describe('a game from another set', () => {
  /** A whole game on a deck built from one other set's pool, as the sweep builds and plays one. */
  const lawRecord = (): ExportedRecord => {
    const pool = poolFor(['LAW'])
    const deck = engineDeck(buildCoverageDecks(pool).decks[0])
    return throughJson(exportRecord(playedRecord(3, { deck, cardDb: sweepCardDb(pool) })))
  }

  it('is transformed like any other, from the bundled set fixtures', () => {
    const record = lawRecord()
    const dealt = [...record.initialState.players.player.deck, ...record.initialState.players.player.hand]
    expect(dealt.some(id => id.startsWith('LAW_'))).toBe(true)
    expect(dealt.some(id => id.startsWith('ASH_'))).toBe(false)
    // A card reprinted from an earlier set plays under that set's id, so one set's game names two.
    expect(dealt).toContain('SHD_260')

    const rows = rowsForRecord(record, CARDS)

    expect(rows).toHaveLength(record.moves.length)
    expect(rows[rows.length - 1].outcome).toBe(rows[rows.length - 1].mover === record.winner ? 'win' : 'loss')
  })

  it('is refused, naming the cards, when it holds one no bundled set has', () => {
    const record = exported(11)
    const unknown: ExportedRecord = {
      ...record,
      initialState: {
        ...record.initialState,
        players: {
          ...record.initialState.players,
          opponent: { ...record.initialState.players.opponent, hand: ['ZZZ_001', ...record.initialState.players.opponent.hand.slice(1)] },
        },
      },
    }
    expect(() => rowsForRecord(unknown, CARDS)).toThrow(/no card data for ZZZ_001/)
  })
})

describe('a whole export file', () => {
  it('gives each record\'s rows, in the file\'s order', () => {
    const file = throughJson(buildGameExport([playedRecord(7), playedRecord(11)]))

    const result = rowsForExport(file, CARDS)

    expect(result.rejected).toEqual([])
    expect(result.games.map(g => g.index)).toEqual([0, 1])
    expect(result.games.map(g => g.rows.length)).toEqual(file.records.map(r => r.moves.length))
    expect(result.games[1].rows[0].gameKey).toBe(gameKey(file.records[1]))
  })

  it('keeps the good records and names the one it refused, with why', () => {
    const file = throughJson(buildGameExport([playedRecord(7), playedRecord(11)]))
    file.records[0].moves = file.records[0].moves.slice(0, 5)

    const result = rowsForExport(file, CARDS)

    expect(result.games.map(g => g.index)).toEqual([1])
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].index).toBe(0)
    expect(result.rejected[0].reason).toMatch(/no winner after its 5 moves/)
  })

  it('refuses a file written in a format it does not know', () => {
    const file = throughJson(buildGameExport([playedRecord(7)]))
    expect(() => rowsForExport({ ...file, formatVersion: EXPORT_FORMAT_VERSION + 1 }, CARDS)).toThrow(/format version/)
  })

  it('refuses something that is not an export at all', () => {
    expect(() => rowsForExport({ initialState: {}, moves: [] }, CARDS)).toThrow(/not a game export/)
    expect(() => rowsForExport(null, CARDS)).toThrow(/not a game export/)
  })
})
