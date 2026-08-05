import type { Action } from '../engine/actions'
import type { GameState, PlayerId } from '../engine/types'

/**
 * Per-card play coverage: which cards a run actually PLAYED, as distinct from which cards sat in a
 * deck it never drew from.
 *
 * Card-implementation tickets assert "every card in this group was played at least once during the
 * run". Counting decks cannot back that claim: a card can be in every deck of a sweep, never be
 * drawn, and still look covered.
 *
 * ## Why this reads state rather than actions
 *
 * A card reaches play by several routes: played from hand, from the resource zone (The Armorer),
 * from the deck (Clan Wren Loyalist, Admiral Ackbar), or discounted from hand (Crix Madine). Several
 * arrive as an `acceptChoice` whose `handIndex` or `deckIndex` means something different per pending
 * choice, so a mapping written against action shapes would have to know every choice kind and would
 * rot as new ones land. A card sitting in play got there by being played, whichever route it took.
 *
 * Events are the exception: they never persist. They resolve to the discard pile, but so does a card
 * discarded from hand, so the pile would over-credit. For events the `playEvent` action is the only
 * unambiguous signal.
 *
 * ## It under-counts on purpose
 *
 * An event played through a choice rather than through `playEvent` is missed. That is the intended
 * direction of error: under-counting yields a false "uncovered", which is visible and gets
 * investigated, while over-counting yields a false "covered", which is the silent lie this exists to
 * prevent.
 */

/**
 * Order card ids the way a person reads them: set, then collector number as a NUMBER.
 *
 * A plain string sort puts `TS26_10` before `TS26_3`, because only some sets zero-pad. ASH does,
 * which is why the flaw stays invisible until another set is in play.
 */
export function compareCardIds(a: string, b: string): number {
  const parse = (id: string): [string, number] => {
    const cut = id.lastIndexOf('_')
    return cut === -1 ? [id, Number.NaN] : [id.slice(0, cut), Number(id.slice(cut + 1))]
  }
  const [setA, numA] = parse(a)
  const [setB, numB] = parse(b)
  if (setA !== setB) return setA < setB ? -1 : 1
  // An unparseable number falls back to string order rather than to NaN, which would make the
  // comparator inconsistent and the sort order arbitrary.
  if (Number.isNaN(numA) || Number.isNaN(numB)) return a < b ? -1 : a > b ? 1 : 0
  return numA - numB
}

export interface PlayCoverage {
  /** Card ids seen in a hand: dealt, drawn, or returned there. */
  drawn: Set<string>
  /** Deck-card ids seen in play, or resolved as an event. Excludes leaders. */
  played: Set<string>
  /** Leader ids that actually deployed. Kept apart: a leader is in play from the first turn, so
   *  folding it in would credit a free card per deck and hide whether the deployed side ever ran. */
  leadersDeployed: Set<string>
}

const SEATS: readonly PlayerId[] = ['player', 'opponent']

export function newCoverage(): PlayCoverage {
  return { drawn: new Set(), played: new Set(), leadersDeployed: new Set() }
}

/** Fold everything visible in this position into the coverage. Idempotent, so it is safe per step. */
export function observeState(cov: PlayCoverage, state: GameState): void {
  for (const seat of SEATS) {
    const p = state.players[seat]
    for (const id of p.hand) cov.drawn.add(id)
    for (const u of p.units) {
      // A deployed leader lives in units[] with isLeader, which is what makes deployment observable
      // here rather than needing the deployLeader action.
      if (u.isLeader) cov.leadersDeployed.add(u.cardId)
      else cov.played.add(u.cardId)
      // Upgrades count either way, including those attached to a deployed leader.
      for (const up of u.upgrades) cov.played.add(up.cardId)
    }
  }
}

/**
 * Credit a card played straight from hand.
 *
 * Two cases need this rather than state observation:
 *
 * - **Events** never persist. They resolve to the discard, and so does a card discarded from hand,
 *   so the pile would over-credit.
 * - **Anything that enters and leaves play within a single action.** Coverage is observed between
 *   actions, so a card that is played and defeated inside one `resolve` is never seen in `units[]`.
 *   A card whose defeat is a *choice* is not this case, since answering the choice is its own action
 *   and leaves an observation point while the card is still in play.
 *
 * Deliberately narrow. `resourceCard` and `setupResource` carry a `handIndex` of exactly the same
 * shape and are not plays, so anything else is ignored rather than guessed at.
 */
const PLAYS_FROM_HAND = new Set(['playUnit', 'playUpgrade', 'playEvent'])

export function observeAction(cov: PlayCoverage, state: GameState, action: Action): void {
  if (!PLAYS_FROM_HAND.has(action.type)) return
  const { handIndex } = action as Extract<Action, { handIndex: number }>
  const id = state.players[state.activePlayer].hand[handIndex]
  if (id) cov.played.add(id)
}
