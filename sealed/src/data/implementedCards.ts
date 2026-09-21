/**
 * List of cards that are currently implemented in the engine.
 *
 * Cards that are not yet supported are commented out or listed in the
 * `blockedCards` array.  The capture mechanic for **ASH_062 The Mandalorian**
 * was previously blocked because the capture half of the effect was missing.
 *
 * With the addition of `captureUnit` (see `engine/effects.ts`) the card can now
 * be considered implemented, so we remove it from the blocked list.
 */

export const implementedCards = [
  // ... many other card IDs ...
  "ASH_062", // The Mandalorian – now fully supported (capture + release)
  // ... other cards ...
];

/**
 * Cards that are still pending implementation.
 *
 * Keeping this list up‑to‑date helps the CI pipeline surface missing
 * functionality early.
 */
export const blockedCards = [
  // Previously blocked because capture was missing:
  // "ASH_062",
  // ... other blocked cards ...
];
