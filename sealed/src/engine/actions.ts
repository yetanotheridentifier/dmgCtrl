/**
 * Core action handlers for the sealed game engine.
 *
 * These functions are the entry points for game actions such as
 * defeating or capturing a unit.  They now use the event dispatcher
 * to ensure that keyword effects (including Bounty) are processed.
 */

import type { Game, Unit } from '../types';
import { dispatchEvent } from './events';

/**
 * Handles the defeat of a unit.
 *
 * @param unit - The unit being defeated.
 * @param game - The current game instance.
 */
export function defeatUnit(unit: Unit, game: Game): void {
  // Mark the unit as defeated
  unit.isDefeated = true;

  // Dispatch the defeat event so that keywords can react
  dispatchEvent({ type: 'defeat', unit }, game);
}

/**
 * Handles the capture of a unit.
 *
 * @param unit - The unit being captured.
 * @param game - The current game instance.
 */
export function captureUnit(unit: Unit, game: Game): void {
  // Mark the unit as captured
  unit.isCaptured = true;

  // Dispatch the capture event so that keywords can react
  dispatchEvent({ type: 'capture', unit }, game);
}
