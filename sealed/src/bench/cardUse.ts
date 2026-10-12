import { createHash } from 'node:crypto'
import type { ExportedRecord } from '../data/recordExport'
import type { Action } from '../engine/actions'
import { legalMoves } from '../engine/legalMoves'
import { replayStates, withCardDb } from '../engine/replay'
import type { CardDb, PlayerId } from '../engine/types'

/**
 * How each card was used, per deck, read off recorded bench games (`records.ts`).
 *
 * For each bot, each deck it sat and each card: how many times the card was played, and in how many
 * games it was legally playable when its holder chose to pass instead. A card passed over in many
 * games and played in none is one that bot cannot use under that deck; one passed over and also
 * played is being held for its moment.
 *
 * **It is asked of the records, not counted while the games are played.** A record replays to every
 * position of its game, so a question like this one needs no counter written into the run for it,
 * and a different one (another split, another moment than the pass) is another function over the
 * same files. The deck is the dimension the decision diagnostic's own table of declined plays lacks
 * (`decisions.ts`), and the two share the predicate below so they cannot come to disagree.
 *
 * A function, with no bench mode in front of it.
 */

type CardPlay = Extract<Action, { type: 'playUnit' | 'playUpgrade' | 'playBaseUpgrade' | 'playEvent' }>

/** A move that plays a card from hand. */
export function isCardPlay(action: Action): action is CardPlay {
  return action.type === 'playUnit' || action.type === 'playUpgrade' || action.type === 'playBaseUpgrade' || action.type === 'playEvent'
}

/**
 * The hand positions a seat could play from, given the moves the engine offers it.
 *
 * Read off the legal moves and never off cost: an upgrade with no host, a debuff with no enemy unit
 * and an attack event with no ready unit are all affordable and none is playable, and the engine's
 * own restrictions already say so.
 */
export function playableHandIndexes(moves: Action[]): Set<number> {
  return new Set(moves.filter(isCardPlay).map(m => m.handIndex))
}

/** A deck as a record identifies it. */
export interface RecordedDeck {
  name: string
  leader: string
  base: string
  /**
   * A short hash of the cards the seat was dealt from. Generated decks share names (a name is the
   * leader and the base's aspect), so the list is what tells two of them apart.
   */
  list: string
}

/** The deck a seat played, from the record alone: its name and the starting position's cards. */
export function deckOf(record: ExportedRecord, seat: PlayerId): RecordedDeck {
  const side = record.initialState.players[seat]
  const cards = [...side.hand, ...side.deck].sort()
  return {
    name: seat === 'player' ? record.playerDeckName : record.opponentDeckName,
    leader: side.leader.cardId,
    base: side.base.cardId,
    list: createHash('sha256').update(JSON.stringify([side.leader.cardId, side.base.cardId, cards])).digest('hex').slice(0, 8),
  }
}

export interface CardUse {
  /** The bot that held the card, as its record names it. */
  ai: string
  deck: RecordedDeck
  cardId: string
  name: string
  /** Games this bot sat this deck. A mirror game in which it held both seats counts twice. */
  games: number
  /** Times the card was played from hand. */
  played: number
  /** Occasions it was playable at a chosen pass: a card held through three such passes is three. */
  declined: number
  /** Games with at least one such occasion. */
  gamesDeclined: number
}

/**
 * Every card each bot played or held back, under each deck it sat, over these records.
 *
 * A pass is a decision only where there was something else to do, so a forced pass counts for
 * nothing. Rows are grouped by deck and bot, the cards held back in the most games first. A card
 * that was neither played nor passed over has no row.
 *
 * Throws for a record that is not the bench's (it names no bot for a seat), and for one this build
 * cannot replay to its stored winner, naming the record.
 */
export function cardUse(records: ExportedRecord[], cards: CardDb): CardUse[] {
  const rows = new Map<string, CardUse>()
  const sat = new Map<string, number>()

  records.forEach((record, index) => {
    const { bench } = record
    if (bench === undefined) throw new Error(`record ${index} is not a bench record: it has no bench field naming its bots`)
    const states = replayStates(withCardDb(record, cards), record.moves)
    const winner = states[states.length - 1].winner
    if (winner !== record.winner) throw new Error(`record ${index} replays to ${winner ?? 'no winner'}, but says ${record.winner}`)

    const decks: Record<PlayerId, RecordedDeck> = { player: deckOf(record, 'player'), opponent: deckOf(record, 'opponent') }
    const group = (seat: PlayerId): string => `${decks[seat].list}|${bench.ais[seat]}`
    const heldBack = new Set<string>()
    const row = (seat: PlayerId, cardId: string): CardUse => {
      const key = `${group(seat)}|${cardId}`
      let use = rows.get(key)
      if (!use) {
        use = { ai: bench.ais[seat], deck: decks[seat], cardId, name: cards[cardId]?.name ?? cardId, games: 0, played: 0, declined: 0, gamesDeclined: 0 }
        rows.set(key, use)
      }
      return use
    }
    for (const seat of ['player', 'opponent'] as PlayerId[]) sat.set(group(seat), (sat.get(group(seat)) ?? 0) + 1)

    record.moves.forEach((move, i) => {
      const state = states[i]
      const hand = state.players[move.by].hand
      if (isCardPlay(move.action)) row(move.by, hand[move.action.handIndex]).played++
      if (move.action.type !== 'pass') return
      const moves = legalMoves(state)
      if (!moves.some(m => m.type !== 'pass')) return
      for (const handIndex of playableHandIndexes(moves)) {
        const use = row(move.by, hand[handIndex])
        use.declined++
        const key = `${group(move.by)}|${use.cardId}`
        if (!heldBack.has(key)) {
          heldBack.add(key)
          use.gamesDeclined++
        }
      }
    })
  })

  for (const use of rows.values()) use.games = sat.get(`${use.deck.list}|${use.ai}`) ?? 0
  const group = (use: CardUse): string => `${use.deck.list}|${use.ai}`
  // By code unit, not by locale: the order is part of what the same records give twice.
  const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  return [...rows.values()].sort((a, b) =>
    byText(group(a), group(b)) || b.gamesDeclined - a.gamesDeclined || a.played - b.played || byText(a.cardId, b.cardId))
}
