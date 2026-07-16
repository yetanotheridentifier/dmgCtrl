import type { EngineCard } from './types'

/**
 * Token upgrades (#308) — Shield, Experience, Advantage. These aren't deck cards;
 * abilities create them and attach them to a unit (they live in `unit.upgrades`
 * like card upgrades). They're modelled as built-in `token` cards always present
 * in the card db, so the stats/keyword helpers pick them up for free:
 *  - **Experience**: a +1/+1 stat upgrade.
 *  - **Shield**: prevents one instance of incoming damage, then is removed.
 *  - **Advantage**: +1/0 until the unit next completes an attack or defence, then
 *    removed (#334).
 * On defeat a unit's tokens cease to exist rather than going to a discard pile.
 */

export const TOKEN_EXPERIENCE = 'TOKEN_EXPERIENCE'
export const TOKEN_SHIELD = 'TOKEN_SHIELD'
export const TOKEN_ADVANTAGE = 'TOKEN_ADVANTAGE'

function tokenCard(id: string, name: string, power: number, hp: number, frontArt: string): EngineCard {
  return { id, name, type: 'token', cost: 0, power, hp, aspects: [], traits: [], keywords: [], unique: false, frontArt }
}

// Official token card art (cdn.swu-db.com) — routed through the art proxy by `artUrl`.
const CDN = 'https://cdn.swu-db.com/images/cards'

/** Built-in token upgrades, merged into every card db (#308). */
export const TOKEN_CARDS: Record<string, EngineCard> = {
  [TOKEN_EXPERIENCE]: tokenCard(TOKEN_EXPERIENCE, 'Experience', 1, 1, `${CDN}/SOR/T01.png`),
  [TOKEN_SHIELD]: tokenCard(TOKEN_SHIELD, 'Shield', 0, 0, `${CDN}/LOF/T02.png`),
  [TOKEN_ADVANTAGE]: tokenCard(TOKEN_ADVANTAGE, 'Advantage', 1, 0, `${CDN}/ASH/T02.png`),
}

/** Remove the first element matching `pred` (one token); same ref if none match. */
export function removeFirst<T>(arr: T[], pred: (x: T) => boolean): T[] {
  const i = arr.findIndex(pred)
  return i === -1 ? arr : arr.filter((_, j) => j !== i)
}

/** True if the unit carries at least one token of the given kind (#308). */
export function hasToken(upgrades: { cardId: string }[], tokenId: string): boolean {
  return upgrades.some(u => u.cardId === tokenId)
}
