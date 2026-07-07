import type { CardDb, GameState, PlayerId, PlayerState } from './types'
import type { ParsedDeck } from '../utils/parseProtectThePod'

export interface InitGameOptions {
  firstPlayer: PlayerId
  /** Injectable for deterministic tests/AI; defaults to Fisher–Yates. */
  shuffle?: <T>(arr: T[]) => T[]
  /** Seed for in-game shuffles (mulligans); defaults to a random seed. */
  rngSeed?: number
}

const OPENING_HAND = 6

export function fisherYates<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function expandDeck(deck: ParsedDeck): string[] {
  const cards: string[] = []
  for (const entry of deck.cards) {
    for (let i = 0; i < entry.count; i++) cards.push(entry.id)
  }
  return cards
}

function initPlayer(deck: ParsedDeck, shuffle: <T>(arr: T[]) => T[]): PlayerState {
  const shuffled = shuffle(expandDeck(deck))
  return {
    leader: { cardId: deck.leader, deployed: false, epicActionUsed: false, exhausted: false },
    base: { cardId: deck.base, damage: 0 },
    hand: shuffled.slice(0, OPENING_HAND),
    deck: shuffled.slice(OPENING_HAND),
    discard: [],
    resources: [],
    units: [],
  }
}

/**
 * Two decklists → the start of setup (T2.2 + #304): bases and leaders placed,
 * decks shuffled, 6 cards dealt. The game begins in the SETUP phase — mulligan
 * decisions (CR 5.2.1e, initiative holder first) and the taking of 2 starting
 * resources (CR 5.2.1f) resolve through the normal action pipeline; round 1's
 * action phase starts once both players have decided.
 */
export function initGame(
  playerDeck: ParsedDeck,
  opponentDeck: ParsedDeck,
  cards: CardDb,
  options: InitGameOptions,
): GameState {
  const shuffle = options.shuffle ?? fisherYates

  return {
    cards,
    players: {
      player: initPlayer(playerDeck, shuffle),
      opponent: initPlayer(opponentDeck, shuffle),
    },
    initiative: options.firstPlayer,
    initiativeTakenBy: null,
    activePlayer: options.firstPlayer,
    phase: 'setup',
    round: 1,
    consecutivePasses: 0,
    regroupResourced: { player: false, opponent: false },
    instanceCounter: 1,
    rngSeed: options.rngSeed ?? Math.floor(Math.random() * 0xffffffff),
    setupStage: 'mulligan',
    winner: null,
  }
}
