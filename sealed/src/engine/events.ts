/**
 * Event dispatcher for the sealed game engine.
 *
 * This module is responsible for routing game events to the
 * appropriate keyword handlers.  It is intentionally lightweight
 * so that individual keyword modules can remain independent.
 */

import type { Game, Event } from '../types';
import { bountyTrigger } from '../keywords/bounty';
import { captureTrigger } from '../keywords/capture';
import { defeatTrigger } from '../keywords/defeat';

/**
 * Dispatches an event to all relevant keyword handlers.
 *
 * @param event - The event to dispatch.
 * @param game  - The current game instance.
 */
export function dispatchEvent(event: Event, game: Game): void {
  // Bounty triggers on defeat or capture
  if (event.type === 'defeat' || event.type === 'capture') {
    bountyTrigger(event, game);
  }

  // Capture keyword
  if (event.type === 'capture') {
    captureTrigger(event, game);
  }

  // Defeat keyword
  if (event.type === 'defeat') {
    defeatTrigger(event, game);
  }

  // ... other keyword triggers can be added here
}
