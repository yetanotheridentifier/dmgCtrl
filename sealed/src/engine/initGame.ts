import type { CardDb, GameState, PlayerId, PlayerState } from './types'
import type { ParsedDeck } from '../utils/parseProtectThePod'

export interface InitGameOptions {
  firstPlayer: PlayerId
  /** Injectable for deterministic tests/AI; defaults to Fisher–Yates. */
  shuffle?: <T>(arr: T[]) => T[]
  /**
   * SWU setup: after drawing 6, each player takes 2 cards from hand as starting
   * resources (CR §5.2 — section absent from the docs PDF; standard setup rule).
   * Receives the dealt hand, returns the indices to resource. Defaults to the
   * last two dealt. The UI can pass a real choice later without engine changes.
   */
  chooseSetupResources?: (hand: string[]) => [number, number]
}

const OPENING_HAND = 6
const SETUP_RESOURCES = 2

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

function initPlayer(deck: ParsedDeck, opts: Required<Pick<InitGameOptions, 'shuffle' | 'chooseSetupResources'>>): PlayerState {
  const shuffled = opts.shuffle(expandDeck(deck))
  const dealt = shuffled.slice(0, OPENING_HAND)
  const remaining = shuffled.slice(OPENING_HAND)

  const resourceIndices = opts.chooseSetupResources(dealt)
  const resourceSet = new Set<number>(resourceIndices)
  const hand = dealt.filter((_, i) => !resourceSet.has(i))
  const resources = dealt
    .filter((_, i) => resourceSet.has(i))
    .map(cardId => ({ cardId, exhausted: false }))

  return {
    leader: { cardId: deck.leader, deployed: false, epicActionUsed: false, exhausted: false },
    base: { cardId: deck.base, damage: 0 },
    hand,
    deck: remaining,
    discard: [],
    resources,
    units: [],
  }
}

/** Two decklists → a valid starting state (T2.2). */
export function initGame(
  playerDeck: ParsedDeck,
  opponentDeck: ParsedDeck,
  cards: CardDb,
  options: InitGameOptions,
): GameState {
  const shuffle = options.shuffle ?? fisherYates
  const chooseSetupResources = options.chooseSetupResources
    ?? ((hand: string[]): [number, number] => [hand.length - SETUP_RESOURCES, hand.length - 1])

  return {
    cards,
    players: {
      player: initPlayer(playerDeck, { shuffle, chooseSetupResources }),
      opponent: initPlayer(opponentDeck, { shuffle, chooseSetupResources }),
    },
    initiative: options.firstPlayer,
    initiativeTakenBy: null,
    activePlayer: options.firstPlayer,
    phase: 'action',
    round: 1,
    consecutivePasses: 0,
    regroupResourced: { player: false, opponent: false },
    instanceCounter: 1,
    winner: null,
  }
}
