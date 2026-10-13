import type { Action } from '../../engine/actions'
import type { CardDb, GameState, PlayerId } from '../../engine/types'
import type { Ai } from '../../ai/types'
import type { ParsedDeck } from '../../utils/parseProtectThePod'
import { opponentOf } from '../../engine/types'
import { resolve } from '../../engine/resolve'
import { setupAi } from '../../ai/setupAi'
import { greedyAi } from '../../ai/greedyAi'
import { clearSearchTrace, lastSearchTrace } from '../../ai/search'
import { playGame } from '../../bench/selfPlay'
import { benchInputs, benchDeckSet } from '../../bench/decks'

/**
 * The hidden-information probe: change something the mover cannot see, and ask for its move again.
 *
 * A bot that reads nothing hidden returns the same move, whatever it is and however it got there.
 * That makes the probe indifferent to the route: any leak, through any function, present or added
 * later, shows up as a changed move, and nothing has to be known about the search to look for one.
 *
 * Every variant leaves `seatView(state, mover)` exactly as it was, and the tests that use these
 * assert that for each position rather than trusting it, so a changed move can never be the mover
 * reacting to something it was entitled to see.
 */

/** A zone the mover cannot see into, and the change made to it. */
export type HiddenZone = 'theirHand' | 'theirDeckOrder' | 'theirResources' | 'ownDeckOrder'

export const HIDDEN_ZONES: HiddenZone[] = ['theirHand', 'theirDeckOrder', 'theirResources', 'ownDeckOrder']

function withPlayer(state: GameState, id: PlayerId, patch: Partial<GameState['players'][PlayerId]>): GameState {
  return { ...state, players: { ...state.players, [id]: { ...state.players[id], ...patch } } }
}

/** A deck with its top third moved to the bottom, so every draw the position could make changes. */
function rotated(deck: string[]): string[] {
  const by = Math.max(1, Math.floor(deck.length / 3))
  return [...deck.slice(by), ...deck.slice(0, by)]
}

/**
 * Trade the first cards of `held` for the cards on the bottom of `deck`, as many as both have.
 * Cards are conserved: what leaves one zone enters the other, so both zones keep their sizes.
 */
function traded(held: string[], deck: string[]): { held: string[]; deck: string[] } {
  const n = Math.min(held.length, deck.length)
  if (n === 0) return { held, deck }
  return {
    held: [...deck.slice(deck.length - n), ...held.slice(n)],
    deck: [...deck.slice(0, deck.length - n), ...held.slice(0, n)],
  }
}

/**
 * The position with one hidden zone changed, or `null` where the change would change nothing (an
 * empty hand, a deck of one card, a hand that is the same cards as the bottom of the deck). A null is
 * a position that cannot test the zone, and is left out of the count rather than scored as a pass.
 */
export function withHiddenChanged(state: GameState, zone: HiddenZone): GameState | null {
  const me = state.activePlayer
  const them = opponentOf(me)
  const theirs = state.players[them]
  let changed: GameState
  switch (zone) {
    case 'theirHand': {
      const swap = traded(theirs.hand, theirs.deck)
      changed = withPlayer(state, them, { hand: swap.held, deck: swap.deck })
      break
    }
    case 'theirDeckOrder':
      changed = withPlayer(state, them, { deck: rotated(theirs.deck) })
      break
    case 'theirResources': {
      // Only the cards the mover cannot see: a resource the mover owns is face up to it (CR 1.7.5).
      const hiddenAt = theirs.resources.flatMap((r, i) => (r.owner === me ? [] : [i]))
      const swap = traded(hiddenAt.map(i => theirs.resources[i].cardId), theirs.deck)
      const resources = theirs.resources.map((r, i) => {
        const at = hiddenAt.indexOf(i)
        return at === -1 ? r : { ...r, cardId: swap.held[at] }
      })
      changed = withPlayer(state, them, { resources, deck: swap.deck })
      break
    }
    case 'ownDeckOrder':
      changed = withPlayer(state, me, { deck: rotated(state.players[me].deck) })
      break
  }
  return JSON.stringify(changed.players) === JSON.stringify(state.players) ? null : changed
}

/** Every position of a played game in which a bot is asked to think, in the order they arose. */
export function decisionPositions(initialState: GameState, moves: { action: Action }[]): GameState[] {
  const positions: GameState[] = []
  let state = initialState
  for (const move of moves) {
    // The setup heuristic answers setup, and never consults a search.
    if (setupAi(state) === null && state.concessionOffer === undefined && move.action.type !== 'offerConcession') {
      positions.push(state)
    }
    state = resolve(state, move.action)
  }
  return positions
}

/** The decision positions of whole seeded games between one bot and itself, first player alternating. */
export function positionsFromGames(
  ai: Ai,
  seeds: number[],
  inputs: { deck: ParsedDeck; cardDb: CardDb },
): GameState[] {
  return seeds.flatMap((seed, i) => {
    const game = playGame({
      deckPlayer: inputs.deck, deckOpponent: inputs.deck, cardDb: inputs.cardDb,
      aiPlayer: ai, aiOpponent: ai, firstPlayer: i % 2 === 0 ? 'player' : 'opponent', seed,
    })
    return decisionPositions(game.initialState!, game.moves)
  })
}

/** A game's ordinary decisions: action phase, nothing owed, every third such position. */
export function quietActionPositions(positions: GameState[], every = 3): GameState[] {
  return positions
    .filter(s => s.phase === 'action' && (s.pendingChoices ?? []).length === 0)
    .filter((_, i) => i % every === 0)
}

/** The decisions that answer a choice, which a quiet sample leaves out: every third of them. */
export function choicePositions(positions: GameState[], every = 3): GameState[] {
  return positions
    .filter(s => (s.pendingChoices ?? []).length > 0)
    .filter((_, i) => i % every === 0)
}

/**
 * The two fixed sets of games the probe reads its positions from, played by `greedy` because that
 * takes seconds where the shipped bot takes minutes, and the positions only have to be real.
 *
 * - `mirror`: ten games on the bench deck, which is thirty units, so what is hidden is bodies.
 * - `coverage`: one game on each of the first ten coverage decks, which between them hold events,
 *   upgrades and the cards that search, draw and discard, so a hidden card can matter in more ways.
 *
 * Positions are addressed by their index in `quietActionPositions` of these, so the sets must not
 * change: a test that names an index is naming one board.
 */
export function probeGames(source: 'mirror' | 'coverage'): GameState[] {
  if (source === 'mirror') {
    return positionsFromGames(greedyAi, Array.from({ length: 10 }, (_, i) => i + 1), benchInputs())
  }
  const set = benchDeckSet('coverage', 1)
  return set.decks.slice(0, 10).flatMap((d, i) =>
    positionsFromGames(greedyAi, [100 + i], { deck: d.player, cardDb: set.cardDb }))
}

export interface ProbeCount {
  /** Positions where the zone could be changed at all. */
  asked: number
  /** Indexes, into the positions given, of those where the bot's move changed with it. */
  changed: number[]
  /**
   * Indexes of those where what the search valued a candidate at changed, whether or not the move
   * did. The finer reading: a value that moves with a hidden card is a leak that has not yet found
   * the position where it changes a move. Empty for a bot that records no search trace.
   */
  revalued: number[]
}

/** The move a bot makes and, where it ran a search, what it valued every candidate at. */
function decision(ai: Ai, state: GameState): { move: string; values: string } {
  clearSearchTrace()
  const move = JSON.stringify(ai(state))
  return { move, values: JSON.stringify(lastSearchTrace()?.candidates ?? null) }
}

/** Ask `ai` for its move on each position and on each variant of it, and count the ones that differ. */
export function probeHidden(
  ai: Ai,
  positions: GameState[],
  zones: HiddenZone[] = HIDDEN_ZONES,
): Record<HiddenZone, ProbeCount> {
  const counts = Object.fromEntries(
    zones.map(z => [z, { asked: 0, changed: [] as number[], revalued: [] as number[] }]),
  ) as Record<HiddenZone, ProbeCount>
  positions.forEach((state, index) => {
    let played: { move: string; values: string } | undefined
    for (const zone of zones) {
      const variant = withHiddenChanged(state, zone)
      if (variant === null) continue
      played ??= decision(ai, state)
      const again = decision(ai, variant)
      counts[zone].asked++
      if (again.move !== played.move) counts[zone].changed.push(index)
      if (again.values !== played.values) counts[zone].revalued.push(index)
    }
  })
  return counts
}

/**
 * What a probe found, by zone, with zones that found nothing left out: `{}` is a bot that read
 * nothing. `ids` names the positions given, so a failure says which boards rather than which rows.
 */
export function found(
  counts: Record<HiddenZone, ProbeCount>,
  what: 'changed' | 'revalued',
  ids?: number[],
): Partial<Record<HiddenZone, number[]>> {
  return Object.fromEntries(
    Object.entries(counts)
      .filter(([, c]) => c[what].length > 0)
      .map(([zone, c]) => [zone, c[what].map(i => ids?.[i] ?? i)]),
  )
}
