/**
 * Bounty keyword implementation.
 *
 * The Bounty keyword grants a reward to the opponent when the unit
 * bearing it is either defeated or captured.  The reward is defined
 * by the `bounty` property on the unit (a numeric value).
 *
 * This file exports a single trigger function that is invoked by
 * the game engine whenever a unit is defeated or captured.
 */

import type { Game, Unit, Event } from '../types';

/**
 * Handles the Bounty keyword.
 *
 * @param event - The event that triggered this function.  Must be
 *                either a 'defeat' or 'capture' event.
 * @param game  - The current game instance.
 */
export function bountyTrigger(event: Event, game: Game): void {
  if (event.type !== 'defeat' && event.type !== 'capture') {
    return;
  }

  const unit = event.unit;
  const bounty = unit.bounty ?? 0;

  if (bounty > 0) {
    const opponent = game.getOpponent(unit.owner);
    opponent.addReward(bounty);
  }
}
