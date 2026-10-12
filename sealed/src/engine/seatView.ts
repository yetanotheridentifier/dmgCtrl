import { UNSEEN_CARD } from './resolve'
import type { GameState, HeldTriggers, PlayerId, PlayerState } from './types'

/**
 * A game state as one seat sees it: the same shape, with what that seat cannot see taken out.
 *
 * The state the engine resolves holds everything, both hands and both decks in draw order included.
 * This is the one definition of what a seat may read off it, for anything that must not learn from
 * a card its seat never saw. It is a pure function of one state and changes nothing it is given.
 *
 * **The guarantee is one-sided.** Two states that differ only in what the seat cannot see have the
 * same view, so nothing hidden can be read back out of one, by any field. The converse does not
 * hold: a view can hide something the seat does know (see "what it cannot give back" below). It
 * errs towards hiding.
 *
 * What the seat cannot see follows the rules (CR 17, and the zone rules in CR 4): a hand and
 * face-down resources are hidden from the opponent, a deck's cards from both players, and the size
 * of every zone, the discard piles, everything in play and every captured card are open.
 *
 * | part of the state | in the view |
 * | --- | --- |
 * | the other seat's hand and deck | one `UNSEEN_CARD` a card: the size and nothing else |
 * | the other seat's resources | `UNSEEN_CARD` for the card, the ready or exhausted state kept. A resource the viewing seat owns is open (CR 1.7.5) and stays |
 * | the seat's own deck | its cards, sorted: which cards are left is known from the deck list, their order is not |
 * | `rngSeed` | 0. It advances on every move and seeds the mulligan shuffle, so with a known deck list it leads back to a deck's order |
 * | `pendingChoices`, `pendingTriggers`, `heldTriggers` | only the seat's own. What the other seat is asked or owed is dropped whole |
 * | `triggerTurn`, `paying`, `resolvingSource` | dropped: the resolver's bookkeeping, which is about work the view no longer holds or is never set at rest |
 * | everything else | as it is: the seat's own hand and resources, both discard piles, units, upgrades, captured cards, leaders, bases, tokens, and every phase, turn and effect field |
 *
 * **The other seat's choices and owed abilities go whole, not field by field.** A choice carries
 * what its chooser is shown (the cards a search turned up, the hand cards an ability may play), an
 * owed ability can belong to a card still in a hand ("when you draw this card"), and whether either
 * is there at all can depend on a hidden card. There are too many kinds to rule on one at a time,
 * and a kind added later would be let through by default.
 *
 * **Hidden cards are `UNSEEN_CARD`**, the id the simulated regroup already puts in a hand it must
 * not read (`GameState.simulatedRegroup`): it is in no card database, and every reader of a hand or
 * a resource already guards an id it cannot look up.
 *
 * **The card database is not part of the view.** `cards` is passed through as it is. A database
 * built from exactly the two decks would itself say what the other deck holds, so a caller that
 * hands a view on strips it or uses a whole set's.
 *
 * ## What it cannot give back
 *
 * The state records where every card is, not who has been shown it, so one state cannot say what a
 * seat has learned. The view therefore hides, although the seat knows them:
 *
 * - a card it looked at, was shown or searched past earlier, and where it put a card it placed on
 *   the top or bottom of a deck;
 * - a card it watched go back into a hand or a deck from somewhere open (a unit returned to hand);
 * - the cards a choice of its own shows it by pointing at a zone instead of carrying them (looking
 *   at a hand): the choice is kept and the zone is still unseen;
 * - the abilities the other seat is owed, which the rules let both players see in most cases.
 *
 * It also assumes the seat does not know the other deck's list.
 */
export function seatView(state: GameState, seat: PlayerId): GameState {
  const other: PlayerId = seat === 'player' ? 'opponent' : 'player'
  const { pendingChoices, pendingTriggers, heldTriggers, triggerTurn, paying, resolvingSource, ...open } = state
  void triggerTurn
  void paying
  void resolvingSource

  const choices = pendingChoices?.filter(c => c.controller === seat) ?? []
  const triggers = pendingTriggers?.filter(t => t.controller === seat) ?? []
  const held = heldTriggers?.map((h): HeldTriggers => ({ attackerId: h.attackerId, triggers: h.triggers.filter(t => t.controller === seat) })) ?? []

  return {
    ...open,
    rngSeed: 0,
    players: {
      [seat]: ownSide(state.players[seat]),
      [other]: otherSide(state.players[other], seat),
    } as Record<PlayerId, PlayerState>,
    // Left out when empty, so a view does not say that something of the other seat's was taken.
    ...(choices.length > 0 && { pendingChoices: choices }),
    ...(triggers.length > 0 && { pendingTriggers: triggers }),
    ...(held.length > 0 && { heldTriggers: held }),
  }
}

/** The viewing seat's own side: all of it, with the deck as its cards and not their order. */
function ownSide(p: PlayerState): PlayerState {
  return { ...p, deck: [...p.deck].sort() }
}

/** The other seat's side: its hidden zones as sizes, and everything open as it is. */
function otherSide(p: PlayerState, viewer: PlayerId): PlayerState {
  return {
    ...p,
    hand: p.hand.map(() => UNSEEN_CARD),
    deck: p.deck.map(() => UNSEEN_CARD),
    resources: p.resources.map(r => (r.owner === viewer ? r : { ...r, cardId: UNSEEN_CARD })),
  }
}
