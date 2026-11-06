import type { CardDb, EngineCard, GameState, PlayerId } from '../engine/types'

/**
 * The player's record by matchup: as one leader and base, against each opposing leader and base,
 * read from the leaders and bases a saved game's `initialState` names, so every game saved counts.
 *
 * Bases are grouped, the same way on both sides, from the card data. A common base with no ability
 * of its own is one of a set's aspect bases, which differ only in name, so it groups by its aspect. A
 * common base with an ability groups with every common base of its HP, whatever their aspects: the
 * Force bases (28 HP) and the splash bases (27 HP) each print one ability across four aspects. A rare
 * or special base is unique and stands alone. A leader stands alone, matched by name and subtitle so
 * that a reprint is the same leader.
 */

/** Wins, losses and draws. */
export interface WinLoss {
  won: number
  lost: number
  drawn: number
}

/** One side of a matchup: what it is matched by, and how it reads. */
export interface Side {
  key: string
  label: string
}

/** The opposing side and the player's record against it. */
export interface Matchup {
  opponent: Side
  record: WinLoss
}

/** Every matchup played, by the player's side's key, then by the opposing side's. */
export type MatchupTally = Map<string, Map<string, Matchup>>

/** What a common base with an ability is called, by its HP. A new kind reads as its HP until named. */
const COMMON_KINDS: Record<number, string> = { 28: 'Force base', 27: 'Splash base' }

export function baseGroup(base: EngineCard): Side {
  if (base.rarity !== 'Common') return { key: `base:${base.name}`, label: base.name }
  if (!base.text) {
    const aspects = base.aspects.join(' ')
    return { key: `aspect:${aspects}`, label: `${aspects || 'No aspect'} base` }
  }
  const hp = base.hp ?? 0
  return { key: `common:${hp}`, label: COMMON_KINDS[hp] ?? `${hp} HP base` }
}

/** A leader on a base as one side of a matchup, or nothing while either card is unknown. */
export function sideOf(leader: EngineCard | undefined, base: EngineCard | undefined): Side | null {
  if (!leader || !base) return null
  const group = baseGroup(base)
  const who = [leader.name, leader.subtitle].filter(Boolean).join(', ')
  return { key: `${who}|${group.key}`, label: `${who} · ${group.label}` }
}

/** One seat's side in a game, read from its starting position and the cards that came with it. */
function seatSide(state: GameState, seat: PlayerId, cards: CardDb): Side | null {
  const { leader, base } = state.players[seat]
  return sideOf(cards[leader.cardId], cards[base.cardId])
}

/** A saved game as the tally reads it. */
export interface TalliedGame {
  initialState: GameState
  winner: PlayerId | 'draw'
  /** Absent on a game saved before the seat was written, which was played from the player seat. */
  humanSeat?: PlayerId
}

/** Adds one game to the tally. A game whose leaders or bases are not in its card data is left out. */
export function addGame(tally: MatchupTally, { initialState, winner, humanSeat = 'player' }: TalliedGame): void {
  const cards = initialState.cards
  const mine = seatSide(initialState, humanSeat, cards)
  const theirs = seatSide(initialState, humanSeat === 'player' ? 'opponent' : 'player', cards)
  if (!mine || !theirs) return
  const against = tally.get(mine.key) ?? new Map<string, Matchup>()
  const matchup = against.get(theirs.key) ?? { opponent: theirs, record: { won: 0, lost: 0, drawn: 0 } }
  if (winner === 'draw') matchup.record.drawn++
  else if (winner === humanSeat) matchup.record.won++
  else matchup.record.lost++
  against.set(theirs.key, matchup)
  tally.set(mine.key, against)
}

const games = ({ won, lost, drawn }: WinLoss) => won + lost + drawn

/** The matchups one side has played, most played first. */
export function matchupsOf(tally: MatchupTally, mine: Side | null): Matchup[] {
  return [...(mine ? tally.get(mine.key)?.values() ?? [] : [])].sort((a, b) => games(b.record) - games(a.record))
}

/** One record over several matchups. */
export function totalOf(matchups: Matchup[]): WinLoss {
  return matchups.reduce((t, { record: r }) => ({ won: t.won + r.won, lost: t.lost + r.lost, drawn: t.drawn + r.drawn }), { won: 0, lost: 0, drawn: 0 })
}
