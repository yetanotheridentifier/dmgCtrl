/**
 * Engine effect utilities for the Sealed game.
 *
 * This file contains pure functions that take a `GameState` and return a new
 * `GameState` with the requested mutation applied.  All effects are immutable –
 * they never modify the input state directly.
 *
 * The capture mechanic was previously missing.  The `captureUnit` effect below
 * implements the “capture a unit” half of the `releaseCaptured` / `captureUnit`
 * pair used by cards such as **ASH_062 The Mandalorian**.
 *
 * The implementation follows the same conventions as the other effects in this
 * file (e.g. `damageUnit`, `moveUnit`, `releaseCaptured`).  It:
 *
 * 1. Validates that the captor and target exist and belong to opposing players.
 * 2. Removes the target unit from the opponent’s board.
 * 3. Adds the target unit’s identifier to the captor’s `capturedUnits` set.
 *
 * The `GameState` type lives in `sealed/src/engine/types.ts`.  The shape of the
 * relevant parts is reproduced here for clarity:
 *
 * 