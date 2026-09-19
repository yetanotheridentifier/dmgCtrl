import type { EngineCard } from './types'

/**
 * Token upgrades — Shield, Experience, Advantage, Weakness. These aren't deck cards;
 * abilities create them and attach them to a unit (they live in `unit.upgrades`
 * like card upgrades). They're modelled as built-in `token` cards always present
 * in the card db, so the stats/keyword helpers pick them up for free:
 *  - **Experience**: a +1/+1 stat upgrade.
 *  - **Shield**: prevents one instance of incoming damage, then is removed.
 *  - **Advantage**: +1/0 until the unit next completes an attack or defence, then
 *    removed.
 *  - **Weakness**: a -1/-1 stat upgrade with the Condition trait and no text (the publisher's card
 *    list; the comprehensive rules predate it). A unit it takes to 0 HP is defeated by the
 *    state-based sweep that closes every action.
 * On defeat a unit's tokens cease to exist rather than going to a discard pile.
 */

export const TOKEN_EXPERIENCE = 'TOKEN_EXPERIENCE'
export const TOKEN_SHIELD = 'TOKEN_SHIELD'
export const TOKEN_ADVANTAGE = 'TOKEN_ADVANTAGE'
export const TOKEN_WEAKNESS = 'TOKEN_WEAKNESS'

function tokenCard(id: string, name: string, power: number, hp: number, frontArt: string, traits: string[] = []): EngineCard {
  return { id, name, type: 'token', cost: 0, power, hp, aspects: [], traits, keywords: [], unique: false, frontArt }
}

// Official token card art (cdn.swu-db.com) — routed through the art proxy by `artUrl`. swu-db has no
// HMW tokens, so Weakness comes from the publisher's CDN, which serves under a doubled slash (see
// `tokenUnits.ts`).
const CDN = 'https://cdn.swu-db.com/images/cards'
const FFG = 'https://cdn.starwarsunlimited.com/'

/** Built-in token upgrades, merged into every card db. */
export const TOKEN_CARDS: Record<string, EngineCard> = {
  [TOKEN_EXPERIENCE]: tokenCard(TOKEN_EXPERIENCE, 'Experience', 1, 1, `${CDN}/SOR/T01.png`),
  [TOKEN_SHIELD]: tokenCard(TOKEN_SHIELD, 'Shield', 0, 0, `${CDN}/LOF/T02.png`),
  [TOKEN_ADVANTAGE]: tokenCard(TOKEN_ADVANTAGE, 'Advantage', 1, 0, `${CDN}/ASH/T02.png`),
  [TOKEN_WEAKNESS]: tokenCard(TOKEN_WEAKNESS, 'Weakness', -1, -1, `${FFG}/09010_T02_EN_Weakness_b4a7e89d32.png`, ['Condition']),
}

/** Remove the first element matching `pred` (one token); same ref if none match. */
export function removeFirst<T>(arr: T[], pred: (x: T) => boolean): T[] {
  const i = arr.findIndex(pred)
  return i === -1 ? arr : arr.filter((_, j) => j !== i)
}

/** True if the unit carries at least one token of the given kind. */
export function hasToken(upgrades: { cardId: string }[], tokenId: string): boolean {
  return upgrades.some(u => u.cardId === tokenId)
}
