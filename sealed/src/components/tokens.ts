export type TokenOrientation = 'portrait' | 'landscape'

/** Centre of a token, as a percentage of the card slot (both axes). */
export interface TokenPos {
  left: number
  top: number
}

/**
 * Token size in px — a rounded rectangle, wide enough to hold two digits (damage
 * tops out around 20). The number inside is ~60% of the token height. Kept small
 * enough that four sit alongside each other on an exhausted (landscape) card
 * without touching the borders or each other.
 */
export const TOKEN_W = 32
export const TOKEN_H = 26

/**
 * Where 1–4 effect tokens (damage, and later others) sit on a unit card,
 * representing physical tokens — placed over the **middle of the art** so the
 * cost/name (top), ability text (bottom) and power/HP (corners) stay visible.
 *
 * - **Ready (portrait):** a cluster centred on the art, building up 1 → row-of-2
 *   → 2-over-1 → 2×2.
 * - **Exhausted (landscape):** a single row centred on the art; it widens
 *   symmetrically as tokens are added (upright, since the card is rotated).
 */
export function tokenLayout(count: number, orientation: TokenOrientation): TokenPos[] {
  const n = Math.max(0, Math.min(count, 4))
  if (orientation === 'portrait') {
    const L = 34, R = 66, MID = 50, TOP = 33, BOT = 49, ART = 41
    const byCount: Record<number, TokenPos[]> = {
      0: [],
      1: [{ left: MID, top: ART }],
      2: [{ left: L, top: ART }, { left: R, top: ART }],
      3: [{ left: L, top: TOP }, { left: R, top: TOP }, { left: MID, top: BOT }],
      4: [{ left: L, top: TOP }, { left: R, top: TOP }, { left: L, top: BOT }, { left: R, top: BOT }],
    }
    return byCount[n]
  }
  // Landscape: a row centred on the art, widening symmetrically as tokens accrue.
  const spacing = 24
  return Array.from({ length: n }, (_, i) => ({ left: 50 + (i - (n - 1) / 2) * spacing, top: 50 }))
}
