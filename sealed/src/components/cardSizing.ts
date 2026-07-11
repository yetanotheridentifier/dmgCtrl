/** A standard 2.5"×3.5" card rendered 1:1 on a 96 CSS-DPI display (short edge). */
export const FULL_CARD_WIDTH_PX = 240
/** Board/hand cards use a 50%-of-full short edge; roll-over zoom (#321) enlarges to 100%. */
export const CARD_WIDTH_PX = Math.round(FULL_CARD_WIDTH_PX * 0.5) // 120

/** The roll-over zoom short edge — full size (#321). The one place the zoom scale lives. */
export const ZOOM_WIDTH_PX = FULL_CARD_WIDTH_PX // 240

/** Portrait cards are 5:7; the long edge is 7/5 of the short edge. */
export function longEdge(shortPx: number): number {
  return Math.round((shortPx * 7) / 5)
}
